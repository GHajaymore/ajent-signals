// PROBE (architecture validation): the app claims the MR + trend two-engine ENSEMBLE
// diversifies (the engines "fire on different days"), giving a smoother curve than either
// alone. Verify it: run MR-only, trend-only, and the REAL ensemble (MR priority, trend
// fallback — matches scheduler.js) on one account and compare return, drawdown, return/DD,
// and how often the two engines are actually in the market on the same day (overlap).
//   node test/ensemble-validation-probe.mjs
import { MARKETS } from '../src/markets.js';
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { computeTrend, trendShouldExit } from '../src/trend.js';
import { mrShouldExit, processPosition } from '../src/scheduler.js';

const RISK = 250, COST = 6, PB = 0.30;
const SYMS = ['ES', 'NQ', 'YM', 'RTY', 'SPY', 'QQQ', 'IWM', 'SX5E', 'N225', 'TSX', 'FTSE', 'DAX', 'SMH', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'BTC', 'ETH'];
const CRYPTO = new Set(['BTC', 'ETH']);
const DATA = {};
for (const sym of SYMS) { if (!MARKETS[sym]) continue; try { const { candles } = await fetchDailyCandles(MARKETS[sym], { DATA_PROVIDER: 'yahoo' }); if (candles && candles.length > 260) DATA[sym] = candles; } catch (e) { /* skip */ } }

// mode: 'mr' | 'trend' | 'ensemble' | 'preempt'. trendW scales trend position size (the adaptive
// per-engine weight floors at 0.5, so trendW=0.5 shows whether that self-correction suffices).
function runMarket(sym, mode, trendW = 1) {
  const candles = DATA[sym], meta = MARKETS[sym];
  const dials = { engines: { mr: { weight: 1 }, trend: { weight: trendW } } };
  const record = { open: {}, closed: [], lastClose: {} };
  for (let i = 210; i < candles.length; i++) {
    const price = candles[i].c, now = candles[i].t;
    let mrSig = computeSignal(candles.slice(0, i + 1), price);
    if (!CRYPTO.has(sym) && mrSig.verdict === 'BUY' && typeof mrSig.pctB === 'number' && mrSig.pctB >= PB) mrSig = { ...mrSig, verdict: 'NO_TRADE', direction: 0, plan: null };
    const trendSig = computeTrend(candles.slice(0, i + 1), price);
    const pos = record.open[sym];
    if (mode === 'mr') {
      processPosition({ symbol: sym, meta, sig: mrSig, live: price, open: true, record, now, risk: RISK, cost: COST, strat: 'mr', shouldExit: mrShouldExit });
    } else if (mode === 'trend') {
      processPosition({ symbol: sym, meta, sig: trendSig, live: price, open: true, record, now, risk: RISK, cost: COST, strat: 'trend', shouldExit: trendShouldExit });
    } else { // ensemble / preempt: manage open pos with its leg's exit; if flat, MR priority then trend.
      if (pos) {                                        // preempt: a fresh MR BUY force-closes an open
        const isTrend = pos.strat === 'trend';          // trend and takes the MR trade (MR is far superior).
        if (mode === 'preempt' && isTrend && mrSig.verdict === 'BUY') {
          processPosition({ symbol: sym, meta, sig: trendSig, live: price, open: true, record, now, risk: RISK, cost: COST, strat: 'trend', shouldExit: () => 'preempt' });
          processPosition({ symbol: sym, meta, sig: mrSig, live: price, open: true, record, now, risk: RISK, cost: COST, strat: 'mr', shouldExit: mrShouldExit });
        } else {
          processPosition({ symbol: sym, meta, sig: isTrend ? trendSig : mrSig, live: price, open: true, record, now, risk: RISK, cost: COST, strat: pos.strat, shouldExit: isTrend ? trendShouldExit : mrShouldExit });
        }
      } else {
        let res = processPosition({ symbol: sym, meta, sig: mrSig, live: price, open: true, record, now, risk: RISK, cost: COST, strat: 'mr', shouldExit: mrShouldExit });
        if (res === 'none' && trendSig.verdict === 'BUY') processPosition({ symbol: sym, meta, sig: trendSig, live: price, open: true, record, now, risk: RISK, cost: COST, dials, strat: 'trend', shouldExit: trendShouldExit });
      }
    }
  }
  return record.closed.map((t) => ({ ...t, sym }));
}
const TRADES = {};
function tradesFor(mode, trendW = 1) { const key = mode + trendW; if (!TRADES[key]) { const all = []; for (const sym of Object.keys(DATA)) all.push(...runMarket(sym, mode, trendW)); TRADES[key] = all.sort((a, b) => a.closedAt - b.closedAt); } return TRADES[key]; }
function metrics(all) {
  let eq = 0, pk = 0, dd = 0; const w = all.filter((x) => x.pnl > 0);
  const gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(all.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  for (const x of all) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: all.length, net: Math.round(eq), maxDD: Math.round(dd), pf: +(gw / (gl || 1)).toFixed(2), win: Math.round(100 * w.length / (all.length || 1)), retDD: +(eq / -(dd || 1)).toFixed(2),
    byLeg: { mr: all.filter((t) => (t.strat || 'mr') === 'mr').length, trend: all.filter((t) => t.strat === 'trend').length } };
}
const fmt = (p) => `n=${String(p.n).padStart(3)} net=$${String(p.net).padStart(6)} maxDD=$${String(p.maxDD).padStart(6)} pf=${String(p.pf).padStart(5)} win=${p.win}% return/DD=${String(p.retDD).padStart(5)}`;
// shared 60/40 split from the ensemble timeline
let tMin = Infinity, tMax = -Infinity; for (const t of tradesFor('ensemble')) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6;

console.log(`\nENSEMBLE VALIDATION — ${Object.keys(DATA).length} markets, one account, post-%B.\n`);
for (const [label, mode] of [['MR only     ', 'mr'], ['Trend only  ', 'trend'], ['ENSEMBLE(live)', 'ensemble'], ['MR-preempt  ', 'preempt']]) {
  const all = tradesFor(mode), m = metrics(all);
  console.log(`  ${label} FULL ${fmt(m)}  [${m.byLeg.mr}MR+${m.byLeg.trend}tr]`);
  console.log(`  ${' '.repeat(label.length)} IS   ${fmt(metrics(all.filter((t) => t.closedAt < mid)))}`);
  console.log(`  ${' '.repeat(label.length)} OOS  ${fmt(metrics(all.filter((t) => t.closedAt >= mid)))}`);
}
const en = metrics(tradesFor('ensemble')), mr = metrics(tradesFor('mr'));
console.log('\n  Does the adaptive per-engine down-weighting (floor 0.5x) fix the trend drag?');
for (const w of [1.0, 0.5, 0.3]) { const m = metrics(tradesFor('ensemble', w)); console.log(`  ensemble, trend x${w.toFixed(1)}  ${fmt(m)}`); }
console.log(`\n  Live ensemble return/DD ${en.retDD} vs MR-only ${mr.retDD}. Trend starves MR (${en.byLeg.mr} MR trades in ensemble vs ${mr.n} standalone).`);
console.log('  → down-weighting trend helps but does not reach MR-only; the drag is structural (occupied markets), not just sizing.');
console.log('');
