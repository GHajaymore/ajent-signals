// "Your strategy" — a user-built, multi-indicator strategy, evaluated client-side on
// the same real daily-close history the app already holds (market.history). Users pick
// from a palette of popular indicators and combine them (all conditions must agree),
// long / short / both. It generates the USER's OWN signals so they can compare their
// idea against the proven Ajent Pulse. It is explicitly THEIR experiment — unproven,
// never presented as validated — and it is NOT the Ajent Pulse recipe: the palette is
// generic public indicators, and Ajent's exact recipe stays server-side and untouched.
import { rsi, sma, ema, macd, bollingerBands } from './indicators.js';

const LS = 'ajent_customstrat_v1';

// Palette of close-based indicators (the client history is daily closes, so OHLC-only
// indicators like ADX/Supertrend aren't offered here). Each entry declares its tunable
// params and how it reads bullish/bearish, plus an evaluator returning the directional
// state at the latest bar. `depth` is 0..1 = how strongly the condition is met (drives
// the user-derived confidence — never a fixed number).
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lastVal = (arr) => { if (!arr) return null; for (let i = arr.length - 1; i >= 0; i--) { const v = arr[i]; if (v != null && !Number.isNaN(v)) return v; } return null; };

export const INDICATORS = {
  rsi: {
    label: 'RSI', blurb: 'Momentum oscillator — oversold vs overbought.',
    params: [
      { k: 'period', label: 'Length', min: 2, max: 21, step: 1, def: 14 },
      { k: 'value', label: 'Oversold below', min: 5, max: 45, step: 1, def: 30 },
    ],
    long: (c) => `RSI(${c.period}) below ${c.value}`, short: (c) => `RSI(${c.period}) above ${100 - c.value}`,
    eval(closes, price, c) {
      const v = lastVal(rsi(closes, c.period || 14)); if (v == null) return null;
      const thr = c.value ?? 30, hi = 100 - thr;
      return { bull: v < thr, bear: v > hi, longDepth: v < thr ? clamp01((thr - v) / thr + 0.25) : 0, shortDepth: v > hi ? clamp01((v - hi) / thr + 0.25) : 0 };
    },
  },
  ma: {
    label: 'Moving average', blurb: 'Trend filter — price above/below the average.',
    params: [
      { k: 'maType', label: 'Type', options: ['sma', 'ema'], def: 'sma' },
      { k: 'period', label: 'Length', min: 5, max: 200, step: 5, def: 50 },
    ],
    long: (c) => `Price above ${c.maType.toUpperCase()}(${c.period})`, short: (c) => `Price below ${c.maType.toUpperCase()}(${c.period})`,
    eval(closes, price, c) {
      const m = lastVal((c.maType === 'ema' ? ema : sma)(closes, c.period || 50)); if (m == null) return null;
      const d = clamp01(Math.abs(price - m) / m / 0.05);
      return { bull: price > m, bear: price < m, longDepth: price > m ? 0.4 + 0.6 * d : 0, shortDepth: price < m ? 0.4 + 0.6 * d : 0 };
    },
  },
  macd: {
    label: 'MACD', blurb: 'Trend-momentum — line above/below its signal.',
    params: [
      { k: 'fast', label: 'Fast', min: 3, max: 20, step: 1, def: 12 },
      { k: 'slow', label: 'Slow', min: 15, max: 40, step: 1, def: 26 },
    ],
    long: () => 'MACD above its signal (bullish)', short: () => 'MACD below its signal (bearish)',
    eval(closes, price, c) {
      const { macdLine, signalLine } = macd(closes, c.fast || 12, c.slow || 26, 9);
      const m = lastVal(macdLine), s = lastVal(signalLine); if (m == null || s == null) return null;
      const spread = clamp01(Math.abs(m - s) / (price * 0.004));
      return { bull: m > s, bear: m < s, longDepth: m > s ? 0.4 + 0.6 * spread : 0, shortDepth: m < s ? 0.4 + 0.6 * spread : 0 };
    },
  },
  boll: {
    label: 'Bollinger Bands', blurb: 'Volatility bands — price stretched past a band.',
    params: [
      { k: 'period', label: 'Length', min: 10, max: 40, step: 1, def: 20 },
      { k: 'mult', label: 'Std-devs', min: 1, max: 3, step: 0.5, def: 2 },
    ],
    long: (c) => `Price below the lower band (${c.period}, ${c.mult}σ)`, short: (c) => `Price above the upper band (${c.period}, ${c.mult}σ)`,
    eval(closes, price, c) {
      const { upper, lower } = bollingerBands(closes, c.period || 20, c.mult || 2);
      const u = lastVal(upper), l = lastVal(lower); if (u == null || l == null) return null;
      return { bull: price < l, bear: price > u, longDepth: price < l ? clamp01((l - price) / (price * 0.03) + 0.3) : 0, shortDepth: price > u ? clamp01((price - u) / (price * 0.03) + 0.3) : 0 };
    },
  },
  stoch: {
    label: 'Stochastic', blurb: 'Oscillator vs the recent price range.',
    params: [
      { k: 'period', label: 'Length', min: 5, max: 21, step: 1, def: 14 },
      { k: 'value', label: 'Oversold below', min: 5, max: 45, step: 1, def: 20 },
    ],
    long: (c) => `Stochastic below ${c.value}`, short: (c) => `Stochastic above ${100 - c.value}`,
    eval(closes, price, c) {
      const p = c.period || 14; if (closes.length < p) return null;
      const win = closes.slice(-p), lo = Math.min(...win), hi = Math.max(...win);
      if (hi === lo) return null;
      const k = ((price - lo) / (hi - lo)) * 100, thr = c.value ?? 20, top = 100 - thr;
      return { bull: k < thr, bear: k > top, longDepth: k < thr ? clamp01((thr - k) / thr + 0.25) : 0, shortDepth: k > top ? clamp01((k - top) / thr + 0.25) : 0 };
    },
  },
  roc: {
    label: 'Momentum', blurb: 'Rate of change over N bars — positive vs negative.',
    params: [{ k: 'period', label: 'Length', min: 3, max: 40, step: 1, def: 12 }],
    long: (c) => `Momentum positive over ${c.period} bars`, short: (c) => `Momentum negative over ${c.period} bars`,
    eval(closes, price, c) {
      const p = c.period || 12; if (closes.length <= p) return null;
      const past = closes[closes.length - 1 - p]; if (!(past > 0)) return null;
      const roc = (price / past - 1) * 100, d = clamp01(Math.abs(roc) / 5);
      return { bull: roc > 0, bear: roc < 0, longDepth: roc > 0 ? 0.35 + 0.65 * d : 0, shortDepth: roc < 0 ? 0.35 + 0.65 * d : 0 };
    },
  },
};

