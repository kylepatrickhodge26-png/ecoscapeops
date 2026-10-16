// EcoScape Ops service worker.
//
// It exists only so the app can be installed and so a signed-out/offline phone shows a
// friendly page. It deliberately caches NOTHING else: no pages, no API responses, no
// customer data, no images. Everything the app shows comes straight from the network,
// so nothing private is ever stored on the device by the worker, and one user's data can
// never be served to another user from a shared cache.
const OFFLINE_CACHE = "ecoscape-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Only page navigations, and only when the network fails.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())),
  );
});
