// CarromX Service Worker
const CACHE_NAME = 'carromx-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'CarromX Alert', body: event.data.text() };
    }
  }

  const title = data.title || '🔔 CarromX Match Alert!';
  const options = {
    body: data.message || data.body || 'Your tournament match is about to begin.',
    icon: '/img/icon.png',
    badge: '/img/badge.png',
    data: data,
    vibrate: [200, 100, 200]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('/');
    })
  );
});
