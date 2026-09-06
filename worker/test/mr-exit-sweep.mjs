// PROBE: does holding mean-reversion winners longer (a higher RSI2 exit) improve
// expectancy without hurting the win rate? Grounded in the LIVE book, where every
// MR winner exited on RSI-recovery at ~0.35R avg. We sweep exitAbove and — crucially
// — split IN-SAMPLE vs OUT-OF-SAMPLE so an edge that only fits the past is exposed.
//   node test/mr-exit-sweep.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { STRATEGY } from '../src/meta.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const EXITS = [55, 60, 65, 70, 75, 80, 85]; // 65 = current live exitAbove
const SYMS = Object.keys(DATA);

// Collect every closed trade for a given exit threshold, across the portfolio.
function runExit(exitRsi) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      const sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST, exitRsi });
    }
    for (const t of record.closed) closed.push(t);
  }
  closed.sort((a, b) => a.closedAt - b.closedAt);
  return closed;
}

// Metrics for a set of closed trades.
function stats(trades) {
  if (!trades.length) return { n: 0 };
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const pnl = trades.reduce((s, t) => s + t.pnl, 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const avgR = trades.reduce((s, t) => s + (t.resultR || 0), 0) / trades.length;
  const holdD = trades.reduce((s, t) => s + Math.max(1, (t.closedAt - t.openedAt) / 86400000), 0) / trades.length;
  const reasons = {};
  for (const t of trades) reasons[t.exitReason] = (reasons[t.exitReason] || 0) + 1;
  return {
    n: trades.length,
    winRate: Math.round((wins.length / trades.length) * 100),
    pnl: Math.round(pnl),
    expPerTrade: +(pnl / trades.length).toFixed(1), // NET $ expectancy per trade
    avgR: +avgR.toFixed(3),
    pf: +(gw / (gl || 1)).toFixed(2),
    avgWin: wins.length ? Math.round(gw / wins.length) : 0,
    avgLoss: losses.length ? Math.round(gl / losses.length) : 0,
    holdD: +holdD.toFixed(1),
    reasons,
  };
}

// Time-based OOS split: trades that CLOSED before the midpoint are in-sample (train),
// after are out-of-sample (test). Midpoint is shared across variants for a fair compare.
let tMin = Infinity, tMax = -Infinity;
const baseline = runExit(65);
for (const t of baseline) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6; // 60% train / 40% test

console.log(`\nMR EXIT SWEEP — ${SYMS.length} markets, split at 60% (train closes < mid, test >= mid)`);
console.log(`current live exitAbove = ${STRATEGY.exitAbove}\n`);

const rows = [];
for (const ex of EXITS) {
  const closed = runExit(ex);
  const full = stats(closed);
  const train = stats(closed.filter((t) => t.closedAt < mid));
  const test = stats(closed.filter((t) => t.closedAt >= mid));
  rows.push({ ex, full, train, test });
}

const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.winRate).padStart(3)}% exp=$${String(s.expPerTrade).padStart(6)} avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} avgW=$${String(s.avgWin).padStart(4)} avgL=$${String(s.avgLoss).padStart(4)} hold=${s.holdD}d` : '(no trades)';

console.log('FULL SAMPLE:');
for (const r of rows) console.log(`  exit>${String(r.ex).padStart(2)}${r.ex === 65 ? '*' : ' '}  ${fmt(r.full)}`);
console.log('\nIN-SAMPLE (train, first 60%):');
for (const r of rows) console.log(`  exit>${String(r.ex).padStart(2)}${r.ex === 65 ? '*' : ' '}  ${fmt(r.train)}`);
console.log('\nOUT-OF-SAMPLE (test, last 40%):');
for (const r of rows) console.log(`  exit>${String(r.ex).padStart(2)}${r.ex === 65 ? '*' : ' '}  ${fmt(r.test)}`);

// Verdict logic: an exit change earns a recommendation ONLY if it beats the baseline (65)
// on OUT-OF-SAMPLE net expectancy per trade AND doesn't crater the win rate.
const base = rows.find((r) => r.ex === 65);
const better = rows.filter((r) => r.ex !== 65 && r.test.n >= 10
  && r.test.expPerTrade > base.test.expPerTrade
  && r.train.expPerTrade > base.train.expPerTrade   // must win in BOTH windows (robust, not fitted)
  && r.test.winRate >= base.test.winRate - 8);
console.log('\nVERDICT:');
if (!better.length) {
  console.log('  No exit threshold beats the current exit>65 on out-of-sample net expectancy in BOTH');
  console.log('  windows. The live RSI-recovery exit is holding up — keep exitAbove = 65.');
} else {
  better.sort((a, b) => b.test.expPerTrade - a.test.expPerTrade);
  for (const r of better) console.log(`  CANDIDATE exit>${r.ex}: OOS exp $${r.test.expPerTrade}/trade vs base $${base.test.expPerTrade}; train $${r.train.expPerTrade} vs $${base.train.expPerTrade}`);
  console.log('  ^ Robust in both windows — worth a closer look before any recipe change.');
}
console.log('');
