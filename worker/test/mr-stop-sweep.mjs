// PROBE: the MR hard stop (stopAtrMult, live = 2x ATR) has never been formally swept.
// It interacts with the RSI-recovery exit: a WIDER stop lets more dips survive to the
// bounce (fewer stop-outs) but shrinks each winner's R and enlarges the tail loss; a
// TIGHTER stop cuts losers faster but shakes out dips before they revert. Swept on the
// CURRENT recipe (post-%B-adoption: indices dip-buy only fires when %B<0.30), $ risk fixed
// so the compare is fair. Gated on IS/OOS + per-market.   node test/mr-stop-sweep.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6, PB_ADOPT_MAX = 0.30;
const MULTS = [1.25, 1.5, 1.75, 2, 2.5, 3, 3.5]; // 2 = current live stopAtrMult
const SYMS = Object.keys(DATA);

function run(stopAtrMult) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeSignal(candles.slice(0, i + 1), candles[i].c, { stopAtrMult });
      // Replicate the LIVE adopted %B gate: equity (non-crypto) dip-buy only fires when %B<0.30.
      if (!meta.crypto && sig.verdict === 'BUY' && sig.strat === 'mr' && typeof sig.pctB === 'number' && sig.pctB >= PB_ADOPT_MAX) {
        sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      }
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  closed.sort((a, b) => a.closedAt - b.closedAt);
  return closed;
}
function stats(t) {
  if (!t.length) return { n: 0 };
  const w = t.filter((x) => x.pnl > 0), l = t.filter((x) => x.pnl < 0);
  const gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(l.reduce((s, x) => s + x.pnl, 0));
  let eq = 0, pk = 0, dd = 0; for (const x of t) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, win: Math.round(100 * w.length / t.length), exp: +(t.reduce((s, x) => s + x.pnl, 0) / t.length).toFixed(1),
    avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pf: +(gw / (gl || 1)).toFixed(2), maxDD: Math.round(dd) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} exp=$${String(s.exp).padStart(6)} pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(6)} win=${String(s.win).padStart(3)}% DD=$${String(s.maxDD).padStart(6)}` : '(none)';

let tMin = Infinity, tMax = -Infinity;
const b = run(2);
for (const t of b) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6;

console.log(`\nMR STOP SWEEP — ${SYMS.length} markets, current stopAtrMult=2, post-%B recipe. 60/40 split.\n`);
const rows = {};
for (const m of MULTS) { const c = run(m); rows[m] = { full: stats(c), is: stats(c.filter((t) => t.closedAt < mid)), oos: stats(c.filter((t) => t.closedAt >= mid)) }; }
for (const win of ['full', 'is', 'oos']) {
  console.log(`${win === 'full' ? 'FULL SAMPLE' : win === 'is' ? 'IN-SAMPLE (train 60%)' : 'OUT-OF-SAMPLE (test 40%)'}:`);
  for (const m of MULTS) console.log(`  stop ${String(m).padStart(4)}x${m === 2 ? '*' : ' '} ${fmt(rows[m][win])}`);
  console.log('');
}
const base = rows[2];
const cands = MULTS.filter((m) => m !== 2 && rows[m].oos.n >= 10 && rows[m].oos.exp > base.oos.exp && rows[m].is.exp > base.is.exp);
console.log('VERDICT (must beat stop=2x on OOS AND IS expectancy):');
if (!cands.length) console.log('  None. stopAtrMult=2 is the robust choice — keep it.');
else cands.forEach((m) => console.log(`  CANDIDATE stop=${m}x: OOS $${rows[m].oos.exp} vs $${base.oos.exp}; IS $${rows[m].is.exp} vs $${base.is.exp}; full pf ${rows[m].full.pf} vs ${base.full.pf}, DD $${rows[m].full.maxDD} vs $${base.full.maxDD}`));
console.log('');
