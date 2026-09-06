// PROBE: portfolio-level concurrent exposure. Mean-reversion dips cluster (a broad
// selloff fires several markets at once), so a user copying every signal can hold many
// positions simultaneously — peak risk, not per-trade risk, is the real drawdown driver.
// The equity backtests never show this. Here we measure max concurrent open positions
// and peak simultaneous $ risk across the whole history.
//   node test/concurrent-exposure.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { DATA } from './bt.mjs';

const RISK = 250, ACCOUNT = 25000;
const SYMS = Object.keys(DATA);

// Collect every position's [open, close] interval (include still-open at window end).
const intervals = [];
for (const sym of SYMS) {
  const candles = DATA[sym], meta = MARKETS[sym];
  const record = { open: {}, closed: [], lastClose: {} };
  for (let i = 210; i < candles.length; i++) {
    const sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
    processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: 6 });
  }
  const endT = candles[candles.length - 1].t;
  for (const t of record.closed) intervals.push({ sym, a: t.openedAt, b: t.closedAt });
  for (const s of Object.keys(record.open)) intervals.push({ sym, a: record.open[s].openedAt, b: endT }); // still open
}

// Sweep the timeline: at each position-open, count how many are concurrently live.
const opens = intervals.map((iv) => iv.a).sort((x, y) => x - y);
let maxConcurrent = 0, maxAt = 0;
const dist = {}; // concurrent-count -> how many open-events saw that level
for (const t of opens) {
  const live = intervals.filter((iv) => iv.a <= t && iv.b > t).length;
  dist[live] = (dist[live] || 0) + 1;
  if (live > maxConcurrent) { maxConcurrent = live; maxAt = t; }
}

// Time-weighted average concurrency (how many positions are typically open).
const allEdges = [...new Set(intervals.flatMap((iv) => [iv.a, iv.b]))].sort((x, y) => x - y);
let weighted = 0, span = 0;
for (let i = 0; i < allEdges.length - 1; i++) {
  const t0 = allEdges[i], t1 = allEdges[i + 1], dt = t1 - t0;
  const live = intervals.filter((iv) => iv.a <= t0 && iv.b > t0).length;
  weighted += live * dt; span += dt;
}
const avgConcurrent = span ? +(weighted / span).toFixed(2) : 0;

console.log(`\nCONCURRENT EXPOSURE — ${SYMS.length} markets, ${intervals.length} positions over the sample\n`);
console.log(`  Peak concurrent open positions: ${maxConcurrent}  (on ${new Date(maxAt).toISOString().slice(0, 10)})`);
console.log(`  Peak simultaneous risk:         $${maxConcurrent * RISK}  = ${(maxConcurrent * RISK / ACCOUNT * 100).toFixed(1)}% of a $${ACCOUNT} account`);
console.log(`  Time-weighted avg open:         ${avgConcurrent} positions ($${Math.round(avgConcurrent * RISK)} typical risk)\n`);
console.log('  Concurrency at each new entry (how crowded it was when a signal fired):');
for (const k of Object.keys(dist).map(Number).sort((a, b) => a - b)) {
  const bar = '#'.repeat(Math.round(dist[k] / opens.length * 40));
  console.log(`    ${String(k).padStart(2)} open: ${String(dist[k]).padStart(3)} entries ${bar}`);
}

// Honest read: is peak risk within a sane bound? Fixed $250/trade = 1% of $25k; the
// question is whether clustering stacks that into a dangerous simultaneous bet.
const peakPct = maxConcurrent * RISK / ACCOUNT * 100;
console.log('\nVERDICT:');
if (peakPct <= 20) console.log(`  Peak simultaneous risk ${peakPct.toFixed(0)}% is within a sane bound for ${SYMS.length} markets at 1%/trade.`);
else console.log(`  Peak simultaneous risk ${peakPct.toFixed(0)}% is HIGH — clustering stacks entries; consider a portfolio cap or lower per-trade risk.`);
console.log(`  (Ajent sizes each paper trade at a fixed $${RISK} risk; a user copying ALL signals in a broad`);
console.log(`   selloff would hold ~${maxConcurrent} at once. Worth surfacing so users size for the cluster, not the trade.)\n`);
