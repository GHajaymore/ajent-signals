// Orthogonal-edge lab: TREND / MOMENTUM candidates (the diversifier for the Ajent
// Pulse ensemble). These ride continuation instead of fading dips, so they need a
// trend exit (trail / channel), not the mean-reversion RSI exit — hence a self-
// contained backtester with the same metrics as bt.mjs. The point is a robust edge
// that fires on DIFFERENT days than mean reversion (real diversification).
//   node test/trend.mjs
import { DATA } from './bt.mjs';
import { sma, atr, stdev } from '../src/indicators.js';

const START = 25000, RISK = 250, COST = 6;
const YEAR = 365.25 * 24 * 3600 * 1000;
const fmt = (r) => `PF ${String(r.pf).padStart(4)}  CAGR ${String(r.cagr).padStart(6)}%  MAR ${String(r.mar).padStart(5)}  DD ${String(r.maxDD).padStart(6)}%  win ${String(r.winRate).padStart(3)}%  n=${r.trades}`;

// Pre-compute the indicator arrays once per market (avoids O(n^2) re-slicing).
const PRE = {};
for (const sym of Object.keys(DATA)) {
  const c = DATA[sym];
  const closes = c.map((x) => x.c), highs = c.map((x) => x.h), lows = c.map((x) => x.l);
  const sd20 = stdev(closes, 20), s20 = sma(closes, 20);
  const upperBB = s20.map((v, i) => (v == null || sd20[i] == null ? null : v + 2 * sd20[i]));
  const lowerBB = s20.map((v, i) => (v == null || sd20[i] == null ? null : v - 2 * sd20[i]));
  const bw = s20.map((v, i) => (v == null || sd20[i] == null || v === 0 ? null : (4 * sd20[i]) / v)); // band width %
  PRE[sym] = { c, closes, highs, lows, atr: atr(c, 14), sma200: sma(closes, 200), sma100: sma(closes, 100), sma50: sma(closes, 50), sma20: s20, upperBB, lowerBB, bw };
}
const rollMax = (a, i, n) => { let m = -Infinity; for (let k = Math.max(0, i - n); k < i; k++) m = Math.max(m, a[k]); return m; };
const rollMin = (a, i, n) => { let m = Infinity; for (let k = Math.max(0, i - n); k < i; k++) m = Math.min(m, a[k]); return m; };

function run(strat, syms = Object.keys(DATA)) {
  const closed = [];
  let tMin = Infinity, tMax = -Infinity, bhSum = 0, nMkt = 0;
  for (const sym of syms) {
    const p = PRE[sym], c = p.c;
    let pos = null;
    for (let i = 210; i < c.length; i++) {
      const price = c[i].c, t = c[i].t;
      const ctx = { p, i, price, sym };
      if (pos) {
        pos.peak = Math.max(pos.peak, price);
        const exit = (price <= pos.stop) || strat.exit(ctx, pos);
        if (exit) {
          const r = Math.abs(pos.entry - pos.stop) || 1e-9;
          const resultR = (price - pos.entry) / r;
          closed.push({ pnl: Math.round(resultR * RISK - COST), openedAt: pos.t, closedAt: t });
          pos = null;
        }
      }
      if (!pos && strat.entry(ctx)) {
        const a = p.atr[i]; if (a == null || !(a > 0)) continue;
        const risk = Math.max(a * strat.stopMult, price * 0.004);
        pos = { entry: price, stop: price - risk, t, peak: price, atr: a, oi: i };
      }
    }
    const first = p.closes[210], last = p.closes[p.closes.length - 1];
    bhSum += (last - first) / first; nMkt++;
  }
  for (const tr of closed) { tMin = Math.min(tMin, tr.openedAt); tMax = Math.max(tMax, tr.closedAt); }
  closed.sort((a, b) => a.closedAt - b.closedAt);
  let eq = START, peak = START, maxDD = 0, gw = 0, gl = 0;
  const wins = closed.filter((t) => t.pnl > 0).length, losses = closed.filter((t) => t.pnl < 0).length;
  for (const t of closed) { eq += t.pnl; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, (eq - peak) / peak); if (t.pnl > 0) gw += t.pnl; else gl += Math.abs(t.pnl); }
  const years = (tMax - tMin) / YEAR || 1;
  const cagr = (Math.pow(eq / START, 1 / years) - 1) * 100;
  return {
    trades: closed.length, winRate: Math.round((wins / ((wins + losses) || 1)) * 100),
    cagr: +cagr.toFixed(1), maxDD: +(maxDD * 100).toFixed(1), pf: +(gw / (gl || 1)).toFixed(2),
    mar: maxDD ? +(cagr / Math.abs(maxDD * 100)).toFixed(2) : 0,
  };
}

