// Robustness lab for the Ajent Strategy. Runs the EXACT production logic across a
// grid of settings + per market, over long history, to answer: is the edge robust
// (a broad plateau of settings all work) or fragile (only today's numbers work)?
// The goal is NOT to pick the top-P&L combo (overfit) — it's to see the plateau
// and confirm the defaults sit in a safe region.
//   node test/sweep.mjs
import { backtest, DATA } from './bt.mjs';
import { computeSignal } from '../src/strategy.js';

const syms = Object.keys(DATA);
const fmt = (r) => `PF ${r.pf}  CAGR ${r.cagr}%  MAR ${r.mar}  DD ${r.maxDD}%  win ${r.winRate}%  n=${r.trades}  (buy&hold ${r.bhCagr}%)`;
const sig = (params) => (c, live) => computeSignal(c, live, params);

console.log(`\nData: ${syms.length} markets over ~${(DATA[syms[0]] || []).length} bars each — ${syms.join(', ')}\n`);

// Baseline = current production defaults.
const base = await backtest(sig({ entryBelow: 15, deepBelow: 5, stopAtrMult: 2 }), { exitRsi: 65 });
console.log('BASELINE  entry<15 · exit>65 · stop 2.0×ATR');
console.log('          ' + fmt(base) + '\n');

// --- Grid sweep -------------------------------------------------------------
const entries = [10, 12, 15, 18, 20];
const exits = [55, 60, 65, 70, 75];
const stops = [1.5, 2, 2.5, 3];
const rows = [];
for (const e of entries) for (const x of exits) for (const s of stops) {
  const r = await backtest(sig({ entryBelow: e, deepBelow: Math.min(5, e - 3), stopAtrMult: s }), { exitRsi: x });
  rows.push({ e, x, s, ...r });
}

const byMar = [...rows].sort((a, b) => b.mar - a.mar);
console.log('TOP 10 by MAR (risk-adjusted — CAGR ÷ max drawdown):');
for (const r of byMar.slice(0, 10)) console.log(`  entry<${r.e} exit>${r.x} stop${r.s}x  →  ${fmt(r)}`);

// Robust plateau: how much of the whole grid clears a real bar?
const good = rows.filter((r) => r.pf >= 1.3 && r.cagr > r.bhCagr && r.trades > 30);
console.log(`\nROBUST PLATEAU: ${good.length} of ${rows.length} settings clear PF≥1.3, beat buy&hold, >30 trades.`);
console.log('  → A wide plateau means the edge is real & not knife-edge; a tiny one means fragile/overfit.');

// Where do the current defaults rank?
const defRank = byMar.findIndex((r) => r.e === 15 && r.x === 65 && r.s === 2) + 1;
console.log(`  Current defaults (15/65/2) rank #${defRank} of ${rows.length} by MAR — want: solidly inside the plateau, not the single peak.`);

// --- Per-market fit (defaults) ---------------------------------------------
console.log('\nPER-MARKET (production defaults) — which markets the recipe actually fits:');
const per = [];
for (const s of syms) { const r = await backtest(sig({ entryBelow: 15, deepBelow: 5, stopAtrMult: 2 }), { exitRsi: 65, syms: [s] }); per.push({ s, ...r }); }
per.sort((a, b) => b.pf - a.pf);
for (const r of per) console.log(`  ${r.s.padEnd(5)}  ${fmt(r)}`);

console.log('\nRead-out: keep the recipe where the plateau is widest, trade the markets that fit, and treat any single high-P&L combo as noise.\n');
