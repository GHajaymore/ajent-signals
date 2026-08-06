// Ajent Signals service worker — NETWORK-FIRST for same-origin requests.
// Guarantees users always get the latest app code when online (fixing the
// stale-cached-modules problem), while still working offline from cache.
// Scope is the site root (/ajent-signals/) so it covers /app/ and /assets/.
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
