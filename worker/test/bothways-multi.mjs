// BOTH-WAYS research across asset classes. The existing bothways.mjs proved shorts
// LOSE on equity indices (structural up-drift). This asks the honest question the app
// hasn't: do long+short strategies have a real edge on SYMMETRIC assets — FX and
// commodities — where there's no drift? Tests several classic both-directional edges
// through one honest R-based backtest and reports per class, with the long/short split.
//   node test/bothways-multi.mjs
import { fetchDailyCandles } from '../src/data.js';
import { sma, rsi, atr, stdev } from '../src/indicators.js';

const GROUPS = {
  FX: { EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X', NZDUSD: 'NZDUSD=X' },
  Commodities: { GC: 'GC=F', SI: 'SI=F', HG: 'HG=F', CL: 'CL=F', NG: 'NG=F', ZC: 'ZC=F', ZS: 'ZS=F', ZW: 'ZW=F' },
  'Equities (benchmark)': { ES: 'ES=F', NQ: 'NQ=F', RTY: 'RTY=F' },
};

// --- extra indicators ------------------------------------------------------
function donchian(c, p) {
  const hi = Array(c.length).fill(null), lo = Array(c.length).fill(null);
  for (let i = p; i < c.length; i++) { let h = -Infinity, l = Infinity; for (let k = 1; k <= p; k++) { h = Math.max(h, c[i - k].h); l = Math.min(l, c[i - k].l); } hi[i] = h; lo[i] = l; }
  return { hi, lo };
}
function adx(c, p) {
  const len = c.length, tr = Array(len).fill(0), pdm = Array(len).fill(0), ndm = Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    const up = c[i].h - c[i - 1].h, dn = c[i - 1].l - c[i].l;
    pdm[i] = (up > dn && up > 0) ? up : 0; ndm[i] = (dn > up && dn > 0) ? dn : 0;
    tr[i] = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  }
  const out = Array(len).fill(null), dx = Array(len).fill(null);
  let trS = 0, pS = 0, nS = 0;
  for (let i = 1; i < len; i++) {
    if (i <= p) { trS += tr[i]; pS += pdm[i]; nS += ndm[i]; }
    else { trS = trS - trS / p + tr[i]; pS = pS - pS / p + pdm[i]; nS = nS - nS / p + ndm[i]; }
    if (i >= p && trS > 0) { const pdi = 100 * pS / trS, ndi = 100 * nS / trS; dx[i] = (pdi + ndi) ? 100 * Math.abs(pdi - ndi) / (pdi + ndi) : 0; }
  }
  let adxV = null, cnt = 0, sum = 0;
  for (let i = 1; i < len; i++) { if (dx[i] == null) continue; cnt++; if (cnt <= p) { sum += dx[i]; if (cnt === p) { adxV = sum / p; out[i] = adxV; } } else { adxV = (adxV * (p - 1) + dx[i]) / p; out[i] = adxV; } }
  return out;
}

// --- strategies: each returns +1 (long) / -1 (short) / 0 at bar i, plus an exit style.
// Trend exits ride an ATR trailing stop; MR exits revert to the mean with a hard stop.
const STRATS = {
  'Donchian 20/10 breakout (both)': {
    exit: 'trail',
    pre: (c) => ({ don: donchian(c, 20), atr: atr(c, 14) }),
    sig: (i, x, c) => { const p = c[i].c; if (x.don.hi[i] == null) return 0; if (p > x.don.hi[i]) return 1; if (p < x.don.lo[i]) return -1; return 0; },
  },
  'Donchian 55/20 breakout (both)': {
    exit: 'trail', trailP: 20,
    pre: (c) => ({ don: donchian(c, 55), don2: donchian(c, 20), atr: atr(c, 14) }),
    sig: (i, x, c) => { const p = c[i].c; if (x.don.hi[i] == null) return 0; if (p > x.don.hi[i]) return 1; if (p < x.don.lo[i]) return -1; return 0; },
  },
  'MA20/50 cross + ADX>20 (both)': {
    exit: 'trail',
    pre: (c) => { const cl = c.map((x) => x.c); return { f: sma(cl, 20), s: sma(cl, 50), adx: adx(c, 14), atr: atr(c, 14) }; },
    sig: (i, x, c) => { if (x.f[i] == null || x.s[i] == null || x.adx[i] == null || x.adx[i] < 20) return 0; if (x.f[i] > x.s[i]) return 1; if (x.f[i] < x.s[i]) return -1; return 0; },
  },
  'RSI2 symmetric MR (both)': {
    exit: 'mr',
    pre: (c) => { const cl = c.map((x) => x.c); return { rsi2: rsi(cl, 2), atr: atr(c, 14) }; },
    sig: (i, x) => { if (x.rsi2[i] == null) return 0; if (x.rsi2[i] < 10) return 1; if (x.rsi2[i] > 90) return -1; return 0; },
  },
  'Bollinger 2σ MR in range (both)': {
    exit: 'mr',
    pre: (c) => { const cl = c.map((x) => x.c); return { mid: sma(cl, 20), sd: stdev(cl, 20), adx: adx(c, 14), atr: atr(c, 14), rsi2: rsi(cl, 2) }; },
    sig: (i, x, c) => { const p = c[i].c; if (x.mid[i] == null || x.sd[i] == null || x.adx[i] == null || x.adx[i] > 25) return 0; if (p < x.mid[i] - 2 * x.sd[i]) return 1; if (p > x.mid[i] + 2 * x.sd[i]) return -1; return 0; },
  },
  'Regime switch: breakout|MR by ADX (both)': {
    exit: 'hybrid',
    pre: (c) => { const cl = c.map((x) => x.c); return { don: donchian(c, 20), adx: adx(c, 14), rsi2: rsi(cl, 2), atr: atr(c, 14) }; },
    sig: (i, x, c) => {
      const p = c[i].c; if (x.adx[i] == null) return 0;
      if (x.adx[i] >= 25) { if (x.don.hi[i] != null && p > x.don.hi[i]) return 1; if (x.don.lo[i] != null && p < x.don.lo[i]) return -1; return 0; }
      if (x.adx[i] < 20) { if (x.rsi2[i] < 10) return 1; if (x.rsi2[i] > 90) return -1; }
      return 0;
    },
  },
};

