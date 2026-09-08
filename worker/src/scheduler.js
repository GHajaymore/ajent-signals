// The 24/7 paper-trading loop (ESM). Runs on the cron trigger.
import { MARKETS, isOpen } from './markets.js';
import { fetchDailyCandles } from './data.js';
import { computeSignal } from './strategy.js';
import { deliverEvents } from './webhooks.js';
import { STRATEGY } from './meta.js';
import { computeAdaptive } from './adaptive.js';
import { highImpactToday } from './calendar.js';
import { computeTrend, trendShouldExit } from './trend.js';
import { computeBothMR, bothMRShouldExit } from './bothways.js';
import { labStep } from './lab.js';

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// ADOPTED 2026-09-07: Bollinger %B mean-reversion confirmation on the equity dip-buyer. The
// lab found (indicator-sweep + bollinger-robustness + pb-adopt-check) that requiring the entry
// close to sit low in the bands (%B < 0.30) lifts the indices profit factor from ~2.6 to ~3.6
// with a smooth parameter plateau (0.15–0.40 all improve, so 0.30 is a robust ridge value, not
// a fitted spike). Applied to indices/ETFs only — the edge REVERSES on crypto, which is
// excluded. It gates the MR dip-buy leg only; the trend-follow leg is untouched. TRADE-OFF: it
// is selective, so it makes fewer trades (higher quality/lower drawdown, lower raw total).
const PB_ADOPT_MAX = 0.30;

// FREE-TIER SCAN BUDGET. Each market is one subrequest and Cloudflare's free tier caps
// an invocation at 50 subrequests. Two things keep us safely under it while letting the
// universe grow and the ACTIVE markets stay fresh:
//   1. Scan only markets whose exchange is OPEN this tick. A closed market's price is
//      static, so its last signal carries forward from the stored SIGNALS blob — no
//      wasted fetch. Open markets therefore refresh EVERY tick, not once per rotation.
//   2. If more markets are open at once than the budget allows, rotate a BATCH through
//      the open pool (cursor persisted), so no single tick exceeds the cap.
// Open-position markets are ALWAYS scanned (even if their exchange just closed) so exits
// (stop / RSI / time) are never delayed. MAX_FETCHES hard-bounds board fetches per tick
// so board + the day tick (~4) + KV overhead stays comfortably under 50.
const SCAN_BATCH_SIZE = 30;
const MAX_FETCHES = 34;

// DYNAMIC CADENCE. The cron fires often (every 2 min), but a tick only actually SCANS —
// fetching + writing — when enough time has passed FOR THE CURRENT ACTIVITY LEVEL, judged
// purely by how many MARKETS are open. Cadence is deliberately NOT tied to open positions:
// the paper record is shared server-side (there is no per-user position count), and market
// activity is the universal, user-independent signal. More open markets (a live session) →
// scan sooner; a quiet board → wait longer. This keeps the effective refresh fast during
// live sessions and slow overnight, so the free-tier KV write budget (~1,000/day) isn't
// spent idling. Thresholds sit just under the wall-clock so a tick reliably passes.
//
// ~2 MIN whenever a real session is open (weekdays, ALL regions / ALL open markets), and
// ~5 MIN when only the 24/7 crypto is open (weekends / gaps — nothing else is moving, so
// this protects the free-tier write budget without any loss). openCount cleanly separates
// the two: weekdays have FX + index/commodity futures open (~18), weekends only crypto (2).
// BUDGET MATH: a scan writes ~1 blob most ticks (SIGNALS carries the cursor; RECORD only
// on a real change) + the change-only day tick. Weekday 2-min ≈ ~690 SIGNALS + rare RECORD
// + day ≈ under ~880/day; weekends ≈ ~290/day. Both under the ~1,000/day free KV cap. A
// flat 1 min needs the paid plan (SIGNALS alone would be ~1,440/day).
function scanIntervalMs(openCount) {
  if (openCount >= 6) return 110_000;  // any real market session open → ~2 min (all regions)
  return 290_000;                       // crypto-only (weekend / session gaps) → ~5 min
}

