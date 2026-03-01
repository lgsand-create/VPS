/**
 * Avgångar PWA — Service Worker
 *
 * Stale-while-revalidate för app shell (visar cachad direkt, uppdaterar i bakgrunden).
 * Network-first för API-anrop.
 * Hanterar push-notiser för förseningar.
 */

const CACHE_VERSION = 10;
const CACHE_NAME = `compuna-avg-v${CACHE_VERSION}`;

const SHELL_ASSETS = [
  '/avg/',
  '/avg/index.html',
  '/avg/avg.css',
  '/avg/avg.js',
  '/avg/manifest.json',
  '/avg/icons/icon.svg',
];

// Install: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: rensa gamla caches + ta kontroll direkt
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Skip waiting
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch: routing-strategi
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-first för API-data
  if (url.pathname.startsWith('/api/avg/')) {
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

  // Stale-while-revalidate för app shell
  if (url.pathname.startsWith('/avg/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }
});

// Push-notiser
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();

    event.waitUntil(
      self.registration.showNotification(data.title || 'Avgångar', {
        body: data.body || '',
        icon: data.icon || '/avg/icons/icon.svg',
        badge: data.badge || '/avg/icons/icon.svg',
        tag: data.tag || 'vt-notification',
        data: data.data || {},
        vibrate: [200, 100, 200],
        requireInteraction: false,
      })
    );
  } catch {
    // Ignorera parse-fel
  }
});

// Klick på notis — öppna appen
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/avg/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        for (const client of clients) {
          if (client.url.includes('/avg/') && 'focus' in client) {
            client.focus();
            if (client.navigate) client.navigate(url);
            return;
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
