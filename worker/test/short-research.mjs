// PROBE: can ANY short strategy be validated on indices / crypto? Beyond the naive
// mean-reversion mirror (which lost), test: MR-short with a trailing stop (cap the big
// bear-rally losses), an overbought-threshold sweep, and — the real hypothesis — a
// TREND-FOLLOWING short (ride established downtrends, the mirror of the long trend engine).
// Self-contained simulator (one position at a time), 60/40 OOS split.
//   node test/short-research.mjs
import { sma, rsi, atr } from '../src/indicators.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const INDICES = ['ES', 'NQ', 'YM', 'RTY', 'XJO', 'SX5E', 'N225', 'TSX'].filter((s) => DATA[s]);
const CRYPTO = ['BTC', 'ETH'].filter((s) => DATA[s]);

// Precompute indicators once per market.
const IND = {};
for (const sym of [...INDICES, ...CRYPTO]) {
  const c = DATA[sym], closes = c.map((x) => x.c);
  IND[sym] = { closes, highs: c.map((x) => x.h), lows: c.map((x) => x.l), t: c.map((x) => x.t),
    rsi2: rsi(closes, 2), s200: sma(closes, 200), s50: sma(closes, 50), atr: atr(c, 14) };
}

// Generic short simulator. entry(i)->{risk} or null; exit(pos,i)->reason or null.
function simShort(sym, entryFn, exitFn) {
  const d = IND[sym], n = d.closes.length, closed = [];
  let pos = null;
  for (let i = 210; i < n; i++) {
    const price = d.closes[i];
    if (pos) {
      pos.trough = Math.min(pos.trough, price);
      const reason = exitFn(pos, i);
      if (reason) {
        // Close at the CURRENT daily close (what production does) — not the stop level.
        // On daily bars a stop can't be assumed to fill exactly; the close is the honest
        // fill, and for a short being run over it captures the gap-through loss.
        const exit = price;
        const resultR = (pos.entry - exit) / pos.risk;           // SHORT P&L
        const pnl = Math.round(resultR * RISK - COST);
        closed.push({ resultR, pnl, closedAt: d.t[i] });
        pos = null;
      }
    }
    if (!pos) { const e = entryFn(i); if (e) pos = { entry: price, trough: price, openedAt: d.t[i], openIdx: i, ...e }; }
  }
  return closed;
}

function stats(trades) {
  if (!trades.length) return { n: 0, winRate: 0, pf: 0, pnl: 0, avgR: 0 };
  const w = trades.filter((t) => t.pnl > 0), l = trades.filter((t) => t.pnl < 0);
  const gw = w.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(l.reduce((s, t) => s + t.pnl, 0));
  return { n: trades.length, winRate: Math.round((w.length / trades.length) * 100), pf: +(gw / (gl || 1)).toFixed(2), pnl: Math.round(trades.reduce((s, t) => s + t.pnl, 0)), avgR: +(trades.reduce((s, t) => s + t.resultR, 0) / trades.length).toFixed(3) };
}
function run(syms, entryFor, exitFor) {
  const all = syms.flatMap((s) => simShort(s, entryFor(s), exitFor(s)));
  all.sort((a, b) => a.closedAt - b.closedAt);
  if (!all.length) return { full: stats(all), oos: stats(all) };
  let tMin = Infinity, tMax = -Infinity; for (const t of all) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
  const mid = tMin + (tMax - tMin) * 0.6;
  return { full: stats(all), oos: stats(all.filter((t) => t.closedAt >= mid)) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.winRate).padStart(3)}% pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(7)} $${String(s.pnl).padStart(6)}` : '(no trades)';

// --- Short strategies -------------------------------------------------------
// 1) MR mirror: overbought RSI2>ob in a downtrend, above prior high. Cover on RSI2<coverBelow
//    or a fixed stopMult×ATR stop.
function mrShort(ob, stopMult, coverBelow, trail = 0) {
  return {
    entry: (sym) => (i) => {
      const d = IND[sym]; const price = d.closes[i], s200 = d.s200[i], r = d.rsi2[i], a = d.atr[i];
      if (s200 == null || r == null || !(a > 0)) return null;
      if (price < s200 && r > ob && price > d.highs[i - 1]) { const risk = Math.max(a * stopMult, price * 0.004); return { risk, stop: price + risk, stopHit: price + risk }; }
      return null;
    },
    exit: (sym) => (pos, i) => {
      const d = IND[sym]; const price = d.closes[i], r = d.rsi2[i], a = d.atr[i];
      // trailing (ratchet the stop DOWN as price falls); else fixed stop.
      const trailLvl = trail && a > 0 ? pos.trough + trail * a : Infinity;
      const stopLvl = Math.min(pos.stop, trailLvl); pos.stopHit = stopLvl;
      if (price >= stopLvl) return trailLvl < pos.stop ? 'trailStop' : 'stop';
      if (r != null && r < coverBelow) return 'cover';
      if (d.t[i] - pos.openedAt > 5 * 24 * 60 * 60000) return 'timeStop';
      return null;
    },
  };
}
// 2) Trend-follow SHORT: price<200SMA & <50SMA & 50SMA falling; ride with a ratcheting
//    trailAtr×ATR trailing stop from the trough (mirror of the long trend engine).
function trendShort(trailAtr = 3, initAtr = 3) {
  return {
    entry: (sym) => (i) => {
      const d = IND[sym]; const price = d.closes[i], s200 = d.s200[i], s50 = d.s50[i], s50p = d.s50[i - 5], a = d.atr[i];
      if (s200 == null || s50 == null || s50p == null || !(a > 0)) return null;
      if (price < s200 && price < s50 && s50 < s50p) { const risk = Math.max(a * initAtr, price * 0.004); return { risk, stop: price + risk, stopHit: price + risk }; }
      return null;
    },
    exit: (sym) => (pos, i) => {
      const d = IND[sym]; const price = d.closes[i], a = d.atr[i];
      const trailLvl = a > 0 ? pos.trough + trailAtr * a : pos.stop;
      const stopLvl = Math.min(pos.stop, trailLvl); pos.stopHit = stopLvl;
      if (price >= stopLvl) return trailLvl < pos.stop ? 'trailStop' : 'stop';
      if (d.t[i] - pos.openedAt > 60 * 24 * 60 * 60000) return 'timeStop';
      return null;
    },
  };
}

function report(label, syms) {
  console.log(`\n=== ${label}: ${syms.join(', ')} ===`);
  const cases = [
    ['MR mirror (ob85, stop2, cover35)', mrShort(85, 2, 35)],
    ['MR + trailing 2xATR (ob85)', mrShort(85, 2, 35, 2)],
    ['MR ob90 stop2', mrShort(90, 2, 35)],
    ['MR ob80 stop2', mrShort(80, 2, 35)],
    ['MR ob85 stop1.5', mrShort(85, 1.5, 35)],
    ['TREND-short (trail3, init3)', trendShort(3, 3)],
    ['TREND-short (trail2, init2)', trendShort(2, 2)],
  ];
  for (const [name, strat] of cases) {
    const r = run(syms, strat.entry, strat.exit);
    console.log(`  ${name.padEnd(30)} full ${fmt(r.full)}`);
    console.log(`  ${''.padEnd(30)}  OOS ${fmt(r.oos)}`);
  }
}

console.log('\nSHORT RESEARCH — can any short be validated on indices / crypto?');
report('INDICES', INDICES);
report('CRYPTO', CRYPTO);
console.log('\nSHIP TEST: net-positive AND PF>1.3 AND holds OOS. Otherwise the side stays long-only.\n');
