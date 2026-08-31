// The 24/7 paper-trading loop (ESM). Runs on the cron trigger.
import { MARKETS, isOpen } from './markets.js';
import { fetchDailyCandles } from './data.js';
import { computeSignal } from './strategy.js';
import { deliverEvents } from './webhooks.js';

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// Open/close the paper position for one market given its computed signal.
// `cost` is the round-turn transaction cost (commission + slippage) deducted from
// every closed trade so the record is NET — never gross.
export async function processPosition({ symbol, meta, sig, live, open, store, now, risk, cost = 0 }) {
  const pos = await store.get('POS#OPEN', symbol);
  if (pos) {
    const price = live ?? sig.price;
    const short = pos.side === 'SHORT';
    let exit = null;
    if (short ? price >= pos.stop : price <= pos.stop) exit = 'stop';
    else if (sig.lastDaily && dayKey(sig.lastDaily.t) !== dayKey(pos.openedAt) && sig.lastDaily.t > pos.openedAt && (short ? sig.lastDaily.up === false : sig.lastDaily.up === true)) exit = short ? 'firstDownClose' : 'firstUpClose';
    else if (now - pos.openedAt > pos.maxHoldMin * 60000) exit = 'timeStop';
    if (!exit) return 'hold';
    const r = pos.risk || Math.abs(pos.entry - pos.stop) || 1e-9;
    const resultR = (short ? (pos.entry - price) : (price - pos.entry)) / r;
    const gross = resultR * (pos.riskDollars || risk);
    const pnl = Math.round(gross - cost); // NET of round-turn cost
    const outcome = pnl > 0 ? 'Win' : pnl < 0 ? 'Loss' : 'Break-even';
    await store.put({ pk: 'TRADE', sk: `${String(now).padStart(16, '0')}#${symbol}`, symbol, name: meta.name, side: short ? 'SHORT' : 'LONG', entry: pos.entry, exit: price, resultR: +resultR.toFixed(3), pnl, cost, riskDollars: pos.riskDollars || risk, outcome, exitReason: exit, openedAt: pos.openedAt, closedAt: now });
    await store.del('POS#OPEN', symbol);
    await store.put({ pk: 'LASTCLOSE', sk: symbol, signalDay: dayKey(now), at: now });
    return `exit:${exit}`;
  }
  if ((sig.verdict === 'BUY' || sig.verdict === 'SELL') && sig.plan && open) {
    const lastClose = await store.get('LASTCLOSE', symbol);
    if (lastClose && lastClose.signalDay === dayKey(now)) return 'skip:tradedToday';
    const short = sig.verdict === 'SELL';
    const entry = live ?? sig.plan.entry;
    const r = sig.plan.risk || Math.abs(sig.plan.entry - sig.plan.stop);
    await store.put({ pk: 'POS#OPEN', sk: symbol, symbol, name: meta.name, side: short ? 'SHORT' : 'LONG', entry, stop: short ? entry + r : entry - r, target1: short ? entry - r : entry + r, risk: r, riskDollars: risk, conviction: sig.conviction, maxHoldMin: sig.plan.maxHoldMin, exitRule: short ? 'firstDownClose' : 'firstUpClose', openedAt: now });
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
  for (const symbol of Object.keys(MARKETS)) {
    try {
      const meta = MARKETS[symbol];
      const { candles, live, liveTime } = await fetchDailyCandles(meta, env);
      const sig = computeSignal(candles, live);
      const now = Date.now();
      // A verdict that flips INTO BUY/SELL (vs last tick) is a fresh signal.
      const prev = bySym[symbol];
      const actionable = sig.verdict === 'BUY' || sig.verdict === 'SELL';
      if (actionable && (!prev || prev.verdict !== sig.verdict)) {
        events.push({ type: 'signal', event: sig.verdict, symbol, name: meta.name, price: live ?? sig.price, strategy: strategyLabel, plan: sig.plan, signal: sig, at: now });
      }
      const prevClose = candles.length >= 2 ? candles[candles.length - 2].c : (candles.length ? candles[candles.length - 1].c : null);
      // Recent daily closes (timestamped) so the app charts real price action and
      // can position trade markers by time — not a flat SIM line.
      const history = candles.slice(-64).map((c) => ({ t: c.t, c: Math.round(c.c * 100) / 100 }));
      bySym[symbol] = { symbol, name: meta.name, updatedAt: now, ...sig, live, liveTime, prevClose, history };
      const res = await processPosition({ symbol, meta, sig, live, open: isOpen(meta), store, now, risk, cost });
      if (res === 'open') {
        events.push({ type: 'position.open', event: 'open', symbol, name: meta.name, price: live ?? sig.price, strategy: strategyLabel, plan: sig.plan, signal: sig, at: now });
      } else if (typeof res === 'string' && res.startsWith('exit:')) {
        events.push({ type: 'position.close', event: res.slice(5), symbol, name: meta.name, price: live ?? sig.price, strategy: strategyLabel, signal: sig, at: now });
      }
    } catch (e) { /* skip this market this tick — its last-known signal is carried forward */ }
  }
  // ONE write for all markets' signals (was one-per-market). Cuts KV writes ~8x
  // so the Worker fits Cloudflare's free tier alongside the account's other apps.
  await store.put({ pk: 'SIGNALS', sk: 'ALL', updatedAt: Date.now(), signals: Object.values(bySym) });
  // Fan out the fresh events to registered Pro webhooks (best-effort).
  try { await deliverEvents(store, events); } catch (e) { /* delivery never blocks trading */ }
  return { events: events.length };
}
