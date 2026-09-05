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
