// PROBE: how much execution cost can the edge absorb before it breaks? The paper
// record assumes $6/round-turn; a real retail user faces wider spread + slippage,
// especially on small accounts. Sweep the per-trade cost and find the break-even —
// the honest margin of safety between the modeled edge and real-world friction.
//   node test/cost-sensitivity.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { DATA } from './bt.mjs';

const RISK = 250, START = 25000;
const SYMS = Object.keys(DATA);
const COSTS = [0, 6, 10, 15, 20, 25, 30, 40, 50]; // $/round-turn per trade

function run(cost) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      const sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost });
    }
    for (const t of record.closed) closed.push(t);
  }
  const wins = closed.filter((t) => t.pnl > 0), losses = closed.filter((t) => t.pnl < 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  return {
    n: closed.length,
    winRate: Math.round((wins.length / closed.length) * 100),
    pf: +(gw / (gl || 1)).toFixed(2),
    netPnl: Math.round(closed.reduce((s, t) => s + t.pnl, 0)),
    expPerTrade: +(closed.reduce((s, t) => s + t.pnl, 0) / closed.length).toFixed(1),
  };
}

console.log(`\nCOST / SLIPPAGE SENSITIVITY — ${SYMS.length} markets, $${RISK} risk/trade, $${START} account`);
console.log(`(each $1 of extra cost ≈ 0.004R; the edge's gross avg-R is ~0.28)\n`);
console.log('  cost/trade   n    win%   PF     net P&L     exp/trade');
let breakEven = null;
for (const c of COSTS) {
  const r = run(c);
  const flag = c === 6 ? '  <- app model' : '';
  console.log(`   $${String(c).padStart(2)}        ${String(r.n).padStart(3)}   ${String(r.winRate).padStart(3)}%  ${String(r.pf).padStart(5)}  $${String(r.netPnl).padStart(6)}    $${String(r.expPerTrade).padStart(6)}${flag}`);
  if (breakEven === null && r.expPerTrade <= 0) breakEven = c;
}

// Find the approximate break-even cost precisely (linear between grid points).
function expAt(c) { return run(c).expPerTrade; }
let lo = 0, hi = 200;
while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (expAt(mid) > 0) lo = mid; else hi = mid; }
console.log(`\n  Break-even cost ≈ $${lo}/trade — above this the net edge turns negative.`);
console.log(`  App models $6. Margin of safety: the edge absorbs ~${(lo / 6).toFixed(0)}x the modeled cost before dying.`);
console.log('\nVERDICT:');
if (lo >= 30) console.log(`  Robust — even at a punishing $${lo}/trade (${(lo/RISK*100).toFixed(1)}% of risked capital) the edge holds.\n  Real retail friction (a few $ to ~$15) leaves the edge clearly intact.`);
else if (lo >= 15) console.log(`  Adequate — holds through realistic retail friction (~$10-15) but not extreme costs. Small accounts should mind spreads.`);
else console.log(`  THIN — the edge dies at modest real-world cost ($${lo}). Costs must be tightly controlled; flag this honestly to users.`);
console.log('');
