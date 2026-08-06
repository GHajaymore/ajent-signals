// Real confluence scoring computed from actual price history — replaces the
// random signal generator. This is a rule-based weighted score, NOT a
// statistically calibrated probability of a winning trade: no combination of
// technical indicators guarantees a given win rate, and none is claimed here.
import { ema, rsi, macd, atr, bollingerBands, sessionVwap, supertrend, marketStructure, adx, obv, cci, ichimoku } from './indicators.js';
import { summarizeNews } from './news.js';
import { getMultipliers } from './adaptiveWeights.js';

// Weights sum to 100. Deliberately non-redundant — one indicator per distinct
// information type so we're not double-counting the same signal:
//   trend direction ....... EMA Stack, Supertrend
//   trend strength ........ ADX / DMI            (new)
//   momentum .............. MACD, RSI
//   price-action structure  Market Structure
//   volatility position ... Bollinger Bands
//   intraday reference .... VWAP
//   volume confirmation ... OBV                  (new)
//   external catalyst ..... News Sentiment
// We intentionally avoid piling on redundant oscillators (e.g. Stochastic RSI
// on top of RSI) — more indicators that move together add noise, not edge.
const WEIGHTS = {
  'EMA Stack': 10,
  Supertrend: 9,
  ADX: 11,
  Ichimoku: 9,
  MACD: 9,
  'RSI (14)': 7,
  CCI: 7,
  'Market Structure': 11,
  'Bollinger Bands': 6,
  VWAP: 9,
  Volume: 8,
  'News Sentiment': 4,
};

