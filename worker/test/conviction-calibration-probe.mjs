// PROBE: the MR 'high-conviction' tier (rsi2<5 AND price<lower Bollinger band) is auto-traded
// at 1.5x size (scaleByConviction). Does that tier actually carry ~1.5x the edge, or is the app
// over-betting it? Buckets every closed MR trade by its entry conviction and compares avgR /
// expectancy / win / PF, then simulates flat vs 1.5x-high sizing on the portfolio (expectancy AND
// drawdown). Post-%B recipe. Self-contained loop (the closed record doesn't store conviction).
//   node test/conviction-calibration-probe.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { mrShouldExit } from '../src/scheduler.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6, PB_ADOPT_MAX = 0.30, HIGH_MULT = 1.5;
const SYMS = Object.keys(DATA);

// Replicates processPosition's MR path (open on BUY, exit via mrShouldExit) but records the
// entry conviction on each closed trade so we can bucket the edge.
function backtest() {
  const trades = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    let pos = null, lastCloseDay = null;
    for (let i = 210; i < candles.length; i++) {
      const price = candles[i].c, now = candles[i].t;
      let sig = computeSignal(candles.slice(0, i + 1), price);
      // Live adopted %B gate (equity dip-buy only when %B<0.30).
      if (!meta.crypto && sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= PB_ADOPT_MAX) {
        sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      }
      if (pos) {
        const reason = mrShouldExit(sig, pos, price, now, 65);
        if (reason) {
          const r = pos.risk || 1e-9, resultR = (price - pos.entry) / r;
          trades.push({ sym, conviction: pos.conviction, resultR, rAtRisk: RISK, pnl1x: Math.round(resultR * RISK - COST), openedAt: pos.openedAt, closedAt: now });
          lastCloseDay = new Date(now).toISOString().slice(0, 10); pos = null;
        }
      }
      if (!pos && sig.verdict === 'BUY' && sig.plan) {
        const day = new Date(now).toISOString().slice(0, 10);
        if (day === lastCloseDay) continue; // don't re-enter same day (matches tradedToday guard)
        pos = { entry: price, stop: sig.plan.stop, risk: sig.plan.risk, side: 'LONG', conviction: sig.conviction, exitAbove: 65, maxHoldMin: sig.plan.maxHoldMin, openedAt: now };
      }
    }
  }
  return trades.sort((a, b) => a.closedAt - b.closedAt);
}
function stats(t) {
  if (!t.length) return { n: 0 };
  const w = t.filter((x) => x.pnl1x > 0), l = t.filter((x) => x.pnl1x < 0);
  const gw = w.reduce((s, x) => s + x.pnl1x, 0), gl = Math.abs(l.reduce((s, x) => s + x.pnl1x, 0));
  return { n: t.length, win: Math.round(100 * w.length / t.length), exp: +(t.reduce((s, x) => s + x.pnl1x, 0) / t.length).toFixed(1),
    avgR: +(t.reduce((s, x) => s + x.resultR, 0) / t.length).toFixed(3), pf: +(gw / (gl || 1)).toFixed(2) };
}
function portfolio(t, highMult) { // total P&L + maxDD applying highMult to high-conviction trades
  let eq = 0, pk = 0, dd = 0, total = 0;
  for (const x of t) { const m = x.conviction === 'high' ? highMult : 1; const pnl = x.resultR * RISK * m - COST; total += pnl; eq += pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { total: Math.round(total), maxDD: Math.round(dd) };
}

const all = backtest();
const high = all.filter((x) => x.conviction === 'high');
const norm = all.filter((x) => x.conviction !== 'high');
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.win).padStart(3)}% exp=$${String(s.exp).padStart(6)} avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)}` : '(none)';

console.log(`\nCONVICTION CALIBRATION — ${SYMS.length} markets, post-%B recipe. High = rsi2<5 & below lower band.\n`);
console.log('EDGE BY TIER:');
console.log('  high-conviction ', fmt(stats(high)));
console.log('  normal          ', fmt(stats(norm)));
console.log('  ALL             ', fmt(stats(all)));
const hi = stats(high), no = stats(norm);
if (hi.n && no.n) {
  const ratio = (hi.avgR / (no.avgR || 1e-9));
  console.log(`\n  high/normal avgR ratio = ${ratio.toFixed(2)}x  (1.5x sizing is justified iff this is >~1.5 AND high n is meaningful)`);
}
console.log('\nPORTFOLIO SIZING (applying the multiplier to high-conviction trades only):');
for (const m of [1, 1.25, 1.5, 1.75, 2]) { const p = portfolio(all, m); console.log(`  high x${m}   total=$${String(p.total).padStart(6)}  maxDD=$${String(p.maxDD).padStart(6)}  return/DD=${(p.total / -(p.maxDD || 1)).toFixed(2)}`); }
console.log('');
