// Does a FAST (scalp-ish) crypto strategy have any edge AFTER realistic costs? Scalping's
// whole problem is that moves are tiny but per-trade cost (fee + spread) is not — so the
// honest test is net-of-cost expectancy, not gross. Tests fast mean-reversion and fast
// momentum on 5-minute BTC/ETH bars (~60 days), both directions, at two cost levels.
// If nothing clears cost, scalping stays disabled (data-backed), per the honest-numbers rule.
//   node test/crypto-scalp.mjs
//
// VERDICT (2026-09-05): NO EDGE — scalping stays disabled. On 5m BTC/ETH (~60d), the gross
// per-trade move is ~0.5 bps (MR) to NEGATIVE (momentum), while the CHEAPEST round-turn cost
// is 10 bps — cost is ~20-40x any edge. Net expectancy is deeply negative at every cost level
// (avgNet -9 to -22 bps; total hundreds of % of losses over ~10-22k trades/yr). 5m is coarser
// than true tick-scalping, but finer bars only add noise + more trades + more cost, so this
// generalizes: fast crypto strategies are a fee-loss. Even with the real-time Binance stream
// (data resolution solved), there is no edge to trade — enabling a "scalp" style would ship a
// money-loser, which the honest-numbers rule forbids. Re-run only if a genuinely cheaper
// execution path (real maker rebates) AND a validated fast signal appear.
import { fetchIntradayCandles } from '../src/data.js';
import { rsi, sma } from '../src/indicators.js';

const SYMS = { BTC: 'BTC-USD', ETH: 'ETH-USD' };
// Round-turn cost as a FRACTION of price. Binance taker ~0.10%/side = 0.20% round-turn;
// a maker/BNB-discount path ~0.05%/side = 0.10%. Both are optimistic (ignore slippage).
const COSTS = { 'taker 0.20%': 0.0020, 'maker 0.10%': 0.0010 };

// Fast mean-reversion: enter on an RSI2 extreme, exit when RSI2 reverts through 50 or after
// maxHold bars. Both ways. Returns per-trade signed % moves (gross, before cost).
function mrTrades(candles, { lower = 10, maxHold = 12 } = {}) {
  const cl = candles.map((c) => c.c);
  const R = rsi(cl, 2);
  const upper = 100 - lower;
  const out = []; let pos = null;
  for (let i = 5; i < cl.length; i++) {
    const r = R[i]; if (r == null) continue;
    if (pos) {
      const revert = pos.dir > 0 ? r >= 50 : r <= 50;
      if (revert || (i - pos.i) >= maxHold) { out.push({ pct: pos.dir * (cl[i] - pos.entry) / pos.entry }); pos = null; }
    }
    if (!pos) {
      if (r < lower) pos = { dir: 1, entry: cl[i], i };
      else if (r > upper) pos = { dir: -1, entry: cl[i], i };
    }
  }
  return out;
}

// Fast momentum: break the last N-bar high → long; break the N-bar low → short. Exit on a
// reverse break or after maxHold bars.
function momTrades(candles, { look = 12, maxHold = 24 } = {}) {
  const cl = candles.map((c) => c.c), hi = candles.map((c) => c.h), lo = candles.map((c) => c.l);
  const out = []; let pos = null;
  for (let i = look; i < cl.length; i++) {
    const hh = Math.max(...hi.slice(i - look, i)), ll = Math.min(...lo.slice(i - look, i));
    if (pos) {
      const rev = pos.dir > 0 ? cl[i] < ll : cl[i] > hh;
      if (rev || (i - pos.i) >= maxHold) { out.push({ pct: pos.dir * (cl[i] - pos.entry) / pos.entry }); pos = null; }
    }
    if (!pos) {
      if (cl[i] > hh) pos = { dir: 1, entry: cl[i], i };
      else if (cl[i] < ll) pos = { dir: -1, entry: cl[i], i };
    }
  }
  return out;
}

function stats(trades, cost) {
  const n = trades.length; if (!n) return { n: 0 };
  const net = trades.map((t) => t.pct - cost); // subtract round-turn cost from each trade
  const wins = net.filter((x) => x > 0).length;
  const gains = net.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const losses = Math.abs(net.filter((x) => x <= 0).reduce((s, x) => s + x, 0));
  const avgGross = trades.reduce((s, t) => s + t.pct, 0) / n;
  const avgNet = net.reduce((s, x) => s + x, 0) / n;
  return { n, win: Math.round(100 * wins / n), pf: losses ? gains / losses : Infinity, avgGrossBps: avgGross * 1e4, avgNetBps: avgNet * 1e4, totalNetPct: net.reduce((s, x) => s + x, 0) * 100 };
}

const series = {};
for (const [sym, y] of Object.entries(SYMS)) {
  try { const { candles } = await fetchIntradayCandles({ yahoo: y, country: 'US' }, { DATA_PROVIDER: 'yahoo' }, { interval: '5m', range: '60d' }); if (candles && candles.length > 500) series[sym] = candles; }
  catch (e) { console.log('skip', sym, e.message); }
}
const days = Math.max(...Object.values(series).map((c) => c.length ? (c[c.length - 1].t - c[0].t) / 86400000 : 0));
console.log(`\nCrypto fast-strategy edge test — 5m bars, ${Object.keys(series).length} coins, ~${days.toFixed(0)} days\n`);
console.log('avgGrossBps/avgNetBps = average per-trade move in basis points (1 bp = 0.01%), before/after cost.\n');

const STRATS = {
  'MR rsi2 <10': (c) => mrTrades(c, { lower: 10 }),
  'MR rsi2 <5':  (c) => mrTrades(c, { lower: 5 }),
  'Momentum 12-bar break': (c) => momTrades(c, { look: 12 }),
};
for (const [name, fn] of Object.entries(STRATS)) {
  const all = []; for (const c of Object.values(series)) all.push(...fn(c));
  const gross = stats(all, 0);
  console.log(`${name}`);
  console.log(`  gross: n=${gross.n} win=${gross.win}% avgMove=${gross.avgGrossBps.toFixed(1)}bps`);
  for (const [cl, cost] of Object.entries(COSTS)) {
    const s = stats(all, cost);
    const verdict = s.avgNetBps > 0 && s.pf >= 1.1 ? '✅ edge' : '❌ no edge after cost';
    console.log(`  net @ ${cl.padEnd(12)}: avgNet=${s.avgNetBps.toFixed(1)}bps · win ${s.win}% · pf ${s.pf === Infinity ? '∞' : s.pf.toFixed(2)} · total ${s.totalNetPct.toFixed(0)}% over ${(all.length / (days / 365)).toFixed(0)}/yr → ${verdict}`);
  }
  console.log('');
}
