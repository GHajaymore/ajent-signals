// Client-side view of the strategy's IDENTITY only — name, whether it's proven, its
// direction. The proprietary recipe (indicators, thresholds, stop multiples, MA lengths)
// is NEVER shipped to the client: signals and the book-profit / stop calls are computed
// server-side and arrive as derived results. Keep this free of any recipe number.
const DEFAULT = {
  key: 'swing',
  name: 'Ajent Pulse',
  proven: true,
  label: 'Swing · daily, long-only',
  direction: 'long',
};
let live = null;
export function setStrategyMeta(m) {
  if (m && typeof m === 'object' && (m.name || m.key || m.adaptiveState)) live = m;
}
export function getStrategy() { return { ...DEFAULT, ...(live || {}) }; }
// The evolving dials the Ajent Strategy has learned globally (or null before sync).
export function getAdaptive() { return (live && live.adaptiveState) || null; }

// GENERALIZED phrases — describe the behaviour, never the proprietary recipe
// (no indicator names, thresholds or stop multiples in user-facing copy).
export function entryPhrase() { return 'deeply oversold in an uptrend'; }
export function exitPhrase() { return 'reverts to the mean'; }
export function stopPhrase() { return 'volatility-based stop'; }
