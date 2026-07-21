// Real technical-analysis math, computed from actual OHLC candle arrays.
// Every function here is a standard, textbook formula — no randomness, no mock data.
// candles: [{ t, o, h, l, c, v }, ...] oldest -> newest, nulls already filtered out.

export function ema(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) { prev = values[i]; } else { prev = values[i] * k + prev * (1 - k); }
    out[i] = prev;
  }
  return out;
}

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function stdDev(values, period) {
  const means = sma(values, period);
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - means[i]) ** 2;
    out[i] = Math.sqrt(sq / period);
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0), loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) out[i] = rsiFromAvg(avgGain, avgLoss);
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = rsiFromAvg(avgGain, avgLoss);
    }
  }
  function rsiFromAvg(g, l) { if (l === 0) return 100; return 100 - 100 / (1 + g / l); }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = ema(macdLine, signalPeriod);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

export function atr(candles, period = 14) {
  const trs = candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const pc = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
  });
  const out = new Array(trs.length).fill(null);
  let prev = null;
  for (let i = 0; i < trs.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      prev = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      prev = (prev * (period - 1) + trs[i]) / period;
    }
    out[i] = prev;
  }
  return out;
}

export function bollingerBands(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const sd = stdDev(closes, period);
  const upper = closes.map((_, i) => (mid[i] === null ? null : mid[i] + mult * sd[i]));
  const lower = closes.map((_, i) => (mid[i] === null ? null : mid[i] - mult * sd[i]));
  return { upper, mid, lower };
}

// Session VWAP — resets at each new calendar day found in the candle timestamps.
export function sessionVwap(candles) {
  const out = new Array(candles.length).fill(null);
  let cumPV = 0, cumV = 0, lastDay = null;
  for (let i = 0; i < candles.length; i++) {
    const day = new Date(candles[i].t * 1000).toISOString().slice(0, 10);
    if (day !== lastDay) { cumPV = 0; cumV = 0; lastDay = day; }
    const typical = (candles[i].h + candles[i].l + candles[i].c) / 3;
    const vol = candles[i].v || 1;
    cumPV += typical * vol;
    cumV += vol;
    out[i] = cumV > 0 ? cumPV / cumV : candles[i].c;
  }
  return out;
}

export function supertrend(candles, period = 10, multiplier = 3) {
  const atrVals = atr(candles, period);
  const dir = new Array(candles.length).fill(null);
  const line = new Array(candles.length).fill(null);
  let upperBand = null, lowerBand = null, trend = 1;
  for (let i = 0; i < candles.length; i++) {
    if (atrVals[i] === null) continue;
    const mid = (candles[i].h + candles[i].l) / 2;
    const basicUpper = mid + multiplier * atrVals[i];
    const basicLower = mid - multiplier * atrVals[i];
    upperBand = upperBand === null ? basicUpper : (basicUpper < upperBand || candles[i - 1].c > upperBand ? basicUpper : upperBand);
    lowerBand = lowerBand === null ? basicLower : (basicLower > lowerBand || candles[i - 1].c < lowerBand ? basicLower : lowerBand);
    if (candles[i].c > upperBand) trend = 1;
    else if (candles[i].c < lowerBand) trend = -1;
    dir[i] = trend;
    line[i] = trend === 1 ? lowerBand : upperBand;
  }
  return { dir, line };
}

// Simple swing-based market structure: compares the two most recent swing highs
// and swing lows (fractal pivots) to call a break of structure up/down/ranging.
export function marketStructure(candles, lookback = 3) {
  const highs = [], lows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const isSwingHigh = candles.slice(i - lookback, i + lookback + 1).every((c, j) => j === lookback || c.h <= candles[i].h);
    const isSwingLow = candles.slice(i - lookback, i + lookback + 1).every((c, j) => j === lookback || c.l >= candles[i].l);
    if (isSwingHigh) highs.push({ i, v: candles[i].h });
    if (isSwingLow) lows.push({ i, v: candles[i].l });
  }
  if (highs.length < 2 || lows.length < 2) return 'neutral';
  const lastHigh = highs[highs.length - 1], prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1], prevLow = lows[lows.length - 2];
  const higherHigh = lastHigh.v > prevHigh.v;
  const higherLow = lastLow.v > prevLow.v;
  const lowerHigh = lastHigh.v < prevHigh.v;
  const lowerLow = lastLow.v < prevLow.v;
  if (higherHigh && higherLow) return 'bull';
  if (lowerHigh && lowerLow) return 'bear';
  return 'neutral';
}
