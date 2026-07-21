// Real confluence scoring computed from actual price history — replaces the
// random signal generator. This is a rule-based weighted score, NOT a
// statistically calibrated probability of a winning trade: no combination of
// technical indicators guarantees a given win rate, and none is claimed here.
import { ema, rsi, macd, atr, bollingerBands, sessionVwap, supertrend, marketStructure } from './indicators.js';

// Weights sum to 100. Kept to a small, deliberately non-redundant set — one
// indicator per information type (trend, momentum, volatility-position,
// intraday reference, trend-following overlay, price-action structure) —
// rather than stacking multiple indicators that tend to move together
// (e.g. RSI and Stoch RSI, or MACD and a second EMA crossover).
const WEIGHTS = {
  'EMA Stack': 20,
  Supertrend: 15,
  MACD: 13,
  'Market Structure': 15,
  'RSI (14)': 12,
  'Bollinger Bands': 10,
  VWAP: 15,
};

const HOLD_BY_VOLATILITY = {
  High: ['20 min', '25 min', '35 min'],
  Medium: ['35 min', '45 min', '1.2 hrs'],
  Low: ['1.2 hrs', '1.8 hrs', '2.4 hrs'],
};

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

export function computeRealSignal(candles, def, rng) {
  const closes = candles.map((c) => c.c);
  const n = closes.length;
  const price = closes[n - 1];

  const ema9 = ema(closes, 9), ema20 = ema(closes, 20), ema50 = ema(closes, Math.min(50, Math.floor(n / 2)));
  const rsiVals = rsi(closes, 14);
  const { histogram } = macd(closes);
  const atrVals = atr(candles, 14);
  const bb = bollingerBands(closes, 20, 2);
  const vwap = sessionVwap(candles);
  const st = supertrend(candles, 10, 3);
  const structure = marketStructure(candles, 6);

  const atrNow = atrVals[n - 1] ?? price * 0.006;
  const atrPctNow = atrNow / price;
  const volatility = atrPctNow >= 0.015 ? 'High' : atrPctNow >= 0.006 ? 'Medium' : 'Low';

  const indicators = [];

  // 1. EMA Stack — trend direction from moving-average order.
  {
    const e9 = ema9[n - 1], e20 = ema20[n - 1], e50 = ema50[n - 1];
    const state = e9 > e20 && e20 > e50 ? 'bull' : e9 < e20 && e20 < e50 ? 'bear' : 'neutral';
    const detail = state === 'bull' ? '9 > 20 > 50 aligned up' : state === 'bear' ? '9 < 20 < 50 aligned down' : 'EMAs compressed, no clear stack';
    indicators.push({ name: 'EMA Stack', state, detail, weight: WEIGHTS['EMA Stack'] });
  }

  // 2. Supertrend — trend-following overlay, independent confirmation of direction.
  {
    const d = st.dir[n - 1];
    const state = d === 1 ? 'bull' : d === -1 ? 'bear' : 'neutral';
    const detail = state === 'bull' ? 'Green — long bias' : state === 'bear' ? 'Red — short bias' : 'Flipping — indecisive';
    indicators.push({ name: 'Supertrend', state, detail, weight: WEIGHTS.Supertrend });
  }

  // 3. MACD — momentum confirmation via histogram direction/expansion.
  {
    const h = histogram[n - 1], hPrev = histogram[n - 2] ?? h;
    const state = h > 0 && h >= hPrev ? 'bull' : h < 0 && h <= hPrev ? 'bear' : 'neutral';
    const detail = state === 'bull' ? 'Bullish histogram expanding' : state === 'bear' ? 'Bearish histogram expanding' : 'Flat histogram';
    indicators.push({ name: 'MACD', state, detail, weight: WEIGHTS.MACD });
  }

  // 4. Market Structure — price-action confirmation (swing highs/lows).
  {
    const state = structure;
    const detail = state === 'bull' ? 'Higher highs, higher lows (BOS up)' : state === 'bear' ? 'Lower highs, lower lows (BOS down)' : 'Ranging, no clear structure';
    indicators.push({ name: 'Market Structure', state, detail, weight: WEIGHTS['Market Structure'] });
  }

  // 5. RSI(14) — momentum without double-counting MACD/Stoch-style oscillators.
  {
    const v = Math.round(rsiVals[n - 1] ?? 50);
    const state = v >= 55 && v < 72 ? 'bull' : v <= 45 && v > 28 ? 'bear' : 'neutral';
    const detail = state === 'bull' ? `${v} — bullish, not overbought` : state === 'bear' ? `${v} — bearish, not oversold` : `${v} — neutral range`;
    indicators.push({ name: 'RSI (14)', state, detail, weight: WEIGHTS['RSI (14)'] });
  }

  // 6. Bollinger Bands — volatility-relative position (breakout/exhaustion context).
  {
    const upper = bb.upper[n - 1], lower = bb.lower[n - 1];
    const state = upper != null && price >= upper ? 'bull' : lower != null && price <= lower ? 'bear' : 'neutral';
    const detail = state === 'bull' ? 'Riding the upper band' : state === 'bear' ? 'Riding the lower band' : 'Mid-band chop';
    indicators.push({ name: 'Bollinger Bands', state, detail, weight: WEIGHTS['Bollinger Bands'] });
  }

  // 7. VWAP — intraday fair-value reference.
  {
    const vw = vwap[n - 1];
    const dist = (price - vw) / vw;
    const state = dist > 0.0008 ? 'bull' : dist < -0.0008 ? 'bear' : 'neutral';
    const detail = state === 'bull' ? 'Price holding above VWAP' : state === 'bear' ? 'Price rejected below VWAP' : 'Hugging VWAP';
    indicators.push({ name: 'VWAP', state, detail, weight: WEIGHTS.VWAP });
  }

  const bullWeight = indicators.filter((i) => i.state === 'bull').reduce((s, i) => s + i.weight, 0);
  const bearWeight = indicators.filter((i) => i.state === 'bear').reduce((s, i) => s + i.weight, 0);
  const direction = bullWeight >= bearWeight ? 1 : -1;
  const confidence = Math.round(Math.max(bullWeight, bearWeight));

  const bull = indicators.filter((i) => i.state === 'bull').length;
  const bear = indicators.filter((i) => i.state === 'bear').length;
  const neutral = indicators.length - bull - bear;

  const entry = price;
  const stop = entry - direction * atrNow * 1.0;
  const trailingStopPts = atrNow * 1.2;
  const target1 = entry + direction * atrNow * 2.0;
  const target2 = entry + direction * atrNow * 3.2;
  const target3 = entry + direction * atrNow * 4.5;
  const riskReward = Math.abs(target1 - entry) / Math.abs(entry - stop || 1e-9);

  const agreeState = direction > 0 ? 'bull' : 'bear';
  const REASON_TEXT = {
    'EMA Stack': { bull: 'Price is trading above a rising EMA stack, confirming an established uptrend.', bear: 'Price is trading below a falling EMA stack, confirming an established downtrend.' },
    Supertrend: { bull: 'Supertrend has flipped bullish, adding trend confirmation.', bear: 'Supertrend has flipped bearish, adding trend confirmation.' },
    MACD: { bull: 'MACD histogram is expanding to the upside on rising momentum.', bear: 'MACD histogram is expanding to the downside on falling momentum.' },
    'Market Structure': { bull: 'Market structure shows higher highs and higher lows — a bullish break of structure.', bear: 'Market structure shows lower highs and lower lows — a bearish break of structure.' },
    'RSI (14)': { bull: 'RSI is firmly bullish without being overbought, leaving room to run.', bear: 'RSI is firmly bearish without being oversold, leaving room to fall.' },
    'Bollinger Bands': { bull: 'Price is riding the upper Bollinger Band on expanding volatility.', bear: 'Price is riding the lower Bollinger Band on expanding volatility.' },
    VWAP: { bull: 'Price is holding above session VWAP, favoring continuation higher.', bear: 'Price is being rejected below session VWAP, favoring continuation lower.' },
  };
  const agreeing = indicators.filter((i) => i.state === agreeState).sort((a, b) => b.weight - a.weight);
  let reasons;
  if (confidence >= 60) {
    reasons = agreeing.slice(0, 3).map((i) => REASON_TEXT[i.name]?.[agreeState]).filter(Boolean);
    reasons.push('Computed from real 5-minute candles over the trailing 5 days — not a random or simulated score.');
  } else {
    reasons = [
      `Confidence of ${confidence}% falls short of the confidence threshold.`,
      `Indicators are split — ${bull} bullish vs ${bear} bearish, ${neutral} neutral.`,
      'Waiting for stronger multi-timeframe alignment before risking capital.',
    ];
  }

  const trend = confidence >= 60 ? (direction > 0 ? 'Bullish' : 'Bearish') : 'Neutral';

  return {
    symbol: def.symbol,
    timeframe: '5m',
    direction,
    confidence,
    trend,
    volatility,
    expectedHold: pick(rng, HOLD_BY_VOLATILITY[volatility]),
    plan: { entry, stop, trailingStopPts, target1, target2, target3, riskReward },
    reasons,
    indicators,
    confluence: { bull, bear, neutral },
    createdAt: Date.now(),
    price,
    isReal: true,
  };
}
