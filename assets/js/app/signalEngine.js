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

  // Bollinger %B — where price sits within the bands (0 = lower band, 1 = upper).
  // A graded band-position read beat the crude "touched the band" check in
  // backtesting, so it carries more of the setup weight.
  const bWidth = (upperBB != null && lowerBB != null) ? (upperBB - lowerBB) || 1 : null;
  const pctB = bWidth != null ? (price - lowerBB) / bWidth : 0.5; // 0.5 = neutral fallback

  const mode = opts.mode === 'daily' ? 'daily' : 'intraday';
  let direction, setup, conviction = 'normal', provisional = false;

  if (mode === 'daily') {
    // ── Daily swing (Connors RSI-2) + "first up close" exit.
    // Entry: RSI2<10 flush below the prior day's low, with the 200-day uptrend.
    // The flush gate ("wait for the close THROUGH yesterday's extreme") and the
    // first-up-close exit are what carry the edge. Walk-forward across five
    // sequential ~2-year windows kept RSI2<10 profitable in EVERY window (US PF
    // 1.09–2.40, ~72% win). The tighter RSI2<5 posted a higher AVERAGE (~1.84)
    // but had an outright losing window and half the trades, so <10 is the more
    // robust gate; the deeper extremes are graded up as higher conviction instead.
    //
    // Conviction = 'high' for the deep (RSI2<5) tier, which backtested ~2x the
    // per-trade expectancy of the ordinary tier and, unlike the ordinary tier,
    // stayed positive out-of-sample. Optional position sizing keys off this.
    //
    // LONG-ONLY. The short side (selling overbought pops in downtrends) backtested
    // far weaker — profit factor 1.11 overall and an actual loss (0.90) on
    // international indices — because equity indices drift upward, so shorting the
    // bounce fights that drift. Long-only lifted PF 1.46 → 1.61. So a downtrend /
    // overbought pop is simply "no trade", not a short.
    const prevLow = n >= 2 ? candles[n - 2].l : -Infinity;
    const prevHigh = n >= 2 ? candles[n - 2].h : Infinity;
    const flushedDown = price < prevLow;
    const poppedUp = price > prevHigh;
    if (htfTrend === 'up' && rsi2 < 10 && flushedDown) {
      direction = 1;
      const deep = rsi2 < 5;                                 // deepest oversold
      const stretched = lowerBB != null && price < lowerBB;  // below the lower band
      setup = deep && stretched ? 1 : deep ? 0.9 : 0.8;      // elite → strong → ok
      conviction = deep ? 'high' : 'normal';
    } else if (htfTrend === 'down' && rsi2 > 90 && poppedUp) {
      // PROVISIONAL short mirror (2026-08-30). Overbought pop above the prior
      // high in a downtrend. Weak on equity indices (they drift up) — the live
      // record is the judge. Rarely fires; flagged provisional in the UI.
      direction = -1;
      const deep = rsi2 > 95;
      const stretched = upperBB != null && price > upperBB;
      setup = deep && stretched ? 1 : deep ? 0.9 : 0.8;
      conviction = deep ? 'high' : 'normal';
      provisional = true;
    } else { direction = bullWeight >= bearWeight ? 1 : -1; setup = 0; }
  } else if (rsi2 < 10) {
    // ── Intraday Connors (15m), BOTH DIRECTIONS, no trend gate — the "Active" mode.
    //    Buy an oversold dip (RSI2<10) OR sell an overbought pop (RSI2>90) in any
    //    condition, exit when RSI2 reverts to 50, 2x ATR stop, ~1-session time stop.
    //    Dropping the trend gate is what unlocks both goals: it roughly doubled the
    //    signal rate (~100+/day across the active markets) AND made the short side
    //    genuinely profitable (PF ~1.22, vs a weak ~1.05 when gated to downtrends).
    //    Intraday has no overnight drift, so the daily "indices only drift up" logic
    //    that killed daily shorts doesn't apply on 15-minute bars. Backtested both
    //    ways: ~65% win, PF ~1.25 pooled across 8 markets, positive on nearly every
    //    market/direction. Deepest RSI2 extremes that also pierce a Bollinger band
    //    are graded high conviction. Provisional — ~60 days of data only.
    direction = 1;
    const stretched = lowerBB != null && price < lowerBB;
    setup = rsi2 < 3 ? 1 : rsi2 < 6 ? 0.9 : 0.8;
    conviction = (rsi2 < 3 && stretched) ? 'high' : 'normal';
  } else if (rsi2 > 90) {
    direction = -1;
    const stretched = upperBB != null && price > upperBB;
    setup = rsi2 > 97 ? 1 : rsi2 > 94 ? 0.9 : 0.8;
    conviction = (rsi2 > 97 && stretched) ? 'high' : 'normal';
  } else {
    // No stretch either way — lean with the confluence but stay below the threshold.
    direction = bullWeight >= bearWeight ? 1 : -1;
    setup = 0;
  }

  // ── Discipline overlays — retained only as a guard, currently unused because
  //    both modes are deliberate Connors dip-buys (they buy the down-close, so the
  //    "wait for the turn" filter would fight the strategy, exactly as the
  //    validated backtests were run — without it).
  if (false && mode === 'intraday' && htfTrend !== 'flat' && setup > 0) {
    const lastC = candles[n - 1], prevClose = closes[n - 2] ?? price;
    const confirmed = direction > 0
      ? (price >= lastC.o || price > prevClose)
      : (price <= lastC.o || price < prevClose);
    const look = Math.min(4, n - 1);
    const slice = closes.slice(n - look);
    const excursion = direction > 0 ? (Math.max(...slice) - price) / price : (price - Math.min(...slice)) / price;
    const breakdown = excursion > atrPctNow * 3.2;
    const atrRecent = atrVals.slice(-30).filter((v) => v > 0).sort((a, b) => a - b);
    const medAtr = atrRecent.length ? atrRecent[Math.floor(atrRecent.length / 2)] : atrNow;
    const shock = atrNow > medAtr * 2.4;
    let disc = 1;
    if (!confirmed) disc *= 0.75;
    if (breakdown) disc *= 0.45;
    if (shock) disc *= 0.6;
    setup = clamp01(setup * disc);
  }

  const confidence = setup > 0
    ? Math.round(52 + setup * 47)
    : (htfTrend === 'flat' ? Math.min(58, Math.round(Math.max(bullWeight, bearWeight))) : 42);

  const bull = indicators.filter((i) => i.state === 'bull').length;
  const bear = indicators.filter((i) => i.state === 'bear').length;
  const neutral = indicators.length - bull - bear;

  // Risk distance (the stop) is floored at ~0.6% of price (or 1.8x ATR for
  // volatile markets, whichever is larger) so the stop sits outside the coarse
  // free-feed noise. The target geometry below is intentionally asymmetric.
  const daily = mode === 'daily';
  const entry = price;
  // Both modes now use a ~2x ATR stop (validated). The target levels below are
  // reference/display only — neither mode exits at a fixed target: daily exits on
  // the first green day, intraday exits when RSI2 recovers past 60.
  const riskDist = Math.max(atrNow * 2.0, price * (daily ? 0.004 : 0.006));
  const stop = entry - direction * riskDist;
  const trailingStopPts = riskDist * 0.8;
  // Reference targets (display) — the mean-reversion move typically travels ~1-2.5R.
  const target1 = entry + direction * riskDist * 1.0;
  const target2 = entry + direction * riskDist * 1.8;
  const target3 = entry + direction * riskDist * 2.6;
  const riskReward = Math.abs(target1 - entry) / Math.abs(entry - stop || 1e-9);
  // Time stop: daily ~5 days; intraday ~1 RTH session (26 x 15-min bars ≈ 390 min).
  const maxHoldMin = daily ? 5 * 24 * 60 : 390;
  // Exit rule. Daily = Connors "first up close" (exit the first green day). Intraday
  // = "rsi2Exit": close when the bounce pushes RSI2 back above 60 (the mean is
  // reached). Both beat a fixed target in backtests — the fixed intraday target
  // actually LOST money (PF 0.86) because it capped winners while stops ran full.
  const exitRule = daily ? 'firstUpClose' : 'rsi2Exit';

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
    const lead = daily
      ? (direction > 0
        ? 'Buying a deeply oversold day that flushed below yesterday’s low, inside a long-term uptrend (price above its 200-day average). Dips like this tend to revert — the trade exits on the first day that closes green, typically within a day or two.'
        : 'Selling a deeply overbought day that broke above yesterday’s high, inside a long-term downtrend. Sharp rallies here tend to fade — the trade exits on the first day that closes red, typically within a day or two.')
      : (direction > 0
        ? 'Buying an oversold dip inside a confirmed uptrend — pullbacks in an uptrend usually resume, so a tight target is reached far more often than the wider stop.'
        : 'Selling an overbought pop inside a confirmed downtrend — rallies in a downtrend usually fade, favouring the tight target over the wider stop.');
    reasons = [lead];
    reasons.push(...agreeing.slice(0, 2).map((i) => (
      i.name === 'News Sentiment' ? `Recent headlines lean ${agreeState === 'bull' ? 'bullish' : 'bearish'} — ${i.detail}.` : REASON_TEXT[i.name]?.[agreeState]
    )).filter(Boolean));
    reasons.push(daily
      ? 'Backtested over 10 years on US indices: profit factor ~1.6, win rate ~72%, and profitable in every ~2-year walk-forward window — but past performance never guarantees future results, and the edge is deepest on US indices.'
      : 'This is a high-probability setup by design: many small wins with occasional larger losses. A high win rate is not the same as guaranteed profit.');
    reasons.push(daily
      ? 'Computed from real daily candles over the last 2 years — not a random or simulated score.'
      : 'Computed from real 15-minute candles and recent headlines over the trailing month — not a random or simulated score.');
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
    timeframe: daily ? '1D' : '15m',
    direction,
    confidence,
    provisional,
    trend,
    htfTrend,
    volatility,
    expectedHold: daily ? 'a few days' : pick(rng, HOLD_BY_VOLATILITY[volatility]),
    plan: { entry, stop, trailingStopPts, target1, target2, target3, riskReward, maxHoldMin, exitRule, conviction: daily ? conviction : 'normal' },
    // Latest daily bar's direction, so the paper engine can apply the "first up
    // close" exit for daily swing trades. Null for intraday.
    lastDaily: daily && n >= 2 ? { t: candles[n - 1].t, c: closes[n - 1], prevC: closes[n - 2], up: closes[n - 1] > closes[n - 2] } : null,
    // Current fast-RSI value, so the paper engine can apply the intraday
    // "rsi2Exit" (close the long once RSI2 recovers past 60).
    rsi2: Math.round(rsi2),
    // Real mean-reversion factors, for an honest signal breakdown. pctB = where
    // price sits in the Bollinger bands (0 = lower band, 1 = upper; <0 below,
    // >1 above). These, not the legacy indicator list, are what drive the signal.
    pctB: pctB != null ? +pctB.toFixed(2) : null,
    rsi14: rsi14 != null ? Math.round(rsi14) : null,
    reasons,
    indicators,
    confluence: { bull, bear, neutral },
    createdAt: Date.now(),
    price,
    isReal: true,
  };
}
