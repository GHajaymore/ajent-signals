// Verify the ADOPTED %B gate (scheduler.js): the equity dip-buy fires only when %B < 0.20 on
// indices/ETFs; crypto keeps the full recipe. Confirms the live config improves vs baseline.
//   node test/pb-adopt-check.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6, PB = 0.20;
function run(adopt) {
  const closed = [];
  for (const sym of Object.keys(DATA)) {
    const candles = DATA[sym], meta = MARKETS[sym] || { name: sym, symbol: sym };
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      if (adopt && !meta.crypto && sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= PB) {
        sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      }
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  return closed;
}
const st = (t) => {
  if (!t.length) return { n: 0, pf: 0, avgR: 0, pnl: 0 };
  const gw = t.filter((x) => x.pnl > 0).reduce((s, x) => s + x.pnl, 0);
  const gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  return { n: t.length, pf: +(gw / (gl || 1)).toFixed(2), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)) };
};
const CRYPTO = new Set(Object.keys(DATA).filter((s) => MARKETS[s] && MARKETS[s].crypto));
const idx = (t) => t.filter((x) => !CRYPTO.has(x.sym));
// Threshold sweep on the INDICES record (where the gate applies) to pick the quality/quantity balance.
function runThr(thr) {
  const closed = [];
  for (const sym of Object.keys(DATA)) {
    const candles = DATA[sym], meta = MARKETS[sym] || { name: sym, symbol: sym };
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      if (thr != null && !meta.crypto && sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= thr) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  return closed;
}
console.log('\nINDICES record by %B threshold (baseline = no gate):');
console.log('  baseline    ', JSON.stringify(st(idx(runThr(null)))));
for (const thr of [0.15, 0.20, 0.25, 0.30, 0.40]) console.log(`  %B<${thr.toFixed(2)}     `, JSON.stringify(st(idx(runThr(thr)))));
