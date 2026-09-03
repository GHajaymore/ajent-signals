// Client-side view of the strategy's parameters — the ONE place the app reads
// "what is the strategy?" from. Defaults mirror the worker (worker/src/meta.js);
// when the backend is connected the live values from GET /signals (`strategy`)
// override them via setStrategyMeta(), so the UI and the book-profit / stop logic
// always match whatever the server actually runs. Change the strategy on the
// server and the whole app follows — no hardcoded RSI/ATR numbers scattered around.
const DEFAULT = {
  key: 'swing',
  name: 'Ajent Strategy',
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

// Handy pre-formatted phrases so copy stays in sync too. `exitAbove` can be
// overridden per-signal (plan.exitAbove) if a market ever differs.
export function entryPhrase() { const s = getStrategy(); return `${s.indicator} below ${s.entryBelow}`; }
export function exitPhrase(exitAbove) { const s = getStrategy(); return `${s.indicator} recovers above ${exitAbove ?? s.exitAbove}`; }
export function stopPhrase() { const s = getStrategy(); return `${s.stopAtrMult}× ATR`; }
