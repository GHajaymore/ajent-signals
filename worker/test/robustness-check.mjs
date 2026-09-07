// ROBUSTNESS GATE — the anti-overfit check every candidate must clear before it's called
// a finding, so the lab's conclusions are STABLE, not erratic. A real edge holds across
// SEQUENTIAL time folds (walk-forward), not one lucky 60/40 split, AND sits on a PARAMETER
// PLATEAU (neighbouring params also improve), not a single spike. Erratic = fails these.
//   node test/robustness-check.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { atr, adx } from '../src/indicators.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const SYMS = Object.keys(DATA);
const IND = {};
for (const sym of SYMS) IND[sym] = { atr: atr(DATA[sym], 14), adx: adx(DATA[sym], 14).adx };

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
const support = (k) => (s, i) => nearLevel(DATA[s], i, IND[s].atr[i], k);
const notch = (lo, hi) => (s, i) => { const a = IND[s].adx[i]; return a != null && !(a >= lo && a < hi); };
const both = (k, lo, hi) => (s, i) => support(k)(s, i) && notch(lo, hi)(s, i);

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
    for (const t of record.closed) closed.push(t);
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}
function st(t) {
  if (!t.length) return { n: 0, pf: 0, avgR: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  return { n: t.length, pf: +(gw / (gl || 1)).toFixed(2), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3) };
}

const baseline = run(null);
const tMin = Math.min(...baseline.map((t) => t.closedAt)), tMax = Math.max(...baseline.map((t) => t.closedAt));

// --- 1) WALK-FORWARD: 4 equal sequential time folds. A stable edge wins MOST folds. ---
console.log(`\nROBUSTNESS GATE — combined support(0.5) + ADX-notch(15-20)\n`);
console.log('1) WALK-FORWARD across 4 sequential time folds (does the edge hold every period, or just on average?):');
const K = 4, edges = [];
const combined = run(both(0.5, 15, 20));
for (let f = 0; f < K; f++) {
  const lo = tMin + (tMax - tMin) * (f / K), hi = tMin + (tMax - tMin) * ((f + 1) / K);
  const inFold = (t) => t.closedAt >= lo && t.closedAt < hi;
  const b = st(baseline.filter(inFold)), g = st(combined.filter(inFold));
  const win = g.n && b.n && g.pf > b.pf && g.avgR > b.avgR;
  edges.push(win);
  const yr = new Date(lo).getFullYear() + '–' + new Date(hi).getFullYear();
  console.log(`   fold ${f + 1} (${yr})  base pf=${String(b.pf).padStart(5)} avgR=${String(b.avgR).padStart(6)} n=${String(b.n).padStart(3)}  ->  gate pf=${String(g.pf).padStart(5)} avgR=${String(g.avgR).padStart(6)} n=${String(g.n).padStart(3)}   ${win ? 'WIN' : '·'}`);
}
console.log(`   folds won: ${edges.filter(Boolean).length}/${K}  ${edges.filter(Boolean).length >= 3 ? '(stable)' : '(ERRATIC — do not promote)'}`);

// --- 2) PARAMETER PLATEAU: neighbours must also improve; a lone spike = overfit. ---
console.log('\n2) PARAMETER PLATEAU (full-sample pf; a smooth ridge = robust, a lone spike = overfit):');
console.log('   support k (xATR):');
for (const k of [0.3, 0.4, 0.5, 0.6, 0.7]) { const s = st(run(both(k, 15, 20))); console.log(`      k=${k}  pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(6)} n=${String(s.n).padStart(3)}`); }
console.log('   ADX notch band [lo,hi):');
for (const [lo, hi] of [[14, 19], [14, 20], [15, 20], [15, 21], [16, 21]]) { const s = st(run(both(0.5, lo, hi))); console.log(`      [${lo},${hi})  pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(6)} n=${String(s.n).padStart(3)}`); }

console.log('\nVERDICT: promote only if the edge wins >=3/4 walk-forward folds AND both parameters');
console.log('sit on a plateau (neighbours also lift pf/avgR). Anything that only shines on the full');
console.log('sample or at one exact parameter is erratic/overfit and stays a lab note, not a change.\n');
