/* eslint-disable no-undef */
/**
 * JikJikoox Express — Service Worker unifié (Web Push FCM + App-Shell PWA)
 * - Gère les notifications en arrière-plan sur mobile, tablette et ordinateur,
 *   évite les doublons via `tag` (dedupeKey) et ouvre directement la mission concernée au clic.
 * - Met en cache uniquement les ressources statiques de l'app-shell pour un lancement rapide
 *   et une détection fiable hors connexion, sans jamais mettre en cache les API authentifiées.
 */

const EXPRESS_CACHE = 'jikjikoox-express-shell-v2';
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/apple-touch-icon.png',
  '/pwa-icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(EXPRESS_CACHE)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch(() => undefined)
          )
        )
      )
      .finally(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('jikjikoox-express-') && key !== EXPRESS_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { notification: { title: 'JikJikoox Express', body: event.data.text() } };
  }

  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.title || 'JikJikoox Express';
  const body =
    notification.body || data.body || 'Une mise à jour de mission est disponible.';
  const tag =
    data.dedupeKey ||
    (data.missionId && data.syncVersion
      ? `jikjikoox_${data.missionId}_v${data.syncVersion}`
      : 'jikjikoox_express_alert');

  const options = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag,
    renotify: true,
    data: {
      missionId: data.missionId || '',
      category: data.category || 'operational',
      url: data.missionId ? `/?mission=${encodeURIComponent(data.missionId)}` : '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && targetUrl !== '/') {
            client.navigate(targetUrl).catch(() => undefined);
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});

function isExcludedPath(pathname) {
  return (
    pathname.startsWith('/functions/') ||
    pathname.startsWith('/rest/') ||
    pathname.startsWith('/storage/') ||
    pathname.startsWith('/api/') ||
    pathname === '/healthz' ||
    pathname === '/firebase-messaging-sw.js'
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isExcludedPath(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(EXPRESS_CACHE).then((cache) => cache.put('/', copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(async () => {
          const cached = (await caches.match(request)) || (await caches.match('/'));
          return (
            cached ||
            new Response('JikJikoox Express est hors connexion. Reconnectez-vous pour synchroniser.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(EXPRESS_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => cached || Response.error());

      return cached || networkFetch;
    })
  );
});