const HOLD_BY_VOLATILITY = {
  High: ['20 min', '25 min', '35 min'],
  Medium: ['35 min', '45 min', '1.2 hrs'],
  Low: ['1.2 hrs', '1.8 hrs', '2.4 hrs'],
};

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function computeRealSignal(candles, def, rng, news = [], opts = {}) {
  // Reward:Risk for the first target — user-adjustable in Settings. Bounded so a
  // stray value can't invert the geometry. Default keeps the high-win-rate 0.4.
  const targetRatio = Math.min(3, Math.max(0.2, opts.targetRatio > 0 ? opts.targetRatio : 0.35));
  const closes = candles.map((c) => c.c);
  const n = closes.length;
  const price = closes[n - 1];

  const ema9 = ema(closes, 9), ema20 = ema(closes, 20), ema50 = ema(closes, Math.min(50, Math.floor(n / 2)));
  // Higher-timeframe trend proxy: a long EMA over the whole ~1-month window acts
  // like the daily/bigger-picture trend. Signals that fight this are the
  // low-accuracy ones, so we only trade with it (see the penalty below).
  const emaLong = ema(closes, Math.min(200, Math.max(50, Math.floor(n * 0.8))));
  const htfTrend = price > emaLong[n - 1] * 1.0005 ? 'up' : price < emaLong[n - 1] * 0.9995 ? 'down' : 'flat';
  const rsiVals = rsi(closes, 14);
  const rsi2Vals = rsi(closes, 2); // fast RSI — the mean-reversion trigger (Connors-style)
  const { histogram } = macd(closes);
  const atrVals = atr(candles, 14);
  const bb = bollingerBands(closes, 20, 2);
  const vwap = sessionVwap(candles);
  const st = supertrend(candles, 10, 3);
  const structure = marketStructure(candles, 6);
  const adxVals = adx(candles, 14);
  const obvVals = obv(candles);
  const cciVals = cci(candles, 20);
  const ich = ichimoku(candles);

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

  // 3. ADX / DMI — trend STRENGTH gate. Only counts as directional when a real
  //    trend is present (ADX >= 20); otherwise stays neutral to avoid chop.
  {
    const a = Math.round(adxVals.adx[n - 1] ?? 0);
    const pdi = adxVals.plusDI[n - 1] ?? 0, mdi = adxVals.minusDI[n - 1] ?? 0;
    const strong = a >= 20;
    const state = strong && pdi > mdi ? 'bull' : strong && mdi > pdi ? 'bear' : 'neutral';
    const detail = !strong ? `ADX ${a} — weak/ranging trend`
      : state === 'bull' ? `ADX ${a} — strong uptrend (+DI leads)`
      : `ADX ${a} — strong downtrend (−DI leads)`;
    indicators.push({ name: 'ADX', state, detail, weight: WEIGHTS.ADX });
  }

  // 3b. Ichimoku — trend structure via Tenkan/Kijun and price location.
  {
    const t = ich.tenkan[n - 1], k = ich.kijun[n - 1];
    const state = t != null && k != null && price > k && t > k ? 'bull'
      : t != null && k != null && price < k && t < k ? 'bear' : 'neutral';
    const detail = state === 'bull' ? 'Price above the Kijun, Tenkan leading up' : state === 'bear' ? 'Price below the Kijun, Tenkan leading down' : 'Coiled around the cloud';
    indicators.push({ name: 'Ichimoku', state, detail, weight: WEIGHTS.Ichimoku });
  }

  // 4. MACD — momentum confirmation via histogram direction/expansion.
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

  // 5b. CCI — commodity channel index; deviation from the mean (futures-native).
  {
    const v = cciVals[n - 1] ?? 0;
    const state = v > 60 ? 'bull' : v < -60 ? 'bear' : 'neutral';
    const detail = state === 'bull' ? `CCI ${Math.round(v)} — strong upside push` : state === 'bear' ? `CCI ${Math.round(v)} — strong downside push` : `CCI ${Math.round(v)} — near the mean`;
    indicators.push({ name: 'CCI', state, detail, weight: WEIGHTS.CCI });
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

  // 8. Volume (OBV) — is volume confirming the move? Compares OBV now vs. ~12
  //    bars ago. Rising = accumulation (bullish), falling = distribution.
  {
    const back = Math.min(12, n - 1);
    const cur = obvVals[n - 1], prev = obvVals[n - 1 - back] ?? cur;
    const denom = Math.max(Math.abs(cur), Math.abs(prev), 1);
    const chg = (cur - prev) / denom;
    const state = chg > 0.05 ? 'bull' : chg < -0.05 ? 'bear' : 'neutral';
    const detail = state === 'bull' ? 'OBV rising — buyers accumulating' : state === 'bear' ? 'OBV falling — sellers distributing' : 'Flat volume flow';
    indicators.push({ name: 'Volume', state, detail, weight: WEIGHTS.Volume });
  }

  // 8. News Sentiment — real recent headlines (48h), keyword-scored. Not
  // insider or non-public information, and not a licensed NLP sentiment feed.
  const newsSummary = summarizeNews(news);
  {
    const { avg, headlines } = newsSummary;
    const state = avg >= 0.4 ? 'bull' : avg <= -0.4 ? 'bear' : 'neutral';
    const top = headlines[0];
    const detail = headlines.length === 0
      ? 'No market-moving headlines in the last 48h'
      : state === 'neutral'
        ? `Mixed/quiet coverage — "${top.title}"`
        : `${state === 'bull' ? 'Net bullish' : 'Net bearish'} coverage — "${top.title}"`;
    indicators.push({ name: 'News Sentiment', state, detail, weight: WEIGHTS['News Sentiment'] });
  }

  // Self-tuning: scale each factor's weight by how well it has actually been
  // predicting in real paper trades, then renormalise so the total stays 100.
  const mult = getMultipliers();
  let wtotal = 0;
  for (const ind of indicators) { ind.weight = ind.weight * (mult[ind.name] || 1); wtotal += ind.weight; }
  if (wtotal > 0) for (const ind of indicators) ind.weight = (ind.weight * 100) / wtotal;

  const bullWeight = indicators.filter((i) => i.state === 'bull').reduce((s, i) => s + i.weight, 0);
  const bearWeight = indicators.filter((i) => i.state === 'bear').reduce((s, i) => s + i.weight, 0);

  // ── Ajent Pulse: mean-reversion-in-trend core ─────────────────────────────
  // Instead of chasing breakouts (many small losses, rare big wins — a LOW win
  // rate), we trade WITH the higher-timeframe trend but only enter on a
  // short-term counter-move: buy an oversold dip in an uptrend, sell an
  // overbought pop in a downtrend. Pullbacks inside a trend usually resume, so a
  // deliberately tight target is reached far more often than the wider stop —
  // the classic high-win-rate profile (Connors RSI-2 family). The catch, stated
  // honestly in the UI: wins are small and the occasional loss is larger.
  const rsi2 = rsi2Vals[n - 1] ?? 50;
  const rsi14 = rsiVals[n - 1] ?? 50;
  const cciNow = cciVals[n - 1] ?? 0;
  const lowerBB = bb.lower[n - 1], upperBB = bb.upper[n - 1];
  const ema9Now = ema9[n - 1];

  let direction, setup;
  if (htfTrend === 'up') {
    direction = 1;
    setup = clamp01(
      0.42 * (rsi2 < 5 ? 1 : rsi2 < 12 ? 0.75 : rsi2 < 25 ? 0.45 : rsi2 < 40 ? 0.2 : 0)
      + 0.24 * (lowerBB != null && price <= lowerBB ? 1 : lowerBB != null && price <= lowerBB * 1.0015 ? 0.5 : 0)
      + 0.20 * (rsi14 < 32 ? 1 : rsi14 < 42 ? 0.5 : 0)
      + 0.08 * (cciNow < -120 ? 1 : cciNow < -60 ? 0.5 : 0)
      + 0.06 * (price < ema9Now ? 1 : 0),
    );
  } else if (htfTrend === 'down') {
    direction = -1;
    setup = clamp01(
      0.42 * (rsi2 > 95 ? 1 : rsi2 > 88 ? 0.75 : rsi2 > 75 ? 0.45 : rsi2 > 60 ? 0.2 : 0)
      + 0.24 * (upperBB != null && price >= upperBB ? 1 : upperBB != null && price >= upperBB * 0.9985 ? 0.5 : 0)
      + 0.20 * (rsi14 > 68 ? 1 : rsi14 > 58 ? 0.5 : 0)
      + 0.08 * (cciNow > 120 ? 1 : cciNow > 60 ? 0.5 : 0)
      + 0.06 * (price > ema9Now ? 1 : 0),
    );
  } else {
    // No clear higher-timeframe trend → no mean-reversion edge. Lean with the
    // confluence but keep confidence low so it stays below the fire threshold.
    direction = bullWeight >= bearWeight ? 1 : -1;
    setup = 0;
  }

  // ── Discipline overlays — the rules seasoned traders actually live by ──────
  if (htfTrend !== 'flat') {
    const lastC = candles[n - 1], prevClose = closes[n - 2] ?? price;
    // (1) "Don't catch a falling knife." Wait for the bar to turn back in the
    //     trade's direction before entering an oversold dip / overbought pop.
    const confirmed = direction > 0
      ? (price >= lastC.o || price > prevClose)
      : (price <= lastC.o || price < prevClose);
    // (2) Distinguish a pullback from a trend BREAK. A violent multi-bar move
    //     against the trend is a breakdown, not a dip to fade.
    const look = Math.min(4, n - 1);
    const slice = closes.slice(n - look);
    const excursion = direction > 0 ? (Math.max(...slice) - price) / price : (price - Math.min(...slice)) / price;
    const breakdown = excursion > atrPctNow * 3.2;
    // (3) Stand aside in the chaos: an ATR spike vs its recent median usually
    //     means a news shock — no edge, wider slippage.
    const atrRecent = atrVals.slice(-30).filter((v) => v > 0).sort((a, b) => a - b);
    const medAtr = atrRecent.length ? atrRecent[Math.floor(atrRecent.length / 2)] : atrNow;
    const shock = atrNow > medAtr * 2.4;

    let disc = 1;
    if (!confirmed) disc *= 0.75;   // needs a deeper dip to fire without the turn
    if (breakdown) disc *= 0.45;    // fading a breakdown is how accounts blow up
    if (shock) disc *= 0.6;         // don't trade the news spike
    setup = clamp01(setup * disc);
  }

  // Only a genuine, confirmed pullback clears a typical 75 threshold, so signals
  // fire selectively on real dips/pops rather than constantly.
  const confidence = htfTrend === 'flat'
    ? Math.min(58, Math.round(Math.max(bullWeight, bearWeight)))
    : Math.round(52 + setup * 47);

  const bull = indicators.filter((i) => i.state === 'bull').length;
  const bear = indicators.filter((i) => i.state === 'bear').length;
  const neutral = indicators.length - bull - bear;

  // Risk distance (the stop) is floored at ~0.6% of price (or 1.8x ATR for
  // volatile markets, whichever is larger) so the stop sits outside the coarse
  // free-feed noise. The target geometry below is intentionally asymmetric.
  const entry = price;
  const riskDist = Math.max(atrNow * 1.8, price * 0.006);
  const stop = entry - direction * riskDist;
  const trailingStopPts = riskDist * 0.8;
  // Deliberately tight first target vs a wider stop. On a mean-reversion bounce
  // the small target (≈0.4× the risk distance) is reached most of the time,
  // which is what produces the high win rate; the two further targets let a
  // strong reversion run. Geometric baseline: 1/(1+0.4) ≈ 71% hit rate before
  // any edge, and buying dips in an uptrend adds a real one.
  const target1 = entry + direction * riskDist * targetRatio;
  const target2 = entry + direction * riskDist * targetRatio * 2.1;
  const target3 = entry + direction * riskDist * targetRatio * 3.5;
  const riskReward = Math.abs(target1 - entry) / Math.abs(entry - stop || 1e-9);

  const agreeState = direction > 0 ? 'bull' : 'bear';
  // Plain-language, category-level reasons — deliberately do NOT name the exact
  // indicators or parameters, so the proprietary formula isn't disclosed.
  const REASON_TEXT = {
    'EMA Stack': { bull: 'The prevailing trend is up and well established.', bear: 'The prevailing trend is down and well established.' },
    Supertrend: { bull: 'Trend-following models confirm the upside.', bear: 'Trend-following models confirm the downside.' },
    ADX: { bull: 'Trend strength is high — this is a real move, not a choppy range.', bear: 'Trend strength is high — this is a real move, not a choppy range.' },
    Ichimoku: { bull: 'Price is holding above its cloud trend structure.', bear: 'Price is trading below its cloud trend structure.' },
    CCI: { bull: 'Price has pushed strongly above its statistical mean.', bear: 'Price has pushed strongly below its statistical mean.' },
    MACD: { bull: 'Momentum is expanding in the trade’s direction.', bear: 'Momentum is expanding in the trade’s direction.' },
    'Market Structure': { bull: 'Price structure is making higher highs and higher lows.', bear: 'Price structure is making lower highs and lower lows.' },
    'RSI (14)': { bull: 'Momentum has room to run without being overextended.', bear: 'Momentum has room to fall without being oversold.' },
    'Bollinger Bands': { bull: 'Volatility is expanding in the trade’s favor.', bear: 'Volatility is expanding in the trade’s favor.' },
    VWAP: { bull: 'Price is holding above fair value.', bear: 'Price is trading below fair value.' },
    Volume: { bull: 'Volume is confirming the move.', bear: 'Volume is confirming the move.' },
  };
  const agreeing = indicators.filter((i) => i.state === agreeState).sort((a, b) => b.weight - a.weight);
  let reasons;
  if (confidence >= 60) {
    const lead = direction > 0
      ? 'Buying an oversold dip inside a confirmed uptrend — pullbacks in an uptrend usually resume, so a tight target is reached far more often than the wider stop.'
      : 'Selling an overbought pop inside a confirmed downtrend — rallies in a downtrend usually fade, favouring the tight target over the wider stop.';
    reasons = [lead];
    reasons.push(...agreeing.slice(0, 2).map((i) => (
      i.name === 'News Sentiment' ? `Recent headlines lean ${agreeState === 'bull' ? 'bullish' : 'bearish'} — ${i.detail}.` : REASON_TEXT[i.name]?.[agreeState]
    )).filter(Boolean));
    reasons.push('This is a high-probability setup by design: many small wins with occasional larger losses. A high win rate is not the same as guaranteed profit.');
    reasons.push('Computed from real 15-minute candles and recent headlines over the trailing month — not a random or simulated score.');
  } else {
    reasons = [
      htfTrend === 'flat'
        ? 'No clear higher-timeframe trend, so there is no reliable dip-buy or pop-sell edge right now.'
        : 'Trend is intact but price has not pulled back far enough — waiting for a genuine oversold dip / overbought pop before entering.',
      `Setup strength ${Math.round((setup || 0) * 100)}% — below the fire threshold.`,
    ];
  }

  const trend = confidence >= 60 ? (direction > 0 ? 'Bullish' : 'Bearish') : 'Neutral';

  return {
    symbol: def.symbol,
    timeframe: '15m',
    direction,
    confidence,
    trend,
    htfTrend,
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
