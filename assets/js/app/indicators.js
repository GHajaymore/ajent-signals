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

// ADX / DMI (Wilder) — measures TREND STRENGTH (not direction) plus the
// directional +DI/-DI. ADX >= ~20-25 means a real trend is present; below that
// the market is ranging/choppy. This is the classic institutional trend filter.
export function adx(candles, period = 14) {
  const n = candles.length;
  const plusDM = new Array(n).fill(0), minusDM = new Array(n).fill(0), tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = candles[i].h - candles[i - 1].h;
    const down = candles[i - 1].l - candles[i].l;
    plusDM[i] = (up > down && up > 0) ? up : 0;
    minusDM[i] = (down > up && down > 0) ? down : 0;
    const pc = candles[i - 1].c;
    tr[i] = Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - pc), Math.abs(candles[i].l - pc));
  }
  const wilder = (arr) => {
    const out = new Array(n).fill(null);
    if (n <= period) return out;
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += arr[i];
    out[period] = sum;
    for (let i = period + 1; i < n; i++) out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    return out;
  };
  const trS = wilder(tr), pdmS = wilder(plusDM), mdmS = wilder(minusDM);
  const plusDI = new Array(n).fill(null), minusDI = new Array(n).fill(null), dx = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    if (!trS[i]) continue;
    plusDI[i] = 100 * (pdmS[i] / trS[i]);
    minusDI[i] = 100 * (mdmS[i] / trS[i]);
    const s = plusDI[i] + minusDI[i];
    dx[i] = s ? 100 * Math.abs(plusDI[i] - minusDI[i]) / s : 0;
  }
  const adxArr = new Array(n).fill(null);
  const start = period * 2;
  if (start < n) {
    let sum = 0, count = 0;
    for (let i = period; i < start; i++) { if (dx[i] != null) { sum += dx[i]; count++; } }
    if (count) {
      adxArr[start - 1] = sum / count;
      for (let i = start; i < n; i++) {
        if (dx[i] == null || adxArr[i - 1] == null) continue;
        adxArr[i] = (adxArr[i - 1] * (period - 1) + dx[i]) / period;
      }
    }
  }
  return { adx: adxArr, plusDI, minusDI };
}

// On-Balance Volume — a running total that adds the bar's volume on up-closes
// and subtracts it on down-closes. A rising OBV means volume is confirming the
// move (accumulation); falling OBV means distribution. Adds a volume dimension
// the price-only indicators can't see.
export function obv(candles) {
  const out = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const v = candles[i].v || 0;
    if (candles[i].c > candles[i - 1].c) out[i] = out[i - 1] + v;
    else if (candles[i].c < candles[i - 1].c) out[i] = out[i - 1] - v;
    else out[i] = out[i - 1];
  }
  return out;
}

// CCI (Commodity Channel Index) — designed for commodities/futures; measures
// how far price has deviated from its statistical mean. > +100 strong up,
// < -100 strong down.
export function cci(candles, period = 20) {
  const n = candles.length;
  const tp = candles.map((c) => (c.h + c.l + c.c) / 3);
  const out = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tp[j];
    const mean = sum / period;
    let md = 0;
    for (let j = i - period + 1; j <= i; j++) md += Math.abs(tp[j] - mean);
    md /= period;
    out[i] = md === 0 ? 0 : (tp[i] - mean) / (0.015 * md);
  }
  return out;
}

// Ichimoku (simplified to the tradable signal): Tenkan (9) & Kijun (26)
// midpoints. Price above Kijun with Tenkan above Kijun = bullish structure.
export function ichimoku(candles, conv = 9, base = 26) {
  const n = candles.length;
  const midpoint = (from, to) => {
    let hi = -Infinity, lo = Infinity;
    for (let j = from; j <= to; j++) { if (candles[j].h > hi) hi = candles[j].h; if (candles[j].l < lo) lo = candles[j].l; }
    return (hi + lo) / 2;
  };
  const tenkan = new Array(n).fill(null), kijun = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i >= conv - 1) tenkan[i] = midpoint(i - conv + 1, i);
    if (i >= base - 1) kijun[i] = midpoint(i - base + 1, i);
  }
  return { tenkan, kijun };
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
