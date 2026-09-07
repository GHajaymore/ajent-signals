// PROBE (fresh — the recipe claims to "evolve in regime filters", but no probe tests
// one on the MR ENTRY): does a "don't catch a falling knife" regime gate improve the
// mean-reversion edge? MR buys an oversold dip in an uptrend (price > 200SMA). Two
// classic ways that dip turns into a knife:
//   1) the market has already rolled over beneath its INTERMEDIATE trend (below 50SMA)
//   2) volatility has EXPLODED (today's ATR >> its own recent median) — a panic regime
//      where "oversold" just keeps getting more oversold.
// We run the EXACT production computeSignal, then veto its BUYs that fail each gate
// (open positions are still managed to their normal exit — we only filter ENTRIES),
// and split IN-SAMPLE vs OUT-OF-SAMPLE so a gate that only fits the past is exposed.
//   node test/regime-filter-probe.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { STRATEGY } from '../src/meta.js';
import { sma, atr } from '../src/indicators.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const SYMS = Object.keys(DATA);

// --- Regime gates (return true = KEEP the trade) ---------------------------
// Intermediate-trend intact: price also above the 50SMA, not just the 200SMA.
function above50(candles) {
  const closes = candles.map((x) => x.c), i = closes.length - 1;
  const s = sma(closes, 50)[i];
  return s != null && closes[i] > s;
}
// Volatility isn't exploding: today's ATR <= mult × its own recent (100-bar) median.
function calmVol(mult) {
  return (candles) => {
    const a = atr(candles, 14), i = candles.length - 1;
    if (a[i] == null) return false;
    const win = [];
    for (let k = Math.max(0, i - 100); k <= i; k++) if (a[k] != null) win.push(a[k]);
    if (!win.length) return true;
    win.sort((x, y) => x - y);
    const med = win[Math.floor(win.length / 2)] || a[i];
    return a[i] <= med * mult;
  };
}
// Softer intermediate-trend gate: allow price up to k×ATR BELOW the 50SMA (a dip that
// pokes just under mid-trend is fine; only reject clearly-broken-down markets).
function near50(k) {
  return (candles) => {
    const closes = candles.map((x) => x.c), i = closes.length - 1;
    const s = sma(closes, 50)[i], a = atr(candles, 14)[i];
    if (s == null || a == null) return false;
    return closes[i] > s - k * a;
  };
}

// Wrap the production signal: keep every non-BUY as-is; veto a BUY the gate rejects
// (→ NO_TRADE, no plan) so no NEW entry opens — exits of open trades are untouched.
function withGate(keep) {
  return (candles, live) => {
    const sig = computeSignal(candles, live);
    if (sig.verdict !== 'BUY' || !keep) return sig;
    return keep(candles) ? sig : { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
  };
}

function run(signalFn) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      const sig = signalFn(candles.slice(0, i + 1), candles[i].c);
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) closed.push(t);
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
  return {
    n: trades.length,
    winRate: Math.round((wins.length / trades.length) * 100),
    pnl: Math.round(pnl),
    exp: +(pnl / trades.length).toFixed(1),
    avgR: +avgR.toFixed(3),
    pf: +(gw / (gl || 1)).toFixed(2),
    maxDD: Math.round(dd),
  };
}

// Shared 60/40 time split (train closes < mid, test >= mid), anchored on the baseline.
const baseline = run(withGate(null));
let tMin = Infinity, tMax = -Infinity;
for (const t of baseline) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6;

// VERDICT (2026-09-06): all REJECTED. The vol-explosion gate hurts or is neutral. The
// 50SMA gate lifts AGGREGATE pf/avgR but is NOT robust — see the per-market table: it
// helps ES/YM/RTY/TSX yet HURTS NQ/SX5E/N225 (N225 net halved), and the headline gain
// leans on a degenerate ETH sample (pf~600 = near-zero losses on a few trades). Softer
// versions don't hold OOS. Left as a permanent record so this idea isn't re-litigated.
const VARIANTS = [
  ['baseline (production)', withGate(null)],
  ['+ above 50SMA (strict)', withGate(above50)],
  ['+ within 1.0xATR of 50SMA', withGate(near50(1.0))],
  ['+ calm vol (ATR<=1.5x med)', withGate(calmVol(1.5))],
];

const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.winRate).padStart(3)}% exp=$${String(s.exp).padStart(6)} avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${String(s.pnl).padStart(6)} maxDD=$${String(s.maxDD).padStart(6)}` : '(no trades)';

console.log(`\nMR REGIME-FILTER PROBE — ${SYMS.length} markets (${SYMS.join(', ')})`);
console.log(`entry RSI2<${STRATEGY.entryBelow}, exit RSI2>${STRATEGY.exitAbove}, stop ${STRATEGY.stopAtrMult}xATR · 60/40 IS/OOS split\n`);

const base = stats(baseline);
for (const [name, fn] of VARIANTS) {
  const closed = run(fn);
  const full = stats(closed);
  const train = stats(closed.filter((t) => t.closedAt < mid));
  const test = stats(closed.filter((t) => t.closedAt >= mid));
  const kept = base.n ? Math.round((full.n / base.n) * 100) : 0;
  console.log(`${name.padEnd(30)} keeps ${String(kept).padStart(3)}% of trades`);
  console.log(`   FULL ${fmt(full)}`);
  console.log(`   TEST ${fmt(test)}   (OOS)`);
}

// Per-market robustness: is the 50SMA gain uniform, or driven by one or two markets?
function runOne(signalFn, sym) {
  const candles = DATA[sym], meta = MARKETS[sym];
  const record = { open: {}, closed: [], lastClose: {} };
  for (let i = 210; i < candles.length; i++) {
    const sig = signalFn(candles.slice(0, i + 1), candles[i].c);
    processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
  }
  return record.closed;
}
console.log('\nPER-MARKET  baseline  ->  + above 50SMA (does the gate help each market, or just a few?)');
for (const sym of SYMS) {
  const b = stats(runOne(withGate(null), sym));
  const g = stats(runOne(withGate(above50), sym));
  const dPf = g.n && b.n ? (g.pf - b.pf).toFixed(2) : '  -';
  const dR = g.n && b.n ? (g.avgR - b.avgR).toFixed(3) : '  -';
  console.log(`  ${sym.padEnd(5)} base pf=${String(b.pf).padStart(5)} avgR=${String(b.avgR).padStart(6)} net=$${String(b.pnl).padStart(6)}  ->  gate pf=${String(g.pf).padStart(5)} avgR=${String(g.avgR).padStart(6)} net=$${String(g.pnl).padStart(6)}   Δpf=${dPf} ΔavgR=${dR}`);
}

console.log('\nSHIP TEST: a gate earns a place ONLY if, vs baseline, it lifts BOTH pf AND avgR');
console.log('AND shrinks maxDD, keeps a usable trade count, and the edge HOLDS out-of-sample.');
console.log('If it just cuts trades without improving return-per-risk, the recipe stays as-is.\n');
