// BMS Troubleshooter service worker - application version 0.6.26-logic-review-draft
// v0.6.24: network-first requests time out to the cached copy, Google Fonts are cached for offline use,
// and a new worker waits until the technician applies the update (no mid-case code or content swap).
const CACHE_NAME = 'bms-troubleshooter-v0-6-26-logic-review-draft';
const NETWORK_TIMEOUT_MS = 3000;
const CORE_FILES = [
  './',
  './index.html',
  './output.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  // No skipWaiting here: the page shows an "Apply update" prompt and sends SKIP_WAITING when the technician agrees.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_FILES.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('bms-troubleshooter-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// v0.6.26: core release files stay paired until Apply update activates the new worker.
async function coreSnapshot(event, fallback) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(fallback);
  return cached || networkFirst(event, fallback);
}
// Network first, but fall back to the cached copy if the network is slow (weak signal) or fails.
// A slow network response still updates the cache in the background.
async function networkFirst(event, fallback) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const cached = (await cache.match(request)) || (fallback ? await cache.match(fallback) : undefined);
  const networkPromise = fetch(request, { cache: 'no-store' }).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  networkPromise.catch(() => {});
  event.waitUntil(networkPromise.catch(() => {}));
  if (!cached) return networkPromise.catch(() => Response.error());
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  try {
    const response = await Promise.race([networkPromise, timeout]);
    if (response && response.ok) return response;
  } catch (error) { /* use the cached copy */ }
  return cached;
}

// Fonts: serve from cache when present and refresh in the background, so IBM Plex renders offline after one online visit.
async function fontCacheFirst(event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request).then(async (response) => {
    if (response && (response.ok || response.type === 'opaque')) await cache.put(event.request, response.clone());
    return response;
  });
  refresh.catch(() => {});
  event.waitUntil(refresh.catch(() => {}));
  return cached || refresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(fontCacheFirst(event));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Serve the installed HTML snapshot; a waiting worker offers the next release.
  if (request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    event.respondWith(coreSnapshot(event, './index.html'));
    return;
  }

  // Serve the matching installed logic snapshot, including offline.
  if (url.pathname.endsWith('/output.json')) {
    event.respondWith(coreSnapshot(event, './output.json'));
    return;
  }

  // Stable static assets remain cache-first for reliable offline field use.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
