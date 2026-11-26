/* eslint-disable no-undef */
/**
 * JikJikoox Express — Service Worker Web Push (Firebase Cloud Messaging)
 * Gère les notifications en arrière-plan sur mobile, tablette et ordinateur,
 * évite les doublons via `tag` (dedupeKey) et ouvre directement la mission concernée au clic.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
    icon: '/favicon.svg',
    badge: '/favicon.svg',
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


// App-shell cache for the installable JikJikoox Express PWA.
// This is deliberately the same root-scope worker used by Firebase Messaging.
const EXPRESS_CACHE = 'jikjikoox-express-shell-v1';
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/functions/') || url.pathname.startsWith('/rest/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(EXPRESS_CACHE).then((cache) => cache.put('/', copy));
      }
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match('/'))));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => {
    const network = fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(EXPRESS_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    });
    return cached || network;
  }));
});
