/* GGO Time Management — minimal service worker.
   Its job is to make the app installable (browsers require a registered SW with
   a fetch handler for the install prompt). It intentionally does NOT cache, so
   there's no risk of serving stale builds — every request passes through to the
   network as normal. Offline caching can be layered on later if needed. */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', () => {
  // Pass-through: let the browser handle every request normally.
});
