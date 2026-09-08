// Now that %B<0.30 is adopted, does STACKING the other strong filter (support-proximity)
// add enough to justify thinning trades further? Compares, on the INDICES record:
//   baseline · %B<0.30 (adopted) · %B<0.30 + near-support(0.5xATR)
//   node test/pb-support-stack-check.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { atr } from '../src/indicators.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6, PB = 0.30;
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
const ATR = {};
for (const sym of Object.keys(DATA)) ATR[sym] = atr(DATA[sym], 14);

function run(mode) { // mode: 'base' | 'pb' | 'pbsupport'
  const closed = [];
  for (const sym of Object.keys(DATA)) {
    const candles = DATA[sym], meta = MARKETS[sym] || { name: sym, symbol: sym };
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      if (mode !== 'base' && !meta.crypto && sig.verdict === 'BUY') {
        const pbOk = typeof sig.pctB === 'number' && sig.pctB < PB;
        const supOk = mode === 'pbsupport' ? nearLevel(candles, i, ATR[sym][i], 0.5) : true;
        if (!(pbOk && supOk)) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      }
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  return closed;
}
const CRYPTO = new Set(Object.keys(DATA).filter((s) => MARKETS[s] && MARKETS[s].crypto));
const st = (t) => {
  if (!t.length) return { n: 0, pf: 0, avgR: 0, pnl: 0 };
  const gw = t.filter((x) => x.pnl > 0).reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  let eq = 0, pk = 0, dd = 0; for (const x of t) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, pf: +(gw / (gl || 1)).toFixed(2), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)), maxDD: Math.round(dd) };
};
const idx = (t) => t.filter((x) => !CRYPTO.has(x.sym));
console.log('\nINDICES record — stacking support-proximity on the adopted %B<0.30:');
console.log('  baseline           ', JSON.stringify(st(idx(run('base')))));
console.log('  %B<0.30 (adopted)  ', JSON.stringify(st(idx(run('pb')))));
console.log('  %B<0.30 + support  ', JSON.stringify(st(idx(run('pbsupport')))));
