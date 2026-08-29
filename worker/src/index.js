// Ajent Signals — Cloudflare Worker. Cron trigger runs the 24/7 paper-trading loop;
// the HTTP handler serves the Pro-gated /signals and /trades endpoints.
import { db } from './db.js';
import { runTick } from './scheduler.js';
import { requirePro } from './auth.js';
import { registerWebhook, listWebhooks, deleteWebhook, deliverEvents, sampleEvent, EDU_DISCLAIMER } from './webhooks.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function readJson(request) {
  try { return (await request.json()) || {}; } catch (e) { return {}; }
}

function summarize(closed) {
  const wins = closed.filter((c) => c.pnl > 0), losses = closed.filter((c) => c.pnl < 0);
  const gw = wins.reduce((s, c) => s + c.pnl, 0), gl = Math.abs(losses.reduce((s, c) => s + c.pnl, 0));
  const dec = wins.length + losses.length;
  return { trades: closed.length, winRate: dec ? Math.round((wins.length / dec) * 100) : 0, profitFactor: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? null : 0), totalPnl: closed.reduce((s, c) => s + (c.pnl || 0), 0) };
}

export default {
  // Cron: '*/15 * * * *' — the 24/7 loop, whether or not anyone's app is open.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTick(env, db(env)));
  },

  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });

    // Pro gate — the backend IS the Pro feature. Free users run client-side.
    const gate = await requirePro(request, env);
    if (!gate.ok) return json({ error: 'Ajent Pro required', reason: gate.reason }, 402);

    const store = db(env);
    const sub = gate.sub || 'anon';
    if (url.pathname === '/signals') {
      return json({ updatedAt: Date.now(), signals: await store.list('SIGNAL') });
    }
    if (url.pathname === '/trades') {
      const open = await store.list('POS#OPEN');
      const closed = (await store.list('TRADE')).sort((a, b) => b.closedAt - a.closedAt).slice(0, 200);
      return json({ open, closed, summary: summarize(closed) });
    }

    // --- Signal-export webhooks (Pro "API into your own tooling") ---------------
    if (url.pathname === '/webhooks') {
      if (request.method === 'GET') {
        const hooks = await listWebhooks(store, sub);
        return json({ webhooks: hooks, disclaimer: EDU_DISCLAIMER });
      }
      if (request.method === 'POST') {
        const b = await readJson(request);
        const r = await registerWebhook(store, sub, { url: b.url, events: b.events });
        if (r.error) return json({ error: r.error }, r.status || 400);
        // secret is shown once here so the user can verify our signatures.
        return json({ webhook: r.hook, note: 'Save the secret — verify X-Ajent-Signature = sha256(HMAC-SHA256(rawBody, secret)).' }, 201);
      }
    }
    // /webhooks/<id> (DELETE) and /webhooks/test (POST a sample to all hooks)
    const m = url.pathname.match(/^\/webhooks\/([\w-]+)$/);
    if (m) {
      const id = m[1];
      if (id === 'test' && request.method === 'POST') {
        const r = await deliverEvents(store, [sampleEvent()], { onlySub: sub });
        return json({ ok: true, delivered: r.delivered, sample: sampleEvent() });
      }
      if (request.method === 'DELETE') {
        const r = await deleteWebhook(store, sub, id);
        return json(r.error ? { error: r.error } : { ok: true }, r.status || 200);
      }
    }
    return json({ error: 'not found' }, 404);
  },
};
