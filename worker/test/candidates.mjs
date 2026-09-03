// Candidate-edge lab. Ajent Pulse shouldn't rely on one recipe — so test OTHER
// entry indicators through the SAME robustness backtest (uptrend filter + the
// mean-reversion RSI exit held constant), over ~2y across all markets. Only edges
// that prove individually robust here should ever join the ensemble — we validate
// on backtest, we do NOT chase whatever looked good last week.
//   node test/candidates.mjs
import { backtest, DATA } from './bt.mjs';
import { sma, rsi, atr, stdev } from '../src/indicators.js';

const fmt = (r) => `PF ${String(r.pf).padStart(4)}  CAGR ${String(r.cagr).padStart(5)}%  MAR ${String(r.mar).padStart(5)}  DD ${String(r.maxDD).padStart(5)}%  win ${String(r.winRate).padStart(3)}%  n=${r.trades}`;

// Each candidate is an ENTRY predicate evaluated at the last bar, in an uptrend
// (price > 200SMA). Exit is the shared RSI-2 recovery (fair comparison of entries).
const CANDIDATES = {
  'Ajent Pulse — RSI2<15 + flush':     ({ price, rsi2, c, n }) => rsi2 < 15 && price < c[n - 2].l,
  'RSI2<15 (no flush)':                ({ rsi2 }) => rsi2 < 15,
  'RSI2<10':                           ({ rsi2 }) => rsi2 < 10,
  'RSI2<5 (deep)':                     ({ rsi2 }) => rsi2 < 5,
  'RSI14<30 (classic oversold)':       ({ closes, n }) => { const r = rsi(closes, 14)[n - 1]; return r != null && r < 30; },
  'Bollinger < lower band (2σ)':       ({ price, closes, n }) => { const s = sma(closes, 20)[n - 1], sd = stdev(closes, 20)[n - 1]; return s != null && sd != null && price < s - 2 * sd; },
  'Confluence: RSI2<15 & < lowerBB':   ({ price, rsi2, closes, n }) => { const s = sma(closes, 20)[n - 1], sd = stdev(closes, 20)[n - 1]; return rsi2 < 15 && s != null && sd != null && price < s - 2 * sd; },
  'Deep confluence: +flush & <lowerBB':({ price, rsi2, c, n, closes }) => { const s = sma(closes, 20)[n - 1], sd = stdev(closes, 20)[n - 1]; return rsi2 < 15 && price < c[n - 2].l && s != null && sd != null && price < s - 2 * sd; },
  'RSI2<15 + RSI14<40 (dual RSI)':     ({ rsi2, closes, n }) => { const r = rsi(closes, 14)[n - 1]; return rsi2 < 15 && r != null && r < 40; },
};

function sigFor(entryFn) {
  return (candles, live) => {
    const c = candles;
    const closes = c.map((x) => x.c);
    const n = closes.length;
    if (n < 210) return { verdict: 'NO_TRADE' };
    const price = live ?? closes[n - 1];
    const s200 = sma(closes, 200)[n - 1];
    const rsi2 = rsi(closes, 2)[n - 1];
    const atrN = atr(c, 14)[n - 1];
    if (s200 == null || rsi2 == null || atrN == null || !(atrN > 0)) return { verdict: 'NO_TRADE', rsi2 };
    const up = price > s200;
    const fire = up && entryFn({ price, rsi2, atrN, s200, closes, c, n });
    if (!fire) return { verdict: 'NO_TRADE', rsi2, price };
    const risk = Math.max(atrN * 2, price * 0.004);
    return { verdict: 'BUY', direction: 1, rsi2, price, conviction: 'normal', plan: { entry: price, stop: price - risk, target1: price + risk, risk, maxHoldMin: 5 * 24 * 60 } };
  };
}

console.log(`\nCandidate edges — ${Object.keys(DATA).length} markets, ~${(DATA[Object.keys(DATA)[0]] || []).length} bars, shared RSI-2 exit:\n`);
const rows = [];
for (const [name, fn] of Object.entries(CANDIDATES)) {
  const r = await backtest(sigFor(fn), { exitRsi: 65 });
  rows.push({ name, ...r });
}
rows.sort((a, b) => b.mar - a.mar);
for (const r of rows) console.log(`  ${r.name.padEnd(38)} ${fmt(r)}`);

console.log('\nRead-out: an edge only earns a place in the ensemble if it is robust HERE (PF well above 1, positive MAR, enough trades) AND ideally uncorrelated with RSI-2 — diversification, not the single best backtest number.\n');
