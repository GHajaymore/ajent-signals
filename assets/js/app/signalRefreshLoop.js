// Signals are computed SERVER-SIDE (the Worker) and never on the client — the Ajent
// Pulse recipe stays off the wire. In production the Worker feed drives every market's
// signal. Without a backend there is no local engine, so markets are simply left in
// their "needs a connection" unavailable state instead of being computed here.
import { backendConfigured } from './backendApi.js';

const SIGNAL_STALE_MS = 20 * 60 * 1000;

function refreshAll(engine) {
  if (backendConfigured()) return; // the server owns every displayed signal
  for (const market of engine.markets) {
    if (market.hasServerSignal) continue;
    if (typeof market.markSignalUnavailable === 'function') market.markSignalUnavailable(SIGNAL_STALE_MS);
  }
}

export function startSignalRefreshLoop(engine, { intervalMs = 5 * 60 * 1000 } = {}) {
  refreshAll(engine);
  return setInterval(() => refreshAll(engine), intervalMs);
}
