// Both-ways research: does adding/loosening the SHORT side make more money than
// the long-biased dip-buyer? Honest portfolio backtest, net of cost.
//   node test/bothways.mjs
import { DATA } from './bt.mjs';
import { sma, rsi, atr } from '../src/indicators.js';

const RISK = 250, COST = 6, YEAR = 365.25 * 24 * 3600 * 1000, START = 25000;

// Long = buy oversold dip; Short = sell overbought pop. Trend gates optional.
// Also a momentum-short option: short a genuine downtrend breakdown (trend-follow).
function simulate(candles, p) {
  const cl = candles.map((c) => c.c);
  const s200 = sma(cl, 200), rsi2 = rsi(cl, 2), atr14 = atr(candles, 14);
  const trades = []; let pos = null;
  for (let i = 205; i < candles.length; i++) {
    const price = cl[i], c = candles[i], up = price > s200[i], down = price < s200[i];
    if (pos) {
      let exit = null;
      const short = pos.dir < 0;
      if (short ? price >= pos.stop : price <= pos.stop) exit = 'stop';
      else if (i > pos.openIdx) {
        if (short && rsi2[i] < 35) exit = 'revert';
        else if (!short && rsi2[i] > 65) exit = 'revert';
      }
      if (!exit && i - pos.openIdx >= 7) exit = 'time';
      if (exit) {
        const r = (short ? (pos.entry - price) : (price - pos.entry)) / pos.risk;
        trades.push({ dir: pos.dir, r, pnl: Math.round(r * RISK - COST), openedAt: c.t, closedAt: c.t, o: candles[pos.openIdx].t });
        pos = null;
      }
    }
    if (!pos && s200[i] != null && rsi2[i] != null) {
      const a = atr14[i] || price * 0.01, risk = Math.max(a * 2, price * 0.004);
      const flush = price < candles[i - 1].l, pop = price > candles[i - 1].h;
      // LONG: oversold dip
      if (rsi2[i] < 15 && flush && (!p.longGate || up)) pos = { dir: 1, entry: price, stop: price - risk, risk, openIdx: i };
      // SHORT (mean-reversion): overbought pop
      else if (p.shortMR && rsi2[i] > 85 && pop && (!p.shortGate || down)) pos = { dir: -1, entry: price, stop: price + risk, risk, openIdx: i };
      // SHORT (momentum / trend break): downtrend + new low + falling RSI (trend-follow)
      else if (p.shortMomentum && down && price < Math.min(...cl.slice(i - 10, i)) && rsi2[i] < 30) pos = { dir: -1, entry: price, stop: price + risk, risk, openIdx: i };
    }
  }
  return trades;
}

function evaluate(p, syms = Object.keys(DATA)) {
  const all = [];
  for (const sym of syms) { const c = DATA[sym]; if (c) for (const t of simulate(c, p)) all.push(t); }
  all.sort((a, b) => a.closedAt - b.closedAt);
  let eq = START, peak = START, maxDD = 0, gw = 0, gl = 0, tMin = Infinity, tMax = -Infinity;
  const wins = all.filter((t) => t.pnl > 0).length, losses = all.filter((t) => t.pnl < 0).length;
  const shorts = all.filter((t) => t.dir < 0), sWins = shorts.filter((t) => t.pnl > 0).length;
  for (const t of all) { eq += t.pnl; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, (eq - peak) / peak); if (t.pnl > 0) gw += t.pnl; else gl += Math.abs(t.pnl); tMin = Math.min(tMin, t.o); tMax = Math.max(tMax, t.closedAt); }
  const years = (tMax - tMin) / YEAR || 1;
  return {
    trades: all.length, win: Math.round((wins / ((wins + losses) || 1)) * 100),
    pnl: Math.round(eq - START), cagr: +((Math.pow(eq / START, 1 / years) - 1) * 100).toFixed(1),
    dd: +(maxDD * 100).toFixed(1), pf: +(gw / (gl || 1)).toFixed(2),
    shorts: shorts.length, shortWin: shorts.length ? Math.round(sWins / shorts.length * 100) : 0,
    shortPnl: Math.round(shorts.reduce((s, t) => s + t.pnl, 0)),
  };
}

const EQ = Object.keys(DATA).filter((s) => s !== 'BTC' && s !== 'ETH');
const variants = {
  'CURRENT: long(up) + short-MR(down)': { longGate: true, shortMR: true, shortGate: true },
  'long-only (dips)':                    { longGate: true },
  'SYMMETRIC MR: dips + pops, no gate':  { longGate: false, shortMR: true, shortGate: false },
  'long + short-MR any regime':          { longGate: true, shortMR: true, shortGate: false },
  'long + MOMENTUM short (trend-follow)': { longGate: true, shortMR: true, shortGate: true, shortMomentum: true },
};
const row = (name, r) => console.log(name.padEnd(38), 'tr', String(r.trades).padStart(4), '| win', String(r.win).padStart(3) + '%', '| P&L', String(r.pnl).padStart(7), '| CAGR', String(r.cagr).padStart(5) + '%', '| DD', String(r.dd).padStart(5) + '%', '| PF', String(r.pf).padStart(5), '| shorts', String(r.shorts).padStart(3), '@', String(r.shortWin).padStart(3) + '% =$' + r.shortPnl);
console.log('=== EQUITY INDICES (validated universe) ===');
for (const [n, p] of Object.entries(variants)) row(n, evaluate(p, EQ));
console.log('\n=== ALL 10 (incl crypto) ===');
for (const [n, p] of Object.entries(variants)) row(n, evaluate(p));
