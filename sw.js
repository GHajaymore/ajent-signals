// Ajent Signals service worker — NETWORK-FIRST for same-origin requests.
// Guarantees users always get the latest app code when online (fixing the
// stale-cached-modules problem), while still working offline from cache.
// Registered from the site root so its scope covers /app/ and /assets/ — works
// the same on GitHub Pages (/ajent-signals/) or a custom domain root.
const CACHE = 'ajent-shell-v1';

self.addEventListener('install', () => {
  // Activate the new worker immediately instead of waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Web push: a payload-less "tickle" from the Worker when a signal fires. The SW
// fetches what fired so the notification names the market(s) and direction, then
// falls back to a generic message if that lookup fails.
const AJENT_API = 'https://ajent-signals-worker.golferajay.workers.dev';
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let title = 'Ajent Signals', body = 'A new trade setup just fired — tap to view.', target = '/app/#/alerts';
    try {
      const data = await fetch(`${AJENT_API}/push/last`, { cache: 'no-store' }).then((r) => r.json());
      const fired = (data && data.fired) || [];
      if (fired.length) {
        const parts = fired.slice(0, 3).map((f) => `${f.verdict} ${f.symbol}${f.confidence ? ` ${f.confidence}%` : ''}`);
        title = fired.length === 1 ? `${fired[0].verdict} · ${fired[0].name || fired[0].symbol}` : `${fired.length} new signals`;
        body = parts.join(' · ') + (fired.length > 3 ? ` +${fired.length - 3} more` : '');
        target = fired.length === 1 ? `/app/#/signal/${fired[0].symbol}` : '/app/#/home';
      }
    } catch (e) { /* keep the generic message */ }
    await self.registration.showNotification(title, {
      body, icon: '/assets/img/icon-192.png', badge: '/assets/img/icon-192.png',
      tag: 'ajent-signal', renotify: true, data: { url: target },
    });
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/app/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.includes('/app') && 'focus' in c) { try { await c.navigate(target); } catch (e) { /* ignore */ } return c.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only manage our own origin — never touch the cross-origin quote proxies.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: 'no-store' });
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});
