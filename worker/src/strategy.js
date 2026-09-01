// Daily Connors mean reversion (ESM). LONG side is the decade-validated "Proven"
// edge. SHORT side (added 2026-08-30) is PROVISIONAL — the mirror logic, NOT yet
// backtest-validated; the live record is the judge. Keep in sync with the client.
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
  const up = price > s200, down = price < s200;

  let setup = 0, conviction = 'normal', side = 0;
  // LONG (validated): oversold flush below the prior day's low in an uptrend.
  // Entry RSI2<15 (a standard Connors threshold — backtests +32% more CAGR than
  // <10 when paired with the RSI2 exit below, on the equity universe, 2yr).
  if (up && rsi2 < 15 && price < c[n - 2].l) {
    const deep = rsi2 < 5, stretched = price < lowerBB;
    setup = deep && stretched ? 1 : deep ? 0.9 : 0.8;
    conviction = deep && stretched ? 'high' : 'normal';
    side = 1;
  } else if (down && rsi2 > 85 && price > c[n - 2].h) {
    // SHORT (PROVISIONAL): overbought pop above the prior day's high in a
    // downtrend — the mirror of the long. Not backtest-validated.
    const deep = rsi2 > 95, stretched = price > upperBB;
    setup = deep && stretched ? 1 : deep ? 0.9 : 0.8;
    conviction = deep && stretched ? 'high' : 'normal';
    side = -1;
  }
  const confidence = setup > 0 ? Math.round(52 + setup * 47) : 42;
  const fires = setup > 0 && confidence >= 75;
  const verdict = fires ? (side > 0 ? 'BUY' : 'SELL') : 'NO_TRADE';
  // How close this market is to a setup (0-100), for the "watching" view when
  // there's no trade. Long side: RSI2 falling toward <10 in an uptrend (maps
  // RSI2 30→0 … 5→100). Short side: RSI2 rising toward >90 in a downtrend
  // (70→0 … 95→100). 0 when the trend doesn't even allow a setup, 100 once one
  // fires — so the app can rank what's brewing instead of showing a flat number.
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const proximity = fires ? 100
    : up ? Math.round(clamp01((30 - rsi2) / 25) * 100)
    : down ? Math.round(clamp01((rsi2 - 70) / 25) * 100)
    : 0;
  const risk = Math.max(atrN * 2.0, price * 0.004);
  const plan = fires ? {
    entry: price,
    stop: side > 0 ? price - risk : price + risk,
    target1: side > 0 ? price + risk : price - risk,
    risk, riskReward: 1,
    exitRule: side > 0 ? 'firstUpClose' : 'firstDownClose',
    maxHoldMin: 5 * 24 * 60, conviction,
  } : null;

  return {
    verdict, direction: fires ? side : 0, confidence, proximity,
    rsi2: Math.round(rsi2), pctB: +pctB.toFixed(2), htfTrend: up ? 'up' : (down ? 'down' : 'flat'),
    conviction, timeframe: '1D', price, provisional: verdict === 'SELL',
    plan,
    lastDaily: n >= 2 ? { t: c[n - 1].t, up: closes[n - 1] > closes[n - 2] } : null,
  };
}
