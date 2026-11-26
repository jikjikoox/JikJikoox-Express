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
