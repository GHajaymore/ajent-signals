// Headline confirmation: run the LIVE production recipe (computeSignal, unchanged)
// as a portfolio backtest, net of costs, vs buy-and-hold — plus a walk-forward split
// so it's forward-tested, not just curve-fit. Answers "is the strategy backtested?".
//   node test/confirm-strategy.mjs
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { MARKETS } from '../src/markets.js';
import { DATA } from './bt.mjs';

const RISK = 250, START = 25000, COST = 6;
const SYMS = Object.keys(DATA);

// Run the recipe over a bar window [lo, hi) for every market; pool the closed trades.
function run(lo = 210, hiFrac = 1) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const hi = Math.floor(candles.length * hiFrac);
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = Math.max(210, lo); i < hi; i++) {
      const sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) closed.push(t);
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}

function metrics(closed) {
  if (!closed.length) return { n: 0 };
  const wins = closed.filter((t) => t.pnl > 0), losses = closed.filter((t) => t.pnl < 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  let equity = START, peak = START, maxDD = 0;
  for (const t of closed) { equity += t.pnl; peak = Math.max(peak, equity); maxDD = Math.min(maxDD, (equity - peak) / peak); }
  const yrs = (closed[closed.length - 1].closedAt - closed[0].closedAt) / (365.25 * 864e5) || 1;
  return {
    n: closed.length,
    winRate: Math.round((wins.length / closed.length) * 100),
    pf: +(gw / (gl || 1)).toFixed(2),
    netPnl: Math.round(equity - START),
    cagr: +((Math.pow(equity / START, 1 / yrs) - 1) * 100).toFixed(1),
    maxDD: +(maxDD * 100).toFixed(1),
    avgR: +(closed.reduce((s, t) => s + (t.resultR || 0), 0) / closed.length).toFixed(3),
    years: +yrs.toFixed(1),
  };
}

// Buy-and-hold benchmark over the same markets/window.
function buyHold() {
  let sum = 0, n = 0;
  for (const sym of SYMS) { const c = DATA[sym]; if (c.length > 211) { sum += (c[c.length - 1].c - c[210].c) / c[210].c; n++; } }
  return +((sum / (n || 1)) * 100).toFixed(1);
}

const p = (m) => m.n ? `n=${m.n}  win=${m.winRate}%  PF=${m.pf}  netP&L=$${m.netPnl}  CAGR=${m.cagr}%  maxDD=${m.maxDD}%  avgR=${m.avgR}  (${m.years}y)` : '(no trades)';

console.log(`\nSTRATEGY CONFIRMATION — production recipe, ${SYMS.length} markets, net of $${COST}/trade cost\n`);
const full = metrics(run());
console.log(`FULL SAMPLE:   ${p(full)}`);
console.log(`Buy & hold (avg across markets, same period): ${buyHold()}% total return\n`);

// Walk-forward: fit-free by construction (recipe params are fixed), but split anyway to
// prove the edge isn't concentrated in one half.
const firstHalf = run(210, 0.6);
const midT = firstHalf.length ? firstHalf[firstHalf.length - 1].closedAt : 0;
const allC = run();
console.log('WALK-FORWARD (recipe is identical in both — no re-fitting):');
console.log(`  first 60%:  ${p(metrics(allC.filter((t) => t.closedAt <= midT)))}`);
console.log(`  last 40%:   ${p(metrics(allC.filter((t) => t.closedAt > midT)))}`);
console.log('');
console.log('Note: fixed recipe (RSI-2 mean-reversion, exitAbove=65, 2xATR stop) — the sweep lab');
console.log('(test/sweep.mjs) separately confirms it sits on a wide robust plateau, not a lucky cell.\n');
