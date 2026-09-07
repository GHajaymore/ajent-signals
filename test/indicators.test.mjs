// Client-side indicator tests (Node's built-in runner — zero dependencies).
//   node --test test/
// The Strategy Builder and the signal displays all compute from assets/js/app/indicators.js,
// so a bug there shows users a wrong signal. These verify the math is correct, produces sane
// ranges, and — importantly — that the CLIENT indicators still agree with the validated
// WORKER indicators (worker/src/indicators.js), which the lab is tested against. If the two
// implementations drift, this fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../assets/js/app/indicators.js';
import * as W from '../worker/src/indicators.js';

// Deterministic candle series (no Math.random — an oscillating uptrend with real H/L/C).
function series(n = 220) {
  const out = [];
  let c = 100;
  for (let i = 0; i < n; i++) {
    c = 100 + 18 * Math.sin(i / 6) + i * 0.12;            // wave + gentle drift
    const rng = 1.4 + 0.9 * Math.abs(Math.sin(i / 3));    // deterministic "volatility"
    out.push({ t: i * 86400000, o: c - rng * 0.3, h: c + rng, l: c - rng, c });
  }
  return out;
}
const CANDLES = series();
const CLOSES = CANDLES.map((x) => x.c);
const nonNull = (a) => a.filter((v) => v != null);

test('sma — exact values and length', () => {
  assert.deepEqual(C.sma([2, 4, 6, 8, 10], 2), [null, 3, 5, 7, 9]);
  assert.equal(C.sma(CLOSES, 20).length, CLOSES.length);
  // last SMA(5) equals the mean of the last 5 closes
  const last5 = CLOSES.slice(-5).reduce((a, b) => a + b, 0) / 5;
  assert.ok(Math.abs(C.sma(CLOSES, 5).at(-1) - last5) < 1e-9);
});

test('ema — seeds on first value, stays within data range', () => {
  const e = C.ema(CLOSES, 12);
  assert.equal(e[0], CLOSES[0]);
  const lo = Math.min(...CLOSES), hi = Math.max(...CLOSES);
  for (const v of nonNull(e)) assert.ok(v >= lo - 1e-6 && v <= hi + 1e-6);
});

test('rsi — always within [0,100]', () => {
  for (const v of nonNull(C.rsi(CLOSES, 14))) assert.ok(v >= 0 && v <= 100, `rsi ${v} out of range`);
  for (const v of nonNull(C.rsi(CLOSES, 2))) assert.ok(v >= 0 && v <= 100);
});

test('atr — positive once seeded, correct length', () => {
  const a = C.atr(CANDLES, 14);
  assert.equal(a.length, CANDLES.length);
  for (const v of nonNull(a)) assert.ok(v > 0, 'atr should be > 0');
});

test('adx — {adx,plusDI,minusDI} all in [0,100]', () => {
  const { adx, plusDI, minusDI } = C.adx(CANDLES, 14);
  assert.equal(adx.length, CANDLES.length);
  for (const v of nonNull(adx)) assert.ok(v >= 0 && v <= 100, `adx ${v} out of range`);
  for (const v of nonNull(plusDI)) assert.ok(v >= 0 && v <= 100);
  for (const v of nonNull(minusDI)) assert.ok(v >= 0 && v <= 100);
});

test('macd — histogram equals line minus signal', () => {
  const { macdLine, signalLine, histogram } = C.macd(CLOSES, 12, 26, 9);
  for (let i = 30; i < CLOSES.length; i++) {
    if (macdLine[i] == null || signalLine[i] == null) continue;
    assert.ok(Math.abs(histogram[i] - (macdLine[i] - signalLine[i])) < 1e-9);
  }
});

test('bollingerBands — upper >= mid >= lower', () => {
  const { upper, mid, lower } = C.bollingerBands(CLOSES, 20, 2);
  for (let i = 20; i < CLOSES.length; i++) {
    if (mid[i] == null) continue;
    assert.ok(upper[i] >= mid[i] && mid[i] >= lower[i]);
  }
});

// --- Client <-> worker parity: the two implementations must agree, or the Builder's math
// has drifted from the lab-validated engine. Compare the shared functions on identical data.
const approxEqualArr = (a, b, tol, from) => {
  assert.equal(a.length, b.length);
  for (let i = from; i < a.length; i++) {
    if (a[i] == null || b[i] == null) continue;
    assert.ok(Math.abs(a[i] - b[i]) < tol, `index ${i}: client ${a[i]} vs worker ${b[i]}`);
  }
};

test('parity — client SMA/EMA/RSI match the worker exactly', () => {
  approxEqualArr(C.sma(CLOSES, 20), W.sma(CLOSES, 20), 1e-9, 20);
  approxEqualArr(C.ema(CLOSES, 12), W.ema(CLOSES, 12), 1e-6, 12);
  approxEqualArr(C.rsi(CLOSES, 14), W.rsi(CLOSES, 14), 1e-6, 15);
});

// KNOWN, INTENTIONAL divergence: client ATR uses Wilder smoothing (the standard ATR);
// worker ATR uses a simple moving average of TR — the smoothing the daily recipe was
// backtested/validated with, so it must NOT change (that would shift every stop and
// invalidate the backtests). The client's atr() is only used by supertrend (not in the
// closes-only builder) and display, so the difference is low-impact. They track closely;
// this pins that they stay in the same ballpark (catches a gross error) without asserting
// exact equality. If you ever unify them, re-validate the recipe first.
test('ATR — client (Wilder) and worker (SMA-of-TR) differ by design but track closely', () => {
  const c = nonNull(C.atr(CANDLES, 14)), w = nonNull(W.atr(CANDLES, 14));
  assert.ok(c.length && w.length);
  const cl = c.at(-1), wl = w.at(-1);
  assert.notEqual(cl, wl, 'expected the two smoothings to differ (if identical, this note is stale)');
  assert.ok(Math.abs(cl - wl) / wl < 0.2, `client/worker ATR drifted too far apart: ${cl} vs ${wl}`);
});

test('parity — client ADX matches the worker (the regime/filter math)', () => {
  const c = C.adx(CANDLES, 14), w = W.adx(CANDLES, 14);
  approxEqualArr(c.adx, w.adx, 1e-6, 40);
  approxEqualArr(c.plusDI, w.plusDI, 1e-6, 20);
  approxEqualArr(c.minusDI, w.minusDI, 1e-6, 20);
});
