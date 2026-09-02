// Web Push (payload-less "tickle") with VAPID auth. Wakes the service worker,
// which fetches the latest and shows a notification. Subscriptions live in ONE
// blob (no KV list). No message encryption needed since there's no payload.

const enc = new TextEncoder();
function b64urlBytes(buf) {
  let s = ''; const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlStr = (str) => b64urlBytes(enc.encode(str));

async function vapidToken(env, audience) {
  const jwk = JSON.parse(env.VAPID_JWK);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64urlStr(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64urlStr(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:admin@ajailabs.app' }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64urlBytes(sig)}`; // WebCrypto ECDSA sig is raw R||S, as VAPID needs
}

// Send one payload-less push. Returns the HTTP status (201 = accepted; 404/410 = gone).
export async function sendPush(env, endpoint, ttl = 1800) {
  const aud = new URL(endpoint).origin;
  const jwt = await vapidToken(env, aud);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
      TTL: String(ttl),
      'Content-Length': '0',
      Urgency: 'high',
    },
  });
  return res.status;
}

const SUBS = () => ['PUSH', 'SUBS'];
const keyOf = (endpoint) => b64urlBytes(enc.encode(endpoint)).slice(0, 40);

export async function addSubscription(store, sub) {
  if (!sub || !sub.endpoint) return false;
  const blob = (await store.get(...SUBS())) || { subs: {} };
  blob.subs = blob.subs || {};
  blob.subs[keyOf(sub.endpoint)] = { endpoint: sub.endpoint, at: Date.now() };
  await store.put({ pk: 'PUSH', sk: 'SUBS', subs: blob.subs, updatedAt: Date.now() });
  return true;
}
export async function removeSubscription(store, endpoint) {
  const blob = await store.get(...SUBS());
  if (!blob || !blob.subs) return;
  delete blob.subs[keyOf(endpoint)];
  await store.put({ pk: 'PUSH', sk: 'SUBS', subs: blob.subs, updatedAt: Date.now() });
}

// Fan a tickle out to every subscriber; prune ones the push service says are gone.
export async function pushToAll(env, store) {
  const blob = await store.get(...SUBS());
  const subs = (blob && blob.subs) || {};
  const endpoints = Object.values(subs).map((s) => s.endpoint);
  if (!endpoints.length) return { sent: 0 };
  let sent = 0, pruned = false;
  for (const ep of endpoints) {
    try {
      const status = await sendPush(env, ep);
      if (status >= 200 && status < 300) sent++;
      else if (status === 404 || status === 410) { delete subs[keyOf(ep)]; pruned = true; }
    } catch (e) { /* skip */ }
  }
  if (pruned) await store.put({ pk: 'PUSH', sk: 'SUBS', subs, updatedAt: Date.now() });
  return { sent };
}
