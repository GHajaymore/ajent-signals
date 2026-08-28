// Proven daily long-only Connors mean reversion (ESM). Mirrors the client daily
// branch and the AWS backend. Keep in sync.
import { sma, rsi, atr, stdev } from './indicators.js';

export function computeSignal(candles, live) {
  const c = candles.slice();
  if (live != null && c.length) c[c.length - 1] = { ...c[c.length - 1], c: live };
  const closes = c.map((x) => x.c);
  const n = closes.length;
  if (n < 210) return { verdict: 'NO_TRADE', confidence: 0, reason: 'insufficient history' };

  const price = closes[n - 1];
  const s200 = sma(closes, 200)[n - 1];
  const rsi2 = rsi(closes, 2)[n - 1];
  const atrN = atr(c, 14)[n - 1];
  const s20 = sma(closes, 20)[n - 1];
  const sd = stdev(closes, 20)[n - 1];
  if (s200 == null || rsi2 == null || atrN == null || !(atrN > 0) || s20 == null) {
    return { verdict: 'NO_TRADE', confidence: 0, reason: 'indicators not ready' };
  }
  const lowerBB = s20 - 2 * sd, upperBB = s20 + 2 * sd;
  const pctB = (price - lowerBB) / ((upperBB - lowerBB) || 1);
  const up = price > s200;

  let setup = 0, conviction = 'normal';
  if (up && rsi2 < 10 && price < c[n - 2].l) {
    const deep = rsi2 < 5, stretched = price < lowerBB;
    setup = deep && stretched ? 1 : deep ? 0.9 : 0.8;
    conviction = deep && stretched ? 'high' : 'normal';
  }
  const confidence = setup > 0 ? Math.round(52 + setup * 47) : 42;
  const verdict = setup > 0 && confidence >= 75 ? 'BUY' : 'NO_TRADE';
  const risk = Math.max(atrN * 2.0, price * 0.004);

  return {
    verdict, direction: verdict === 'BUY' ? 1 : 0, confidence,
    rsi2: Math.round(rsi2), pctB: +pctB.toFixed(2), htfTrend: up ? 'up' : 'down',
    conviction, timeframe: '1D', price,
    plan: verdict === 'BUY' ? { entry: price, stop: price - risk, target1: price + risk, risk, riskReward: 1, exitRule: 'firstUpClose', maxHoldMin: 5 * 24 * 60, conviction } : null,
    lastDaily: n >= 2 ? { t: c[n - 1].t, up: closes[n - 1] > closes[n - 2] } : null,
  };
}
