// Second engine in the Ajent Pulse ensemble: TREND-FOLLOW (validated in the lab —
// test/trend.mjs — as a robust, orthogonal edge). It fires on continuation, the
// opposite condition to the mean-reversion dip-buyer, so the two diversify and
// fire on different days. Long-only. Its exit rides the trend (a break of the
// follow-MA), NOT the mean-reversion recovery.
import { sma, atr } from './indicators.js';

export const TREND = {
  key: 'trend',
  trendSma: 200,     // only in an uptrend
  followSma: 50,     // ride while above this rising MA (robust plateau: 50-100)
  stopAtrMult: 3,    // wider stop — trends breathe
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
  if (!fires) return { verdict: 'NO_TRADE', trendMA: s50, price };
  const risk = Math.max(atrN * TREND.stopAtrMult, price * 0.004);
  return {
    verdict: 'BUY', direction: 1, price, conviction: 'normal', trendMA: s50,
    plan: { entry: price, stop: price - risk, target1: price + risk, risk, maxHoldMin: TREND.maxHoldMin },
  };
}

// Trend exit: stop, or a break back below the (current) follow-MA, or the time stop.
export function trendShouldExit(sig, pos, price, now) {
  if (price <= pos.stop) return 'stop';
  if (sig && sig.trendMA != null && price < sig.trendMA) return 'trendBreak';
  if (now - pos.openedAt > pos.maxHoldMin * 60000) return 'timeStop';
  return null;
}
