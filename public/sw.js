// Service worker — makes the app installable (PWA) with an offline fallback.
// NETWORK-FIRST: always fetch the latest code/data when online; the cache is only a
// fallback when offline. This avoids ever serving stale UI. Never touches /api/.
const CACHE = 'streamgarden-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  // Wipe every old cache (including the previous cache-first version).
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never intercept API / streams / downloads.
  if (url.pathname.startsWith('/api/')) return;

  // Network-first: fresh copy wins; cache is the offline fallback.
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit || (request.mode === 'navigate' ? caches.match('/index.html') : undefined))
      )
  );
});
