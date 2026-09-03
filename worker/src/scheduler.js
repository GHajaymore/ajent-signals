// The 24/7 paper-trading loop (ESM). Runs on the cron trigger.
import { MARKETS, isOpen } from './markets.js';
import { fetchDailyCandles } from './data.js';
import { computeSignal } from './strategy.js';
import { deliverEvents } from './webhooks.js';
import { STRATEGY } from './meta.js';
import { computeAdaptive } from './adaptive.js';
import { highImpactToday } from './calendar.js';
import { computeTrend, trendShouldExit } from './trend.js';

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// Meaningful transitions for the per-market signal timeline (verdict flips,
// proximity milestones, deep-oversold). Honest, real-state changes only — nothing
// fabricated. Returns short human strings.
function changeEvents(prev, sig) {
  const ev = [];
  const pv = prev && prev.verdict, nv = sig.verdict;
  if (pv && pv !== nv) {
    if (nv === 'BUY') ev.push(`Fired a BUY — oversold dip (RSI2 ${sig.rsi2}) in an uptrend.`);
    else if (nv === 'SELL') ev.push(`Fired a SELL — overbought pop (RSI2 ${sig.rsi2}) in a downtrend.`);
    else if (pv === 'BUY' || pv === 'SELL') ev.push('Setup cleared — back to no-trade.');
  }
  const pp = (prev && prev.proximity) || 0, np = sig.proximity || 0;
  if (nv === 'NO_TRADE') {
    if (pp < 60 && np >= 60) ev.push(`Approaching a setup — ${np}% of the way (RSI2 ${sig.rsi2}).`);
    else if (pp < 100 && np >= 100 && !ev.length) ev.push(`At the trigger — waiting on the flush below the prior day's low (RSI2 ${sig.rsi2}).`);
  }
  const pr = prev && prev.rsi2, nr = sig.rsi2;
  if (typeof pr === 'number' && pr >= 5 && typeof nr === 'number' && nr < 5) ev.push('Deeply oversold (RSI2 < 5) — high-conviction tier.');
  return ev;
}

// Open/close the paper position for one market given its computed signal, mutating
// the in-memory `record` blob ({ open:{}, closed:[], lastClose:{} }). Synchronous:
// the whole record is ONE KV get + ONE KV put per tick (see runTick), so we never
// use KV list() — which is capped at 1,000/day on the free tier and was blowing up
// /trades. `cost` is the round-turn transaction cost, deducted so P&L is NET.
// Mean-reversion exit (the default): stop, the momentum-recovery exit, or time stop.
// `exitRsiOverride` lets the backtest sweep vary the exit; live uses pos.exitAbove.
export function mrShouldExit(sig, pos, price, now, exitRsiOverride) {
  const short = pos.side === 'SHORT';
  const exitRsi = exitRsiOverride ?? pos.exitAbove ?? STRATEGY.exitAbove;
  if (short ? price >= pos.stop : price <= pos.stop) return 'stop';
  if (sig.rsi2 != null && (short ? sig.rsi2 < (100 - exitRsi) : sig.rsi2 > exitRsi)) return 'rsiRecover';
  if (now - pos.openedAt > pos.maxHoldMin * 60000) return 'timeStop';
  return null;
}

export function processPosition({ symbol, meta, sig, live, open, record, now, risk, cost = 0, exitRsi, dials = null, strat = 'mr', shouldExit }) {
  const exitFn = shouldExit || ((s, p, pr, nw) => mrShouldExit(s, p, pr, nw, exitRsi));
  const pos = record.open[symbol];
  if (pos) {
    const price = live ?? sig.price;
    const short = pos.side === 'SHORT';
    const exit = exitFn(sig, pos, price, now); // exit rule is per the position's strategy
    if (!exit) return 'hold';
    const r = pos.risk || Math.abs(pos.entry - pos.stop) || 1e-9;
    const resultR = (short ? (pos.entry - price) : (price - pos.entry)) / r;
    const gross = resultR * (pos.riskDollars || risk);
    const pnl = Math.round(gross - cost); // NET of round-turn cost
    const outcome = pnl > 0 ? 'Win' : pnl < 0 ? 'Loss' : 'Break-even';
    record.closed.unshift({ symbol, name: meta.name, side: short ? 'SHORT' : 'LONG', strat: pos.strat || 'mr', entry: pos.entry, exit: price, resultR: +resultR.toFixed(3), pnl, cost, riskDollars: pos.riskDollars || risk, outcome, exitReason: exit, openedAt: pos.openedAt, closedAt: now });
    if (record.closed.length > 300) record.closed.length = 300;
    delete record.open[symbol];
    record.lastClose[symbol] = { signalDay: dayKey(now), at: now };
    return `exit:${exit}`;
  }
  if ((sig.verdict === 'BUY' || sig.verdict === 'SELL') && sig.plan && open) {
    const lastClose = record.lastClose[symbol];
    if (lastClose && lastClose.signalDay === dayKey(now)) return 'skip:tradedToday';
    const short = sig.verdict === 'SELL';
    const entry = live ?? sig.plan.entry;
    const r = sig.plan.risk || Math.abs(sig.plan.entry - sig.plan.stop);
    // Size = base risk × global size dial × this engine's adaptive weight (bounded).
    const engineW = (dials && dials.engines && dials.engines[strat] && dials.engines[strat].weight) || 1;
    const riskDollars = Math.round(risk * ((dials && dials.sizeMult) || 1) * engineW);
    record.open[symbol] = { symbol, name: meta.name, side: short ? 'SHORT' : 'LONG', strat, entry, stop: short ? entry + r : entry - r, target1: short ? entry - r : entry + r, risk: r, riskDollars, conviction: sig.conviction, maxHoldMin: sig.plan.maxHoldMin, exitRule: strat === 'trend' ? 'trendBreak' : 'rsiRecover', exitAbove: sig.plan.exitAbove, openedAt: now };
    return 'open';
  }
  return 'none';
}

