// EXPERIMENTAL third engine: INTRADAY day-trading (15-minute bars, long-only, flat
// by the close — no overnight risk). This is NOT a proven edge. An earlier intraday
// version LOST money live (see the app's own history), so this ships as a clearly-
// labelled EXPERIMENT tracked on its OWN separate paper record — never merged into
// the proven Swing record, never with advertised returns. It stays experimental
// until the lab (test/daytrade.mjs) proves a robust, positive out-of-sample edge.
//
// Shape: the same mean-reversion idea as the proven daily engine, but on 15-min
// bars — buy a deep RSI-2 oversold flush while the intraday trend is still up, exit
// when momentum recovers or the volatility stop is hit, and ALWAYS close before the
// session ends. The flat-by-close rule is what removes overnight gap risk; the
// scheduler enforces it live, the backtester enforces it on the last bar of each day.
import { sma, rsi, atr, stdev } from './indicators.js';

// Intraday dials. Kept separate from the daily STRATEGY so tuning one never touches
// the other. The lab sweeps these; production reads whatever is validated here.
//
// LAB (test/daytrade.mjs, 60-day 15m sample, 2026-09-03): this recipe is MARGINAL,
// NOT proven — pooled PF ~1.4 / 64% win / MAR ~8 on ES+NQ+YM, but only 13/81 sweep
// settings clear PF>=1.3 (no wide plateau), and RTY is a net LOSER intraday (PF 0.69)
// so it is excluded from the traded set (see DAY_MARKETS in the scheduler). The whole
// top-performing cluster sits on trendSma 30, so that is the trend filter here — not
// a single lucky cell. It ships as a labelled EXPERIMENT on its own live record; the
// live paper result, not this short backtest, is the judge before any "proven" claim.
export const DAYTRADE = {
  key: 'day',
  indicatorPeriod: 2,   // RSI-2, same oscillator as the daily engine
  entryBelow: 10,       // deeper oversold than daily (intraday noise is higher)
  exitAbove: 60,        // book profit when momentum recovers
  deepBelow: 3,         // deepest / high-conviction tier
  trendSma: 30,         // intraday trend filter (bars): only buy dips while above it
  stopAtrMult: 1.5,     // tighter stop — intraday moves are smaller, and we exit by close
  maxHoldBars: 26,      // hard time cap in bars (~one cash session) even before flat-by-close
  proven: false,        // NEVER true until the live record proves it out-of-sample
  experiment: true,
};

// Compute the intraday signal from 15-min candles (oldest -> newest). `params`
// overrides the dials for the lab sweep, so the robustness test runs the EXACT
// production logic at different settings rather than a re-implementation.
export function computeDaySignal(candles, live, params) {
  const P = params ? { ...DAYTRADE, ...params } : DAYTRADE;
  const c = candles.slice();
  if (live != null && c.length) c[c.length - 1] = { ...c[c.length - 1], c: live };
  const closes = c.map((x) => x.c);
  const n = closes.length;
  if (n < P.trendSma + 20) return { verdict: 'NO_TRADE', confidence: 0, reason: 'insufficient history' };

  const price = closes[n - 1];
  const sTrend = sma(closes, P.trendSma)[n - 1];
  const rsi2 = rsi(closes, P.indicatorPeriod)[n - 1];
  const atrN = atr(c, 14)[n - 1];
  const s20 = sma(closes, 20)[n - 1];
  const sd = stdev(closes, 20)[n - 1];
  if (sTrend == null || rsi2 == null || atrN == null || !(atrN > 0) || s20 == null || sd == null) {
    return { verdict: 'NO_TRADE', confidence: 0, reason: 'indicators not ready' };
  }
  const lowerBB = s20 - 2 * sd, upperBB = s20 + 2 * sd;
  const pctB = (price - lowerBB) / ((upperBB - lowerBB) || 1);
  const up = price > sTrend;

  // LONG-ONLY. The short mirror is deliberately absent: shorting mean-reversion on
  // equity indices lost money on the daily engine and there is no evidence it works
  // intraday either — it will not be added without lab proof.
  let setup = 0, conviction = 'normal';
  if (up && rsi2 < P.entryBelow && price < c[n - 2].l) {
    const deep = rsi2 < P.deepBelow, stretched = price < lowerBB;
    setup = deep && stretched ? 1 : deep ? 0.9 : 0.8;
    conviction = deep && stretched ? 'high' : 'normal';
  }
  const confidence = setup > 0 ? Math.round(52 + setup * 47) : 40;
  const fires = setup > 0 && confidence >= 75;
  const verdict = fires ? 'BUY' : 'NO_TRADE';
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const proximity = fires ? 100 : up ? Math.round(clamp01((25 - rsi2) / 22) * 100) : 0;
  const risk = Math.max(atrN * P.stopAtrMult, price * 0.0025);
  const plan = fires ? {
    entry: price, stop: price - risk, target1: price + risk, risk, riskReward: 1,
    exitRule: 'rsiRecover', exitAbove: P.exitAbove, maxHoldBars: P.maxHoldBars,
    conviction, intraday: true,
  } : null;

  return {
    verdict, direction: fires ? 1 : 0, confidence, proximity,
    rsi2: Math.round(rsi2), pctB: +pctB.toFixed(2), htfTrend: up ? 'up' : 'down',
    conviction, timeframe: '15m', price, plan, experiment: true,
  };
}

// Intraday exit: the volatility stop, the momentum-recovery exit, the bar time cap,
// or — the defining rule — a forced flat before the session closes (`endOfSession`).
// No position is ever carried overnight, so there is no gap risk to manage.
export function dayShouldExit(sig, pos, price, now, { endOfSession = false, barsHeld = null } = {}) {
  if (price <= pos.stop) return 'stop';
  const exitRsi = pos.exitAbove ?? DAYTRADE.exitAbove;
  if (sig && sig.rsi2 != null && sig.rsi2 > exitRsi) return 'rsiRecover';
  if (barsHeld != null && pos.maxHoldBars && barsHeld >= pos.maxHoldBars) return 'timeStop';
  if (endOfSession) return 'flatByClose';
  return null;
}
