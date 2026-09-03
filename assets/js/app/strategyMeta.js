// Client-side view of the strategy's parameters — the ONE place the app reads
// "what is the strategy?" from. Defaults mirror the worker (worker/src/meta.js);
// when the backend is connected the live values from GET /signals (`strategy`)
// override them via setStrategyMeta(), so the UI and the book-profit / stop logic
// always match whatever the server actually runs. Change the strategy on the
// server and the whole app follows — no hardcoded RSI/ATR numbers scattered around.
const DEFAULT = {
  key: 'swing',
  name: 'Ajent Pulse',
  proven: true,
  label: 'Swing · daily Connors RSI-2',
  indicator: 'RSI-2',
  indicatorPeriod: 2,
  direction: 'long',
  entryBelow: 15,
  exitAbove: 65,
  deepBelow: 5,
  stopAtrMult: 2,
  trendSma: 200,
};
let live = null;
export function setStrategyMeta(m) {
  if (m && typeof m === 'object' && (m.exitAbove != null || m.entryBelow != null)) live = m;
}
export function getStrategy() { return { ...DEFAULT, ...(live || {}) }; }
// The evolving dials the Ajent Strategy has learned globally (or null before sync).
export function getAdaptive() { return (live && live.adaptive) || null; }

// GENERALIZED phrases — describe the behaviour, never the proprietary recipe
// (no indicator names, thresholds or stop multiples in user-facing copy).
export function entryPhrase() { return 'deeply oversold in an uptrend'; }
export function exitPhrase() { return 'reverts to the mean'; }
export function stopPhrase() { return 'volatility-based stop'; }
