// TREND engine entry-filter lab: does an ADX(14) MINIMUM improve the trend-follow leg?
// Trend-following whipsaws in low-ADX chop; a min-ADX gate should skip the weak "trends".
// Faithfully replicates computeTrend's entry (price>200SMA && price>50SMA && 50SMA rising)
// and trendShouldExit's ratcheting 3xATR trail, then sweeps an ADX floor under the full
// robustness gate: parameter plateau, IS/OOS split, per-market.  node test/trend-adx-entry-probe.mjs
import { DATA } from './bt.mjs';
import { sma, atr, adx } from '../src/indicators.js';
import { MARKETS } from '../src/markets.js';

const RISK = 250, COST = 6;
const TREND_SMA = 200, FOLLOW_SMA = 50, STOP_ATR = 3, TRAIL_ATR = 3;

const PRE = {};
for (const sym of Object.keys(DATA)) {
  const c = DATA[sym], closes = c.map((x) => x.c);
  PRE[sym] = { c, closes, s200: sma(closes, TREND_SMA), s50: sma(closes, FOLLOW_SMA), atr: atr(c, 14), adx: adx(c, 14).adx };
}

// One market's trend trades over candle index range [lo,hi), with an ADX floor (null=off).
function trades(sym, adxMin, lo, hi) {
  const p = PRE[sym], c = p.c, out = [];
  let pos = null;
  const end = Math.min(hi, c.length);
  for (let i = Math.max(210, lo); i < end; i++) {
    const price = c[i].c, t = c[i].t, a = p.atr[i];
    if (pos) {
      pos.peak = Math.max(pos.peak, price);
      const trail = (a > 0) ? pos.peak - TRAIL_ATR * a : -Infinity;
      const stopLevel = Math.max(pos.stop, trail);
      if (price <= stopLevel) {
        const r = Math.abs(pos.entry - pos.stop) || 1e-9;
        out.push({ pnl: Math.round(((price - pos.entry) / r) * RISK - COST), resultR: (price - pos.entry) / r });
        pos = null;
      }
    }
    if (!pos) {
      const s200 = p.s200[i], s50 = p.s50[i], s50p = p.s50[i - 5], adxN = p.adx[i];
      if (s200 == null || s50 == null || s50p == null || a == null || !(a > 0)) continue;
      const fires = price > s200 && price > s50 && s50 > s50p;
      const adxOk = adxMin == null || (adxN != null && adxN >= adxMin);
      if (fires && adxOk) {
        const risk = Math.max(a * STOP_ATR, price * 0.004);
        pos = { entry: price, stop: price - risk, peak: price };
      }
    }
  }
  return out;
}
const st = (t) => {
  if (!t.length) return { n: 0, pf: 0, avgR: 0, pnl: 0, win: 0 };
  const gw = t.filter((x) => x.pnl > 0).reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  return { n: t.length, pf: +(gw / (gl || 1)).toFixed(2), avgR: +(t.reduce((s, x) => s + x.resultR, 0) / t.length).toFixed(3), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)), win: Math.round(100 * t.filter((x) => x.pnl > 0).length / t.length) };
};
const CRYPTO = new Set(Object.keys(DATA).filter((s) => MARKETS[s] && MARKETS[s].crypto));
const EQ = Object.keys(DATA).filter((s) => !CRYPTO.has(s));
const all = (adxMin, syms, lo, hi) => { const o = []; for (const s of syms) o.push(...trades(s, adxMin, lo, hi)); return o; };
const LEN = (sym) => PRE[sym].c.length;
const maxLen = Math.max(...EQ.map(LEN));
const SPLIT = Math.floor(maxLen * 0.6); // per-market IS/OOS by index (data are aligned-ish; good enough for a plateau read)

console.log('\n=== TREND engine — ADX(14) entry floor, EQUITIES (full sample) ===');
console.log('  baseline (no floor)  ', JSON.stringify(st(all(null, EQ, 0, 1e9))));
for (const m of [12, 15, 18, 20, 22, 25, 30]) console.log(`  ADX>=${String(m).padStart(2)}            `, JSON.stringify(st(all(m, EQ, 0, 1e9))));

console.log('\n=== IS (first 60% of bars) ===');
console.log('  baseline             ', JSON.stringify(st(all(null, EQ, 0, SPLIT))));
for (const m of [15, 18, 20, 25]) console.log(`  ADX>=${String(m).padStart(2)}            `, JSON.stringify(st(all(m, EQ, 0, SPLIT))));
console.log('\n=== OOS (last 40% of bars) ===');
console.log('  baseline             ', JSON.stringify(st(all(null, EQ, SPLIT, 1e9))));
for (const m of [15, 18, 20, 25]) console.log(`  ADX>=${String(m).padStart(2)}            `, JSON.stringify(st(all(m, EQ, SPLIT, 1e9))));

console.log('\n=== per-market (ADX>=20 vs baseline, full sample) ===');
for (const sym of EQ) {
  const b = st(trades(sym, null, 0, 1e9)), g = st(trades(sym, 20, 0, 1e9));
  const mark = g.pf >= b.pf ? '  +' : '  -';
  console.log(`${mark} ${sym.padEnd(6)} base pf ${String(b.pf).padStart(5)} (n${b.n})  ADX20 pf ${String(g.pf).padStart(5)} (n${g.n})`);
}
console.log('\n(crypto trend shown for reference — gate is equities-scoped like %B)');
for (const sym of [...CRYPTO]) { const b = st(trades(sym, null, 0, 1e9)), g = st(trades(sym, 20, 0, 1e9)); console.log(`   ${sym.padEnd(6)} base pf ${String(b.pf).padStart(5)} (n${b.n})  ADX20 pf ${String(g.pf).padStart(5)} (n${g.n})`); }
