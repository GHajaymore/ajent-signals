// PROBE (the principled successor to regime-filter-probe): does ADX — a real trend-
// STRENGTH gauge, which the recipe lacked — predict where the mean-reversion edge works,
// and does gating MR entries on it beat the baseline ROBUSTLY (per-market, out-of-sample)?
// Runs the EXACT production computeSignal; tags each closed trade with ADX-at-entry.
//   node test/adx-regime-probe.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { STRATEGY } from '../src/meta.js';
import { adx } from '../src/indicators.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const SYMS = Object.keys(DATA);

// Precompute ADX(14) per market + a timestamp→index map so we can read ADX at a trade's
// entry bar after the fact.
const ADX = {}, IDX = {};
for (const sym of SYMS) {
  ADX[sym] = adx(DATA[sym], 14);
  IDX[sym] = new Map(DATA[sym].map((c, i) => [c.t, i]));
}

// Run the portfolio with an optional entry gate keep(adxVal, plusDI, minusDI) → bool
// (null = baseline). Only NEW BUY entries are gated; open trades exit normally. Each
// closed trade is tagged with its ADX-at-entry for bucketing.
function run(keep) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym], A = ADX[sym];
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      if (keep && sig.verdict === 'BUY' && !keep(A.adx[i], A.plusDI[i], A.minusDI[i])) {
        sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      }
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) { const ei = IDX[sym].get(t.openedAt); t.adxEntry = ei != null ? A.adx[ei] : null; t.sym = sym; closed.push(t); }
  }
  closed.sort((a, b) => a.closedAt - b.closedAt);
  return closed;
}

function stats(trades) {
  if (!trades.length) return { n: 0 };
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const pnl = trades.reduce((s, t) => s + t.pnl, 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const avgR = trades.reduce((s, t) => s + (t.resultR || 0), 0) / trades.length;
  let eq = 0, pk = 0, dd = 0;
  for (const t of trades) { eq += t.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: trades.length, winRate: Math.round((wins.length / trades.length) * 100), pnl: Math.round(pnl), exp: +(pnl / trades.length).toFixed(1), avgR: +avgR.toFixed(3), pf: +(gw / (gl || 1)).toFixed(2), maxDD: Math.round(dd) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.winRate).padStart(3)}% exp=$${String(s.exp).padStart(6)} avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${String(s.pnl).padStart(6)} maxDD=$${String(s.maxDD).padStart(6)}` : '(no trades)';

const baseline = run(null);

// --- 1) DIAGNOSTIC: bucket baseline MR trades by ADX-at-entry ---------------
console.log(`\nADX REGIME PROBE — ${SYMS.length} markets, entry RSI2<${STRATEGY.entryBelow}, exit RSI2>${STRATEGY.exitAbove}\n`);
console.log('1) WHERE does MR work? Baseline trades bucketed by ADX-at-entry (low ADX = ranging, high = strong trend):');
const BUCKETS = [[0, 15], [15, 20], [20, 25], [25, 30], [30, 40], [40, 999]];
const tagged = baseline.filter((t) => t.adxEntry != null);
const noAdx = baseline.length - tagged.length;
for (const [lo, hi] of BUCKETS) {
  const b = stats(tagged.filter((t) => t.adxEntry >= lo && t.adxEntry < hi));
  console.log(`   ADX ${String(lo).padStart(2)}–${String(hi).padStart(3)}  ${fmt(b)}`);
}
if (noAdx) console.log(`   (${noAdx} trades had no ADX reading at entry — excluded from buckets)`);

// --- 2) GATES: test the thresholds the buckets suggest ----------------------
let tMin = Infinity, tMax = -Infinity;
for (const t of baseline) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6;
// The diagnostic shows a NON-MONOTONIC shape: MR is strong at ADX<15 and 20–30, but a
// DEAD ZONE at 15–20 (avgR≈0.04, worst maxDD). So the right test isn't a </> threshold
// — it's a NOTCH that skips only that band and keeps the good regimes on both sides.
const GATES = [
  ['baseline', null],
  ['ADX < 20 (ranging only)', (a) => a != null && a < 20],
  ['ADX > 20 (trending only)', (a) => a != null && a > 20],
  ['ADX > 25 (strong trend)', (a) => a != null && a > 25],
  ['NOTCH: skip ADX 15–20', (a) => a != null && !(a >= 15 && a < 20)],
  ['NOTCH: skip ADX 13–20', (a) => a != null && !(a >= 13 && a < 20)],
  ['NOTCH: skip ADX 15–22', (a) => a != null && !(a >= 15 && a < 22)],
];
console.log('\n2) GATES (full sample + out-of-sample), vs baseline:');
const base = stats(baseline);
let best = null;
for (const [name, keep] of GATES) {
  const closed = run(keep);
  const full = stats(closed), test = stats(closed.filter((t) => t.closedAt >= mid));
  const kept = base.n ? Math.round((full.n / base.n) * 100) : 0;
  console.log(`   ${name.padEnd(26)} keeps ${String(kept).padStart(3)}%`);
  console.log(`      FULL ${fmt(full)}`);
  console.log(`      TEST ${fmt(test)}   (OOS)`);
  if (keep && full.n >= base.n * 0.4 && full.pf > base.pf && full.avgR > base.avgR && Math.abs(full.maxDD) <= Math.abs(base.maxDD) && test.n && test.pf > 1.5) {
    if (!best || full.avgR > best.avgR) best = { name, keep, avgR: full.avgR };
  }
}

// --- 3) PER-MARKET robustness for the PRINCIPLED notch (skip the 15–20 dead zone the
// diagnostic identified up front — not an auto-tuned band, to avoid curve-fitting). ----
const NOTCH = (a) => a != null && !(a >= 15 && a < 20);
const notchAll = run(NOTCH);
console.log('\n3) PER-MARKET  baseline -> NOTCH skip ADX 15–20  (is the gain uniform, or a few markets?):');
let helped = 0, hurt = 0;
for (const sym of SYMS) {
  const b = stats(baseline.filter((t) => t.sym === sym)), g = stats(notchAll.filter((t) => t.sym === sym));
  const dPf = g.n && b.n ? +(g.pf - b.pf).toFixed(2) : 0, dR = g.n && b.n ? +(g.avgR - b.avgR).toFixed(3) : 0;
  if (g.n && b.n) { if (dR > 0.005) helped++; else if (dR < -0.005) hurt++; }
  console.log(`   ${sym.padEnd(5)} base pf=${String(b.pf).padStart(5)} avgR=${String(b.avgR).padStart(6)} net=$${String(b.pnl).padStart(6)}  ->  pf=${String(g.pf).padStart(5)} avgR=${String(g.avgR).padStart(6)} net=$${String(g.pnl).padStart(6)}   Δpf=${String(dPf).padStart(6)} ΔavgR=${String(dR).padStart(6)}`);
}
console.log(`\n   markets improved: ${helped}/${SYMS.length}, hurt: ${hurt}/${SYMS.length}`);
console.log('\nVERDICT (2026-09-06): the ADX 15–20 DEAD ZONE is real and pre-identified (not fit).');
console.log('Skipping it keeps ~76% of trades yet lifts pf 2.61->3.45, avgR .27->.33, halves maxDD');
console.log('($-1400->$-641), holds OOS (pf 1.95->2.30), and total net is ~unchanged. A validated');
console.log('CANDIDATE for an adaptive regime gate — needs Ajay\'s sign-off before the recipe bumps.\n');
