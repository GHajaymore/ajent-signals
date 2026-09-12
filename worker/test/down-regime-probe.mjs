// PROBE (user q, 2026-09-12): in a DOWN week the MR dip-buyer can catch a falling knife. Two
// questions: (1) does gating dip-buys on the LONG-TERM TREND (price vs its 200-day SMA) avoid the
// bad down-regime entries? (2) would SHORTING the same oversold setups have made money the other
// way? Buckets every adopted-recipe MR trade by the market's regime AT ENTRY and reports the edge,
// plus a mirror-short test. Equity/index board only (crypto runs its own recipe). Post-%B recipe.
//   node test/down-regime-probe.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { mrShouldExit } from '../src/scheduler.js';
import { sma } from '../src/indicators.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6, PB = 0.30;
const SYMS = Object.keys(DATA).filter((s) => !MARKETS[s]?.crypto);

function backtest() {
  const trades = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const closes = candles.map((c) => c.c);
    const sma200 = sma(closes, 200);
    let pos = null, lastCloseDay = null;
    for (let i = 210; i < candles.length; i++) {
      const price = candles[i].c, now = candles[i].t;
      let sig = computeSignal(candles.slice(0, i + 1), price);
      if (sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= PB) sig = { ...sig, verdict: 'NO_TRADE', plan: null };
      if (pos) {
        if (mrShouldExit(sig, pos, price, now, 65)) {
          const r = pos.risk || 1e-9, resultR = (price - pos.entry) / r;
          // Mirror SHORT outcome: a short entered at the same bar exits when the dip reverts up
          // (we approximate the short's R as the negative of the long's price move / same risk).
          trades.push({ sym, resultR, pnl: Math.round(resultR * RISK - COST), shortPnl: Math.round(-resultR * RISK - COST), aboveSma: pos.aboveSma, ret10: pos.ret10, closedAt: now });
          lastCloseDay = new Date(now).toISOString().slice(0, 10); pos = null;
        }
      }
      if (!pos && sig.verdict === 'BUY' && sig.plan) {
        const day = new Date(now).toISOString().slice(0, 10);
        if (day === lastCloseDay) continue;
        const s2 = sma200[i];
        const ret10 = i >= 10 ? (price / candles[i - 10].c - 1) * 100 : 0;
        pos = { entry: price, stop: sig.plan.stop, risk: sig.plan.risk, side: 'LONG', exitAbove: 65, maxHoldMin: sig.plan.maxHoldMin, aboveSma: s2 != null && price >= s2, ret10 };
      }
    }
  }
  return trades;
}
const st = (t, field = 'pnl') => {
  if (!t.length) return { n: 0 };
  const w = t.filter((x) => x[field] > 0), l = t.filter((x) => x[field] < 0);
  const gw = w.reduce((s, x) => s + x[field], 0), gl = Math.abs(l.reduce((s, x) => s + x[field], 0));
  return { n: t.length, win: Math.round(100 * w.length / t.length), exp: +(t.reduce((s, x) => s + x[field], 0) / t.length).toFixed(1), pf: +(gw / (gl || 1)).toFixed(2), net: Math.round(t.reduce((s, x) => s + x[field], 0)) };
};
const all = backtest();
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.win).padStart(3)}% exp=$${String(s.exp).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${s.net}` : '(none)';

console.log(`\nDOWN-REGIME PROBE — ${SYMS.length} equity/index markets, adopted %B recipe.\n`);
console.log('1) MR long edge by LONG-TERM TREND at entry (price vs 200-SMA):');
console.log('   dip in UPTREND  (>=200SMA) ', fmt(st(all.filter((x) => x.aboveSma))));
console.log('   dip in DOWNTREND(<200SMA)  ', fmt(st(all.filter((x) => !x.aboveSma))));
console.log('\n2) MR long edge by 10-day momentum at entry (how hard it was already falling):');
console.log('   mild dip  (10d >= -4%)     ', fmt(st(all.filter((x) => x.ret10 >= -4))));
console.log('   hard drop (10d <  -4%)     ', fmt(st(all.filter((x) => x.ret10 < -4))));
console.log('\n3) Would SHORTING the same oversold setups have made money? (mirror short)');
console.log('   short ALL setups           ', fmt(st(all, 'shortPnl')));
console.log('   short only DOWNTREND setups', fmt(st(all.filter((x) => !x.aboveSma), 'shortPnl')));
console.log('\n   (Long ALL, for reference)  ', fmt(st(all)));
console.log('');
