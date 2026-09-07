// CONTINUOUS INDICATOR + SUPPORTING-DATA SWEEP — the standing lab pass that tests every
// plausible indicator (and support/resistance levels) as a FILTER on the proven MR entry,
// to see which fine-tunes the edge. Runs the EXACT production computeSignal, vetoes BUYs
// that fail each gate (open positions still exit normally), and reports full + out-of-
// sample + per-market so a gate that only fits the past is exposed. Re-run each pass;
// promote only gates that lift pf AND avgR, hold OOS, stay robust across markets, and keep
// enough trades. Add new gates here as indicators/data become available.
//   node test/indicator-sweep.mjs
//
// FINDINGS (2026-09-06). Consistent pattern across the whole sweep:
//   WORKS  — LOCATION: support/resistance proximity (0.5xATR of a pivot; 60-bar best,
//            120-bar also passes). FULL pf 2.61->3.36, OOS pf 1.95->4.56. Pairs with —
//          — REGIME: the ADX 15-20 dead-zone notch. COMBINED (both) is the winner:
//            FULL pf ->4.96, OOS ->4.44, 9/10 markets (see combined-filter-probe.mjs).
//   HURTS  — trend-STRUCTURE gates (above 50SMA, price>Kijun/Ichimoku, Supertrend-up):
//            they cut good dip-buys (Kijun pf 2.61->2.18). MR wants the dip, not the trend.
//   WEAK   — CCI<-100: redundant with the RSI-2 entry (already oversold); fails OOS bar.
// support + ADX-notch are wired as a measured experiment (adaptive.js). Re-run each pass;
// add new indicators/data below and re-check before promoting anything.
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { atr, sma, adx } from '../src/indicators.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const SYMS = Object.keys(DATA);

// Precompute per-market series the gates read at the entry bar.
const IND = {};
for (const sym of SYMS) {
  const c = DATA[sym];
  IND[sym] = { atr: atr(c, 14), s50: sma(c.map((x) => x.c), 50), adx: adx(c, 14).adx, superUp: supertrendDir(c, 10, 3), cci: cciSeries(c, 20), kijun: kijunSeries(c, 26) };
}

// CCI (Commodity Channel Index) — deviation from the typical-price mean; < -100 = deep oversold.
function cciSeries(c, p = 20) {
  const n = c.length, tp = c.map((x) => (x.h + x.l + x.c) / 3), o = new Array(n).fill(null);
  for (let i = p - 1; i < n; i++) {
    let s = 0; for (let j = i - p + 1; j <= i; j++) s += tp[j]; const m = s / p;
    let md = 0; for (let j = i - p + 1; j <= i; j++) md += Math.abs(tp[j] - m); md /= p;
    o[i] = md === 0 ? 0 : (tp[i] - m) / (0.015 * md);
  }
  return o;
}
// Ichimoku Kijun (base line) — midpoint of the N-bar high/low; price above = trend structure intact.
function kijunSeries(c, base = 26) {
  const n = c.length, o = new Array(n).fill(null);
  for (let i = base - 1; i < n; i++) { let hi = -Infinity, lo = Infinity; for (let j = i - base + 1; j <= i; j++) { if (c[j].h > hi) hi = c[j].h; if (c[j].l < lo) lo = c[j].l; } o[i] = (hi + lo) / 2; }
  return o;
}

// --- Supporting-data helpers ------------------------------------------------
// Supertrend direction (+1 up / -1 down), ATR-band trend follower.
function supertrendDir(c, period, mult) {
  const a = atr(c, period), dir = new Array(c.length).fill(null);
  let upper = null, lower = null, trend = 1;
  for (let i = 0; i < c.length; i++) {
    if (a[i] == null) continue;
    const mid = (c[i].h + c[i].l) / 2, bu = mid + mult * a[i], bl = mid - mult * a[i];
    upper = upper == null ? bu : (bu < upper || c[i - 1].c > upper ? bu : upper);
    lower = lower == null ? bl : (bl > lower || c[i - 1].c < lower ? bl : lower);
    if (c[i].c > upper) trend = 1; else if (c[i].c < lower) trend = -1;
    dir[i] = trend;
  }
  return dir;
}
// Is price within kAtr of an ESTABLISHED pivot low/high (a real support/resistance level)?
// Pivot = a bar whose low is the lowest in +/-L bars, taken from a window ending a few bars
// back so we compare to prior structure, not the bar we're trading. "Near a level" = a dip
// bouncing at support rather than falling in mid-air.
function nearLevel(c, i, atrVal, kAtr, lookback = 60, L = 3) {
  if (!(atrVal > 0)) return false;
  const price = c[i].c;
  let best = Infinity;
  for (let j = i - L; j >= Math.max(L, i - lookback); j--) {
    let lowPivot = true, highPivot = true;
    for (let k = j - L; k <= j + L; k++) {
      if (k === j || !c[k]) continue;
      if (c[k].l < c[j].l) lowPivot = false;
      if (c[k].h > c[j].h) highPivot = false;
    }
    if (lowPivot) best = Math.min(best, Math.abs(price - c[j].l));
    if (highPivot) best = Math.min(best, Math.abs(price - c[j].h));
  }
  return best !== Infinity && best <= kAtr * atrVal;
}

