// Pro gate. The Worker (24/7 signals + real-time data + full paper record) is the
// Pro tier, so its endpoints require a valid Pro token. The token is a signed
// bearer (HMAC-SHA256 of {sub, exp} with PRO_SECRET) that YOUR payment flow issues
// after it has verified a Stripe subscription or an App Store / Google Play receipt
// server-side. The app sends it as `Authorization: Bearer <token>`.
//
// Until you set the PRO_SECRET, the gate is OPEN (handy while wiring things up).

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(enc.encode(s));

async function hmac(data, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

// Call this from your payment webhook (after verifying the purchase) to mint a Pro
// token for a user. ttlDays ~ your subscription period; re-issue on renewal.
export async function issueProToken(sub, ttlDays, secret) {
  const payload = b64urlStr(JSON.stringify({ sub, exp: Date.now() + ttlDays * 86400000 }));
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifyProToken(token, secret) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return false;
  if (sig !== await hmac(payload, secret)) return false;
  try {
    const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof exp === 'number' && exp > Date.now();
  } catch (e) { return false; }
}

export async function requirePro(request, env) {
  if (!env.PRO_SECRET) return { ok: true, note: 'gate open (PRO_SECRET not set)' };
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, reason: 'missing Pro token' };
  return (await verifyProToken(token, env.PRO_SECRET)) ? { ok: true } : { ok: false, reason: 'invalid or expired Pro token' };
}
