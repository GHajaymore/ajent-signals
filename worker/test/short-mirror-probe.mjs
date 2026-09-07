// PROBE: does the MIRROR short (overbought pop in a downtrend, the exact mirror of the
// long oversold-dip entry) actually work on INDICES and CRYPTO? These run long-only in
// production; this tests enabling the short side. Faithful to src/strategy.js (same RSI2
// thresholds, 200SMA trend gate, 2xATR stop, RSI-recovery exit) — just with shorts on and
// a per-direction filter. 60/40 out-of-sample split so a fitted-only result is exposed.
//   node test/short-mirror-probe.mjs
import { sma, rsi, atr } from '../src/indicators.js';
import { STRATEGY } from '../src/meta.js';
import { processPosition } from '../src/scheduler.js';
import { MARKETS } from '../src/markets.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const P = STRATEGY;
const INDICES = ['ES', 'NQ', 'YM', 'RTY', 'XJO', 'SX5E', 'N225', 'TSX'].filter((s) => DATA[s]);
const CRYPTO = ['BTC', 'ETH'].filter((s) => DATA[s]);

// Faithful mirror of computeSignal, with `dir` = which side(s) may fire: 'long'|'short'|'both'.
function computeSig(candles, dir) {
  const c = candles;
  const closes = c.map((x) => x.c);
  const n = closes.length;
  if (n < P.trendSma + 10) return { verdict: 'NO_TRADE' };
  const price = closes[n - 1];
  const s200 = sma(closes, P.trendSma)[n - 1];
  const rsi2 = rsi(closes, P.indicatorPeriod)[n - 1];
  const atrN = atr(c, 14)[n - 1];
  if (s200 == null || rsi2 == null || !(atrN > 0)) return { verdict: 'NO_TRADE', rsi2 };
  const up = price > s200, down = price < s200;
  let side = 0, setup = 0;
  if ((dir === 'long' || dir === 'both') && up && rsi2 < P.entryBelow && price < c[n - 2].l) {
    setup = 0.8; side = 1;
  } else if ((dir === 'short' || dir === 'both') && down && rsi2 > (100 - P.entryBelow) && price > c[n - 2].h) {
    setup = 0.8; side = -1;
  }
  const confidence = setup > 0 ? Math.round(52 + setup * 47) : 42;
  const fires = setup > 0 && confidence >= 75;
  const risk = Math.max(atrN * P.stopAtrMult, price * 0.004);
  return {
    verdict: fires ? (side > 0 ? 'BUY' : 'SELL') : 'NO_TRADE',
    rsi2: Math.round(rsi2), price, conviction: 'normal',
    plan: fires ? { entry: price, stop: side > 0 ? price - risk : price + risk, target1: side > 0 ? price + risk : price - risk, risk, riskReward: 1, exitRule: 'rsiRecover', exitAbove: P.exitAbove, maxHoldMin: 5 * 24 * 60, conviction: 'normal' } : null,
  };
}

function runDir(syms, dir) {
  const closed = [];
  for (const sym of syms) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      const sig = computeSig(candles.slice(0, i + 1), dir);
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) closed.push(t);
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}

function stats(trades) {
  if (!trades.length) return { n: 0, winRate: 0, pf: 0, pnl: 0, avgR: 0 };
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  return { n: trades.length, winRate: Math.round((wins.length / trades.length) * 100), pf: +(gw / (gl || 1)).toFixed(2), pnl: Math.round(trades.reduce((s, t) => s + t.pnl, 0)), avgR: +(trades.reduce((s, t) => s + (t.resultR || 0), 0) / trades.length).toFixed(3) };
}

// Shared OOS midpoint from the long book so train/test windows line up.
function splitPoint(syms) {
  const l = runDir(syms, 'both');
  if (!l.length) return 0;
  let tMin = Infinity, tMax = -Infinity;
  for (const t of l) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
  return tMin + (tMax - tMin) * 0.6;
}

function report(label, syms) {
  const mid = splitPoint(syms);
  console.log(`\n=== ${label} (${syms.join(', ')}) ===`);
  const line = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.winRate).padStart(3)}% pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(7)} $${String(s.pnl).padStart(6)}` : '(no trades)';
  for (const dir of ['long', 'short']) {
    const all = runDir(syms, dir);
    console.log(`  ${dir.toUpperCase().padEnd(6)} full: ${line(stats(all))}`);
    console.log(`  ${''.padEnd(6)}  OOS: ${line(stats(all.filter((t) => t.closedAt >= mid)))}`);
  }
}

console.log('\nMIRROR-SHORT PROBE — is shorting overbought pops validated on indices / crypto?');
report('INDICES', INDICES);
report('CRYPTO', CRYPTO);

console.log('\nVERDICT: a side earns "ship it" only if it is net-positive AND holds OOS. The long');
console.log('side is the benchmark; compare the SHORT rows against it above.\n');
