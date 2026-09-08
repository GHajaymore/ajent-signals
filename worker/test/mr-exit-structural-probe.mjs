// PROBE: the mr-exit-sweep only varied the RSI-recovery THRESHOLD. This tests whether a
// structurally different MR exit beats the pure "wait for RSI>65 or hit stop" rule. The
// live exit never uses target1 or the tracked peak — so once a dip runs to +1R then fades
// before RSI recovers, all the open profit is given back. Variants add a take-profit, a
// breakeven-after-green stop, a peak trail, and a give-back stop. Same entry (computeSignal),
// same RSI/stop/time baseline underneath; gated on IS/OOS + per-market. Long side only
// (the proven equity/crypto MR edge is long-only); shorts fall through to the baseline exit.
//   node test/mr-exit-structural-probe.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition, mrShouldExit } from '../src/scheduler.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6, EXIT_RSI = 65;
const SYMS = Object.keys(DATA);

// Each variant wraps the live baseline (stop / rsiRecover65 / timeStop) and adds one
// structural rule for LONG positions. Returns an exit-reason string or null (hold).
const base = (s, p, pr, nw) => mrShouldExit(s, p, pr, nw, EXIT_RSI);
const curR = (p, pr) => (p.side === 'SHORT' ? (p.entry - pr) : (pr - p.entry)) / (p.risk || 1e-9);
const peakR = (p) => (p.side === 'SHORT' ? 0 : (p.peak - p.entry) / (p.risk || 1e-9)); // long only

// MR winners book at ~0.5R avg (RSI recovers fast), so structural rules must engage at
// SUB-1R levels or they never trigger. Thresholds chosen around the real winner distribution.
const VARIANTS = {
  'baseline (live)': base,
  'target +0.5R': (s, p, pr, nw) => (p.side !== 'SHORT' && curR(p, pr) >= 0.5 ? 'target' : base(s, p, pr, nw)),
  'target +0.75R': (s, p, pr, nw) => (p.side !== 'SHORT' && curR(p, pr) >= 0.75 ? 'target' : base(s, p, pr, nw)),
  'target +1R': (s, p, pr, nw) => (p.side !== 'SHORT' && pr >= p.target1 ? 'target' : base(s, p, pr, nw)),
  'breakeven after +0.5R': (s, p, pr, nw) => {
    if (p.side !== 'SHORT' && peakR(p) >= 0.5 && pr <= p.entry) return 'breakeven';
    return base(s, p, pr, nw);
  },
  'trail 0.5R (after +0.5R peak)': (s, p, pr, nw) => {
    if (p.side !== 'SHORT' && peakR(p) >= 0.5 && pr <= p.peak - 0.5 * p.risk) return 'trail';
    return base(s, p, pr, nw);
  },
  'trail 0.5R (after +0.75R peak)': (s, p, pr, nw) => {
    if (p.side !== 'SHORT' && peakR(p) >= 0.75 && pr <= p.peak - 0.5 * p.risk) return 'trail';
    return base(s, p, pr, nw);
  },
  'giveback 40% (after +0.75R)': (s, p, pr, nw) => {
    if (p.side !== 'SHORT' && peakR(p) >= 0.75 && curR(p, pr) <= peakR(p) * 0.6) return 'giveback';
    return base(s, p, pr, nw);
  },
};

function run(shouldExit) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      const sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST, shouldExit });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  closed.sort((a, b) => a.closedAt - b.closedAt);
  return closed;
}
function stats(t) {
  if (!t.length) return { n: 0, exp: 0, pf: 0, avgR: 0, win: 0 };
  const w = t.filter((x) => x.pnl > 0), l = t.filter((x) => x.pnl < 0);
  const gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(l.reduce((s, x) => s + x.pnl, 0));
  return { n: t.length, win: Math.round(100 * w.length / t.length), exp: +(t.reduce((s, x) => s + x.pnl, 0) / t.length).toFixed(1),
    avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pf: +(gw / (gl || 1)).toFixed(2) };
}

// Shared 60/40 time split (from baseline closes) so every variant is judged on the same windows.
let tMin = Infinity, tMax = -Infinity;
const b0 = run(base);
for (const t of b0) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6;
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} exp=$${String(s.exp).padStart(6)} pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(6)} win=${String(s.win).padStart(3)}%` : '(none)';

console.log(`\nMR STRUCTURAL EXIT PROBE — ${SYMS.length} markets, baseline = live RSI>65 recovery. 60/40 time split.\n`);
const rows = {};
for (const [name, fn] of Object.entries(VARIANTS)) {
  const c = run(fn);
  rows[name] = { full: stats(c), is: stats(c.filter((t) => t.closedAt < mid)), oos: stats(c.filter((t) => t.closedAt >= mid)) };
}
for (const win of ['full', 'is', 'oos']) {
  console.log(`${win === 'full' ? 'FULL SAMPLE' : win === 'is' ? 'IN-SAMPLE (train 60%)' : 'OUT-OF-SAMPLE (test 40%)'}:`);
  for (const name of Object.keys(VARIANTS)) console.log(`  ${name.padEnd(30)} ${fmt(rows[name][win])}`);
  console.log('');
}
// Per-market full-sample PF for the best-looking OOS candidate vs baseline, to check breadth.
const bx = rows['baseline (live)'];
console.log('VERDICT (a variant must beat baseline OOS exp in BOTH windows to be a candidate):');
const cands = Object.keys(VARIANTS).filter((k) => k !== 'baseline (live)'
  && rows[k].oos.n >= 10 && rows[k].oos.exp > bx.oos.exp && rows[k].is.exp > bx.is.exp);
if (!cands.length) console.log('  None. The live RSI-recovery exit holds up structurally — no take-profit/trail/breakeven beats it OOS. Keep it.');
else cands.forEach((k) => console.log(`  CANDIDATE ${k}: OOS exp $${rows[k].oos.exp} vs $${bx.oos.exp}; IS $${rows[k].is.exp} vs $${bx.is.exp} — inspect per-market before adopting.`));
console.log('');
