// Local check of the signal-export webhooks (no Cloudflare needed):
// URL guarding, per-hook signing, and end-to-end signed delivery to a receiver.
//   node test/webhooks.mjs
import http from 'node:http';
import {
  validateWebhookUrl, registerWebhook, listWebhooks, deleteWebhook,
  deliverEvents, sign, sampleEvent,
} from '../src/webhooks.js';

function memStore() {
  const m = new Map(); const k = (pk, sk) => `${pk}|${sk}`;
  return {
    put: async (i) => { m.set(k(i.pk, i.sk), i); },
    get: async (pk, sk) => m.get(k(pk, sk)) || null,
    del: async (pk, sk) => { m.delete(k(pk, sk)); },
    list: async (pk) => [...m.values()].filter((v) => String(v.pk).startsWith(pk)),
  };
}

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } };

// 1) URL guarding
ok('reject http://',        !validateWebhookUrl('http://example.com/hook').ok);
ok('reject localhost',      !validateWebhookUrl('https://localhost/hook').ok);
ok('reject 127.0.0.1',      !validateWebhookUrl('https://127.0.0.1/hook').ok);
ok('reject 10.x private',   !validateWebhookUrl('https://10.0.0.5/hook').ok);
ok('reject 192.168.x',      !validateWebhookUrl('https://192.168.1.10/hook').ok);
ok('accept public https',    validateWebhookUrl('https://hooks.example.com/abc').ok);

// 2) register / list / limit / delete
const store = memStore();
const reg = await registerWebhook(store, 'u1', { url: 'https://hooks.example.com/a', events: ['signal'] });
ok('register returns hook + secret', reg.hook && reg.hook.secret && reg.hook.id);
ok('register rejects bad url', (await registerWebhook(store, 'u1', { url: 'http://x' })).error);
for (let i = 0; i < 5; i++) await registerWebhook(store, 'u1', { url: `https://h.example.com/${i}` });
ok('per-user limit enforced', (await registerWebhook(store, 'u1', { url: 'https://h.example.com/x' })).error);
ok('list scoped to user', (await listWebhooks(store, 'u2')).length === 0);
await deleteWebhook(store, 'u1', reg.hook.id);
ok('delete removes hook', !(await store.get('HOOK#u1', reg.hook.id)));

// 3) end-to-end signed delivery to a real receiver
const received = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c));
  req.on('end', () => { received.push({ headers: req.headers, body }); res.writeHead(200); res.end('ok'); });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const store2 = memStore();
const secret = 'test-secret-123';
await store2.put({ pk: 'HOOK#u1', sk: 'h1', id: 'h1', url: `http://127.0.0.1:${port}/hook`, events: ['signal'], secret, active: true, failures: 0 });
const del = await deliverEvents(store2, [sampleEvent()]);
ok('delivered to receiver', del.delivered === 1 && received.length === 1);

if (received.length) {
  const rec = received[0];
  const expectedSig = await sign(secret, rec.body);
  ok('signature header matches', rec.headers['x-ajent-signature'] === expectedSig);
  const payload = JSON.parse(rec.body);
  ok('payload is educational', /educational/i.test(payload.disclaimer) && payload.mode === 'educational-simulated');
  ok('payload carries no order fields', payload.orderId === undefined && payload.execute === undefined && payload.broker === undefined);
  ok('event type + symbol present', payload.type === 'signal' && payload.symbol === 'ES');
}

// 4) inactive hook is skipped
const store3 = memStore();
await store3.put({ pk: 'HOOK#u1', sk: 'h2', id: 'h2', url: `http://127.0.0.1:${port}/x`, events: ['signal'], secret, active: false });
const before = received.length;
await deliverEvents(store3, [sampleEvent()]);
ok('inactive hook skipped', received.length === before);

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
