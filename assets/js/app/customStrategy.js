// "Your strategy" — a user-configurable indicator strategy, evaluated client-side
// on the same real daily-close history the app already holds (market.history). It
// generates the USER's own signals so they can compare their idea against the proven
// Ajent Pulse. It is explicitly THEIR experiment — unproven, never presented as
// validated — while Ajent Pulse's exact recipe stays proprietary and untouched.
import { rsi, sma } from './indicators.js';

const LS = 'ajent_customstrat_v1';
export const CUSTOM_DEFAULT = { rsiPeriod: 2, entryBelow: 10, exitAbove: 65, useTrend: true, trendSma: 50 };

// Bounds keep the config in ranges the ~96-bar client history can actually evaluate.
export const CUSTOM_BOUNDS = {
  rsiPeriod: { min: 2, max: 14, step: 1 },
  entryBelow: { min: 5, max: 35, step: 1 },
  exitAbove: { min: 55, max: 90, step: 1 },
  trendSma: { options: [20, 50] },
};

export function getCustomConfig() {
  try { const c = JSON.parse(localStorage.getItem(LS)); if (c && typeof c === 'object') return { ...CUSTOM_DEFAULT, ...c }; } catch (e) { /* ignore */ }
  return { ...CUSTOM_DEFAULT };
}
export function setCustomConfig(cfg) { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) { /* ignore */ } }
export function resetCustomConfig() { try { localStorage.removeItem(LS); } catch (e) { /* ignore */ } }

// Evaluate the user's rule on one market's recent closes. Long-only, mirroring the
// proven engine's shape: buy an oversold RSI while (optionally) in an uptrend.
export function evalCustom(market, cfg) {
  const h = market && market.history;
  const need = (cfg.useTrend ? cfg.trendSma : cfg.rsiPeriod) + 5;
  if (!Array.isArray(h) || h.length < need) return { ready: false };
  const rArr = rsi(h, cfg.rsiPeriod);
  const r = rArr[rArr.length - 1];
  const price = market.price || h[h.length - 1];
  let trendOk = true, trendMA = null;
  if (cfg.useTrend) { const sArr = sma(h, cfg.trendSma); trendMA = sArr[sArr.length - 1]; trendOk = trendMA != null && price > trendMA; }
  if (r == null) return { ready: false };
  const fires = r < cfg.entryBelow && trendOk;
  // Confidence is derived from the USER's OWN configured thresholds — never a fixed
  // number. `depth` = how far RSI has pushed past their entry line (a stronger take on
  // their setup); a lift is added when their trend filter confirms. Bounded 70..92 to
  // match the engine's scale so both boards read on one axis. `proximity` (for names
  // not yet firing) is how close RSI is to their entry line, 0..100.
  const span = Math.max(1, cfg.entryBelow);
  const depth = Math.max(0, Math.min(1, (cfg.entryBelow - r) / span));
  const trendLift = (cfg.useTrend && trendOk) ? 0.15 : 0;
  const strength = Math.min(1, depth + trendLift);
  const confidence = Math.round(70 + strength * 22);
  const proximity = r <= cfg.entryBelow ? 100 : Math.max(0, Math.round(100 * cfg.entryBelow / r));
  return { ready: true, rsi: Math.round(r), price, trendOk, trendMA, fires, confidence, proximity };
}
