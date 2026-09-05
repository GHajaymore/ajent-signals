// PROMOTION GATE for a STOCKS tracked cell. Today stocks are screener-only (signals,
// not auto-traded) because of single-name / earnings-gap risk. Before making them a
// tracked EXPERIMENT cell (auto-paper-traded on their own record), the edge must clear
// the same gate as every other cell — run the PRODUCTION swing recipe (computeSignal)
// long-only across the diversified universe. Long-only, so no short-side gate.
//   node test/promote-stocks.mjs
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { STRATEGY } from '../src/meta.js';
import { STOCK_UNIVERSE } from '../src/stocks.js';

// Backtest the exact production entry + a mean-reversion exit (RSI reverts past the
// exit threshold), a volatility stop, and a ~5-day time cap — the swing shape.
function backtest(candles, from = 0, to = 1e9) {
  const closed = []; let pos = null;
  const lo = Math.max(210, from), hi = Math.min(candles.length, to);
  for (let i = lo; i < hi; i++) {
    const price = candles[i].c;
    const sig = computeSignal(candles.slice(0, i + 1), price);
    if (pos) {
      let exit = null;
      if (price <= pos.stop) exit = price;
      else if (sig.rsi2 != null && sig.rsi2 > STRATEGY.exitAbove) exit = price;
      else if (i - pos.oi >= 5) exit = price;
      if (exit != null) { closed.push((exit - pos.entry) / pos.risk); pos = null; }
    }
    if (!pos && sig.verdict === 'BUY' && sig.plan) {
      pos = { entry: sig.plan.entry, stop: sig.plan.stop, risk: sig.plan.risk || Math.abs(sig.plan.entry - sig.plan.stop) || 1e-9, oi: i };
    }
  }
  return closed;
}
function agg(R) {
  const w = R.filter((r) => r > 0), l = R.filter((r) => r < 0);
  const gw = w.reduce((a, r) => a + r, 0), gl = Math.abs(l.reduce((a, r) => a + r, 0));
  return { n: R.length, win: R.length ? Math.round(w.length / R.length * 100) : 0, pf: gl ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0), avgR: R.length ? +(R.reduce((a, r) => a + r, 0) / R.length).toFixed(3) : 0 };
}

const data = {};
const BATCH = 8;
for (let i = 0; i < STOCK_UNIVERSE.length; i += BATCH) {
  await Promise.all(STOCK_UNIVERSE.slice(i, i + BATCH).map(async (sym) => {
    try { const { candles } = await fetchDailyCandles({ yahoo: sym, country: 'US' }, { DATA_PROVIDER: 'yahoo' }); if (candles && candles.length > 260) data[sym] = candles; } catch (e) { /* skip */ }
  }));
}
const have = Object.keys(data), mkts = have.map((n) => data[n]);
const runAll = (syms, from, to) => { let all = []; for (const s of syms) all = all.concat(backtest(data[s], from, to)); return agg(all); };

console.log(`\nSTOCKS tracked-cell gate — production swing recipe, ${have.length}/${STOCK_UNIVERSE.length} names.\n`);
const pooled = runAll(have);
const g1 = pooled.pf >= 1.3 && pooled.avgR > 0.05 && pooled.n >= 60;
const maxLen = Math.max(...mkts.map((c) => c.length));
const folds = [[0, maxLen / 3], [maxLen / 3, 2 * maxLen / 3], [2 * maxLen / 3, maxLen]].map(([a, b]) => runAll(have, Math.floor(a), Math.floor(b)));
const foldTraded = folds.filter((f) => f.n >= 8).length, foldPos = folds.filter((f) => f.n >= 8 && f.avgR > 0).length;
const g2 = foldPos >= Math.max(2, foldTraded - 1);
const half = Math.ceil(have.length / 2), oos = runAll(have.slice(half));
const g3 = oos.avgR > 0 && oos.n >= 30;
const gate = (p, l, d) => console.log(`  ${p ? '✅' : '❌'} ${l.padEnd(15)} ${d}`);
gate(g1, '1 Pooled', `pf ${pooled.pf} · win ${pooled.win}% · avgR ${pooled.avgR} · n=${pooled.n}`);
gate(g2, '2 Walk-forward', `folds avgR [${folds.map((f) => f.avgR).join(', ')}] — ${foldPos}/${foldTraded} positive`);
gate(g3, '3 Out-of-sample', `holdout ${have.length - half} names: avgR ${oos.avgR} · n=${oos.n}`);
console.log(`\n  VERDICT: ${g1 && g2 && g3 ? '✅ PROMOTE — stocks can ship as a tracked EXPERIMENT cell' : '❌ HOLD'}\n`);
