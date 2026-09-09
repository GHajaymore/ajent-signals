// Operator role session (owner / admin). Distinct from the Pro token: this unlocks the operator
// CONSOLE, not paid app features. The user exchanges a secret access key for a short-lived signed
// token (worker/src/roles.js); we persist only the expiring token, never the raw key. Everyone
// without a valid session is a plain 'member' and never sees any of this.
const KEY = 'ajent_role_session';

function base() {
  try {
    const w = (typeof window !== 'undefined' && window.__AJENT_API) || '';
    const ls = localStorage.getItem('ajent_api') || '';
    return (w || ls || '').replace(/\/+$/, '');
  } catch (e) { return ''; }
}

export function getRoleSession() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.token && s.exp > Date.now()) return s; } catch (e) { /* ignore */ }
  return null;
}
export function getRole() { return getRoleSession()?.role || 'member'; }
export function isOperator() { const r = getRole(); return r === 'owner' || r === 'admin'; }
export function isOwner() { return getRole() === 'owner'; }
export function clearRole() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

// Exchange an access key for a role session. Never stores the raw key.
export async function unlockRole(key) {
  const b = base();
  if (!b) return { ok: false, error: 'No backend is configured.' };
  try {
    const r = await fetch(`${b}/role/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    if (r.status === 404) return { ok: false, error: 'The console isn’t enabled on the server yet (set ROLE_SECRET + OWNER_KEY).' };
    if (r.status === 401) return { ok: false, error: 'That access key isn’t valid.' };
    if (!r.ok) return { ok: false, error: 'Couldn’t unlock — try again.' };
    const d = await r.json();
    if (!d || !d.token || !d.role) return { ok: false, error: 'Unexpected response from the server.' };
    try { localStorage.setItem(KEY, JSON.stringify({ role: d.role, token: d.token, exp: d.exp })); } catch (e) { /* ignore */ }
    return { ok: true, role: d.role };
  } catch (e) { return { ok: false, error: 'Network error — couldn’t reach the server.' }; }
}

// Aggregate operator analytics. Returns the payload, or { error } (and clears the session if it
// has expired server-side), or null if there's nothing to call.
export async function fetchConsoleOverview() {
  const b = base(); const s = getRoleSession();
  if (!b || !s) return null;
  try {
    const r = await fetch(`${b}/console/overview`, { cache: 'no-store', headers: { 'X-Role-Token': s.token } });
    if (r.status === 401 || r.status === 403) { clearRole(); return { error: 'Your console session expired — unlock again.' }; }
    if (r.status === 404) return { error: 'The console isn’t enabled on the server yet.' };
    if (!r.ok) return { error: 'Couldn’t load the console.' };
    return await r.json();
  } catch (e) { return { error: 'Network error — couldn’t reach the server.' }; }
}

// Admin market control — which markets Ajent auto-trades.
export async function fetchMarketConfig() {
  const b = base(); const s = getRoleSession();
  if (!b || !s) return null;
  try {
    const r = await fetch(`${b}/console/config/markets`, { cache: 'no-store', headers: { 'X-Role-Token': s.token } });
    if (r.status === 401 || r.status === 403) { clearRole(); return { error: 'Your console session expired — unlock again.' }; }
    if (!r.ok) return { error: 'Couldn’t load market config.' };
    return await r.json();
  } catch (e) { return { error: 'Network error.' }; }
}

// Save the disabled-symbol list. Returns { ok, disabled, ... } or { error }.
export async function saveMarketConfig(disabled) {
  const b = base(); const s = getRoleSession();
  if (!b || !s) return { error: 'No session.' };
  try {
    const r = await fetch(`${b}/console/config/markets`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role-Token': s.token }, body: JSON.stringify({ disabled }) });
    if (r.status === 401 || r.status === 403) { clearRole(); return { error: 'Session expired.' }; }
    if (!r.ok) return { error: 'Save failed.' };
    return await r.json();
  } catch (e) { return { error: 'Network error.' }; }
}
