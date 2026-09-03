// Second engine in the Ajent Pulse ensemble: TREND-FOLLOW (validated in the lab —
// test/trend.mjs — as a robust, orthogonal edge). It fires on continuation, the
// opposite condition to the mean-reversion dip-buyer, so the two diversify and
// fire on different days. Long-only. Its exit rides the trend (a break of the
// follow-MA), NOT the mean-reversion recovery.
import { sma, atr } from './indicators.js';

export const TREND = {
  key: 'trend',
  trendSma: 200,     // only in an uptrend
  followSma: 50,     // fire while above this rising MA (robust plateau: 50-100)
  stopAtrMult: 3,    // initial stop — trends breathe
  trailAtrMult: 3,   // ratcheting trailing stop from the peak (lab: 3-4× is a robust
                     // plateau, MAR 6.26 vs the 50SMA-break exit's 5.16 — test/trend.mjs)
  maxHoldMin: 60 * 24 * 60, // long time stop (weeks); trends can run
};

export function computeTrend(candles, live) {
  const c = candles.slice();
  if (live != null && c.length) c[c.length - 1] = { ...c[c.length - 1], c: live };
  const closes = c.map((x) => x.c);
  const n = closes.length;
  if (n < TREND.trendSma + 10) return { verdict: 'NO_TRADE' };
  const price = closes[n - 1];
  const s200 = sma(closes, TREND.trendSma)[n - 1];
  const s50arr = sma(closes, TREND.followSma);
  const s50 = s50arr[n - 1], s50prev = s50arr[n - 6];
  const atrN = atr(c, 14)[n - 1];
  if (s200 == null || s50 == null || s50prev == null || atrN == null || !(atrN > 0)) return { verdict: 'NO_TRADE', trendMA: s50 };
  const up = price > s200;
  const rising = s50 > s50prev;
  const fires = up && price > s50 && rising;
  // `atr` rides along even on NO_TRADE so an OPEN trend position can trail its stop
  // against the CURRENT ATR each tick, not the entry-time value.
  if (!fires) return { verdict: 'NO_TRADE', trendMA: s50, price, atr: atrN };
  const risk = Math.max(atrN * TREND.stopAtrMult, price * 0.004);
  return {
    verdict: 'BUY', direction: 1, price, conviction: 'normal', trendMA: s50, atr: atrN,
    plan: { entry: price, stop: price - risk, target1: price + risk, risk, maxHoldMin: TREND.maxHoldMin, trail: true },
  };
}

// Trend exit: a RATCHETING trailing stop — exit when price falls trailAtrMult×ATR
// below the highest price seen since entry (never looser than the initial stop) — or
// the time stop. Lab-validated (test/trend.mjs): the trail beats the old 50SMA-break
// exit on a robust 3-4× plateau (MAR 6.26 / PF 3.15 / 56% win vs 5.16 / 2.74 / 39%).
// `pos.peak` is maintained by the caller (processPosition); `sig.atr` is the live ATR.
export function trendShouldExit(sig, pos, price, now) {
  const atrN = sig && sig.atr;
  const peak = pos.peak != null ? pos.peak : pos.entry;
  const trailLevel = (atrN && atrN > 0) ? peak - TREND.trailAtrMult * atrN : -Infinity;
  const stopLevel = Math.max(pos.stop, trailLevel);
  if (price <= stopLevel) return trailLevel > pos.stop ? 'trailStop' : 'stop';
  if (now - pos.openedAt > pos.maxHoldMin * 60000) return 'timeStop';
  return null;
}
