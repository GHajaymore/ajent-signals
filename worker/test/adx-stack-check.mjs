// DECISIVE CHECK: %B<0.30 is ADOPTED live. Does stacking the ADX 15–20 "dead zone" notch ON TOP
// of it still add edge, or is it redundant (like support-proximity turned out to be)? The earlier
// adx-regime-probe measured the notch vs the RAW baseline (no %B); this measures it vs the gate we
// actually run. Indices/ETFs only (crypto keeps the full recipe). Uses the exact production signal.
//   node test/adx-stack-check.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6, PB = 0.30, DEAD_LO = 15, DEAD_HI = 20;
const inDeadZone = (adxEntry) => typeof adxEntry === 'number' && adxEntry >= DEAD_LO && adxEntry < DEAD_HI;

function run(mode) { // 'base' | 'pb' | 'pbadx'
  const closed = [];
  for (const sym of Object.keys(DATA)) {
    const candles = DATA[sym], meta = MARKETS[sym] || { name: sym, symbol: sym };
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      if (mode !== 'base' && !meta.crypto && sig.verdict === 'BUY') {
        const pbOk = typeof sig.pctB === 'number' && sig.pctB < PB;
        const adxOk = mode === 'pbadx' ? !inDeadZone(sig.adxEntry) : true;
        if (!(pbOk && adxOk)) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      }
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  return closed;
}
const CRYPTO = new Set(Object.keys(DATA).filter((s) => MARKETS[s] && MARKETS[s].crypto));
const st = (t) => {
  if (!t.length) return { n: 0, pf: 0, avgR: 0, pnl: 0, maxDD: 0 };
  const gw = t.filter((x) => x.pnl > 0).reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  let eq = 0, pk = 0, dd = 0; for (const x of t) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, pf: +(gw / (gl || 1)).toFixed(2), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)), maxDD: Math.round(dd) };
};
const idx = (t) => t.filter((x) => !CRYPTO.has(x.sym));
const pb = st(idx(run('pb'))), pbadx = st(idx(run('pbadx')));
console.log('\nINDICES/ETF record — does ADX 15–20 notch add to the ADOPTED %B<0.30?\n');
console.log('  baseline            ', JSON.stringify(st(idx(run('base')))));
console.log('  %B<0.30 (adopted)   ', JSON.stringify(pb));
console.log('  %B<0.30 + ADX notch ', JSON.stringify(pbadx));
const dPf = (pbadx.pf - pb.pf), dR = (pbadx.avgR - pb.avgR), dDD = (pbadx.maxDD - pb.maxDD), dropped = pb.n - pbadx.n;
console.log(`\n  Δ vs adopted %B: PF ${dPf >= 0 ? '+' : ''}${dPf.toFixed(2)}, avgR ${dR >= 0 ? '+' : ''}${dR.toFixed(3)}, maxDD ${dDD >= 0 ? '+' : ''}${dDD} (less negative = better), trades dropped ${dropped}/${pb.n}`);
console.log(`  VERDICT: ${dPf > 0.15 && dR >= -0.005 ? 'ADX notch ADDS on top of %B — worth forward-testing.' : 'ADX notch is REDUNDANT with %B — like support; do not stack.'}\n`);
