// Optional backend connection. When `window.__AJENT_API` (set in app/index.html)
// or localStorage 'ajent_api' points at the deployed backend, the app reads the
// 24/7 server-side paper-trading record from it. When it's empty, the app runs
// exactly as before — fully client-side. Nothing here throws on a missing/bad
// endpoint; callers get null and fall back.

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
