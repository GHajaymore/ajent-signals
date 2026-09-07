// ROBUSTNESS GATE for the Bollinger %B mean-reversion confirmation, found by the indicator
// sweep (support 0.5xATR + %B<0.20 passed the ship test; %B<0 alone had OOS pf 3.88). Before
// it's called a finding it must clear the same anti-overfit bar as any other: hold across
// SEQUENTIAL walk-forward folds (not one lucky split) AND sit on a PARAMETER PLATEAU
// (neighbouring thresholds also improve), AND not lean on one market.
//   node test/bollinger-robustness.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { atr } from '../src/indicators.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const SYMS = Object.keys(DATA);

function bbPctB(c, p = 20, k = 2) {
  const n = c.length, close = c.map((x) => x.c), o = new Array(n).fill(null);
  for (let i = p - 1; i < n; i++) {
    let s = 0; for (let j = i - p + 1; j <= i; j++) s += close[j]; const m = s / p;
    let v = 0; for (let j = i - p + 1; j <= i; j++) v += (close[j] - m) ** 2; const sd = Math.sqrt(v / p);
    const lo = m - k * sd, hi = m + k * sd; o[i] = hi === lo ? 0.5 : (close[i] - lo) / (hi - lo);
  }
  return o;
}
function nearLevel(c, i, atrVal, kAtr, lookback = 60, L = 3) {
  if (!(atrVal > 0)) return false;
  const price = c[i].c; let best = Infinity;
  for (let j = i - L; j >= Math.max(L, i - lookback); j--) {
    let lowP = true, highP = true;
    for (let k = j - L; k <= j + L; k++) { if (k === j || !c[k]) continue; if (c[k].l < c[j].l) lowP = false; if (c[k].h > c[j].h) highP = false; }
    if (lowP) best = Math.min(best, Math.abs(price - c[j].l));
    if (highP) best = Math.min(best, Math.abs(price - c[j].h));
  }
  return best !== Infinity && best <= kAtr * atrVal;
}
const IND = {};
for (const sym of SYMS) IND[sym] = { atr: atr(DATA[sym], 14), bpb: bbPctB(DATA[sym], 20, 2) };

const pbOnly = (thr) => (s, i) => IND[s].bpb[i] != null && IND[s].bpb[i] < thr;
const supPb = (thr, k = 0.5) => (s, i) => nearLevel(DATA[s], i, IND[s].atr[i], k) && IND[s].bpb[i] != null && IND[s].bpb[i] < thr;

function run(keep) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      if (keep && sig.verdict === 'BUY' && !keep(sym, i)) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}
function st(t) {
  if (!t.length) return { n: 0, pf: 0, avgR: 0, dd: 0 };
  const gw = t.filter((x) => x.pnl > 0).reduce((s, x) => s + x.pnl, 0);
  const gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  let eq = 0, pk = 0, dd = 0; for (const x of t) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, pf: +(gw / (gl || 1)).toFixed(2), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), dd: Math.round(dd) };
}

const baseline = run(null);
const tMin = Math.min(...baseline.map((t) => t.closedAt)), tMax = Math.max(...baseline.map((t) => t.closedAt));
const b = st(baseline);
console.log(`\nBOLLINGER %B ROBUSTNESS GATE — ${SYMS.length} markets, MR entry\nbaseline: pf=${b.pf} avgR=${b.avgR} n=${b.n} maxDD=$${b.dd}\n`);

// 1) WALK-FORWARD — the candidate: support(0.5) + %B<0.20.
const cand = run(supPb(0.20));
console.log('1) WALK-FORWARD across 4 sequential folds — support(0.5) + %B<0.20:');
const K = 4; let wins = 0;
for (let f = 0; f < K; f++) {
  const lo = tMin + (tMax - tMin) * (f / K), hi = tMin + (tMax - tMin) * ((f + 1) / K);
  const inFold = (t) => t.closedAt >= lo && t.closedAt < hi;
  const bb = st(baseline.filter(inFold)), gg = st(cand.filter(inFold));
  const win = gg.n && bb.n && gg.pf > bb.pf && gg.avgR > bb.avgR; if (win) wins++;
  console.log(`   fold ${f + 1} (${new Date(lo).getFullYear()}-${new Date(hi).getFullYear()})  base pf=${String(bb.pf).padStart(5)} avgR=${String(bb.avgR).padStart(6)} n=${String(bb.n).padStart(3)}  ->  gate pf=${String(gg.pf).padStart(5)} avgR=${String(gg.avgR).padStart(6)} n=${String(gg.n).padStart(3)}  ${win ? 'WIN' : '·'}`);
}
console.log(`   folds won: ${wins}/${K}  ${wins >= 3 ? '(stable)' : '(ERRATIC — do not promote)'}`);

// 2) PARAMETER PLATEAU — %B threshold neighbours must also improve.
console.log('\n2) PARAMETER PLATEAU — %B threshold (full sample; smooth ridge = robust):');
console.log('   %B alone:');
for (const thr of [-0.05, 0, 0.1, 0.2, 0.3]) { const s = st(run(pbOnly(thr))); console.log(`      %B<${String(thr).padStart(5)}  pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(6)} n=${String(s.n).padStart(3)} maxDD=$${String(s.dd).padStart(6)}`); }
console.log('   support(0.5) + %B:');
for (const thr of [0.1, 0.15, 0.2, 0.25, 0.3]) { const s = st(run(supPb(thr))); console.log(`      %B<${String(thr).padStart(5)}  pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(6)} n=${String(s.n).padStart(3)} maxDD=$${String(s.dd).padStart(6)}`); }

// 3) PER-MARKET — does it lean on one name, or broadly help?
console.log('\n3) PER-MARKET — support(0.5) + %B<0.20 vs baseline (ΔavgR):');
let up = 0, dn = 0;
for (const sym of SYMS) {
  const bs = st(baseline.filter((t) => t.sym === sym)), gs = st(cand.filter((t) => t.sym === sym));
  const dR = gs.n && bs.n ? +(gs.avgR - bs.avgR).toFixed(3) : 0;
  if (gs.n && bs.n) { if (dR > 0.005) up++; else if (dR < -0.005) dn++; }
  console.log(`   ${sym.padEnd(5)} base avgR=${String(bs.avgR).padStart(6)} n=${String(bs.n).padStart(2)}  ->  avgR=${String(gs.avgR).padStart(6)} n=${String(gs.n).padStart(2)}  ΔavgR=${String(dR).padStart(6)}`);
}
console.log(`   improved ${up}/${SYMS.length}, hurt ${dn}/${SYMS.length}`);
console.log('\nVERDICT: a finding only if >=3/4 folds win AND the %B plateau is smooth AND it helps broadly.\n');