export async function runTick(env, store) {
  const risk = Number(env.RISK_DOLLARS || 250);
  const cost = Number(env.COST_PER_TRADE || 6); // round-turn commission + slippage
  const events = []; // fresh signal/position events to push to Pro webhooks
  const strategyLabel = 'Proven daily (RSI2 mean-reversion)';
  // Read the previous signals blob ONCE (1 KV read) — used for fresh-signal
  // detection and to carry forward any market whose fetch fails this tick.
  const prevBlob = await store.get('SIGNALS', 'ALL');
  const bySym = {};
  if (prevBlob && Array.isArray(prevBlob.signals)) for (const s of prevBlob.signals) bySym[s.symbol] = s;
  // The paper record is ONE blob (open positions + closed trades + per-market
  // last-close guard), read once and written once — no KV list() anywhere.
  const stored = await store.get('RECORD', 'ALL');
  const record = {
    open: (stored && stored.open) || {},
    closed: (stored && stored.closed) || [],
    lastClose: (stored && stored.lastClose) || {},
    migrated: !!(stored && stored.migrated),
    adopted: (stored && stored.adopted) || null, // last-adopted dials (weekly cadence)
  };
  // One-time migration from the old per-key layout to this blob, attempted at most
  // once (the `migrated` flag is then persisted) so we never pin the KV list quota.
  if (!record.migrated) {
    try {
      for (const p of await store.list('POS#OPEN')) if (p && p.symbol) record.open[p.symbol] = p;
    } catch (e) { /* list quota may be spent today; the record starts fresh */ }
    record.migrated = true;
  }
  // The evolving Ajent Strategy learns ONE set of dials globally from the whole
  // pooled record. It ADOPTS a new set on a fixed CADENCE (weekly) rather than
  // every tick — so it adjusts on accumulated evidence, not daily noise — and only
  // within hard bounds (stop 1.5-3× ATR, size 0.6-1.4×) after a real sample (20+
  // trades). Automatic (no human bottleneck) but disciplined. `learned` is the
  // current read (reported); `record.adopted` is what actually trades until the
  // next re-tune. The daily report shows both.
  const RETUNE_MS = 7 * 86400000; // adjust the strategy at most weekly
  const learned = computeAdaptive(record, STRATEGY);
  const nowMs = Date.now();
  if (!record.adopted || (nowMs - (record.adopted.at || 0)) > RETUNE_MS) {
    record.adopted = { stopMult: learned.stopMult, sizeMult: learned.sizeMult, engines: learned.engines, at: nowMs, fromTrades: learned.trades };
  }
  const dials = { stopMult: record.adopted.stopMult, sizeMult: record.adopted.sizeMult, engines: record.adopted.engines || null };
  // Per-market signal timeline (bounded rolling log). Read once, written once only
  // if something changed this tick.
  const histBlob = (await store.get('HISTORY', 'ALL')) || {};
  const hist = histBlob.hist || {};
  let histChanged = false;
  for (const symbol of Object.keys(MARKETS)) {
    try {
      const meta = MARKETS[symbol];
      const { candles, live, liveTime } = await fetchDailyCandles(meta, env);
      // ENSEMBLE: compute both engines. Mean-reversion (the dip-buyer) + trend-
      // follow (continuation). They fire on different conditions, so at most one
      // opens per market; each is managed by its own exit rule.
      const mrSig = computeSignal(candles, live);
      // Express the evolved dials in the MR plan (stop scaled by the global dial).
      if (mrSig.plan && dials && dials.stopMult) {
        const scale = dials.stopMult / STRATEGY.stopAtrMult;
        const long = mrSig.direction > 0;
        const r = mrSig.plan.risk * scale;
        mrSig.plan = { ...mrSig.plan, risk: r, stop: long ? mrSig.plan.entry - r : mrSig.plan.entry + r, target1: long ? mrSig.plan.entry + r : mrSig.plan.entry - r, stopMult: dials.stopMult, sizeMult: dials.sizeMult };
      }
      const trendSig = computeTrend(candles, live);
      const now = Date.now();
      // The signal shown for the market: whichever engine is actionable (dip first,
      // else trend), else the mean-reversion no-trade state.
      const displaySig = mrSig.verdict === 'BUY' ? mrSig : (trendSig.verdict === 'BUY' ? trendSig : mrSig);
      const prev = bySym[symbol];
      const actionable = displaySig.verdict === 'BUY' || displaySig.verdict === 'SELL';
      if (actionable && (!prev || prev.verdict !== displaySig.verdict)) {
        events.push({ type: 'signal', event: displaySig.verdict, symbol, name: meta.name, price: live ?? displaySig.price, strategy: strategyLabel, plan: displaySig.plan, signal: displaySig, at: now });
      }
      const prevClose = candles.length >= 2 ? candles[candles.length - 2].c : (candles.length ? candles[candles.length - 1].c : null);
      const history = candles.slice(-64).map((c) => ({ t: c.t, c: Math.round(c.c * 100) / 100 }));
      const evs = changeEvents(prev, displaySig);
      if (evs.length) {
        hist[symbol] = hist[symbol] || [];
        for (const t of evs) hist[symbol].unshift({ at: now, text: t });
        if (hist[symbol].length > 12) hist[symbol].length = 12;
        histChanged = true;
      }
      // News/event regime filter: stand aside on a high-impact event day.
      const newsHold = highImpactToday(meta.country, new Date(now));
      const dispStrat = displaySig === trendSig ? 'trend' : 'mr';
      bySym[symbol] = { symbol, name: meta.name, updatedAt: now, ...displaySig, live, liveTime, prevClose, history, newsHold: newsHold ? newsHold.name : null, strat: dispStrat };
      const canOpen = isOpen(meta) && !meta.noTrade && !newsHold;
      // Manage the open position with ITS engine's exit; if flat, try MR then trend.
      const pos = record.open[symbol];
      let res;
      if (pos) {
        const isTrend = pos.strat === 'trend';
        res = processPosition({ symbol, meta, sig: isTrend ? trendSig : mrSig, live, open: canOpen, record, now, risk, cost, dials, strat: pos.strat, shouldExit: isTrend ? trendShouldExit : mrShouldExit });
      } else {
        res = processPosition({ symbol, meta, sig: mrSig, live, open: canOpen, record, now, risk, cost, dials, strat: 'mr', shouldExit: mrShouldExit });
        if (res === 'none' && canOpen && trendSig.verdict === 'BUY') {
          res = processPosition({ symbol, meta, sig: trendSig, live, open: canOpen, record, now, risk, cost, dials, strat: 'trend', shouldExit: trendShouldExit });
        }
      }
      if (res === 'open') {
        events.push({ type: 'position.open', event: 'open', symbol, name: meta.name, price: live ?? displaySig.price, strategy: strategyLabel, plan: displaySig.plan, signal: displaySig, at: now });
      } else if (typeof res === 'string' && res.startsWith('exit:')) {
        events.push({ type: 'position.close', event: res.slice(5), symbol, name: meta.name, price: live ?? displaySig.price, strategy: strategyLabel, signal: displaySig, at: now });
      }
    } catch (e) { /* skip this market this tick — its last-known signal is carried forward */ }
  }
  // ONE write for all markets' signals (was one-per-market). Cuts KV writes ~8x
  // so the Worker fits Cloudflare's free tier alongside the account's other apps.
  await store.put({ pk: 'SIGNALS', sk: 'ALL', updatedAt: Date.now(), signals: Object.values(bySym), adaptive: { ...learned, adopted: record.adopted, nextRetune: (record.adopted.at || nowMs) + RETUNE_MS } });
  // One batched write for the whole paper record (was one put/del per position +
  // TRADE + LASTCLOSE keys). /trades now reads this single blob via get — no list.
  await store.put({ pk: 'RECORD', sk: 'ALL', updatedAt: Date.now(), open: record.open, closed: record.closed, lastClose: record.lastClose, migrated: record.migrated, adopted: record.adopted });
  if (histChanged) await store.put({ pk: 'HISTORY', sk: 'ALL', updatedAt: Date.now(), hist });
  // Fan out the fresh events to registered Pro webhooks (best-effort).
  try { await deliverEvents(store, events); } catch (e) { /* delivery never blocks trading */ }
  const fired = events.filter((e) => e.type === 'signal').map((e) => ({ symbol: e.symbol, name: e.name, verdict: e.event, confidence: e.signal && e.signal.confidence }));
  return { events: events.length, signalFired: fired.length > 0, fired };
}