function simulate(candles, strat) {
  const x = strat.pre(candles);
  const trades = [];
  let pos = null;
  for (let i = 60; i < candles.length; i++) {
    const price = candles[i].c, a = x.atr[i] || price * 0.01;
    if (pos) {
      const long = pos.dir > 0;
      pos.peak = long ? Math.max(pos.peak, candles[i].h) : Math.min(pos.peak, candles[i].l);
      let exit = null;
      // hard stop always
      if (long ? price <= pos.stop : price >= pos.stop) exit = price;
      else if (pos.style === 'trail') {
        const trail = long ? pos.peak - 3 * a : pos.peak + 3 * a;
        if (long ? price <= trail : price >= trail) exit = price;
        else if (i - pos.oi >= 80) exit = price;
      } else { // mr: revert to mean (rsi2 back through 50) or short time cap
        const r2 = x.rsi2 ? x.rsi2[i] : null;
        const reverted = r2 != null && (long ? r2 > 50 : r2 < 50);
        if (reverted || i - pos.oi >= 8) exit = price;
      }
      if (exit != null) { trades.push({ r: ((exit - pos.entry) / pos.risk) * pos.dir, dir: pos.dir }); pos = null; }
    }
    if (!pos) {
      const d = strat.sig(i, x, candles);
      if (d !== 0) {
        const risk = Math.max(a * (strat.exit === 'mr' ? 2.5 : 3), price * 0.004);
        pos = { dir: d, entry: price, risk, stop: d > 0 ? price - risk : price + risk, oi: i, peak: d > 0 ? candles[i].h : candles[i].l, style: strat.exit === 'hybrid' ? (x.adx[i] >= 25 ? 'trail' : 'mr') : strat.exit };
      }
    }
  }
  return trades;
}

function agg(trades) {
  const R = trades.map((t) => t.r);
  const wins = R.filter((r) => r > 0), losses = R.filter((r) => r < 0);
  const gw = wins.reduce((a, r) => a + r, 0), gl = Math.abs(losses.reduce((a, r) => a + r, 0));
  const shorts = trades.filter((t) => t.dir < 0), sWins = shorts.filter((t) => t.r > 0);
  return {
    n: R.length, win: R.length ? Math.round(wins.length / R.length * 100) : 0,
    pf: gl ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0),
    avgR: R.length ? +(R.reduce((a, r) => a + r, 0) / R.length).toFixed(3) : 0,
    shortN: shorts.length, shortWin: shorts.length ? Math.round(sWins.length / shorts.length * 100) : 0,
    shortAvgR: shorts.length ? +(shorts.reduce((a, t) => a + t.r, 0) / shorts.length).toFixed(3) : 0,
  };
}

// ---- run ----
const DATA = {};
for (const [group, syms] of Object.entries(GROUPS)) {
  DATA[group] = {};
  for (const [name, yahoo] of Object.entries(syms)) {
    try { const { candles } = await fetchDailyCandles({ yahoo, country: 'US' }, { DATA_PROVIDER: 'yahoo' }); if (candles && candles.length > 300) DATA[group][name] = candles; }
    catch (e) { /* skip */ }
  }
}

console.log('\nBOTH-WAYS by asset class — aggregated R across all symbols in the class.');
console.log('PASS = pf≥1.3 & avgR>0.05 & n≥30; the shortAvgR column is the honest short-side test.\n');
for (const [group, syms] of Object.entries(DATA)) {
  console.log(`=== ${group} (${Object.keys(syms).length} symbols) ===`);
  for (const [sName, strat] of Object.entries(STRATS)) {
    let all = [];
    for (const candles of Object.values(syms)) all = all.concat(simulate(candles, strat));
    const r = agg(all);
    const pass = r.pf >= 1.3 && r.avgR > 0.05 && r.n >= 30 ? 'PASS' : (r.avgR > 0 ? 'weak' : 'FAIL');
    console.log(`  ${sName.padEnd(38)} pf ${String(r.pf).padStart(5)} win ${String(r.win).padStart(3)}% avgR ${String(r.avgR).padStart(6)} n=${String(r.n).padStart(4)} | short: n=${String(r.shortN).padStart(3)} avgR ${String(r.shortAvgR).padStart(6)} → ${pass}`);
  }
  console.log('');
}
