// Widening probe: do FX CROSS pairs (EUR/JPY, GBP/JPY, …) clear the gate on the SAME
// shipped FX engine (src/bothways.js, cell 'fx' = symmetric RSI14 MR)? The FX cell's
// weakness is low signal frequency; adding validated crosses gives users more setups
// and grows the forward record faster — but only if the edge actually holds on them.
// Tests the PRODUCTION engine (not an inline recipe) through the 5 promotion gates.
//
// VERDICT (2026-09-04): HOLD — do NOT add. The LONG side is strong (pooled pf 1.6,
// avgR 0.107, walk-forward 3/3, OOS +0.13), but the SHORT side FAILS (avgR -0.005).
// The JPY crosses drifted up over the sample (yen weakness), so they behaved like
// drifting equities, not symmetric FX — the two-way symmetry that makes the USD
// majors work doesn't hold here. Adding them long-only would be a regime bet, not a
// robust edge, so they stay out. Re-run if the FX cell's recipe or the regime changes.
//   node test/fx-crosses.mjs
import { fetchDailyCandles } from '../src/data.js';
import { computeBothMR, bothMRShouldExit } from '../src/bothways.js';

const CROSSES = { EURGBP: 'EURGBP=X', EURJPY: 'EURJPY=X', GBPJPY: 'GBPJPY=X', AUDJPY: 'AUDJPY=X', EURAUD: 'EURAUD=X', EURCHF: 'EURCHF=X', CADJPY: 'CADJPY=X', NZDJPY: 'NZDJPY=X' };

function backtest(candles, from = 0, to = 1e9) {
  const trades = []; let pos = null;
  const lo = Math.max(60, from), hi = Math.min(candles.length, to);
  for (let i = lo; i < hi; i++) {
    const sub = candles.slice(0, i + 1);
    const sig = computeBothMR(sub, null, 'fx');
    const price = candles[i].c, now = candles[i].t;
    if (pos) {
      if (bothMRShouldExit(sig, pos, price, now)) { trades.push({ r: (pos.dir * (price - pos.entry)) / pos.risk, dir: pos.dir }); pos = null; }
    }
    if (!pos && (sig.verdict === 'BUY' || sig.verdict === 'SELL')) {
      const dir = sig.direction;
      pos = { dir, entry: sig.plan.entry, stop: sig.plan.stop, risk: sig.plan.risk, side: dir < 0 ? 'SHORT' : 'LONG', maxHoldMin: sig.plan.maxHoldMin, openedAt: now };
    }
  }
  return trades;
}
function agg(all) {
  const R = all.map((t) => t.r), w = R.filter((r) => r > 0), l = R.filter((r) => r < 0);
  const gw = w.reduce((a, r) => a + r, 0), gl = Math.abs(l.reduce((a, r) => a + r, 0));
  const sh = all.filter((t) => t.dir < 0);
  return { n: R.length, win: R.length ? Math.round(w.length / R.length * 100) : 0, pf: gl ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0), avgR: R.length ? +(R.reduce((a, r) => a + r, 0) / R.length).toFixed(3) : 0, shortN: sh.length, shortAvgR: sh.length ? +(sh.reduce((a, t) => a + t.r, 0) / sh.length).toFixed(3) : 0 };
}

const data = {};
for (const [nm, y] of Object.entries(CROSSES)) { try { const { candles } = await fetchDailyCandles({ yahoo: y, country: 'US' }, { DATA_PROVIDER: 'yahoo' }); if (candles && candles.length > 300) data[nm] = candles; } catch (e) { /* skip */ } }
const have = Object.keys(data), mkts = have.map((n) => data[n]);
const runAll = (syms, from, to) => { let all = []; for (const s of syms) all = all.concat(backtest(data[s], from, to)); return agg(all); };

console.log(`\nFX CROSSES through the gate (shipped 'fx' engine). Symbols: ${have.join(', ')}\n`);
console.log('Per symbol:');
for (const s of have) { const r = agg(backtest(data[s])); console.log(`  ${s.padEnd(8)} pf ${String(r.pf).padStart(5)} win ${String(r.win).padStart(3)}% avgR ${String(r.avgR).padStart(6)} n=${String(r.n).padStart(3)} short avgR ${r.shortAvgR}`); }

const pooled = runAll(have);
const g1 = pooled.pf >= 1.3 && pooled.avgR > 0.05 && pooled.n >= 40;
const maxLen = Math.max(...mkts.map((c) => c.length));
const folds = [[0, maxLen / 3], [maxLen / 3, 2 * maxLen / 3], [2 * maxLen / 3, maxLen]].map(([a, b]) => runAll(have, Math.floor(a), Math.floor(b)));
const foldTraded = folds.filter((f) => f.n >= 5).length, foldPos = folds.filter((f) => f.n >= 5 && f.avgR > 0).length;
const g2 = foldPos >= Math.max(2, foldTraded - 1);
const half = Math.ceil(have.length / 2), oos = runAll(have.slice(half));
const g3 = oos.avgR > 0 && oos.n >= 20;
const g5 = pooled.shortAvgR > 0 && pooled.shortN >= 15;
const gate = (p, l, d) => console.log(`  ${p ? '✅' : '❌'} ${l.padEnd(15)} ${d}`);
console.log('\nPooled gate:');
gate(g1, '1 Pooled', `pf ${pooled.pf} · win ${pooled.win}% · avgR ${pooled.avgR} · n=${pooled.n}`);
gate(g2, '2 Walk-forward', `folds avgR [${folds.map((f) => f.avgR).join(', ')}] — ${foldPos}/${foldTraded} positive`);
gate(g3, '3 Out-of-sample', `holdout [${have.slice(half).join(', ')}] avgR ${oos.avgR} · n=${oos.n}`);
gate(g5, '5 Short side', `shorts avgR ${pooled.shortAvgR} · n=${pooled.shortN}`);
console.log(`\n  VERDICT: ${g1 && g2 && g3 && g5 ? '✅ PROMOTE — add these crosses to the FX cell' : '❌ HOLD — do not add'}\n`);
