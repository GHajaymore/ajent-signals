// Strategy research — sweep proven RSI-2 mean-reversion variants and measure each
// HONESTLY (net of cost, one portfolio) so we only ship what actually improves.
//   node test/research.mjs
import { DATA } from './bt.mjs';
import { sma, rsi, atr } from '../src/indicators.js';

const RISK = 250, COST = 6, YEAR = 365.25 * 24 * 3600 * 1000, START = 25000;

// Self-contained long-only RSI-2 sim so entry AND exit rules are both tunable.
function simulate(candles, p) {
  const cl = candles.map((c) => c.c);
  const s200 = sma(cl, p.trendSMA), rsi2 = rsi(cl, 2), atr14 = atr(candles, 14), s5 = sma(cl, 5);
  const trades = []; let pos = null;
  for (let i = p.trendSMA + 2; i < candles.length; i++) {
    const price = cl[i], c = candles[i];
    if (pos) {
      // Scale in once on a deeper dip (Connors add-down): each unit tracked by its
      // own entry so P&L is honest; stop moves to the worst unit's stop.
      if (p.scaleAt && pos.units.length < 2 && rsi2[i] < p.scaleAt) {
        const a = atr14[i] || price * 0.01, risk = Math.max(a * p.stopATR, price * 0.004);
        pos.units.push({ entry: price, risk });
        pos.stop = Math.min(...pos.units.map((u) => u.entry - u.risk));
      }
      let exit = null;
      if (price <= pos.stop) exit = 'stop';
      else if (i > pos.openIdx) {
        if (p.exit === 'firstUp' && c.c > candles[i - 1].c) exit = 'firstUp';
        else if (p.exit === 'rsiHigh' && rsi2[i] > p.rsiExit) exit = 'rsiHigh';
        else if (p.exit === 'sma5' && price > s5[i]) exit = 'sma5';
      }
      if (!exit && i - pos.openIdx >= p.maxHold) exit = 'time';
      if (exit) {
        let pnl = 0, rsum = 0;
        for (const u of pos.units) { pnl += ((price - u.entry) / u.risk) * RISK - COST; rsum += (price - u.entry) / u.risk; }
        trades.push({ r: rsum / pos.units.length, pnl: Math.round(pnl), openedAt: candles[pos.openIdx].t, closedAt: c.t });
        pos = null;
      }
    }
    if (!pos && s200[i] != null && rsi2[i] != null) {
      const up = price > s200[i], flush = price < candles[i - 1].l;
      if (up && rsi2[i] < p.rsiEntry && (!p.requireFlush || flush)) {
        const a = atr14[i] || price * 0.01, risk = Math.max(a * p.stopATR, price * 0.004);
        pos = { units: [{ entry: price, risk }], stop: price - risk, openIdx: i };
      }
    }
  }
  return trades;
}

function evaluate(p, syms = Object.keys(DATA)) {
  const all = []; let bhSum = 0, n = 0;
  for (const sym of syms) {
    const candles = DATA[sym]; if (!candles) continue;
    for (const t of simulate(candles, p)) all.push(t);
    const first = candles[210].c, last = candles[candles.length - 1].c;
    bhSum += (last - first) / first; n++;
  }
  all.sort((a, b) => a.closedAt - b.closedAt);
  let eq = START, peak = START, maxDD = 0, gw = 0, gl = 0;
  const wins = all.filter((t) => t.pnl > 0).length, losses = all.filter((t) => t.pnl < 0).length;
  let tMin = Infinity, tMax = -Infinity;
  for (const t of all) {
    eq += t.pnl; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, (eq - peak) / peak);
    if (t.pnl > 0) gw += t.pnl; else gl += Math.abs(t.pnl);
    tMin = Math.min(tMin, t.openedAt); tMax = Math.max(tMax, t.closedAt);
  }
  const years = (tMax - tMin) / YEAR || 1;
  const cagr = (Math.pow(eq / START, 1 / years) - 1) * 100;
  return {
    trades: all.length, win: Math.round((wins / ((wins + losses) || 1)) * 100),
    pnl: Math.round(eq - START), cagr: +cagr.toFixed(1), dd: +(maxDD * 100).toFixed(1),
    pf: +(gw / (gl || 1)).toFixed(2), mar: maxDD ? +(cagr / Math.abs(maxDD * 100)).toFixed(1) : 0,
  };
}

// NEW baseline = what's now shipped: rsi2<15 entry, exit when RSI2>65.
const BASE = { rsiEntry: 15, requireFlush: true, trendSMA: 200, stopATR: 2, exit: 'rsiHigh', rsiExit: 65, maxHold: 7 };
const variants = {
  'SHIPPED (rsi2<15, exit>65)':     BASE,
  '+ scale-in at rsi2<5':           { ...BASE, scaleAt: 5 },
  '+ scale-in at rsi2<8':           { ...BASE, scaleAt: 8 },
  'exit>70 (hold longer)':          { ...BASE, rsiExit: 70 },
  'exit>60 (take sooner)':          { ...BASE, rsiExit: 60 },
  'wider stop 3xATR':               { ...BASE, stopATR: 3 },
  'wider stop 3x + scale<5':        { ...BASE, stopATR: 3, scaleAt: 5 },
  'maxHold 10d':                    { ...BASE, maxHold: 10 },
  'scale<5 + stop3 + exit70 + 10d': { ...BASE, scaleAt: 5, stopATR: 3, rsiExit: 70, maxHold: 10 },
  'entry rsi2<20':                  { ...BASE, rsiEntry: 20 },
  'entry<20 + scale<8 + stop3':     { ...BASE, rsiEntry: 20, scaleAt: 8, stopATR: 3 },
};

const EQ = Object.keys(DATA).filter((s) => s !== 'BTC' && s !== 'ETH');
const row = (name, r) => console.log(name.padEnd(30), String(r.trades).padStart(5), String(r.win).padStart(5), String(r.pnl).padStart(8), String(r.cagr).padStart(7), String(r.dd).padStart(8), String(r.pf).padStart(6), String(r.mar).padStart(6));

console.log('=== ALL 10 MARKETS (incl. crypto) ===');
console.log('variant'.padEnd(30), 'trades  win%   netP&L   CAGR%   maxDD%   PF    MAR');
for (const [name, p] of Object.entries(variants)) row(name, evaluate(p));

console.log('\n=== EQUITY INDICES ONLY (validated universe, no crypto) ===');
console.log('variant'.padEnd(30), 'trades  win%   netP&L   CAGR%   maxDD%   PF    MAR');
for (const [name, p] of Object.entries(variants)) row(name, evaluate(p, EQ));