// --- Trend / momentum candidates ------------------------------------------
const up = (p, i) => p.sma200[i] != null && p.closes[i] > p.sma200[i];
// SMA trend-follow (rising MA) is the winner — sweep the MA period to confirm a
// robust PLATEAU rather than one lucky setting, and keep a Donchian for contrast.
const smaTrend = (arr) => ({
  stopMult: 3,
  entry: ({ p, i, price }) => up(p, i) && arr(p)[i] != null && price > arr(p)[i] && arr(p)[i] > arr(p)[i - 5],
  exit: ({ p, i, price }) => arr(p)[i] != null && price < arr(p)[i],
});
// Trailing-stop variants of the PRODUCTION trend engine (50SMA rising entry) — does
// a ratcheting ATR trail from the peak beat the plain "exit when price < 50SMA"?
// `alsoSma` = trail AND the MA-break (whichever hits first). Trail uses CURRENT ATR.
const trailTrend = (mult, alsoSma) => ({
  stopMult: 3,
  entry: ({ p, i, price }) => up(p, i) && p.sma50[i] != null && price > p.sma50[i] && p.sma50[i] > p.sma50[i - 5],
  exit: ({ p, i, price }, pos) => (price <= pos.peak - mult * (p.atr[i] || pos.atr)) || (alsoSma && p.sma50[i] != null && price < p.sma50[i]),
});
const STRATS = {
  '20SMA trend-follow (rising)': smaTrend((p) => p.sma20),
  '50SMA trend-follow (rising) [PROD]': smaTrend((p) => p.sma50),
  '100SMA trend-follow (rising)': smaTrend((p) => p.sma100),
  'Trail 2.0xATR (from peak)': trailTrend(2, false),
  'Trail 2.5xATR (from peak)': trailTrend(2.5, false),
  'Trail 3.0xATR (from peak)': trailTrend(3, false),
  'Trail 3.5xATR (from peak)': trailTrend(3.5, false),
  'Trail 4.0xATR (from peak)': trailTrend(4, false),
  '50SMA-break OR trail 3xATR': trailTrend(3, true),
  'Donchian 40/20 breakout': {
    stopMult: 3,
    entry: ({ p, i, price }) => up(p, i) && price >= rollMax(p.highs, i, 40),
    exit: ({ p, i, price }) => price <= rollMin(p.lows, i, 20),
  },
  // --- third-edge candidates (orthogonal to dip-buying & MA trend-follow) ---
  'Bollinger squeeze breakout': {
    stopMult: 3,
    entry: ({ p, i, price }) => {
      if (!up(p, i) || p.upperBB[i] == null || p.bw[i] == null) return false;
      const minBW = rollMin(p.bw, i, 60);
      return minBW != null && p.bw[i] <= minBW * 1.15 && price >= p.upperBB[i]; // break out of a volatility squeeze
    },
    exit: ({ price }, pos) => price <= pos.peak - 3 * pos.atr,
  },
  'Pullback to 20MA in uptrend': {
    stopMult: 2.5,
    entry: ({ p, i, price }) => up(p, i) && p.sma50[i] != null && p.sma50[i] > p.sma50[i - 5]
      && p.sma20[i] != null && p.c[i - 1] && p.c[i - 1].l < p.sma20[i - 1] && price > p.sma20[i], // dipped to the 20MA, resumed
    exit: ({ p, i, price }) => p.sma50[i] != null && price < p.sma50[i],
  },
  // --- structurally DIFFERENT edges (time / volatility, orthogonal to price) ---
  'Turn-of-month seasonality': { // buy last days of month, hold into the new month
    stopMult: 3,
    entry: ({ p, i }) => { const d = new Date(p.c[i].t).getUTCDate(); return up(p, i) && d >= 26; },
    exit: ({ i }, pos) => i - pos.oi >= 5, // hold ~5 trading days (through the turn)
  },
  'Volatility-spike reversion': { // buy after an ATR spike settles, in an uptrend
    stopMult: 3,
    entry: ({ p, i, price }) => {
      if (!up(p, i) || p.atr[i] == null) return false;
      const recent = p.atr.slice(Math.max(0, i - 20), i).filter((v) => v > 0);
      if (!recent.length) return false;
      const med = recent.slice().sort((a, b) => a - b)[Math.floor(recent.length / 2)];
      // was a spike in the last 3 bars, now calming and price above the 20MA
      const spiked = [i - 1, i - 2, i - 3].some((k) => k >= 0 && p.atr[k] > med * 1.8);
      return spiked && p.atr[i] < med * 1.5 && p.sma20[i] != null && price > p.sma20[i];
    },
    exit: ({ i }, pos) => i - pos.oi >= 5,
  },
};

console.log(`\nTREND / MOMENTUM candidates — ${Object.keys(DATA).length} markets, ~${(DATA[Object.keys(DATA)[0]] || []).length} bars:\n`);
const rows = [];
for (const [name, s] of Object.entries(STRATS)) rows.push({ name, ...run(s) });
rows.sort((a, b) => b.mar - a.mar);
for (const r of rows) console.log(`  ${r.name.padEnd(36)} ${fmt(r)}`);
console.log('\nBench: Ajent Pulse (mean reversion) prints PF ~2.6 / CAGR ~29% / MAR ~7. A trend edge earns a place if it is robustly POSITIVE (need not beat MR) AND fires on different days — diversification, not replacement.\n');
