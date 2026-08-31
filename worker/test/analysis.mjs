// Honest performance analysis: the daily strategy vs the alternatives (buy-and-
// hold, risk-free), NET of a $6 round-turn cost, as a PORTFOLIO — all markets on
// ONE $25,000 account risking 1% ($250) per trade.  node test/analysis.mjs
import { MARKETS } from '../src/markets.js';
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';

function memStore() {
  const m = new Map(); const k = (pk, sk) => `${pk}|${sk}`;
  return { put: async (i) => m.set(k(i.pk, i.sk), i), get: async (pk, sk) => m.get(k(pk, sk)) || null, del: async (pk, sk) => m.delete(k(pk, sk)), all: (pk) => [...m.values()].filter((v) => v.pk === pk) };
}
const START = 25000, RISK = 250, COST = 6, RF = 4.5;   // account, risk/trade, round-turn cost, risk-free %/yr
const YEAR = 365.25 * 24 * 3600 * 1000;                 // Yahoo timestamps are ms
const cagr = (mult, years) => years > 0 ? (Math.pow(mult, 1 / years) * 100 - 100) : 0;
const pct = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;

const SYMS = ['ES', 'NQ', 'RTY', 'XJO', 'SX5E', 'N225', 'TSX'];
const allTrades = [];
let tMin = Infinity, tMax = -Infinity, bhSum = 0, nMkt = 0, wins = 0;
for (const sym of SYMS) {
  const { candles } = await fetchDailyCandles(MARKETS[sym], { DATA_PROVIDER: 'yahoo' });
  const store = memStore();
  for (let i = 210; i < candles.length; i++) {
    const sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
    await processPosition({ symbol: sym, meta: MARKETS[sym], sig, live: candles[i].c, open: true, store, now: candles[i].t, risk: RISK, cost: COST });
  }
  const ts = store.all('TRADE');
  allTrades.push(...ts);
  wins += ts.filter((t) => t.pnl > 0).length;
  tMin = Math.min(tMin, candles[210].t); tMax = Math.max(tMax, candles[candles.length - 1].t);
  const bh = candles[candles.length - 1].c / candles[210].c;
  bhSum += cagr(bh, (candles[candles.length - 1].t - candles[210].t) / YEAR); nMkt++;
}
allTrades.sort((a, b) => a.closedAt - b.closedAt);
const years = (tMax - tMin) / YEAR;
let eq = START, peak = START, maxDD = 0;
for (const t of allTrades) { eq += t.pnl; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, (eq - peak) / peak); }
const net = eq - START;
const stratCagr = cagr(eq / START, years);
const bhCagr = bhSum / nMkt;   // equal-weight index buy&hold
const mar = maxDD < 0 ? stratCagr / (Math.abs(maxDD) * 100) : Infinity;

console.log(`\nPORTFOLIO — 7 index markets on ONE $${START.toLocaleString()} account · 1% risk/trade · net of $${COST}/round-turn · ${years.toFixed(1)} yrs\n`);
console.log(`  trades            ${allTrades.length}  (win ${Math.round(wins / allTrades.length * 100)}%, ${(allTrades.length / years).toFixed(0)}/yr)`);
console.log(`  net P&L           ${pct(net / START * 100)} total  (${net >= 0 ? '+' : ''}$${net.toLocaleString()})`);
console.log(`  ANNUALISED return ${pct(stratCagr)}/yr`);
console.log(`  max drawdown      ${pct(maxDD * 100)}`);
console.log(`  MAR (ret/DD)      ${mar.toFixed(2)}`);
console.log(`  ----`);
console.log(`  vs buy & hold     ${pct(bhCagr)}/yr   (${stratCagr > bhCagr ? 'strategy WINS' : 'strategy TRAILS'})`);
console.log(`  vs risk-free      ${pct(RF)}/yr   (${stratCagr > RF ? 'strategy WINS' : 'strategy TRAILS'})`);
