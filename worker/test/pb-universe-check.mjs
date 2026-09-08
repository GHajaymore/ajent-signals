// RE-VALIDATE the one live recipe change (%B<0.30, adopted from a 10-market sweep in
// pb-adopt-check) on the FULL equity universe (~26 indices+ETFs the engine actually trades;
// crypto excluded by design). More data = a stronger robustness check on the adopted threshold.
// If 0.30 still sits on a smooth plateau and dominates, the adoption is confirmed at scale.
//   node test/pb-universe-check.mjs
import { MARKETS } from '../src/markets.js';
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';

const RISK = 250, COST = 6;
// Equity MR universe (the %B gate applies to these; crypto BTC/ETH excluded from the gate).
const EQ = ['ES', 'NQ', 'YM', 'RTY', 'SPY', 'QQQ', 'IWM', 'XJO', 'SX5E', 'N225', 'TSX', 'FTSE', 'DAX', 'HSI', 'NIFTY', 'SENSEX', 'BNF', 'SSE', 'KOSPI', 'CAC', 'SMH', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY'];
const DATA = {};
for (const sym of EQ) { if (!MARKETS[sym]) continue; try { const { candles } = await fetchDailyCandles(MARKETS[sym], { DATA_PROVIDER: 'yahoo' }); if (candles && candles.length > 260) DATA[sym] = candles; } catch (e) { /* skip */ } }
const SYMS = Object.keys(DATA);

function run(thr) { // thr=null → baseline (no gate)
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym], record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      if (thr != null && sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= thr) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}
function st(t) {
  if (!t.length) return { n: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  let eq = 0, pk = 0, dd = 0; for (const x of t) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, win: Math.round(100 * w.length / t.length), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pf: +(gw / (gl || 1)).toFixed(2), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)), maxDD: Math.round(dd) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.win).padStart(3)}% avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${String(s.pnl).padStart(6)} DD=$${String(s.maxDD).padStart(6)}` : '(none)';

let tMin = Infinity, tMax = -Infinity;
const b = run(0.30);
for (const t of b) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6;
console.log(`\n%B THRESHOLD RE-VALIDATION — ${SYMS.length} equity markets (full traded universe). 0.30 = live.\n`);
console.log('FULL SAMPLE:');
console.log(`  no gate     ${fmt(st(run(null)))}`);
for (const thr of [0.15, 0.20, 0.25, 0.30, 0.40, 0.50]) { const c = run(thr); console.log(`  %B<${thr.toFixed(2)}${thr === 0.30 ? '*' : ' '}  ${fmt(st(c))}`); }
console.log('\nOUT-OF-SAMPLE (last 40%):');
console.log(`  no gate     ${fmt(st(run(null).filter((t) => t.closedAt >= mid)))}`);
for (const thr of [0.15, 0.20, 0.25, 0.30, 0.40, 0.50]) { const c = run(thr).filter((t) => t.closedAt >= mid); console.log(`  %B<${thr.toFixed(2)}${thr === 0.30 ? '*' : ' '}  ${fmt(st(c))}`); }
console.log('');
