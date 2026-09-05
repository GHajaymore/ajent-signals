// BOTH-WAYS mean-reversion engine — the validated experiment cells for symmetric
// assets (FX, commodities) where there is no structural up-drift, so the edge works
// LONG *and* SHORT (unlike the equity dip-buyer, which is long-only by design).
//
// Validated through the promotion gate (worker/test/promote.mjs, 2026-09-04): each
// cell cleared all 5 gates — pooled edge, walk-forward, out-of-sample, robust plateau,
// and a positive short side. Shipped as EXPERIMENT cells (backtest n is modest ~48–49):
// tracked live, clearly labelled unproven, graduating to 'live' only once the forward
// record confirms. Recipe stays server-side (this module never ships to the client).
import { rsi, sma, atr, roc } from './indicators.js';

// Per-cell config. FX = symmetric RSI(14) mean-reversion. Commodities = RSI(2) dip/pop
// gated by the SMA-50 trend side and a same-direction momentum (ROC) confirm.
export const BOTH_CELLS = {
  fx: { rsiP: 14, lower: 30, smaP: 50, exitMid: 50, stopAtr: 2.5, maxHoldMin: 60 * 24 * 10, rr: 1, useTrend: false, useRoc: false },
  commodity: { rsiP: 2, lower: 15, smaP: 50, rocP: 12, exitMid: 50, stopAtr: 2.5, maxHoldMin: 60 * 24 * 10, rr: 1, useTrend: true, useRoc: true },
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Compute the cell's long/short/no-trade signal on daily candles. `live` overrides the
// last close with the fresh quote. Mirrors the shape of computeSignal/computeTrend so
// the scheduler + payload machinery treat it identically.
export function computeBothMR(candles, live, cellKey) {
  const cfg = BOTH_CELLS[cellKey];
  if (!cfg) return { verdict: 'NO_TRADE' };
  const c = candles.slice();
  if (live != null && c.length) c[c.length - 1] = { ...c[c.length - 1], c: live };
  const cl = c.map((x) => x.c);
  const n = cl.length;
  const need = Math.max(cfg.smaP, cfg.rsiP + 5, cfg.rocP || 0) + 5;
  if (n < need) return { verdict: 'NO_TRADE' };
  const price = cl[n - 1];
  const r = rsi(cl, cfg.rsiP)[n - 1];
  const a = atr(c, 14)[n - 1];
  const s = sma(cl, cfg.smaP)[n - 1];
  if (r == null || a == null || !(a > 0) || s == null) return { verdict: 'NO_TRADE', trendMA: s, atr: a };
  const upper = 100 - cfg.lower;
  const rocV = cfg.useRoc ? roc(cl, cfg.rocP)[n - 1] : 0;
  const trendUp = price > s, trendDn = price < s;
  const longFilt = (!cfg.useTrend || trendUp) && (!cfg.useRoc || (rocV != null && rocV > 0));
  const shortFilt = (!cfg.useTrend || trendDn) && (!cfg.useRoc || (rocV != null && rocV < 0));

  let dir = 0;
  if (r < cfg.lower && longFilt) dir = 1;
  else if (r > upper && shortFilt) dir = -1;

  if (dir === 0) {
    // Proximity toward the nearer trigger, for the "watching" state on the board.
    const prox = r <= 50 ? clamp01((50 - r) / (50 - cfg.lower)) : clamp01((r - 50) / (upper - 50));
    return { verdict: 'NO_TRADE', price, atr: a, trendMA: s, htfTrend: trendUp ? 'up' : 'down', rsiMR: r, proximity: Math.round(prox * 100) };
  }

  const risk = Math.max(a * cfg.stopAtr, price * 0.004);
  const depth = dir > 0 ? (cfg.lower - r) / cfg.lower : (r - upper) / cfg.lower;
  const confidence = Math.round(72 + 16 * clamp01(depth + 0.2));
  return {
    verdict: dir > 0 ? 'BUY' : 'SELL', direction: dir, price, confidence, conviction: 'normal',
    // htfTrend reflects the trade side (a short is a bearish setup) so the client's
    // "Trend" label + long/short handling read correctly.
    htfTrend: dir > 0 ? 'up' : 'down', trendMA: s, atr: a, rsiMR: r,
    plan: { entry: price, stop: dir > 0 ? price - risk : price + risk, target1: dir > 0 ? price + risk * cfg.rr : price - risk * cfg.rr, risk, maxHoldMin: cfg.maxHoldMin },
  };
}

// Exit: the cell's RSI reverts through the mid (the mean is reached), the protective
// stop, or the time cap. `sig.rsiMR` is the fresh reading carried each tick.
export function bothMRShouldExit(sig, pos, price, now) {
  const short = pos.side === 'SHORT';
  if (short ? price >= pos.stop : price <= pos.stop) return 'stop';
  const r = sig && typeof sig.rsiMR === 'number' ? sig.rsiMR : null;
  if (r != null && (short ? r < 50 : r > 50)) return 'rsiRecover';
  if (now - pos.openedAt > (pos.maxHoldMin || 1) * 60000) return 'timeStop';
  return null;
}