// Meaningful transitions for the per-market signal timeline (verdict flips,
// proximity milestones, deep-oversold). Honest, real-state changes only — nothing
// fabricated. Returns short human strings.
function changeEvents(prev, sig) {
  const ev = [];
  const pv = prev && prev.verdict, nv = sig.verdict;
  if (pv && pv !== nv) {
    // Vague, recipe-free wording — no RSI2 readings or thresholds in the timeline. A
    // trend BUY is a continuation (no rsi2), not an oversold dip.
    if (nv === 'BUY') ev.push(sig.strat === 'trend'
      ? 'Fired a BUY — trend continuation in an established uptrend.'
      : 'Fired a BUY — oversold dip.');
    else if (nv === 'SELL') ev.push('Fired a SELL — overbought pop in a downtrend.');
    else if (pv === 'BUY' || pv === 'SELL') ev.push('Setup cleared — back to no-trade.');
  }
  const pp = (prev && prev.proximity) || 0, np = sig.proximity || 0;
  if (nv === 'NO_TRADE') {
    if (pp < 60 && np >= 60) ev.push(`Approaching a setup — ${np}% of the way.`);
    else if (pp < 100 && np >= 100 && !ev.length) ev.push('At the trigger — waiting on confirmation.');
  }
  const pr = prev && prev.rsi2, nr = sig.rsi2;
  if (typeof pr === 'number' && pr >= 5 && typeof nr === 'number' && nr < 5) ev.push('Deepest-oversold reading — high-conviction tier.');
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

// `openMap`/`lastCloseMap` let a market hold engine-independent position slots (the ensemble
// runs the MR leg into record.open and the trend leg into record.openTrend concurrently, so a
// weeks-long trend hold never blocks the MR dip-buy — see runTick). Both default to the shared
// record maps, so every existing caller (backtests, both-ways, stocks) behaves exactly as before.
export function processPosition({ symbol, meta, sig, live, open, record, now, risk, cost = 0, exitRsi, dials = null, strat = 'mr', shouldExit, openMap, lastCloseMap }) {
  const exitFn = shouldExit || ((s, p, pr, nw) => mrShouldExit(s, p, pr, nw, exitRsi));
  const om = openMap || record.open;
  const lc = lastCloseMap || record.lastClose;
  const pos = om[symbol];
  if (pos) {
    const price = live ?? sig.price;
    const short = pos.side === 'SHORT';
    // Track the peak since entry (long-only) so a trend position can ratchet its
    // trailing stop. Persisted on the record; harmless for mean-reversion (it ignores it).
    pos.peak = Math.max(pos.peak != null ? pos.peak : pos.entry, price);
    const exit = exitFn(sig, pos, price, now); // exit rule is per the position's strategy
    if (!exit) return 'hold';
    const r = pos.risk || Math.abs(pos.entry - pos.stop) || 1e-9;
    const resultR = (short ? (pos.entry - price) : (price - pos.entry)) / r;
    const gross = resultR * (pos.riskDollars || risk);
    const pnl = Math.round(gross - cost); // NET of round-turn cost
    const outcome = pnl > 0 ? 'Win' : pnl < 0 ? 'Loss' : 'Break-even';
    record.closed.unshift({ symbol, name: meta.name, side: short ? 'SHORT' : 'LONG', strat: pos.strat || 'mr', entry: pos.entry, exit: price, resultR: +resultR.toFixed(3), pnl, cost, riskDollars: pos.riskDollars || risk, outcome, exitReason: exit, openedAt: pos.openedAt, closedAt: now, adxEntry: pos.adxEntry ?? null, nearSupport: pos.nearSupport ?? null, adxRange: pos.adxRange ?? null, pbEntry: pos.pbEntry ?? null });
    if (record.closed.length > 300) record.closed.length = 300;
    delete om[symbol];
    lc[symbol] = { signalDay: dayKey(now), at: now };
    return `exit:${exit}`;
  }
  if ((sig.verdict === 'BUY' || sig.verdict === 'SELL') && sig.plan && open) {
    const lastClose = lc[symbol];
    if (lastClose && lastClose.signalDay === dayKey(now)) return 'skip:tradedToday';
    const short = sig.verdict === 'SELL';
    const entry = live ?? sig.plan.entry;
    const r = sig.plan.risk || Math.abs(sig.plan.entry - sig.plan.stop);
    // Size = base risk × global size dial × this engine's adaptive weight (bounded).
    const engineW = (dials && dials.engines && dials.engines[strat] && dials.engines[strat].weight) || 1;
    const riskDollars = Math.round(risk * ((dials && dials.sizeMult) || 1) * engineW);
    om[symbol] = { symbol, name: meta.name, side: short ? 'SHORT' : 'LONG', strat, entry, stop: short ? entry + r : entry - r, target1: short ? entry - r : entry + r, risk: r, riskDollars, conviction: sig.conviction, maxHoldMin: sig.plan.maxHoldMin, exitRule: strat === 'trend' ? 'trailStop' : 'rsiRecover', exitAbove: sig.plan.exitAbove, peak: entry, openedAt: now, adxEntry: sig.plan.adxEntry ?? null, nearSupport: sig.plan.nearSupport ?? null, adxRange: sig.plan.adxRange ?? null, pbEntry: sig.plan.pbEntry ?? null };
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
    open: (stored && stored.open) || {},           // MR (+ both-ways) positions, keyed by symbol
    openTrend: (stored && stored.openTrend) || {},  // trend positions — a PARALLEL slot so a weeks-
    closed: (stored && stored.closed) || [],        // long trend hold never blocks the MR dip-buy
    lastClose: (stored && stored.lastClose) || {},
    lastCloseTrend: (stored && stored.lastCloseTrend) || {},
    migrated: !!(stored && stored.migrated),
    slotsSplit: !!(stored && stored.slotsSplit),    // one-time: move legacy trend positions out of open
    adopted: (stored && stored.adopted) || null, // last-adopted dials (weekly cadence)
  };
  // One-time, lossless: legacy records kept the trend leg in record.open (keyed by symbol, one
  // position per market). Move any trend position to its own slot so the concurrent-slots
  // ensemble can run. MR positions are untouched. Idempotent via the slotsSplit flag.
  if (!record.slotsSplit) {
    for (const [sym, p] of Object.entries(record.open)) {
      if (p && p.strat === 'trend') { record.openTrend[sym] = p; delete record.open[sym]; }
    }
    record.slotsSplit = true;
  }
  // Signature of the persisted record, so we only WRITE it back when it actually changes
  // (a trade, a book-profit call flip, a retune, or migration) — not every tick. Combined
  // with moving the rotation cursor to the SIGNALS blob, this drops RECORD from a per-tick
  // write to a rare one, roughly halving the tick's KV writes (the free-tier bottleneck).
  const recordSigBefore = JSON.stringify({ o: (stored && stored.open) || {}, t: (stored && stored.openTrend) || {}, c: ((stored && stored.closed) || []).length, a: (stored && stored.adopted) || null, m: !!(stored && stored.migrated), s: !!(stored && stored.slotsSplit) });
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
  // Defensive: a bug in the adaptive layer must NEVER stop live trading. On any
  // failure, fall back to the proven defaults (no adaptation this tick).
  let learned;
  try { learned = computeAdaptive(record, STRATEGY); }
  catch (e) { learned = { learning: true, trades: (record.closed || []).length, winRate: 0, sizeMult: 1, stopMult: STRATEGY.stopAtrMult, engines: {}, note: 'adaptive fell back to defaults' }; }
  const nowMs = Date.now();
  if (!record.adopted || (nowMs - (record.adopted.at || 0)) > RETUNE_MS) {
    record.adopted = { stopMult: learned.stopMult, sizeMult: learned.sizeMult, engines: learned.engines, at: nowMs, fromTrades: learned.trades };
  }
  const dials = { stopMult: record.adopted.stopMult, sizeMult: record.adopted.sizeMult, engines: record.adopted.engines || null };
  // --- Rotating scan batch (see SCAN_BATCH_SIZE) --------------------------------------
  // Scan a window of the market list this tick; carry the rest forward from bySym. The
  // cursor persists in the record blob (no extra KV read). Open positions are always
  // included so their exits are checked every tick; MAX_FETCHES caps the total.
  const allSymbols = Object.keys(MARKETS);
  const openPool = allSymbols.filter((s) => isOpen(MARKETS[s]));
  const pool = openPool.length ? openPool : allSymbols; // nothing open (rare) → rotate all
  const storedCursor = (prevBlob && Number.isInteger(prevBlob.scanCursor)) ? prevBlob.scanCursor : 0;
  const cursor = ((storedCursor % pool.length) + pool.length) % pool.length;
  const batch = [];
  for (let i = 0; i < Math.min(SCAN_BATCH_SIZE, pool.length); i++) batch.push(pool[(cursor + i) % pool.length]);
  // Always manage BOTH slots' open positions (bare-symbol keys in each map).
  const openSyms = [...new Set([...Object.keys(record.open), ...Object.keys(record.openTrend)])].filter((s) => MARKETS[s]);
  let scanSet = [...new Set([...openSyms, ...batch])];
  if (scanSet.length > MAX_FETCHES) {
    // Managing open positions is the priority; fill remaining slots with batch symbols.
    const room = Math.max(0, MAX_FETCHES - openSyms.length);
    scanSet = [...new Set([...openSyms, ...batch.slice(0, room)])];
  }
  const nextCursor = (cursor + SCAN_BATCH_SIZE) % pool.length; // persisted on the SIGNALS blob
  // Dynamic-cadence gate: skip this tick entirely (no fetches, no writes) unless enough
  // time has passed for the current activity level. The last real scan is stamped on the
  // SIGNALS blob's updatedAt. Skipped ticks cost only the KV reads already done above.
  const lastScan = (prevBlob && prevBlob.updatedAt) || 0;
  if (nowMs - lastScan < scanIntervalMs(openPool.length)) {
    return { skipped: true, openCount: openPool.length, sinceLastScanMs: nowMs - lastScan };
  }
  // Per-market signal timeline (bounded rolling log). Read once, written once only
  // if something changed this tick.
  const histBlob = (await store.get('HISTORY', 'ALL')) || {};
  const hist = histBlob.hist || {};
  let histChanged = false;
  // Isolated live strategy lab (its OWN blob — NEVER touches the record above). Loaded once,
  // written once at the end, and every step below is try/caught so a lab bug can't affect live
  // trading. Reuses the candles the loop already fetches. See lab.js.
  const labStored = await store.get('RECORD_LAB', 'ALL');
  const lab = { startedAt: (labStored && labStored.startedAt) || nowMs, cand: (labStored && labStored.cand) || {} };
  const labSig = (l) => JSON.stringify(Object.entries(l.cand).map(([k, r]) => [k, (r.closed || []).length, Object.keys(r.open || {}).length, Object.keys(r.openTrend || {}).length]));
  const labSigBefore = labSig(lab);
  // One-time self-heal of stored timeline events: (1) trend BUYs once logged the mislabel
  // "oversold dip (RSI2 undefined)"; (2) older events leaked recipe details — RSI2
  // readings, the "< 5" threshold, and the "flush below the prior day's low" entry
  // trigger. Rewrite the DESCRIPTIONS in place (the facts — a BUY fired, a % of the way —
  // are untouched). Idempotent: after the sweep nothing matches, so it never rewrites again.
  for (const sym of Object.keys(hist)) {
    for (const e of hist[sym]) {
      if (!e || typeof e.text !== 'string') continue;
      if (e.text.includes('RSI2 undefined')) { e.text = 'Fired a BUY — trend continuation in an established uptrend.'; histChanged = true; continue; }
      let t = e.text
        .replace(/Deeply oversold \(RSI2 < 5\)/g, 'Deepest-oversold reading')
        .replace(/ on the flush below the prior day's low/g, ' on confirmation')
        .replace(/\s*\(RSI2 [^)]*\)/g, '');
      if (t !== e.text) { e.text = t; histChanged = true; }
    }
  }
  for (const symbol of scanSet) {
    try {
      const meta = MARKETS[symbol];
      const { candles, live, liveTime } = await fetchDailyCandles(meta, env);
      const bothWays = meta.engine === 'mrBoth';
      // BOTH-WAYS cells (FX, commodities — symmetric assets) use the long+short MR
      // engine. Everything else uses the equity ENSEMBLE: mean-reversion dip-buyer +
      // trend-follow continuation, long-only, at most one opens per market.
      let mrSig, trendSig;
      if (bothWays) {
        mrSig = computeBothMR(candles, live, meta.cell);
        trendSig = { verdict: 'NO_TRADE' };
      } else {
        mrSig = computeSignal(candles, live);
        // %B gate (adopted, see PB_ADOPT_MAX): the dip-buy fires only near/below the lower band
        // on indices/ETFs. Crypto keeps the full recipe (the edge reverses there). The
        // trend-follow leg below is unaffected — this only vetoes the MR BUY.
        if (!meta.crypto && mrSig.verdict === 'BUY' && typeof mrSig.pctB === 'number' && mrSig.pctB >= PB_ADOPT_MAX) {
          mrSig = { ...mrSig, verdict: 'NO_TRADE', direction: 0, plan: null };
        }
        // Express the evolved dials in the MR plan (stop scaled by the global dial).
        if (mrSig.plan && dials && dials.stopMult) {
          const scale = dials.stopMult / STRATEGY.stopAtrMult;
          const long = mrSig.direction > 0;
          const r = mrSig.plan.risk * scale;
          mrSig.plan = { ...mrSig.plan, risk: r, stop: long ? mrSig.plan.entry - r : mrSig.plan.entry + r, target1: long ? mrSig.plan.entry + r : mrSig.plan.entry - r, stopMult: dials.stopMult, sizeMult: dials.sizeMult };
        }
        trendSig = computeTrend(candles, live);
      }
      const now = Date.now();
      // The signal shown: for both-ways, the MR signal (BUY/SELL/no-trade); for the
      // ensemble, whichever engine is actionable (dip first, else trend).
      const displaySig = bothWays ? mrSig : (mrSig.verdict === 'BUY' ? mrSig : (trendSig.verdict === 'BUY' ? trendSig : mrSig));
      const prev = bySym[symbol];
      const actionable = displaySig.verdict === 'BUY' || displaySig.verdict === 'SELL';
      if (actionable && (!prev || prev.verdict !== displaySig.verdict)) {
        events.push({ type: 'signal', event: displaySig.verdict, symbol, name: meta.name, price: live ?? displaySig.price, strategy: strategyLabel, plan: displaySig.plan, signal: displaySig, at: now });
      }
      const prevClose = candles.length >= 2 ? candles[candles.length - 2].c : (candles.length ? candles[candles.length - 1].c : null);
      const history = candles.slice(-64).map((c) => ({ t: c.t, c: Math.round(c.c * 100) / 100 }));
      // Tag the engine that produced the shown signal (both-ways is mean-reversion),
      // set before the timeline so its wording is correct (dip vs continuation).
      const dispStrat = (!bothWays && displaySig === trendSig) ? 'trend' : 'mr';
      displaySig.strat = dispStrat;
      const evs = changeEvents(prev, displaySig);
      if (evs.length) {
        hist[symbol] = hist[symbol] || [];
        for (const t of evs) hist[symbol].unshift({ at: now, text: t });
        if (hist[symbol].length > 12) hist[symbol].length = 12;
        histChanged = true;
      }
      // News/event regime filter: stand aside on a high-impact event day.
      const newsHold = highImpactToday(meta.country, new Date(now));
      bySym[symbol] = { symbol, name: meta.name, updatedAt: now, ...displaySig, live, liveTime, prevClose, history, newsHold: newsHold ? newsHold.name : null, strat: dispStrat };
      const canOpen = isOpen(meta) && !meta.noTrade && !newsHold;
      // Emit the Pro webhook event for whatever a slot just did.
      const emit = (res, sig) => {
        if (res === 'open') events.push({ type: 'position.open', event: 'open', symbol, name: meta.name, price: live ?? sig.price, strategy: strategyLabel, plan: sig.plan, signal: sig, at: now });
        else if (typeof res === 'string' && res.startsWith('exit:')) events.push({ type: 'position.close', event: res.slice(5), symbol, name: meta.name, price: live ?? sig.price, strategy: strategyLabel, signal: sig, at: now });
      };
      if (bothWays) {
        // One MR-only engine (long/short); no trend leg for symmetric cells.
        emit(processPosition({ symbol, meta, sig: mrSig, live, open: canOpen, record, now, risk, cost, dials, strat: 'mr', shouldExit: bothMRShouldExit }), mrSig);
      } else {
        // ENSEMBLE: MR and trend run as INDEPENDENT per-market slots (record.open / record.openTrend)
        // so a weeks-long trend hold never blocks the far-superior MR dip-buy (lab 2026-09-08). Each
        // slot manages its own open position with its own exit, or opens when flat.
        emit(processPosition({ symbol, meta, sig: mrSig, live, open: canOpen, record, now, risk, cost, dials, strat: 'mr', shouldExit: mrShouldExit }), mrSig);
        emit(processPosition({ symbol, meta, sig: trendSig, live, open: canOpen, record, now, risk, cost, dials, strat: 'trend', shouldExit: trendShouldExit, openMap: record.openTrend, lastCloseMap: record.lastCloseTrend }), trendSig);
      }
      // Derive the position's book-profit / hold CALL here (the recipe stays on the
      // server) so the client can show it WITHOUT the exit threshold, which /trades
      // strips. Only for a still-open position.
      // The board shows one signal (displaySig); read the CALL from the slot that produced it.
      const openPos = dispStrat === 'trend' ? record.openTrend[symbol] : record.open[symbol];
      if (openPos) {
        const long = (openPos.side || 'LONG') === 'LONG';
        if (openPos.strat === 'trend') openPos.call = 'trend';
        else if (bothWays) {
          // Both-ways MR: book profit once the cell's RSI reverts through the mid.
          const rNow = mrSig && typeof mrSig.rsiMR === 'number' ? mrSig.rsiMR : null;
          openPos.call = (rNow != null && (long ? rNow >= 50 : rNow <= 50)) ? 'profit' : 'hold';
        } else {
          const rsiNow = mrSig && typeof mrSig.rsi2 === 'number' ? mrSig.rsi2 : null;
          const exit = openPos.exitAbove;
          openPos.call = (rsiNow != null && exit != null && (long ? rsiNow >= exit : rsiNow <= (100 - exit))) ? 'profit' : 'hold';
        }
      }
      // Feed the isolated lab the SAME candles (best-effort; a lab bug never blocks live trading).
      if (!bothWays) { try { labStep(lab, symbol, candles, live, meta, now, risk, cost); } catch (e) { /* lab is best-effort */ } }
    } catch (e) { /* skip this market this tick — its last-known signal is carried forward */ }
  }
  // Persist the lab blob (isolated, best-effort — its failure never affects the live record below).
  try { if (labSig(lab) !== labSigBefore) await store.put({ pk: 'RECORD_LAB', sk: 'ALL', updatedAt: Date.now(), startedAt: lab.startedAt, cand: lab.cand }); } catch (e) { /* lab persist best-effort */ }
  // Persist each blob independently so one failure (e.g. a KV quota blip) can't
  // stop the others. RECORD first — the paper trades are the most important thing
  // to save; a batched blob each (no KV list, fits the free tier).
  // RECORD only when it actually changed (trade / call flip / retune / migration).
  const recordSigAfter = JSON.stringify({ o: record.open, t: record.openTrend, c: record.closed.length, a: record.adopted, m: record.migrated, s: record.slotsSplit });
  if (recordSigAfter !== recordSigBefore) {
    try { await store.put({ pk: 'RECORD', sk: 'ALL', updatedAt: Date.now(), open: record.open, openTrend: record.openTrend, closed: record.closed, lastClose: record.lastClose, lastCloseTrend: record.lastCloseTrend, migrated: record.migrated, slotsSplit: record.slotsSplit, adopted: record.adopted }); } catch (e) { /* retried next tick */ }
  }
  // SIGNALS every scan (prices/signals move); it also carries the rotating scan cursor.
  try { await store.put({ pk: 'SIGNALS', sk: 'ALL', updatedAt: Date.now(), scanCursor: nextCursor, signals: Object.values(bySym), adaptive: { ...learned, adopted: record.adopted, nextRetune: (record.adopted.at || nowMs) + RETUNE_MS } }); } catch (e) { /* retried next tick */ }
  try { if (histChanged) await store.put({ pk: 'HISTORY', sk: 'ALL', updatedAt: Date.now(), hist }); } catch (e) { /* non-fatal */ }
  // Fan out the fresh events to registered Pro webhooks (best-effort).
  try { await deliverEvents(store, events); } catch (e) { /* delivery never blocks trading */ }
  const fired = events.filter((e) => e.type === 'signal').map((e) => ({ symbol: e.symbol, name: e.name, verdict: e.event, confidence: e.signal && e.signal.confidence }));
  return { events: events.length, signalFired: fired.length > 0, fired };
}
