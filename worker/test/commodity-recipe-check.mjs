// Validation probe: combos.mjs surfaced that on commodities, a pure RSI14 symmetric
// mean-reversion (the SAME recipe the FX cell uses) scored higher and more symmetric
// (pf 1.68, short avgR +0.149) than the SHIPPED commodity recipe (RSI2 dip/pop + SMA50
// side + ROC momentum, cell 'commodity'). Is that a real, robust improvement or a
// pooled-overfit mirage? This runs BOTH recipes on the same live daily history, pooled
// and on a 60/40 in-sample vs out-of-sample split, reporting the honest short side.
// No production code is changed.
//   node test/commodity-recipe-check.mjs
//
// VERDICT (2026-09-05): HOLD — keep the shipped commodity recipe. The combos.mjs hint
// did NOT survive OOS with a realistic production exit: the RSI14 symmetric candidate
// scores PF 0.70 out-of-sample with shorts −0.303 (it loses money), while the shipped
// recipe is robust — OOS PF 2.17, avgR 0.087, shorts +0.096 (better OOS than IS). The
// combos.mjs pooled figure leaned on a condition-based exit (RSI14 back above 30) that
// doesn't hold once the production exit family (RSI-through-50 / ATR stop / time stop)
// is applied. This is the 2nd pooled-lab candidate this session to collapse OOS (see
// fx-rsi-compare.mjs) — the shipped recipes are the robust ones. Also a useful positive:
// confirms the shipped commodity cell's SHORT side works forward (OOS +0.096).
import { fetchDailyCandles } from '../src/data.js';
import { computeBothMR, bothMRShouldExit } from '../src/bothways.js';
import { rsi, atr, sma } from '../src/indicators.js';

const COMM = { GC: 'GC=F', SI: 'SI=F', HG: 'HG=F', CL: 'CL=F', NG: 'NG=F' };

// A) SHIPPED recipe — drive the production engine on the 'commodity' cell.
function backtestShipped(candles, from, to) {
  const trades = []; let pos = null;
  const lo = Math.max(60, from), hi = Math.min(candles.length, to);
  for (let i = lo; i < hi; i++) {
    const sig = computeBothMR(candles.slice(0, i + 1), null, 'commodity');
    const price = candles[i].c, now = candles[i].t;
    if (pos) { const ex = bothMRShouldExit(sig, pos, price, now); if (ex) { trades.push({ r: (pos.dir * (price - pos.entry)) / pos.risk, dir: pos.dir }); pos = null; } }
    if (!pos && (sig.verdict === 'BUY' || sig.verdict === 'SELL')) pos = { dir: sig.direction, entry: sig.plan.entry, stop: sig.plan.stop, risk: sig.plan.risk, side: sig.direction < 0 ? 'SHORT' : 'LONG', openedAt: now };
  }
  return trades;
}

// B) CANDIDATE — pure RSI14/30 symmetric MR (identical to the FX cell), no trend/ROC
// filter. Same exit family: RSI back through 50, ATR stop, time stop.
function backtestRsi14(candles, from, to) {
  const cl = candles.map((x) => x.c);
  const R = rsi(cl, 14), A = atr(candles, 14), S = sma(cl, 50);
  const lower = 30, upper = 70, stopAtr = 2.5, maxHoldMs = 10 * 86400000;
  const trades = []; let pos = null;
  const lo = Math.max(60, from), hi = Math.min(candles.length, to);
  for (let i = lo; i < hi; i++) {
    const price = cl[i], now = candles[i].t, r = R[i], a = A[i], s = S[i];
    if (r == null || a == null || !(a > 0) || s == null) continue;
    if (pos) {
      let ex = null;
      if (pos.dir > 0 ? price <= pos.stop : price >= pos.stop) ex = 'stop';
      else if (pos.dir > 0 ? r > 50 : r < 50) ex = 'rsiRecover';
      else if (now - pos.openedAt > maxHoldMs) ex = 'timeStop';
      if (ex) { trades.push({ r: (pos.dir * (price - pos.entry)) / pos.risk, dir: pos.dir }); pos = null; }
    }
    if (!pos) {
      let dir = 0; if (r < lower) dir = 1; else if (r > upper) dir = -1;
      if (dir !== 0) { const risk = Math.max(a * stopAtr, price * 0.004); pos = { dir, entry: price, stop: dir > 0 ? price - risk : price + risk, risk, openedAt: now }; }
    }
  }
  return trades;
}

function stats(trades) {
  const n = trades.length; if (!n) return { n: 0 };
  const wins = trades.filter((t) => t.r > 0), gains = wins.reduce((s, t) => s + t.r, 0);
  const losses = trades.filter((t) => t.r <= 0).reduce((s, t) => s + Math.abs(t.r), 0);
  const shorts = trades.filter((t) => t.dir < 0);
  const avgR = (a) => (a.length ? a.reduce((s, t) => s + t.r, 0) / a.length : 0);
  return { n, win: Math.round(100 * wins.length / n), pf: losses ? gains / losses : Infinity, avgR: avgR(trades), shortN: shorts.length, shortAvgR: avgR(shorts) };
}
const fmt = (s) => (!s.n ? 'n=0' : `n=${String(s.n).padStart(3)} win ${(s.win + '%').padStart(4)} PF ${(s.pf === Infinity ? '∞' : s.pf.toFixed(2)).padStart(5)} avgR ${s.avgR.toFixed(3).padStart(6)} short ${s.shortAvgR.toFixed(3).padStart(6)} (n=${s.shortN})`);

const series = {};
for (const [sym, y] of Object.entries(COMM)) {
  try { const { candles } = await fetchDailyCandles({ yahoo: y, country: 'US' }, { DATA_PROVIDER: 'yahoo' }); if (candles && candles.length > 200) series[sym] = candles; }
  catch (e) { console.log('skip', sym, e.message); }
}
console.log(`\nCommodity recipe check — ${Object.keys(series).length} futures, pooled + 60/40 IS/OOS\n`);
for (const [name, fn] of [['SHIPPED (rsi2 dip + trend + roc)', backtestShipped], ['CANDIDATE (rsi14 symmetric MR)', backtestRsi14]]) {
  const pooled = [], is = [], oos = [];
  for (const c of Object.values(series)) {
    const cut = Math.floor(c.length * 0.6);
    pooled.push(...fn(c, 0, 1e9)); is.push(...fn(c, 0, cut)); oos.push(...fn(c, cut - 60, 1e9));
  }
  console.log(name);
  console.log('  pooled', fmt(stats(pooled)));
  console.log('     IS ', fmt(stats(is)));
  console.log('    OOS ', fmt(stats(oos)));
  console.log('');
}
