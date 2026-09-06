// PROBE: per-market robustness of the TREND engine (buy price>200SMA & above a
// rising 50SMA; exit on a ratcheting 3xATR trailing stop). Same 60/40 OOS split as
// the MR audit. Trend is the newer edge (few live trades) so lab evidence matters more.
//   node test/trend-market-audit.mjs
import { MARKETS } from '../src/markets.js';
import { computeTrend, trendShouldExit } from '../src/trend.js';
import { processPosition } from '../src/scheduler.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const SYMS = Object.keys(DATA);

function closedFor(sym) {
  const candles = DATA[sym], meta = MARKETS[sym];
  const record = { open: {}, closed: [], lastClose: {} };
  for (let i = 210; i < candles.length; i++) {
    const sig = computeTrend(candles.slice(0, i + 1), candles[i].c);
    processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST, strat: 'trend', shouldExit: trendShouldExit });
  }
  return record.closed.sort((a, b) => a.closedAt - b.closedAt);
}

function stats(trades) {
  if (!trades.length) return { n: 0, winRate: 0, pnl: 0, avgR: 0, pf: 0 };
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  return {
    n: trades.length,
    winRate: Math.round((wins.length / trades.length) * 100),
    pnl: Math.round(trades.reduce((s, t) => s + t.pnl, 0)),
    avgR: +(trades.reduce((s, t) => s + (t.resultR || 0), 0) / trades.length).toFixed(3),
    pf: +(gw / (gl || 1)).toFixed(2),
  };
}

const all = SYMS.map((sym) => ({ sym, closed: closedFor(sym) }));
let tMin = Infinity, tMax = -Infinity;
for (const m of all) for (const t of m.closed) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6;

console.log(`\nTREND PER-MARKET AUDIT — 200/50 SMA entry, 3xATR trail, 60/40 train/test split\n`);
const rows = all.map(({ sym, closed }) => ({
  sym, full: stats(closed), test: stats(closed.filter((t) => t.closedAt >= mid)),
})).sort((a, b) => b.full.pf - a.full.pf);

const line = (s) => s.n ? `n=${String(s.n).padStart(2)} win=${String(s.winRate).padStart(3)}% pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(6)} $${String(s.pnl).padStart(6)}` : '   (no trades)      ';
console.log('  sym    FULL                                     |  OOS (test)');
for (const r of rows) console.log(`  ${r.sym.padEnd(5)}  ${line(r.full)}  |  ${line(r.test)}`);

// Portfolio-level (trend is a continuation edge — fewer, longer trades; judge the pool).
const allClosed = all.flatMap((m) => m.closed);
console.log(`\nPORTFOLIO (all trend trades):  ${line(stats(allClosed))}`);
console.log(`PORTFOLIO OOS (test window):    ${line(stats(allClosed.filter((t) => t.closedAt >= mid)))}`);

console.log('\nVERDICT (trend is the diversifier — it should be positive AND fire on different days');
console.log('than MR; a per-market loss matters less than the pooled edge holding OOS):');
const port = stats(allClosed), portOOS = stats(allClosed.filter((t) => t.closedAt >= mid));
if (port.pf >= 1.3 && portOOS.n >= 8 && portOOS.pf >= 1.0) {
  console.log(`  Pooled trend edge HOLDS — full pf ${port.pf}, OOS pf ${portOOS.pf}. Keep the ensemble as-is.`);
} else if (portOOS.n < 8) {
  console.log(`  Too few OOS trend trades (${portOOS.n}) to judge robustness — WATCH the live record.`);
} else {
  console.log(`  Pooled trend edge WEAK OOS (pf ${portOOS.pf}) — flag for review; the live record decides.`);
}
console.log('');