export const INDICATOR_KEYS = Object.keys(INDICATORS);

// A fresh condition with an indicator's default params.
export function defaultCondition(key) {
  const meta = INDICATORS[key]; const c = { key };
  for (const p of meta.params) c[p.k] = p.def;
  return c;
}

// Default = the classic dip-buy so an untouched builder still does something sensible.
export const CUSTOM_DEFAULT = {
  direction: 'long', // 'long' | 'short' | 'both'
  conditions: [
    { key: 'rsi', period: 2, value: 15 },
    { key: 'ma', maType: 'sma', period: 50 },
  ],
};

export function getCustomConfig() {
  try { const c = JSON.parse(localStorage.getItem(LS)); if (c && Array.isArray(c.conditions)) return { direction: c.direction || 'long', conditions: c.conditions }; } catch (e) { /* ignore */ }
  return { direction: CUSTOM_DEFAULT.direction, conditions: CUSTOM_DEFAULT.conditions.map((x) => ({ ...x })) };
}
export function setCustomConfig(cfg) { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) { /* ignore */ } }
export function resetCustomConfig() { try { localStorage.removeItem(LS); } catch (e) { /* ignore */ } }

// Evaluate the user's whole rule on one market's recent closes. Returns the firing
// state for the configured direction, a user-derived confidence, and proximity =
// how many of their conditions are currently met (honest "3 of 4" style progress).
export function evalCustom(market, cfg) {
  const h = market && market.history;
  if (!Array.isArray(h) || h.length < 30 || !cfg.conditions || !cfg.conditions.length) return { ready: false };
  const price = market.price || h[h.length - 1];
  if (!(price > 0)) return { ready: false };

  let longMet = 0, shortMet = 0, longDepth = 0, shortDepth = 0, total = 0;
  for (const cond of cfg.conditions) {
    const ind = INDICATORS[cond.key]; if (!ind) continue;
    const r = ind.eval(h, price, cond); if (!r) return { ready: false }; // not enough history yet
    total += 1;
    if (r.bull) { longMet += 1; longDepth += r.longDepth || 0; }
    if (r.bear) { shortMet += 1; shortDepth += r.shortDepth || 0; }
  }
  if (!total) return { ready: false };

  const wantLong = cfg.direction !== 'short';
  const wantShort = cfg.direction !== 'long';
  const longFires = wantLong && longMet === total;
  const shortFires = wantShort && shortMet === total;
  // If both sides fire (possible with 'both' + loose rules), take the deeper one.
  let dir = 0, depth = 0, met = 0;
  if (longFires && (!shortFires || longDepth >= shortDepth)) { dir = 1; depth = longDepth / total; met = longMet; }
  else if (shortFires) { dir = -1; depth = shortDepth / total; met = shortMet; }
  else { met = wantShort && !wantLong ? shortMet : Math.max(wantLong ? longMet : 0, wantShort ? shortMet : 0); }

  const fires = dir !== 0;
  const confidence = Math.round(72 + 20 * clamp01(depth));
  const proximity = Math.round((met / total) * 100); // % of your conditions currently met
  // longFires/shortFires are the raw per-side states (before the direction gate), so
  // the paper tracker can tell when an OPEN position's own setup has ended.
  return { ready: true, fires, dir, price, confidence, proximity, met, total, longFires: longMet === total, shortFires: shortMet === total };
}
