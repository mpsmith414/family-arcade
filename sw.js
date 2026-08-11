/* Family Arcade service worker.
   Bump CACHE when you change a game, otherwise phones keep the old copy. */
const CACHE = 'arcade-v18';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './shared/kidkit.js',
  './games/oliver-run/index.html',
  './games/emsile-fishing/index.html',
  './games/daddy-smash/index.html',
  './games/tower-climb/index.html',
  './games/treasure-boat/index.html',
  './games/star-wings/index.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(FILES.map(f => c.add(new Request(f, {cache:'reload'})).catch(()=>{}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Cache first: instant loads and full offline play. Refresh in the
   background so the next launch picks up any changes. */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req).then(hit => {
      const live = fetch(req).then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || live;
    })
  );
});
