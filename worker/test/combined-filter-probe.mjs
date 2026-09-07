// PROBE: do the two validated MR filters STACK? support-proximity (0.5xATR of a real
// pivot level = a bounce, not a knife) targets LOCATION; the ADX 15–20 notch targets
// REGIME (a dead zone where MR has no edge). They're orthogonal, so combining them could
// beat either alone — or over-filter. Exact production computeSignal, veto BUYs, 60/40
// IS/OOS + per-market.  node test/combined-filter-probe.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { atr, adx } from '../src/indicators.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const SYMS = Object.keys(DATA);
const IND = {};
for (const sym of SYMS) IND[sym] = { atr: atr(DATA[sym], 14), adx: adx(DATA[sym], 14).adx };

function nearLevel(c, i, atrVal, kAtr = 0.5, lookback = 60, L = 3) {
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
const support = (s, i) => nearLevel(DATA[s], i, IND[s].atr[i], 0.5);
const notch = (s, i) => { const a = IND[s].adx[i]; return a != null && !(a >= 15 && a < 20); };

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

const VARIANTS = [
  ['baseline', null],
  ['support 0.5xATR', support],
  ['ADX notch 15-20', notch],
  ['BOTH (support AND notch)', (s, i) => support(s, i) && notch(s, i)],
  ['EITHER (support OR notch)', (s, i) => support(s, i) || notch(s, i)],
];
const baseline = run(null);
let tMin = Infinity, tMax = -Infinity; for (const t of baseline) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6, base = stats(baseline);
console.log(`\nCOMBINED FILTER PROBE — ${SYMS.length} markets, MR entry, 60/40 IS/OOS\n`);
let combined = null;
for (const [name, keep] of VARIANTS) {
  const closed = run(keep), full = stats(closed), test = stats(closed.filter((t) => t.closedAt >= mid));
  const kept = base.n ? Math.round((full.n / base.n) * 100) : 0;
  console.log(`${name.padEnd(28)} keeps ${String(kept).padStart(3)}%`);
  console.log(`   FULL ${fmt(full)}`);
  console.log(`   TEST ${fmt(test)}   (OOS)`);
  if (name.startsWith('BOTH')) combined = keep;
}
console.log('\nPER-MARKET  baseline -> BOTH (support AND notch):');
let up = 0, dn = 0;
for (const sym of SYMS) {
  const b = stats(baseline.filter((t) => t.sym === sym)), g = stats(run(combined).filter((t) => t.sym === sym));
  const dR = g.n && b.n ? +(g.avgR - b.avgR).toFixed(3) : 0;
  if (g.n && b.n) { if (dR > 0.005) up++; else if (dR < -0.005) dn++; }
  console.log(`   ${sym.padEnd(5)} base avgR=${String(b.avgR).padStart(6)} net=$${String(b.pnl).padStart(6)} n=${String(b.n).padStart(2)}  ->  avgR=${String(g.avgR).padStart(6)} net=$${String(g.pnl).padStart(6)} n=${String(g.n).padStart(2)}   ΔavgR=${String(dR).padStart(6)}`);
}
console.log(`   improved ${up}/${SYMS.length}, hurt ${dn}/${SYMS.length}\n`);
