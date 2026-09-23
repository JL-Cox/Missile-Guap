/*
  A deliberately small, readable service worker.

  It only ever touches this app's own origin. There is no push handler, no
  background sync to a server, and no code path that can send anything
  anywhere - by design, so that "nothing leaves your device" stays true even
  when the app is not open.
*/

// The build step prepends `self.__BASE__`, `self.__BUILD__` and
// `self.__PRECACHE__` with the real hashed filenames and the path the app is
// served from. Without them (dev server) we fall back to the shell at the root.
const BASE = self.__BASE__ || '/';
const SHELL = `${BASE}index.html`;
const CACHE = `steady-${self.__BUILD__ || 'dev'}`;
const PRECACHE = self.__PRECACHE__ || [BASE, SHELL, `${BASE}manifest.webmanifest`];

/*
  Every cache this app has ever made is named steady-<build>. Only those are
  ever deleted: the cache storage belongs to the whole address, and anything
  else in it is not ours to throw away.
*/
const OURS = 'steady-';

/*
  The one place this worker touches the network, for this app's own files.
  Kept to a single call on purpose: tools/privacy-check.mjs counts them, so a
  second one cannot be added without somebody noticing.
*/
const network = (request) => fetch(request);

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for every tab to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One bad URL must not fail the whole install and leave the app with no
      // offline copy at all, so each file is cached independently.
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(OURS) && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Anything not from this origin is none of our business. There should not be
  // any, and the page's CSP blocks it regardless, but this makes it explicit.
  if (url.origin !== self.location.origin) return;

  /*
    `ignoreVary` matters more than it looks. Static hosts commonly answer with
    `Vary: Origin`, and Vite's module scripts are requested with `crossorigin`,
    so the browser sends an `Origin` header that the service worker's own
    `cache.add()` request never had. With Vary respected, every asset lookup
    misses, and the app is a blank page the first time you lose signal. We only
    ever cache our own static files, so varying on anything is meaningless here.
  */
  const fromCache = (req) => caches.match(req, { ignoreVary: true });

  // Navigations: try the network so updates land, fall back to cache offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      network(request)
        .then((response) => {
          /*
            Only a real page replaces the offline copy. Caching whatever came
            back meant one 404, captive-portal login page or server error while
            online became the app you got every time you were offline.
          */
          const type = response.headers.get('Content-Type') || '';
          if (response.ok && type.includes('text/html')) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(SHELL, copy));
          }
          return response;
        })
        .catch(async () => {
          const hit = await fromCache(SHELL);
          return hit ?? new Response('Steady is not cached on this device yet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          });
        }),
    );
    return;
  }

  // Assets: cache first. Vite hashes filenames, so a cached hit is never stale.
  event.respondWith(
    fromCache(request).then((hit) => {
      if (hit) return hit;
      return network(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        // A rejected respondWith shows as a hard network error with no clue
        // why, so fail with something the developer tools can actually show.
        .catch(() => new Response('', { status: 504, statusText: 'Offline and not cached' }));
    }),
  );
});

// Tapping a reminder notification brings the app forward rather than opening a
// second copy of it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = all.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(BASE);
    })(),
  );
});
