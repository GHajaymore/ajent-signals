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

async function getJson(pathname) {
  const b = base();
  if (!b) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(b + pathname, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { clearTimeout(t); return null; }
}

// { open:[], closed:[], summary:{} } or null if unavailable.
export function fetchServerTrades() { return getJson('/trades'); }
// { updatedAt, signals:[] } or null.
export function fetchServerSignals() { return getJson('/signals'); }