// Veto wrapper: keep every non-BUY as-is; a BUY survives only if keep(sym,i) is true.
function gate(keep) {
  return (sym) => (candles, live) => {
    const sig = computeSignal(candles.slice(), live);
    if (sig.verdict !== 'BUY' || !keep) return sig;
    return keep(sym, candles.length - 1) ? sig : { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
  };
}
function run(keep) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym], fn = gate(keep)(sym);
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      const sig = fn(candles.slice(0, i + 1), candles[i].c);
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  closed.sort((a, b) => a.closedAt - b.closedAt);
  return closed;
}
function stats(t) {
  if (!t.length) return { n: 0 };
  const w = t.filter((x) => x.pnl > 0), l = t.filter((x) => x.pnl < 0);
  const gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(l.reduce((s, x) => s + x.pnl, 0));
  let eq = 0, pk = 0, dd = 0; for (const x of t) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, winRate: Math.round((w.length / t.length) * 100), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pf: +(gw / (gl || 1)).toFixed(2), maxDD: Math.round(dd) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.winRate).padStart(3)}% avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${String(s.pnl).padStart(6)} maxDD=$${String(s.maxDD).padStart(6)}` : '(no trades)';

const G = IND; // shorthand
const GATES = [
  ['baseline', null],
  ['near support/resist 0.5xATR', (s, i) => nearLevel(DATA[s], i, G[s].atr[i], 0.5)],
  ['near support/resist 1.0xATR', (s, i) => nearLevel(DATA[s], i, G[s].atr[i], 1.0)],
  ['near support/resist 1.5xATR', (s, i) => nearLevel(DATA[s], i, G[s].atr[i], 1.5)],
  ['near support/resist 120-bar', (s, i) => nearLevel(DATA[s], i, G[s].atr[i], 0.5, 120)],
  ['Supertrend still up', (s, i) => G[s].superUp[i] === 1],
  ['above 50SMA', (s, i) => G[s].s50[i] != null && DATA[s][i].c > G[s].s50[i]],
  ['CCI < -100 (deep oversold)', (s, i) => G[s].cci[i] != null && G[s].cci[i] < -100],
  ['price > Kijun (Ichimoku)', (s, i) => G[s].kijun[i] != null && DATA[s][i].c > G[s].kijun[i]],
  ['ADX notch: skip 15-20 (ref)', (s, i) => { const a = G[s].adx[i]; return a != null && !(a >= 15 && a < 20); }],
];

const baseline = run(null);
let tMin = Infinity, tMax = -Infinity;
for (const t of baseline) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6;
const base = stats(baseline);

console.log(`\nINDICATOR + SUPPORT-LEVEL SWEEP — ${SYMS.length} markets, MR entry, 60/40 IS/OOS\n`);
const passers = [];
for (const [name, keep] of GATES) {
  const closed = run(keep);
  const full = stats(closed), test = stats(closed.filter((t) => t.closedAt >= mid));
  const kept = base.n ? Math.round((full.n / base.n) * 100) : 0;
  console.log(`${name.padEnd(30)} keeps ${String(kept).padStart(3)}%`);
  console.log(`   FULL ${fmt(full)}`);
  console.log(`   TEST ${fmt(test)}   (OOS)`);
  if (keep && full.n >= base.n * 0.4 && full.pf > base.pf && full.avgR > base.avgR && Math.abs(full.maxDD) <= Math.abs(base.maxDD) && test.n && test.pf > base.pf * 0.9 && test.avgR > 0) {
    passers.push({ name, keep, full });
  }
}
console.log('\nSHIP TEST: keeps>=40%, pf & avgR up, maxDD no worse, and holds OOS (pf near/above base, avgR>0).');
if (!passers.length) console.log('No gate passed this pass. Recipe stands.');
else {
  console.log(`PASSED: ${passers.map((p) => p.name).join('; ')}`);
  for (const p of passers) {
    console.log(`\nPER-MARKET  baseline -> ${p.name}:`);
    let up = 0, dn = 0;
    for (const sym of SYMS) {
      const b = stats(baseline.filter((t) => t.sym === sym)), g = stats(run(p.keep).filter((t) => t.sym === sym));
      const dR = g.n && b.n ? +(g.avgR - b.avgR).toFixed(3) : 0;
      if (g.n && b.n) { if (dR > 0.005) up++; else if (dR < -0.005) dn++; }
      console.log(`   ${sym.padEnd(5)} base avgR=${String(b.avgR).padStart(6)} net=$${String(b.pnl).padStart(6)}  ->  avgR=${String(g.avgR).padStart(6)} net=$${String(g.pnl).padStart(6)}   ΔavgR=${String(dR).padStart(6)}`);
    }
    console.log(`   improved ${up}/${SYMS.length}, hurt ${dn}/${SYMS.length}`);
  }
}
console.log('');
