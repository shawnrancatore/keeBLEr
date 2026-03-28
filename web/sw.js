// SPDX-License-Identifier: MIT
// keeBLEr service worker — stale-while-revalidate caching

const CACHE_NAME = 'keebler-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/protocol.js',
  './js/keycodes.js',
  './js/state.js',
  './js/ui.js',
  './js/connection.js',
  './js/keyboard.js',
  './js/mouse.js',
  './js/capture.js',
  './js/c64.js',
  './js/init.js',
  './av/index.html',
  './av/av-app.js',
  './av/manifest.webmanifest',
  './64/index.html',
  './64/c64-app.js',
  './64/c64.css',
  './64/manifest.webmanifest',
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch: serve from cache, fall back to network, cache the response
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(() => {});
        return cached;
      }

      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});
