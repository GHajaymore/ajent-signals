// Parameterized portfolio backtest — measure any signal function against the
// baseline, NET of costs, on ONE $25k account risking 1% per trade.
//   node test/bt.mjs
import { MARKETS } from '../src/markets.js';
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';

const START = 25000, RISK = 250, COST = 6;
const YEAR = 365.25 * 24 * 3600 * 1000;
const SYMS = ['ES', 'NQ', 'YM', 'RTY', 'XJO', 'SX5E', 'N225', 'TSX', 'BTC', 'ETH'];

// Fetch once, reuse across variants (avoids hammering Yahoo).
const DATA = {};
for (const sym of SYMS) {
  try {
    const { candles } = await fetchDailyCandles(MARKETS[sym], { DATA_PROVIDER: 'yahoo' });
    if (candles && candles.length > 220) DATA[sym] = candles;
  } catch (e) { /* skip */ }
}

export async function backtest(signalFn, opts = {}) {
  const syms = opts.syms || Object.keys(DATA);
  const closed = [];
  let tMin = Infinity, tMax = -Infinity, bhSum = 0, nMkt = 0;
  for (const sym of syms) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      const sig = signalFn(candles.slice(0, i + 1), candles[i].c);
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST, exitRsi: opts.exitRsi });
    }
    for (const t of record.closed) { closed.push(t); tMin = Math.min(tMin, t.openedAt); tMax = Math.max(tMax, t.closedAt); }
    const first = candles[210].c, last = candles[candles.length - 1].c;
    bhSum += (last - first) / first; nMkt++;
  }
  closed.sort((a, b) => a.closedAt - b.closedAt);
  let equity = START, peak = START, maxDD = 0, gw = 0, gl = 0, inMarketDays = 0;
  const wins = closed.filter((t) => t.pnl > 0).length, losses = closed.filter((t) => t.pnl < 0).length;
  for (const t of closed) {
    equity += t.pnl; peak = Math.max(peak, equity);
    maxDD = Math.min(maxDD, (equity - peak) / peak);
    if (t.pnl > 0) gw += t.pnl; else gl += Math.abs(t.pnl);
    inMarketDays += Math.max(1, (t.closedAt - t.openedAt) / 86400000);
  }
  const years = (tMax - tMin) / YEAR || 1;
  const cagr = (Math.pow(equity / START, 1 / years) - 1) * 100;
  const bhCagr = (Math.pow(1 + bhSum / (nMkt || 1), 1 / years) - 1) * 100;
  return {
    trades: closed.length, winRate: Math.round((wins / ((wins + losses) || 1)) * 100),
    totalPnl: Math.round(equity - START), cagr: +cagr.toFixed(1), maxDD: +(maxDD * 100).toFixed(1),
    pf: +(gw / (gl || 1)).toFixed(2), mar: maxDD ? +(cagr / Math.abs(maxDD * 100)).toFixed(2) : 0,
    years: +years.toFixed(1), bhCagr: +bhCagr.toFixed(1),
    avgWin: wins ? Math.round(gw / wins) : 0, avgLoss: losses ? Math.round(gl / losses) : 0,
  };
}

export { DATA };
