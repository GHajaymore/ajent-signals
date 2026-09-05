// EXPERIMENTAL intraday day-trading engine (15-minute bars, flat by the close — no
// overnight risk). BOTH-WAYS as of 2026-09-04: intraday there is no structural
// up-drift, so a down day is a genuine SHORT setup (unlike the long-only daily equity
// engine). Validated through the promotion gate (test/promote-day.mjs): the no-trend-
// gate symmetric mean-reversion variant cleared all 5 gates — pooled pf 1.39, walk-
// forward 3/3, out-of-sample on RTY (+0.069, the long-only loser), robust plateau,
// and a positive short side (+0.06). Still an EXPERIMENT: only ~60 days of 15m history
// exist, so it ships on its OWN separate record (RECORD_DAY), clearly unproven — the
// live forward result is the judge, never this short backtest.
import { sma, rsi, atr } from './indicators.js';

// Intraday dials. `recipe` is bumped when the rule changes so the experiment's record
// is reset rather than mixing results from two different strategies (see the day
// scheduler). Symmetric MR: buy a deep RSI-2 oversold, short a deep overbought, exit
// when RSI reverts through the mid, capped by a vol stop / time / flat-by-close.
export const DAYTRADE = {
  key: 'day',
  recipe: 2,             // bump on any rule change → the day record resets
  bothWays: true,        // long AND short (validated intraday, no drift)
  indicatorPeriod: 2,    // RSI-2, same oscillator as the daily engine
  entryBelow: 10,        // long when RSI2 < 10; short when RSI2 > 90 (100 - 10)
  exitMid: 50,           // book profit when RSI2 reverts through the mid
  stopAtrMult: 1.5,      // tighter stop — intraday moves are smaller, exit by close
  maxHoldBars: 26,       // hard time cap (~one cash session) before flat-by-close
  proven: false,         // NEVER true until the live record proves it out-of-sample
  experiment: true,
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Compute the intraday BOTH-WAYS signal from 15-min candles (oldest → newest). `params`
// overrides the dials for the lab sweep, so the robustness test runs the EXACT
// production logic at different settings rather than a re-implementation.
export function computeDaySignal(candles, live, params) {
  const P = params ? { ...DAYTRADE, ...params } : DAYTRADE;
  const c = candles.slice();
  if (live != null && c.length) c[c.length - 1] = { ...c[c.length - 1], c: live };
  const closes = c.map((x) => x.c);
  const n = closes.length;
  if (n < 40) return { verdict: 'NO_TRADE', confidence: 0, reason: 'insufficient history' };

  const price = closes[n - 1];
  const rsi2 = rsi(closes, P.indicatorPeriod)[n - 1];
  const atrN = atr(c, 14)[n - 1];
  const s30 = sma(closes, 30)[n - 1]; // context for the "trend" label only — NOT a gate
  if (rsi2 == null || atrN == null || !(atrN > 0)) return { verdict: 'NO_TRADE', confidence: 0, reason: 'indicators not ready' };

  const upper = 100 - P.entryBelow;
  let dir = 0;
  if (rsi2 < P.entryBelow) dir = 1;
  else if (rsi2 > upper) dir = -1;
  const trendUp = s30 != null && price > s30;

  if (dir === 0) {
    const prox = rsi2 <= 50 ? clamp01((50 - rsi2) / (50 - P.entryBelow)) : clamp01((rsi2 - 50) / (upper - 50));
    return { verdict: 'NO_TRADE', direction: 0, confidence: 40, proximity: Math.round(prox * 100), rsiMR: Math.round(rsi2), htfTrend: trendUp ? 'up' : 'down', conviction: 'normal', timeframe: '15m', price, plan: null, experiment: true };
  }

  const depth = dir > 0 ? (P.entryBelow - rsi2) / P.entryBelow : (rsi2 - upper) / P.entryBelow;
  const confidence = Math.round(72 + 18 * clamp01(depth + 0.2));
  const risk = Math.max(atrN * P.stopAtrMult, price * 0.0025);
  const plan = {
    entry: price, stop: dir > 0 ? price - risk : price + risk, target1: dir > 0 ? price + risk : price - risk,
    risk, riskReward: 1, exitRule: 'rsiMid', maxHoldBars: P.maxHoldBars, conviction: 'normal', intraday: true,
  };
  return {
    verdict: dir > 0 ? 'BUY' : 'SELL', direction: dir, confidence, conviction: 'normal',
    // A short is a bearish setup, so the trend label follows the trade side.
    htfTrend: dir > 0 ? 'up' : 'down', rsiMR: Math.round(rsi2), timeframe: '15m', price, plan, experiment: true,
  };
}

// Intraday exit (both directions): the volatility stop, the RSI-reverts-through-mid
// profit exit, the bar time cap, or — the defining rule — a forced flat before the
// session closes (`endOfSession`). No position is ever carried overnight.
export function dayShouldExit(sig, pos, price, now, { endOfSession = false, barsHeld = null } = {}) {
  const short = pos.side === 'SHORT';
  if (short ? price >= pos.stop : price <= pos.stop) return 'stop';
  const r = sig && sig.rsiMR != null ? sig.rsiMR : null;
  if (r != null && (short ? r < 50 : r > 50)) return 'rsiRecover';
  if (barsHeld != null && pos.maxHoldBars && barsHeld >= pos.maxHoldBars) return 'timeStop';
  if (endOfSession) return 'flatByClose';
  return null;
}
