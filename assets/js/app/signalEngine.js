// The Ajent Pulse recipe (indicators, thresholds, stops) is proprietary and computed
// SERVER-SIDE only — it is never shipped to the browser. This module used to hold a
// full client-side engine; that has been removed so the exact recipe can't be read out
// of the client bundle. In production the app shows only the Worker's signals. In a
// no-backend / dev build there is simply no local engine, so markets stay in their
// "needs a connection" state rather than being computed here.
export function computeRealSignal() {
  return { verdict: 'NO_TRADE', confidence: 0, plan: null, reasons: [], noLocalEngine: true, source: 'none' };
}
