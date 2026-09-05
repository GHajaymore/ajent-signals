// Real-time crypto PRICES straight from Binance's public WebSocket — browser → Binance,
// with NO Worker and NO Cloudflare cost (so it never touches the free-tier scan/request
// budget). It overlays the live last-price on the crypto markets so BTC/ETH tick in real
// time for EVERY user (the server /live overlay is Pro-only, and the browser REST path is
// CORS-blocked in production — a WebSocket is neither). The SIGNAL/verdict and the paper
// record stay on the server's scan; only the displayed price streams. Reconnects with
// backoff; silently no-ops if WebSockets are unavailable.
import { state } from './state.js';

// App symbol → Binance stream symbol. USDT pairs track USD closely enough for display.
const MAP = { BTC: 'btcusdt', ETH: 'ethusdt' };
const REV = {}; for (const [k, v] of Object.entries(MAP)) REV[v] = k;

let ws = null, backoff = 1000, stopped = false, repaintTimer = null;

function applyPrice(streamSym, price) {
  const appSym = REV[streamSym];
  if (!appSym || !(price > 0)) return false;
  const m = state.engine && typeof state.engine.get === 'function' ? state.engine.get(appSym) : null;
  // Only overlay a real, server-tracked market — never fabricate one from the stream.
  if (!m || !m.hasServerSignal || typeof m.applyServerPriceOverlay !== 'function') return false;
  // Keep the server's daily prevClose so the % change stays on the same basis as the
  // signal; pass no proxy (this IS the direct spot price).
  m.applyServerPriceOverlay(price, m.prevClose ?? null, Math.floor(Date.now() / 1000), null);
  return true;
}

function connect(onTick) {
  if (stopped || typeof WebSocket === 'undefined') return;
  const streams = Object.values(MAP).map((s) => s + '@miniTicker').join('/');
  let sock;
  try { sock = new WebSocket('wss://stream.binance.com:9443/stream?streams=' + streams); }
  catch (e) { return schedule(onTick); }
  ws = sock;
  sock.onopen = () => { backoff = 1000; };
  sock.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      const d = (msg && msg.data) || msg; // combined-stream frames wrap the payload in .data
      if (d && d.s && d.c && applyPrice(String(d.s).toLowerCase(), parseFloat(d.c))) repaint(onTick);
    } catch (e) { /* ignore a malformed frame */ }
  };
  sock.onclose = () => { if (ws === sock) schedule(onTick); };
  sock.onerror = () => { try { sock.close(); } catch (e) { /* ignore */ } };
}

function schedule(onTick) {
  if (stopped) return;
  setTimeout(() => connect(onTick), backoff);
  backoff = Math.min(backoff * 2, 30000); // exponential backoff up to 30s
}

// Coalesce repaints: miniTicker streams ~1/s per symbol, so repaint at most ~every 2s to
// stay smooth on low-end phones (the price data itself updates on every frame).
function repaint(onTick) {
  if (!onTick || repaintTimer) return;
  repaintTimer = setTimeout(() => { repaintTimer = null; try { onTick(); } catch (e) { /* ignore */ } }, 2000);
}

export function startCryptoStream(onTick) { stopped = false; connect(onTick); }
export function stopCryptoStream() {
  stopped = true;
  if (repaintTimer) { clearTimeout(repaintTimer); repaintTimer = null; }
  try { ws && ws.close(); } catch (e) { /* ignore */ }
  ws = null;
}
