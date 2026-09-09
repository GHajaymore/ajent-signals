// OPERATOR ROLES — owner > admin > member. Distinct from the Pro gate (auth.js): those are
// PAYING app users; these are the OPERATOR SEATS that run the product. An owner/admin proves
// their seat with a secret ACCESS KEY (env.OWNER_KEY / env.ADMIN_KEY), which they exchange once
// for a short-lived signed role token (HMAC of {role, exp}). The raw key never persists in the
// client; only the expiring token does.
//
// SECURITY POSTURE: closed by default. A seat can be unlocked only if BOTH its key is configured
// AND a signing secret (ROLE_SECRET, or the existing PRO_SECRET) is set. With neither, the whole
// console is 404 — the opposite of the Pro gate, which opens when unset. Members are everyone
// else and never touch any of this.

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(enc.encode(s));

async function hmac(data, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

// Constant-time compare — the key check and the token-signature check both guard privileged
// access, so neither may leak length/content via timing.
function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export const ROLE_RANK = { member: 0, admin: 1, owner: 2 };
export function roleSecret(env) { return env.ROLE_SECRET || env.PRO_SECRET || null; }

// Which seat (if any) does this access key unlock? Owner beats admin if a key somehow matches
// both. A seat whose key isn't configured can never match (closed by default).
export function roleForKey(key, env) {
  if (!key) return null;
  if (env.OWNER_KEY && timingSafeEqual(key, env.OWNER_KEY)) return 'owner';
  if (env.ADMIN_KEY && timingSafeEqual(key, env.ADMIN_KEY)) return 'admin';
  return null;
}

export async function issueRoleToken(role, ttlHours, secret) {
  const payload = b64urlStr(JSON.stringify({ role, exp: Date.now() + ttlHours * 3600000 }));
  return `${payload}.${await hmac(payload, secret)}`;
}

// Returns { role, exp } on a valid, unexpired, role-bearing token; null otherwise. Rejects a
// Pro token (same secret, but no `role` claim) so the two token families can share Authorization.
export async function readRoleToken(token, secret) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || !secret) return null;
  if (!timingSafeEqual(sig, await hmac(payload, secret))) return null;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (!claims || typeof claims.role !== 'string' || !(claims.role in ROLE_RANK)) return null;
    if (typeof claims.exp !== 'number' || claims.exp <= Date.now()) return null;
    return { role: claims.role, exp: claims.exp };
  } catch (e) { return null; }
}

// Gate a request on a minimum seat. Reads the role token from X-Role-Token (preferred, so it
// never collides with the Pro Authorization header) or a `?rk=` fallback. Returns
// { ok, role } / { ok:false, reason, status }.
export async function requireRole(request, env, minRole) {
  const secret = roleSecret(env);
  if (!secret) return { ok: false, reason: 'console not configured', status: 404 };
  const url = new URL(request.url);
  const token = (request.headers.get('X-Role-Token') || url.searchParams.get('rk') || '').trim();
  const claims = await readRoleToken(token, secret);
  if (!claims) return { ok: false, reason: 'no valid role session', status: 401 };
  if (ROLE_RANK[claims.role] < ROLE_RANK[minRole]) return { ok: false, reason: 'insufficient role', status: 403 };
  return { ok: true, role: claims.role };
}
