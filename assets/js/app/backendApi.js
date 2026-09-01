// Optional backend connection. When `window.__AJENT_API` (set in app/index.html)
// or localStorage 'ajent_api' points at the deployed backend, the app reads the
// 24/7 server-side paper-trading record from it. When it's empty, the app runs
// exactly as before — fully client-side. Nothing here throws on a missing/bad
// endpoint; callers get null and fall back.
import { isPro as isProNative } from './iap.js';

function base() {
  try {
    const w = (typeof window !== 'undefined' && window.__AJENT_API) || '';
    const ls = localStorage.getItem('ajent_api') || '';
    return (w || ls || '').replace(/\/+$/, '');
  } catch (e) { return ''; }
}

export function backendConfigured() { return !!base(); }

// Pro token — issued by the payment flow after a verified purchase, stored here.
function proToken() {
  try { return (typeof window !== 'undefined' && window.__AJENT_PRO_TOKEN) || localStorage.getItem('ajent_pro_token') || ''; } catch (e) { return ''; }
}
export function hasProToken() { return !!proToken(); }

// --- Free trial -------------------------------------------------------------
// New users get the full experience free for TRIAL_DAYS, then drop to the Free
// tier (limited markets + extra-delayed signals) unless they go Pro. The clock
// starts on first launch and is stored locally.
const TRIAL_DAYS = 30;
function trialStartMs() {
  try {
    let t = localStorage.getItem('ajent_trial_start');
    if (!t) { t = String(Date.now()); localStorage.setItem('ajent_trial_start', t); }
    return Number(t) || Date.now();
  } catch (e) { return Date.now(); }
}
export function trialDaysLeft() {
  return Math.max(0, Math.ceil((TRIAL_DAYS * 86400000 - (Date.now() - trialStartMs())) / 86400000));
}
export function trialActive() { return trialDaysLeft() > 0; }

// Entitled to Pro features (all markets, real-time data, Active, alerts, export)?
// True during the free trial, for a native purchase, a valid Pro token, or the
// early-access override. Client-side gate only — the backend enforces its own.
export function isEntitled() {
  try { if (typeof window !== 'undefined' && window.__AJENT_UNLOCK_ALL) return true; } catch (e) { /* ignore */ }
  if (trialActive()) return true;
  return isProNative() || hasProToken();
}
// Distinguish a paying/entitled user from a trial user (both get full access, but
// the UI messages differ — trial shows a countdown, Pro shows "Pro").
export function isPaid() {
  try { if (typeof window !== 'undefined' && window.__AJENT_UNLOCK_ALL) return true; } catch (e) { /* ignore */ }
  return isProNative() || hasProToken();
}

async function getJson(pathname) {
  const b = base();
  if (!b) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const headers = {};
    const tok = proToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
    const r = await fetch(b + pathname, { cache: 'no-store', signal: ctrl.signal, headers });
    clearTimeout(t);
    if (!r.ok) return null; // 402 (not Pro) or any error -> fall back to client-side
    return await r.json();
  } catch (e) { clearTimeout(t); return null; }
}

// { open:[], closed:[], summary:{} } or null if unavailable.
export function fetchServerTrades() { return getJson('/trades'); }
// { updatedAt, signals:[] } or null.
export function fetchServerSignals() { return getJson('/signals'); }
// Real-time crypto quotes fetched server-side (no browser CORS). { quotes:{BTC:{price,prevClose,at}}, at } or null.
export function fetchLiveQuotes() { return getJson('/live'); }
// Market news fetched server-side. { news:[{title,publisher,link,time}], source } or null.
export function fetchNews() { return getJson('/news'); }
// Real OHLC candles for a market's chart, fetched server-side (no browser CORS).
// `appSymbol` is the app's symbol (ES/RTY/BTC…) — the Worker maps it to the same
// instrument the strategy trades. Returns an array of {t,o,h,l,c} or null.
export async function fetchServerCandles(appSymbol, interval, range) {
  const data = await getJson(`/candles?symbol=${encodeURIComponent(appSymbol)}&interval=${interval}&range=${range}`);
  return data && Array.isArray(data.candles) ? data.candles : null;
}

// --- Signal-export webhooks (Pro) -------------------------------------------
// Manage the user's "signal → my own bot/TradingView" webhooks on the backend.
// All return null on any failure (no backend, not Pro, network) so the UI can
// degrade gracefully. Educational only — the backend never places orders.
async function sendJson(pathname, method, body) {
  const b = base();
  if (!b) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    const tok = proToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
    const r = await fetch(b + pathname, { method, cache: 'no-store', signal: ctrl.signal, headers, body: body ? JSON.stringify(body) : undefined });
    clearTimeout(t);
    if (!r.ok) return { error: `HTTP ${r.status}`, status: r.status };
    return await r.json();
  } catch (e) { clearTimeout(t); return null; }
}
export function listWebhooks() { return getJson('/webhooks'); }
export function createWebhook(url, events) { return sendJson('/webhooks', 'POST', { url, events }); }
export function deleteWebhook(id) { return sendJson(`/webhooks/${encodeURIComponent(id)}`, 'DELETE'); }
export function testWebhooks() { return sendJson('/webhooks/test', 'POST'); }

// --- Billing (web / Stripe) --------------------------------------------------
const LS_TOKEN = 'ajent_pro_token';
export function setProToken(t) { try { if (t) localStorage.setItem(LS_TOKEN, t); } catch (e) { /* ignore */ } }
export function clearProToken() { try { localStorage.removeItem(LS_TOKEN); } catch (e) { /* ignore */ } }

// Start a Stripe Checkout for plan 'monthly'|'annual'. Returns { url } to redirect to.
export function startCheckout(plan, { successUrl, cancelUrl }) {
  return sendJson('/billing/checkout', 'POST', { plan, successUrl, cancelUrl });
}
// After the Stripe redirect (?session_id=…), exchange it for the Pro token.
export async function redeemSession(sessionId) {
  const b = base();
  if (!b || !sessionId) return null;
  try {
    const r = await fetch(`${b}/billing/token?session_id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json();
    if (d && d.token) setProToken(d.token);
    return d;
  } catch (e) { return null; }
}
// On launch: if we hold a token, ask the backend for a fresh one (renewals extend it).
export async function refreshProToken() {
  const t = proToken();
  if (!t) return null;
  const r = await sendJson('/billing/refresh', 'POST', { token: t });
  if (r && r.token) { setProToken(r.token); return r; }
  return null;
}

// Server-confirmed entitlement: the client cap is a soft nudge, but a faked or
// expired local token must not keep Pro unlocked while online. Ask the backend;
// if it says the token is NOT entitled, drop it so the app reverts to Free. Only
// acts on an explicit `false` — a network blip leaves the token untouched.
export async function confirmEntitlement() {
  if (!backendConfigured() || !hasProToken()) return;
  const r = await getJson('/billing/status'); // sends the token in Authorization
  if (r && r.entitled === false) clearProToken();
}

// Whether a real purchase path exists yet (Stripe configured on the backend).
// Synchronous read of a flag set by initBilling(); defaults false (waitlist) so
// a configured-backend-but-no-Stripe state never dead-ends on a failing checkout.
let _checkoutReady = false;
export function checkoutAvailable() { return _checkoutReady; }
export async function initBilling() {
  if (!backendConfigured()) { _checkoutReady = false; return false; }
  const r = await getJson('/billing/config');
  _checkoutReady = !!(r && r.checkout);
  return _checkoutReady;
}
