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
