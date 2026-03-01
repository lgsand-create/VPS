/**
 * Compuna Monitor — Service Worker
 *
 * Cache-first för app shell, network-first för API-anrop.
 */

const CACHE_NAME = 'compuna-monitor-v6';

const SHELL_ASSETS = [
  '/app/',
  '/app/index.html',
  '/app/app.css',
  '/app/app.js',
  '/app/manifest.json',
  '/app/icons/icon-192.png',
  '/app/icons/icon-512.png',
];

// Install: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: rensa gamla caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Skip waiting vid meddelande från appen
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch: routing-strategi
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skippa auth-endpoints (ska aldrig cachas)
  if (url.pathname.startsWith('/api/pwa/auth')) {
    return;
  }

  // Network-first för API-data
  if (url.pathname.startsWith('/api/pwa/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first för app shell
  if (url.pathname.startsWith('/app/')) {
    event.respondWith(
      caches.match(event.request)
        .then(cached => cached || fetch(event.request))
    );
    return;
  }
});
