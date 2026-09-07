// Same math as the client + AWS engine, ESM for Cloudflare Workers.
export function sma(a, p) {
  const o = Array(a.length).fill(null); let s = 0;
  for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= p) s -= a[i - p]; if (i >= p - 1) o[i] = s / p; }
  return o;
}
export function rsi(cl, p) {
  const o = Array(cl.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= p) { g += up; l += dn; if (i === p) { g /= p; l /= p; o[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); } }
    else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; o[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); }
  }
  return o;
}
export function atr(c, p) {
  const tr = Array(c.length).fill(null);
  for (let i = 1; i < c.length; i++) { const h = c[i].h, lo = c[i].l, pc = c[i - 1].c; tr[i] = Math.max(h - lo, Math.abs(h - pc), Math.abs(lo - pc)); }
  const o = Array(c.length).fill(null); let s = 0, n = 0;
  for (let i = 1; i < c.length; i++) { s += tr[i]; n++; if (n > p) { s -= tr[i - p]; n--; } if (n === p) o[i] = s / p; }
  return o;
}
export function stdev(a, p) {
  const o = Array(a.length).fill(null);
  for (let i = p - 1; i < a.length; i++) { let m = 0; for (let k = 0; k < p; k++) m += a[i - k]; m /= p; let v = 0; for (let k = 0; k < p; k++) { const d = a[i - k] - m; v += d * d; } o[i] = Math.sqrt(v / p); }
  return o;
}
// Wilder's ADX with directional indicators → {adx, plusDI, minusDI}, aligned to candle
// index. A trend-STRENGTH gauge (0-100): low ADX = ranging/choppy, high ADX = a strong
// trend (up if +DI leads -DI, down if -DI leads). OHLC-based, like atr. Lab / regime use
// — this is the trend-strength measure the recipe lacked; NOT in the client builder.
export function adx(c, p = 14) {
  const n = c.length;
  const plusDI = Array(n).fill(null), minusDI = Array(n).fill(null), adxArr = Array(n).fill(null);
  if (n < 2) return { adx: adxArr, plusDI, minusDI };
  const tr = Array(n).fill(0), pDM = Array(n).fill(0), mDM = Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = c[i].h - c[i - 1].h, dn = c[i - 1].l - c[i].l;
    pDM[i] = (up > dn && up > 0) ? up : 0;
    mDM[i] = (dn > up && dn > 0) ? dn : 0;
    tr[i] = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  }
  // Wilder-smooth TR/+DM/-DM (seed = sum of first p, then s = s - s/p + x), then DX.
  let sTR = 0, sP = 0, sM = 0;
  const dx = Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    if (i <= p) { sTR += tr[i]; sP += pDM[i]; sM += mDM[i]; if (i < p) continue; }
    else { sTR = sTR - sTR / p + tr[i]; sP = sP - sP / p + pDM[i]; sM = sM - sM / p + mDM[i]; }
    const pdi = sTR > 0 ? 100 * sP / sTR : 0, mdi = sTR > 0 ? 100 * sM / sTR : 0;
    plusDI[i] = pdi; minusDI[i] = mdi;
    const sum = pdi + mdi;
    dx[i] = sum > 0 ? 100 * Math.abs(pdi - mdi) / sum : 0;
  }
  // ADX = Wilder-smoothed DX over p (first value = mean of the first p DX readings).
  let adxVal = null, cnt = 0, dxSum = 0;
  for (let i = p; i < n; i++) {
    if (dx[i] == null) continue;
    if (adxVal == null) { dxSum += dx[i]; if (++cnt === p) { adxVal = dxSum / p; adxArr[i] = adxVal; } }
    else { adxVal = (adxVal * (p - 1) + dx[i]) / p; adxArr[i] = adxVal; }
  }
  return { adx: adxArr, plusDI, minusDI };
}

// --- The user-facing Strategy-Builder palette, mirrored server-side so the lab can
// test the SAME indicator combinations users can build (assets/js/app/customStrategy.js).
// Generic public indicators — NOT the proprietary recipe. Close-based, matching the
// client math so a combo validated here is one a user could actually replicate.
export function ema(a, p) {
  const o = Array(a.length).fill(null); const k = 2 / (p + 1); let e = null;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v == null) continue; e = e == null ? v : v * k + e * (1 - k); o[i] = e; }
  return o;
}
// MACD line / signal / histogram (defaults 12/26/9).
export function macd(cl, fast = 12, slow = 26, sig = 9) {
  const ef = ema(cl, fast), es = ema(cl, slow);
  const macdLine = cl.map((_, i) => (ef[i] == null || es[i] == null ? null : ef[i] - es[i]));
  const signalLine = ema(macdLine.map((v) => (v == null ? 0 : v)), sig);
  const histogram = macdLine.map((v, i) => (v == null || signalLine[i] == null ? null : v - signalLine[i]));
  return { macdLine, signalLine, histogram };
}
// Bollinger Bands (period, mult σ) → {upper, mid, lower}.
export function bollinger(cl, p = 20, mult = 2) {
  const mid = sma(cl, p), sd = stdev(cl, p);
  const upper = cl.map((_, i) => (mid[i] == null ? null : mid[i] + mult * sd[i]));
  const lower = cl.map((_, i) => (mid[i] == null ? null : mid[i] - mult * sd[i]));
  return { upper, mid, lower };
}
// Fast %K stochastic over closes (matches the client builder, which has closes only).
export function stochastic(cl, p = 14) {
  const o = Array(cl.length).fill(null);
  for (let i = p - 1; i < cl.length; i++) { let lo = Infinity, hi = -Infinity; for (let k = 0; k < p; k++) { const v = cl[i - k]; if (v < lo) lo = v; if (v > hi) hi = v; } o[i] = hi === lo ? 50 : ((cl[i] - lo) / (hi - lo)) * 100; }
  return o;
}
// Rate of change (momentum) over p bars, in percent.
export function roc(cl, p = 12) {
  const o = Array(cl.length).fill(null);
  for (let i = p; i < cl.length; i++) { const past = cl[i - p]; o[i] = past > 0 ? (cl[i] / past - 1) * 100 : null; }
  return o;
}
