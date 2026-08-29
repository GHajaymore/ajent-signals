// Local check of the payment→token flow (no Stripe/Cloudflare needed):
// Stripe signature verification + webhook→grant→redeem→refresh with in-mem KV.
//   node test/billing.mjs
import crypto from 'node:crypto';
import { verifyStripeSignature, handleStripeEvent, tokenForSession, refreshToken } from '../src/billing.js';
import { issueProToken, verifyProToken } from '../src/auth.js';

function memStore() {
  const m = new Map(); const k = (pk, sk) => `${pk}|${sk}`;
  return {
    put: async (i) => { m.set(k(i.pk, i.sk), i); },
    get: async (pk, sk) => m.get(k(pk, sk)) || null,
    del: async (pk, sk) => { m.delete(k(pk, sk)); },
    list: async (pk) => [...m.values()].filter((v) => String(v.pk).startsWith(pk)),
  };
}
const env = { PRO_SECRET: 'pro-secret-xyz', STRIPE_WEBHOOK_SECRET: 'whsec_test' };
// Build a Stripe-style signature header for a raw body.
function stripeSig(raw, secret, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n); } };

// 1) signature verification
const raw = JSON.stringify({ hello: 'world' });
ok('valid signature accepted', await verifyStripeSignature(raw, stripeSig(raw, env.STRIPE_WEBHOOK_SECRET), env.STRIPE_WEBHOOK_SECRET));
ok('wrong secret rejected', !(await verifyStripeSignature(raw, stripeSig(raw, 'nope'), env.STRIPE_WEBHOOK_SECRET)));
ok('tampered body rejected', !(await verifyStripeSignature(raw + 'x', stripeSig(raw, env.STRIPE_WEBHOOK_SECRET), env.STRIPE_WEBHOOK_SECRET)));
ok('stale timestamp rejected', !(await verifyStripeSignature(raw, stripeSig(raw, env.STRIPE_WEBHOOK_SECRET, 1000000000), env.STRIPE_WEBHOOK_SECRET)));
ok('missing header rejected', !(await verifyStripeSignature(raw, '', env.STRIPE_WEBHOOK_SECRET)));

// 2) checkout.session.completed → grant → redeem → token is a valid Pro token
const store = memStore();
const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', customer: 'cus_123', metadata: { plan: 'monthly', ttl_days: 35 } } } };
ok('event handled → granted', (await handleStripeEvent(env, store, event)) === 'granted');
const redeemed = await tokenForSession(store, 'cs_test_1');
ok('token redeemable by session_id', !!(redeemed && redeemed.token));
ok('minted token verifies as Pro', await verifyProToken(redeemed.token, env.PRO_SECRET));
ok('unknown session_id → null', (await tokenForSession(store, 'cs_nope')) === null);

// 3) refresh: an EXPIRED but authentic token still refreshes while entitlement is active
const expiredTok = await issueProToken('cus_123', -1, env.PRO_SECRET); // exp in the past
ok('expired token is not valid', !(await verifyProToken(expiredTok, env.PRO_SECRET)));
const refreshed = await refreshToken(env, store, expiredTok);
ok('refresh returns active token', !!(refreshed && refreshed.token && refreshed.exp > Date.now()));
ok('refreshed token verifies as Pro', await verifyProToken(refreshed.token, env.PRO_SECRET));

// 4) forged token (wrong secret) cannot refresh
const forged = await issueProToken('cus_123', 30, 'attacker-secret');
ok('forged token cannot refresh', (await refreshToken(env, store, forged)) === null);

// 5) renewal (invoice.paid, no subscription fetch) re-grants
ok('invoice.paid → renewed', (await handleStripeEvent(env, store, { type: 'invoice.paid', data: { object: { customer: 'cus_123' } } })) === 'renewed');

// 6) subscription deleted → entitlement removed → refresh fails afterwards
ok('subscription.deleted → revoked', (await handleStripeEvent(env, store, { type: 'customer.subscription.deleted', data: { object: { customer: 'cus_123' } } })) === 'revoked');
ok('no refresh after revoke', (await refreshToken(env, store, expiredTok)) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
