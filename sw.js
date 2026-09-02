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

// Web push: a payload-less "tickle" from the Worker when a signal fires. Show a
// notification; tapping it opens (or focuses) the app on the Alerts screen.
self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification('Ajent Signals', {
    body: 'A new trade setup just fired — tap to view.',
    icon: '/assets/img/icon-192.png',
    badge: '/assets/img/icon-192.png',
    tag: 'ajent-signal',
    renotify: true,
    data: { url: '/app/#/alerts' },
  }));
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
