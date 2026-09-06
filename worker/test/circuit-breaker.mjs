// PROBE: would a portfolio drawdown circuit breaker IMPROVE the strategy? (Not "hide
// losses" — a real risk-off rule we'd apply to real money.) When pooled equity draws
// down past a threshold, stop opening NEW positions (existing ones still exit) until
// equity recovers to within a resume band of its peak. Honest test: does it beat the
// baseline on risk-adjusted return, or is it dead weight because DD never gets deep?
//   node test/circuit-breaker.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { DATA } from './bt.mjs';

const RISK = 250, START = 25000, COST = 6;
const SYMS = Object.keys(DATA);

// One time-ordered portfolio pass. `breaker` = {dd, resume} in %; null = baseline.
function simulate(breaker) {
  // Build a global, time-sorted event stream across all markets.
  const events = [];
  for (const sym of SYMS) {
    const candles = DATA[sym];
    for (let i = 210; i < candles.length; i++) events.push({ t: candles[i].t, sym, i });
  }
  events.sort((a, b) => a.t - b.t);

  const record = { open: {}, closed: [], lastClose: {} };
  let equity = START, peak = START, maxDD = 0, halted = false;
  let haltedBars = 0, haltEpisodes = 0, blockedEntries = 0;

  for (const ev of events) {
    const candles = DATA[ev.sym], meta = MARKETS[ev.sym];
    const sig = computeSignal(candles.slice(0, ev.i + 1), candles[ev.i].c);
    const before = record.closed.length;
    const hadPos = !!record.open[ev.sym];
    // Circuit breaker gates NEW entries only; existing positions always manage/exit.
    const allowOpen = !halted;
    if (halted && !hadPos) haltedBars++;
    const res = processPosition({ symbol: ev.sym, meta, sig, live: candles[ev.i].c, open: allowOpen, record, now: ev.t, risk: RISK, cost: COST });
    if (halted && !hadPos && (sig.verdict === 'BUY' || sig.verdict === 'SELL') && sig.plan && res === 'none') blockedEntries++;
    // A trade just closed → update the portfolio equity curve + breaker state.
    if (record.closed.length > before) {
      equity += record.closed[0].pnl;
      peak = Math.max(peak, equity);
      const dd = (equity - peak) / peak * 100;
      maxDD = Math.min(maxDD, dd);
      if (breaker) {
        if (!halted && dd <= -breaker.dd) { halted = true; haltEpisodes++; }
        else if (halted && equity >= peak * (1 - breaker.resume / 100)) halted = false;
      }
    }
  }
  const closed = record.closed;
  const wins = closed.filter((t) => t.pnl > 0), losses = closed.filter((t) => t.pnl < 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const yrs = closed.length ? (closed[0].closedAt - closed[closed.length - 1].closedAt) / (365.25 * 864e5) : 1;
  const cagr = (Math.pow(equity / START, 1 / (Math.abs(yrs) || 1)) - 1) * 100;
  return {
    n: closed.length, winRate: Math.round((wins.length / (closed.length || 1)) * 100),
    pf: +(gw / (gl || 1)).toFixed(2), netPnl: Math.round(equity - START),
    maxDD: +maxDD.toFixed(1), cagr: +cagr.toFixed(1),
    mar: maxDD ? +(cagr / Math.abs(maxDD)).toFixed(2) : 0,
    haltEpisodes, blockedEntries,
  };
}

const p = (m) => `n=${String(m.n).padStart(3)} win=${m.winRate}% PF=${String(m.pf).padStart(4)} net=$${String(m.netPnl).padStart(6)} maxDD=${String(m.maxDD).padStart(5)}% MAR=${String(m.mar).padStart(5)} | halts=${m.haltEpisodes} blocked=${m.blockedEntries}`;

console.log(`\nDRAWDOWN CIRCUIT BREAKER — portfolio pass, ${SYMS.length} markets\n`);
const base = simulate(null);
console.log(`  BASELINE (no breaker):        ${p(base)}`);
for (const dd of [4, 5, 6, 8, 10]) {
  const r = simulate({ dd, resume: 1 }); // resume when back within 1% of peak
  console.log(`  breaker @ -${dd}% (resume -1%):  ${p(r)}`);
}

console.log('\nVERDICT:');
console.log(`  Baseline max drawdown is ${base.maxDD}%. A circuit breaker only acts if DD reaches its`);
console.log('  threshold; look above for whether ANY setting improves MAR/PF without cutting net P&L.');
console.log('  If halts=0, the breaker never fires (DD too shallow) → it would change the record by');
console.log('  NOTHING, so it neither helps the strategy nor "protects" a P&L that is already fine.');
console.log('  If a breaker DOES raise MAR, it is a genuine, honest enhancement (a real risk rule),');
console.log('  NOT a way to hide losses — the losses before it triggers stay in the record.\n');
