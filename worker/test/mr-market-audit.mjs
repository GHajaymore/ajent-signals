// PROBE: per-market robustness of the MR recipe. Which of the traded markets
// earn their place out-of-sample, and which are propped up by in-sample luck?
// Same discipline that dropped XJO once. No recipe change — a keep/watch/drop read.
//   node test/mr-market-audit.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const SYMS = Object.keys(DATA);

function closedFor(sym) {
  const candles = DATA[sym], meta = MARKETS[sym];
  const record = { open: {}, closed: [], lastClose: {} };
  for (let i = 210; i < candles.length; i++) {
    const sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
    processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
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

// Shared midpoint across all markets for a fair OOS split.
const all = SYMS.map((sym) => ({ sym, closed: closedFor(sym) }));
let tMin = Infinity, tMax = -Infinity;
for (const m of all) for (const t of m.closed) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6;

console.log(`\nMR PER-MARKET AUDIT — recipe exit=65, 60/40 train/test split\n`);
const rows = all.map(({ sym, closed }) => ({
  sym,
  full: stats(closed),
  train: stats(closed.filter((t) => t.closedAt < mid)),
  test: stats(closed.filter((t) => t.closedAt >= mid)),
})).sort((a, b) => b.test.pf - a.test.pf);

const line = (s) => s.n ? `n=${String(s.n).padStart(2)} win=${String(s.winRate).padStart(3)}% pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(6)} $${String(s.pnl).padStart(6)}` : '   (no trades)      ';
console.log('  sym    FULL                                     |  OOS (test)');
for (const r of rows) console.log(`  ${r.sym.padEnd(5)}  ${line(r.full)}  |  ${line(r.test)}`);

// Verdict per the drop-discipline: a market is a DROP candidate if it's a net loser
// out-of-sample (pf<1) despite the pooled edge; WATCH if OOS is thin or marginal.
console.log('\nVERDICT (keep / watch / drop):');
for (const r of rows) {
  let v, why;
  if (r.test.n < 5) { v = 'WATCH'; why = 'too few OOS trades to judge'; }
  else if (r.test.pf < 1.0) { v = 'DROP?'; why = `OOS net loser (pf ${r.test.pf}, $${r.test.pnl})`; }
  else if (r.test.pf < 1.3) { v = 'WATCH'; why = `marginal OOS (pf ${r.test.pf})`; }
  else { v = 'KEEP '; why = `robust OOS (pf ${r.test.pf})`; }
  console.log(`  ${v}  ${r.sym.padEnd(5)} — ${why}`);
}
console.log('\nNote: crypto (BTC/ETH) has NO validated MR edge by design — it rides the pooled record');
console.log('for 24/7 coverage, not because MR is proven on it. Judge indices strictly; crypto is context.\n');
