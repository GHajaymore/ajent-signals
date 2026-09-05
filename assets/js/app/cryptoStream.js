// Real-time crypto PRICES straight from Coinbase's public WebSocket — browser → Coinbase,
// with NO Worker and NO Cloudflare cost (so it never touches the free-tier scan/request
// budget). It overlays the live last-price on the crypto markets so BTC/ETH tick in real
// time for EVERY user (the server /live overlay is Pro-only, and the browser REST path is
// CORS-blocked in production — a WebSocket is neither). The SIGNAL/verdict and the paper
// record stay on the server's scan; only the displayed price streams.
//
// Why Coinbase, not Binance: Binance.com's stream is GEO-BLOCKED in the US (US users must
// use Binance.US), so it fails for a large share of users. Coinbase is US-accessible and
// global, and streams BTC-USD / ETH-USD directly (real USD — a better match than Binance's
// USDT pairs). Reconnects with backoff; silently no-ops if WebSockets are unavailable.
import { state } from './state.js';
import { fmtPrice } from './format.js';

// App symbol → Coinbase product id (real USD spot pairs, matching the app's markets).
const MAP = { BTC: 'BTC-USD', ETH: 'ETH-USD' };
const REV = {}; for (const [k, v] of Object.entries(MAP)) REV[v] = k;
const WS_URL = 'wss://ws-feed.exchange.coinbase.com';

let ws = null, backoff = 1000, stopped = false, repaintTimer = null;

function applyPrice(productId, price) {
  const appSym = REV[productId];
  if (!appSym || !(price > 0)) return false;
  const m = state.engine && typeof state.engine.get === 'function' ? state.engine.get(appSym) : null;
  // Only overlay a real, server-tracked market — never fabricate one from the stream.
  if (!m || !m.hasServerSignal || typeof m.applyServerPriceOverlay !== 'function') return false;
  // Keep the server's daily prevClose so the % change stays on the same basis as the
  // signal; pass no proxy (this IS the direct spot price).
  m.applyServerPriceOverlay(price, m.prevClose ?? null, Math.floor(Date.now() / 1000), null);
  patchPriceCells(appSym, price, m.decimals);
  return true;
}

// Tick the visible price cells for this symbol between the ~2s full repaints, with a brief
// green/red flash — so the streaming crypto price feels live. Throttled to ~1.4/s per
// symbol so it's smooth, not frantic. Price cells carry data-sym on their row + data-f=price.
const lastPatchAt = {};
function patchPriceCells(appSym, price, decimals) {
  if (typeof document === 'undefined') return;
  const now = Date.now();
  if (lastPatchAt[appSym] && now - lastPatchAt[appSym] < 700) return;
  lastPatchAt[appSym] = now;
  const cells = document.querySelectorAll(`[data-sym="${appSym}"] [data-f="price"]`);
  cells.forEach((el) => {
    const prev = el.dataset.tickpx ? parseFloat(el.dataset.tickpx) : null;
    el.dataset.tickpx = String(price);
    el.textContent = fmtPrice(price, decimals != null ? decimals : 2);
    if (prev != null && prev !== price) {
      const cls = price > prev ? 'tick-up' : 'tick-down';
      el.classList.remove('tick-up', 'tick-down');
      void el.offsetWidth; // restart the CSS animation
      el.classList.add(cls);
    }
  });
}

function connect(onTick) {
  if (stopped || typeof WebSocket === 'undefined') return;
  let sock;
  try { sock = new WebSocket(WS_URL); }
  catch (e) { return schedule(onTick); }
  ws = sock;
  sock.onopen = () => {
    backoff = 1000;
    try { sock.send(JSON.stringify({ type: 'subscribe', product_ids: Object.values(MAP), channels: ['ticker'] })); }
    catch (e) { /* the close/reconnect path will retry */ }
  };
  sock.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data);
      if (d && d.type === 'ticker' && d.product_id && d.price && applyPrice(d.product_id, parseFloat(d.price))) repaint(onTick);
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

// Coalesce repaints: the ticker channel streams several frames/sec, so repaint at most
// ~every 2s to stay smooth on low-end phones (the price data itself updates every frame).
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
