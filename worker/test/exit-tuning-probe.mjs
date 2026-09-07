// EXIT TUNING (with the validated entry filter in place) — entries are now filtered to
// support + the ADX regime (pf →4.96); higher-quality entries may have more follow-through,
// so the RSI-recovery exit (book at RSI2>65) might no longer be optimal. Sweep the exit
// threshold WITH the combined filter applied, robustness-gated (plateau + walk-forward), to
// see if holding winners longer helps — or if the current exit is already right.
//   node test/exit-tuning-probe.mjs
//
// VERDICT (2026-09-07): the current exit (RSI2>65) is ALREADY OPTIMAL — no change. Even with
// the improved filtered entries, the exit-threshold plateau is a smooth ridge that PEAKS
// exactly at RSI2>65 (FULL pf 4.96 / avgR .383 / win 81%, OOS pf 4.44) and degrades
// monotonically on both sides: holding winners longer (>70/75/80) steadily lowers pf and
// deepens maxDD, because MR winners revert past the mean and waiting gives the gains back.
// The edge improvement lives in the ENTRY filters; the exit was right all along. A clean
// confirmation, not a change — the robustness discipline says leave the proven recipe alone.
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { STRATEGY } from '../src/meta.js';
import { atr, adx } from '../src/indicators.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const SYMS = Object.keys(DATA);
const IND = {};
for (const sym of SYMS) IND[sym] = { atr: atr(DATA[sym], 14), adx: adx(DATA[sym], 14).adx };

function nearLevel(c, i, atrVal, kAtr = 0.5, lookback = 60, L = 3) {
  if (!(atrVal > 0)) return false;
  const price = c[i].c; let best = Infinity;
  for (let j = i - L; j >= Math.max(L, i - lookback); j--) {
    let lowP = true, highP = true;
    for (let k = j - L; k <= j + L; k++) { if (k === j || !c[k]) continue; if (c[k].l < c[j].l) lowP = false; if (c[k].h > c[j].h) highP = false; }
    if (lowP) best = Math.min(best, Math.abs(price - c[j].l));
    if (highP) best = Math.min(best, Math.abs(price - c[j].h));
  }
  return best !== Infinity && best <= kAtr * atrVal;
}
// Combined validated entry gate: near a support/resistance level AND out of the ADX 15–20 dead zone.
const keep = (s, i) => nearLevel(DATA[s], i, IND[s].atr[i], 0.5) && (() => { const a = IND[s].adx[i]; return a != null && !(a >= 15 && a < 20); })();

function run(exitRsi) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      if (sig.verdict === 'BUY' && !keep(sym, i)) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST, exitRsi });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}
function st(t) {
  if (!t.length) return { n: 0, winRate: 0, pf: 0, avgR: 0, pnl: 0, hold: 0, maxDD: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  let eq = 0, pk = 0, dd = 0; for (const x of t) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  const hold = t.reduce((s, x) => s + Math.max(1, (x.closedAt - x.openedAt) / 86400000), 0) / t.length;
  return { n: t.length, winRate: Math.round((w.length / t.length) * 100), pf: +(gw / (gl || 1)).toFixed(2), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)), hold: +hold.toFixed(1), maxDD: Math.round(dd) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.winRate).padStart(3)}% avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${String(s.pnl).padStart(6)} hold=${s.hold}d maxDD=$${String(s.maxDD).padStart(6)}` : '(none)';

console.log(`\nEXIT TUNING with the combined entry filter — ${SYMS.length} markets. Current live exit = RSI2>${STRATEGY.exitAbove}\n`);
const base = run(STRATEGY.exitAbove);
const tMin = Math.min(...base.map((t) => t.closedAt)), tMax = Math.max(...base.map((t) => t.closedAt)), mid = tMin + (tMax - tMin) * 0.6;
const EXITS = [60, 65, 70, 75, 80, 85];
console.log('EXIT-THRESHOLD PLATEAU (full + OOS):');
for (const ex of EXITS) {
  const c = run(ex), full = st(c), test = st(c.filter((t) => t.closedAt >= mid));
  console.log(`  RSI2>${ex}${ex === STRATEGY.exitAbove ? '*' : ' '}  FULL ${fmt(full)}`);
  console.log(`  ${''.padEnd(7)}  OOS  ${fmt(test)}`);
}
console.log('\nREAD: a shifted optimum only counts if it lifts pf AND avgR on a smooth plateau AND');
console.log('holds OOS. If the ridge peaks at the current RSI2>65 (or gains are erratic), the exit is');
console.log('already right — leave the proven recipe alone.\n');
