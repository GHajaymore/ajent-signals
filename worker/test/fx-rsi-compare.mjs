// Tuning probe: the shipped FX cell (rsiP:14, lower:30) fires rarely (~5 setups per
// pair per year), so the live record had caught zero FX trades. Would a FASTER RSI
// trade often enough to make the both-ways capability actually contribute, without
// killing the edge? Compares trigger configs on the same live daily history, pooled
// and on a 60/40 in-sample vs out-of-sample split. No production code is changed.
//   node test/fx-rsi-compare.mjs
//
// VERDICT (2026-09-05): HOLD — do NOT loosen. Faster triggers OVERFIT. rsi2/05 looks
// superb in-sample (PF 3.60) but collapses out-of-sample (PF 1.11, avgR 0.015) and
// its SHORT side turns NEGATIVE OOS (-0.016); rsi2/10 loses money OOS (PF 0.97). The
// shipped rsi14/30 is the ONLY config robust across the IS→OOS boundary (OOS PF 2.39,
// avgR 0.209, shorts +0.146). FX two-way mean-reversion is genuinely rare; chasing
// frequency buys noise and forfeits the short-side edge. The record's FX silence is
// honest rarity, not a defect. (The other lever — adding pairs — was tested and held
// in fx-crosses.mjs.) Re-run if the FX cell's recipe or the regime changes.
import { fetchDailyCandles } from '../src/data.js';
import { rsi, atr, sma } from '../src/indicators.js';

const FX = { EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X', NZDUSD: 'NZDUSD=X' };

// Symmetric MR with configurable RSI period + band. Exit: RSI back through 50, ATR
// stop, or time stop. Mirrors the shipped computeBothMR/bothMRShouldExit logic.
function backtest(candles, cfg) {
  const cl = candles.map((x) => x.c);
  const R = rsi(cl, cfg.rsiP), A = atr(candles, 14), S = sma(cl, cfg.smaP);
  const upper = 100 - cfg.lower;
  const trades = []; let pos = null;
  for (let i = 60; i < candles.length; i++) {
    const price = candles[i].c, now = candles[i].t, r = R[i], a = A[i], s = S[i];
    if (r == null || a == null || !(a > 0) || s == null) continue;
    if (pos) {
      let ex = null;
      if (pos.dir > 0 ? price <= pos.stop : price >= pos.stop) ex = 'stop';
      else if (pos.dir > 0 ? r > 50 : r < 50) ex = 'rsiRecover';
      else if (now - pos.openedAt > cfg.maxHoldDays * 86400000) ex = 'timeStop';
      if (ex) { trades.push({ r: (pos.dir * (price - pos.entry)) / pos.risk, dir: pos.dir }); pos = null; }
    }
    if (!pos) {
      let dir = 0;
      if (r < cfg.lower) dir = 1; else if (r > upper) dir = -1;
      if (dir !== 0) {
        const risk = Math.max(a * cfg.stopAtr, price * 0.004);
        pos = { dir, entry: price, stop: dir > 0 ? price - risk : price + risk, risk, openedAt: now };
      }
    }
  }
  return trades;
}

function stats(trades) {
  const n = trades.length; if (!n) return { n: 0 };
  const wins = trades.filter((t) => t.r > 0), gains = wins.reduce((s, t) => s + t.r, 0);
  const losses = trades.filter((t) => t.r <= 0).reduce((s, t) => s + Math.abs(t.r), 0);
  const shorts = trades.filter((t) => t.dir < 0), longs = trades.filter((t) => t.dir > 0);
  const avgR = (a) => a.length ? a.reduce((s, t) => s + t.r, 0) / a.length : 0;
  return {
    n, win: Math.round(100 * wins.length / n), pf: losses ? gains / losses : Infinity,
    avgR: avgR(trades), shortN: shorts.length, shortAvgR: avgR(shorts), longN: longs.length, longAvgR: avgR(longs),
  };
}

const CONFIGS = {
  'shipped rsi14/30': { rsiP: 14, lower: 30, smaP: 50, stopAtr: 2.5, maxHoldDays: 10 },
  'rsi7/25':          { rsiP: 7,  lower: 25, smaP: 50, stopAtr: 2.5, maxHoldDays: 10 },
  'rsi2/15 (comm)':   { rsiP: 2,  lower: 15, smaP: 50, stopAtr: 2.5, maxHoldDays: 10 },
  'rsi2/10':          { rsiP: 2,  lower: 10, smaP: 50, stopAtr: 2.5, maxHoldDays: 10 },
  'rsi2/05':          { rsiP: 2,  lower: 5,  smaP: 50, stopAtr: 2.5, maxHoldDays: 10 },
};

const series = {};
for (const [sym, y] of Object.entries(FX)) {
  try {
    const { candles } = await fetchDailyCandles({ yahoo: y, country: 'US' }, { DATA_PROVIDER: 'yahoo' });
    if (candles && candles.length > 200) series[sym] = candles;
  } catch (e) { console.log('skip', sym, e.message); }
}
const spanDays = Math.max(...Object.values(series).map((c) => c.length ? (c[c.length - 1].t - c[0].t) / 86400000 : 0));
const years = spanDays / 365;
console.log(`FX both-ways trigger sweep — pooled across ${Object.keys(series).length} pairs, ~${years.toFixed(1)}y of daily bars\n`);
// Split each pair 60/40: in-sample (train window) vs out-of-sample (held out).
function splitRun(cfg, part) {
  const all = [];
  for (const c of Object.values(series)) {
    const cut = Math.floor(c.length * 0.6);
    const seg = part === 'is' ? c.slice(0, cut) : c.slice(cut - 60); // keep 60-bar warmup for OOS
    all.push(...backtest(seg, cfg));
  }
  return stats(all);
}
function fmt(s) {
  if (!s.n) return 'n=0';
  return `n=${String(s.n).padStart(3)} win ${(s.win + '%').padStart(4)} PF ${(s.pf === Infinity ? '∞' : s.pf.toFixed(2)).padStart(5)} avgR ${s.avgR.toFixed(3).padStart(6)} sh ${s.shortAvgR.toFixed(3).padStart(6)} lo ${s.longAvgR.toFixed(3).padStart(6)}`;
}
console.log('config'.padEnd(18), 'trd/yr'.padStart(7), '  pooled → in-sample vs out-of-sample');
for (const [name, cfg] of Object.entries(CONFIGS)) {
  const all = []; for (const c of Object.values(series)) all.push(...backtest(c, cfg));
  const s = stats(all); if (!s.n) { console.log(name.padEnd(18), '   0'); continue; }
  console.log(name.padEnd(18), (s.n / years).toFixed(1).padStart(7), ' ', fmt(s));
  console.log(''.padEnd(18), ''.padStart(7), '   IS:', fmt(splitRun(cfg, 'is')));
  console.log(''.padEnd(18), ''.padStart(7), '  OOS:', fmt(splitRun(cfg, 'oos')));
}
