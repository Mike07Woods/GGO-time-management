/* GGO Time Management — service worker.
   Makes the app installable (browsers require a registered SW with a fetch
   handler) and handles Web Push notifications. It intentionally does NOT cache,
   so there's no risk of serving stale builds. */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', () => {
  // Pass-through: let the browser handle every request normally.
});

// --- Web Push ---------------------------------------------------------------
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'GGO', {
      body: data.body || '',
      icon: '/logo192.png',
      badge: '/logo192.png',
      tag: data.tag || 'default',
      data: { url: data.url || '/' },
      vibrate: [200, 100, 200],
      requireInteraction: data.requireInteraction || false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing tab on that URL if we have one.
      for (const client of clientList) {
        if (client.url.endsWith(url) && 'focus' in client) return client.focus();
      }
      // Otherwise focus any open tab and navigate it, or open a new one.
      if (clientList.length && 'navigate' in clientList[0]) {
        return clientList[0].focus().then((c) => c.navigate(url));
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })
  );
});
