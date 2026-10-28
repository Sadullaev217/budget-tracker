// Service worker — caches the app shell so the tracker works offline.
// Bump CACHE_VERSION when any cached file changes.
const CACHE_VERSION = 'ledger-v10';
const SHELL = [
  '/',
  '/index.html',
  '/style.css?v=10',
  '/lib.js?v=10',
  '/app.js?v=10',
  '/icon.svg',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Network-first for HTML (always get the latest), cache-first for assets.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests
  if(event.request.method !== 'GET' || url.origin !== location.origin) return;

  // HTML pages — try network first, fall back to cache
  if(event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')){
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else — cache first, then network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;
      return fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
        return res;
      });
    })
  );
});
