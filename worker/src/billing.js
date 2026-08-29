// Payment → Pro-token flow. THIS is what turns Pro into revenue. The Pro token
// (auth.js) is only ever minted here, AFTER a processor confirms a real payment:
//   • Web:   Stripe Checkout → signed webhook → issue token → app redeems it.
//   • iOS:   App Store receipt validated server-side → issue token.
//   • Play:  Google Play purchase token validated server-side → issue token.
// We never see card data — Stripe/Apple/Google collect it. We only read a
// receipt/webhook and mint the token that unlocks the backend.
import { issueProToken, readProToken } from './auth.js';

const enc = new TextEncoder();
const PLAN_TTL_DAYS = { monthly: 35, annual: 400 }; // token lifetime; renewals re-issue

// ---- small crypto helpers ---------------------------------------------------
async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// ---- Stripe REST (fetch, no SDK — Workers-friendly) -------------------------
function form(obj, prefix, out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
async function stripe(env, path, method = 'GET', body) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? form(body).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`stripe ${path}: ${data.error ? data.error.message : res.status}`);
  return data;
}

// Create a Checkout Session for a subscription. plan = 'monthly' | 'annual'.
// Prices come from env (STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL) — never hard-coded.
export async function createCheckoutSession(env, { plan, successUrl, cancelUrl, ref }) {
  const priceId = plan === 'annual' ? env.STRIPE_PRICE_ANNUAL : env.STRIPE_PRICE_MONTHLY;
  if (!priceId) return { error: `price for ${plan} not configured`, status: 500 };
  const ttl = PLAN_TTL_DAYS[plan] || PLAN_TTL_DAYS.monthly;
  const session = await stripe(env, 'checkout/sessions', 'POST', {
    mode: 'subscription',
    'line_items': [{ price: priceId, quantity: 1 }],
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    client_reference_id: ref || undefined,
    allow_promotion_codes: true,
    metadata: { plan, ttl_days: ttl },
    // carry ttl on the subscription too, so renewal invoices can read it
    subscription_data: { metadata: { plan, ttl_days: ttl } },
  });
  return { id: session.id, url: session.url };
}

async function getSubscription(env, id) {
  try { return await stripe(env, `subscriptions/${id}`, 'GET'); } catch (e) { return null; }
}

// ---- webhook ---------------------------------------------------------------
// Verify Stripe's signature over the RAW body (constant-time, with tolerance).
export async function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  let t = null; const v1s = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(), val = part.slice(i + 1).trim();
    if (k === 't') t = val; else if (k === 'v1') v1s.push(val);
  }
  if (!t || !v1s.length) return false;
  if (toleranceSec && Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > toleranceSec) return false;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return v1s.some((v) => timingSafeEqual(expected, v));
}

const subKey = (sub) => ['ENT#SUB', String(sub)];
const sessKey = (id) => ['ENT#SESSION', String(id)];

async function grant(env, store, sub, ttlDays, plan) {
  const token = await issueProToken(sub, ttlDays, env.PRO_SECRET);
  const exp = Date.now() + ttlDays * 86400000;
  await store.put({ pk: subKey(sub)[0], sk: subKey(sub)[1], sub: String(sub), token, exp, plan, updatedAt: Date.now() });
  return { token, exp };
}

// Process a verified Stripe event. Returns a short status string.
export async function handleStripeEvent(env, store, event) {
  const obj = event.data && event.data.object;
  if (!obj) return 'noop';
  switch (event.type) {
    case 'checkout.session.completed': {
      const sub = obj.customer || obj.client_reference_id || (obj.customer_details && obj.customer_details.email);
      if (!sub) return 'no-sub';
      const md = obj.metadata || {};
      const ttl = Number(md.ttl_days) || PLAN_TTL_DAYS[md.plan] || PLAN_TTL_DAYS.monthly;
      const { token, exp } = await grant(env, store, sub, ttl, md.plan);
      // Map this session → sub, and stash the token so the app can redeem it once.
      await store.put({ pk: sessKey(obj.id)[0], sk: sessKey(obj.id)[1], sub: String(sub), token, exp, createdAt: Date.now() });
      return 'granted';
    }
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const sub = obj.customer; if (!sub) return 'no-sub';
      let ttl = PLAN_TTL_DAYS.monthly;
      if (obj.subscription) {
        const s = await getSubscription(env, obj.subscription);
        if (s && s.metadata && s.metadata.ttl_days) ttl = Number(s.metadata.ttl_days);
        else if (s && s.current_period_end) ttl = Math.max(1, Math.ceil((s.current_period_end * 1000 - Date.now()) / 86400000) + 2);
      }
      await grant(env, store, sub, ttl, 'renewal');
      return 'renewed';
    }
    case 'customer.subscription.deleted': {
      const sub = obj.customer; if (!sub) return 'no-sub';
      // Let the current token lapse naturally; stop refreshing it.
      await store.del(subKey(sub)[0], subKey(sub)[1]);
      return 'revoked';
    }
    default:
      return 'ignored';
  }
}

// App redeems its Pro token after the Stripe redirect (?session_id=...).
export async function tokenForSession(store, sessionId) {
  const rec = await store.get(sessKey(sessionId)[0], sessKey(sessionId)[1]);
  if (!rec) return null;
  return { token: rec.token, exp: rec.exp };
}

// App refreshes its token on launch (renewals extend exp). Proves ownership by
// presenting its current token (even if expired — we ignore exp for the lookup).
export async function refreshToken(env, store, oldToken) {
  const claims = await readProToken(oldToken, env.PRO_SECRET, { ignoreExp: true });
  if (!claims || !claims.sub) return null;
  const rec = await store.get(subKey(claims.sub)[0], subKey(claims.sub)[1]);
  if (!rec || !rec.token || rec.exp <= Date.now()) return null;
  return { token: rec.token, exp: rec.exp };
}

// ---- App Store / Google Play (server-side receipt validation) --------------
// SCAFFOLD: wire the real validation, then reuse grant() to mint the token.
// Kept as explicit stubs so nothing silently "passes" without real validation.
export async function validateApple(env, { receipt, sub }) {
  // TODO: POST the receipt to Apple's App Store Server API (verifyReceipt is
  // deprecated — use the App Store Server API with your issuer key / shared
  // secret env.APPLE_SHARED_SECRET). On a valid active subscription:
  //   return grant(env, store, appleTransactionOriginalId, ttl, 'apple');
  if (!env.APPLE_SHARED_SECRET) return { error: 'apple validation not configured', status: 501 };
  return { error: 'apple validation not implemented', status: 501 };
}
export async function validateGoogle(env, { purchaseToken, productId, sub }) {
  // TODO: call the Google Play Developer API
  // purchases.subscriptionsv2.get with a service account (env.GOOGLE_SA_JSON).
  // On an active purchase: grant() keyed by the linkedPurchaseToken/obfuscatedId.
  if (!env.GOOGLE_SA_JSON) return { error: 'google validation not configured', status: 501 };
  return { error: 'google validation not implemented', status: 501 };
}

export { PLAN_TTL_DAYS };
