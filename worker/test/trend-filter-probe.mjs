// TREND-ENGINE filter probe — the ensemble's trend-follow leg hasn't had the sweep. The
// mirror hypothesis of the MR findings: MR wants LOW ADX (ranging), so trend-following
// should want HIGH ADX (a real, strong trend) and price sitting well above the follow-MA.
// Runs the exact production computeTrend + trendShouldExit, vetoes BUYs by each gate, with
// full + OOS + parameter plateau + walk-forward on the equity markets. node test/trend-filter-probe.mjs
//
// VERDICT (2026-09-06): NO robust improvement — the trend engine is already well-filtered.
// The mirror hypothesis (trend wants high ADX) is NOT confirmed once the robustness gate is
// applied: ADX>30 LOOKS great (pf 3.44) but n=21/OOS 8 (tiny), the ADX-threshold plateau is
// ERRATIC/non-monotonic (2.05->1.77->2.02->1.42->3.44->2.58), and walk-forward fails
// (ADX>20 2/4, ADX>25 1/4 folds). Root cause: computeTrend already gates on price>200SMA AND
// a rising 50SMA, so it self-selects strong trends; ADX is redundant and just shrinks the
// already-thin sample (~71 trades/decade) into noise. The gate caught an overfit spike —
// exactly its purpose. Trend engine stays as-is; too few trades to fine-tune reliably.
import { computeTrend, trendShouldExit } from '../src/trend.js';
import { processPosition } from '../src/scheduler.js';
import { adx } from '../src/indicators.js';
import { MARKETS } from '../src/markets.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const SYMS = Object.keys(DATA);
const ADX = {};
for (const sym of SYMS) ADX[sym] = adx(DATA[sym], 14).adx;

const adxAbove = (x) => (sig, s, i) => { const a = ADX[s][i]; return a != null && a > x; };
const distance = (k) => (sig) => sig.trendMA != null && sig.atr > 0 && (sig.price - sig.trendMA) / sig.atr > k;

function run(keep) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeTrend(candles.slice(0, i + 1), candles[i].c);
      if (keep && sig.verdict === 'BUY' && !keep(sig, sym, i)) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST, strat: 'trend', shouldExit: trendShouldExit });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}
function st(t) {
  if (!t.length) return { n: 0, winRate: 0, pf: 0, avgR: 0, pnl: 0, maxDD: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  let eq = 0, pk = 0, dd = 0; for (const x of t) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, winRate: Math.round((w.length / t.length) * 100), pf: +(gw / (gl || 1)).toFixed(2), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)), maxDD: Math.round(dd) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.winRate).padStart(3)}% avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${String(s.pnl).padStart(6)} maxDD=$${String(s.maxDD).padStart(6)}` : '(none)';

const baseline = run(null);
const tMin = Math.min(...baseline.map((t) => t.closedAt)), tMax = Math.max(...baseline.map((t) => t.closedAt)), mid = tMin + (tMax - tMin) * 0.6, base = st(baseline);
console.log(`\nTREND-ENGINE FILTER PROBE — ${SYMS.length} equity markets, 60/40 IS/OOS\n`);
const VARIANTS = [
  ['baseline (trend engine)', null],
  ['ADX > 20 (real trend)', adxAbove(20)],
  ['ADX > 25 (strong trend)', adxAbove(25)],
  ['ADX > 30 (very strong)', adxAbove(30)],
  ['price > 0.5xATR above 50MA', distance(0.5)],
  ['ADX>25 + dist>0.5', (sig, s, i) => adxAbove(25)(sig, s, i) && distance(0.5)(sig)],
];
for (const [name, keep] of VARIANTS) {
  const c = run(keep), full = st(c), test = st(c.filter((t) => t.closedAt >= mid));
  console.log(`${name.padEnd(28)} keeps ${String(base.n ? Math.round(full.n / base.n * 100) : 0).padStart(3)}%`);
  console.log(`   FULL ${fmt(full)}`);
  console.log(`   OOS  ${fmt(test)}`);
}
// Plateau + walk-forward on ADX> if it looks promising.
console.log('\nADX threshold PLATEAU (full pf; monotone ridge = robust):');
for (const x of [10, 15, 20, 25, 30, 35]) { const s = st(run(adxAbove(x))); console.log(`   ADX>${x}  pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(6)} n=${String(s.n).padStart(3)}`); }
console.log('\nWALK-FORWARD (4 folds; wins >=3/4 = stable):');
for (const x of [20, 25]) {
  const c = run(adxAbove(x)); let wins = 0; const line = [];
  for (let f = 0; f < 4; f++) { const lo = tMin + (tMax - tMin) * (f / 4), hi = tMin + (tMax - tMin) * ((f + 1) / 4), inF = (t) => t.closedAt >= lo && t.closedAt < hi; const b = st(baseline.filter(inF)), g = st(c.filter(inF)); const win = g.n && b.n && g.pf > b.pf && g.avgR > b.avgR; if (win) wins++; line.push(`f${f + 1} ${g.pf}${win ? '*' : ''}`); }
  console.log(`   ADX>${x}: ${line.join('  ')}  -> ${wins}/4 ${wins >= 3 ? '(stable)' : '(erratic)'}`);
}
console.log('');
