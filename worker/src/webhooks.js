// Signal-export webhooks — the Pro "API into your own tooling" feature.
//
// A Pro user registers a URL (their own bot, a TradingView alert relay, a Zapier
// catch-hook, a Discord relay…). When a fresh signal fires, the Worker POSTs a
// SIGNED, EDUCATIONAL payload to that URL. We NEVER place an order or touch a
// broker — we only hand the user the same signal the app shows, over HTTP, so
// THEY decide what (if anything) to do with it in their own system.
//
// Educational posture is baked into every payload (`disclaimer`) and the docs:
// Ajent Signals is not a broker or adviser, holds no funds, places no orders.

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// HMAC-SHA256(hex) of the raw body with the hook's per-hook secret. Receivers
// recompute this to prove the call really came from us (GitHub/Stripe style).
export async function sign(secret, body) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'sha256=' + toHex(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
}

function randToken(bytes = 24) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const EDU_DISCLAIMER =
  'Educational signal only. Ajent Signals is not a broker or investment adviser, ' +
  'places no orders and holds no funds. Hypothetical/simulated — not a recommendation ' +
  'to buy or sell anything. You are solely responsible for any decision you make.';

// Only allow public https endpoints. Blocks localhost / private ranges so the
// Worker can't be pointed at internal addresses (SSRF hygiene).
export function validateWebhookUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (e) { return { ok: false, error: 'not a valid URL' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'must be an https:// URL' };
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return { ok: false, error: 'private host not allowed' };
  // literal IPs → block loopback / private / link-local ranges
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split('.').map(Number);
    const priv = p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
    if (priv) return { ok: false, error: 'private IP not allowed' };
  }
  if (h.includes(':')) return { ok: false, error: 'IPv6 hosts not allowed' }; // keep it simple/safe
  return { ok: true, url: u.toString() };
}

// pk namespace: HOOK#<sub> so a user only ever sees their own hooks.
const hookPk = (sub) => `HOOK#${sub || 'anon'}`;
const MAX_PER_USER = 5;

export async function listWebhooks(store, sub) {
  const hooks = await store.list(hookPk(sub));
  return hooks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function registerWebhook(store, sub, { url, events } = {}) {
  const v = validateWebhookUrl(url);
  if (!v.ok) return { error: v.error, status: 400 };
  const existing = await listWebhooks(store, sub);
  if (existing.length >= MAX_PER_USER) return { error: `limit ${MAX_PER_USER} webhooks per account`, status: 409 };
  const allowed = ['signal', 'position.open', 'position.close'];
  const evs = Array.isArray(events) && events.length ? events.filter((e) => allowed.includes(e)) : allowed.slice();
  if (!evs.length) return { error: 'no valid events', status: 400 };
  const id = randToken(8);
  const hook = { pk: hookPk(sub), sk: id, id, url: v.url, events: evs, secret: randToken(24), active: true, createdAt: Date.now(), failures: 0 };
  await store.put(hook);
  return { hook };
}

export async function deleteWebhook(store, sub, id) {
  const hook = await store.get(hookPk(sub), id);
  if (!hook) return { error: 'not found', status: 404 };
  await store.del(hookPk(sub), id);
  return { ok: true };
}

// Build the educational payload the user's system receives.
function eventBody(ev) {
  const s = ev.signal || {};
  return {
    type: ev.type,                       // 'signal' | 'position.open' | 'position.close'
    event: ev.event || s.verdict || null, // 'BUY' | 'SELL' | 'open' | 'stop' | ...
    symbol: ev.symbol,
    name: ev.name || null,
    price: ev.price ?? s.price ?? null,
    strategy: ev.strategy || null,
    conviction: s.conviction || ev.conviction || null,
    rsi2: s.rsi2 ?? null,
    plan: ev.plan || s.plan || null,     // hypothetical entry/stop/target levels
    at: ev.at || Date.now(),
    source: 'ajent-signals',
    mode: 'educational-simulated',
    disclaimer: EDU_DISCLAIMER,
  };
}

// Deliver a batch of fresh events to every matching webhook across all users.
// Best-effort: a failing endpoint is counted and auto-disabled after repeated
// failures; it never blocks the trading loop.
export async function deliverEvents(store, events, { onlySub } = {}) {
  if (!events || !events.length) return { delivered: 0 };
  // Cron delivery fans out to every user's hooks; a user's own /test scopes to theirs.
  const all = onlySub ? await store.list(hookPk(onlySub)) : await store.list('HOOK#');
  let delivered = 0;
  for (const hook of all) {
    if (!hook.active) continue;
    for (const ev of events) {
      if (!hook.events.includes(ev.type)) continue;
      const body = JSON.stringify(eventBody(ev));
      try {
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Ajent-Signals-Webhook/1',
            'X-Ajent-Event': ev.type,
            'X-Ajent-Timestamp': String(Date.now()),
            'X-Ajent-Signature': await sign(hook.secret, body),
          },
          body,
        });
        if (res.ok) { delivered++; if (hook.failures) { hook.failures = 0; await store.put(hook); } }
        else await noteFailure(store, hook);
      } catch (e) { await noteFailure(store, hook); }
    }
  }
  return { delivered };
}

async function noteFailure(store, hook) {
  hook.failures = (hook.failures || 0) + 1;
  if (hook.failures >= 20) hook.active = false; // auto-pause a dead endpoint
  await store.put(hook);
}

// A one-off sample event so users can test their receiver end-to-end.
export function sampleEvent() {
  return {
    type: 'signal', event: 'BUY', symbol: 'ES', name: 'E-mini S&P 500', price: 5123.5,
    strategy: 'Proven daily (RSI2 mean-reversion)',
    signal: { verdict: 'BUY', conviction: 'high', rsi2: 7.8, plan: { entry: 5123.5, stop: 5108.0, target1: 5139.0 } },
    at: Date.now(),
  };
}

export { EDU_DISCLAIMER };
