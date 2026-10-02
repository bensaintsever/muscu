// Service worker : réseau d'abord (mises à jour rapides), cache en repli (hors ligne en salle).
const VERSION = '2026-10-02-3';
const CACHE = `muscu-${VERSION}`;
const NETWORK_TIMEOUT = 4000;

const ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'css/suivi.css',
  'js/app.js',
  'js/timer.js',
  'js/db.js',
  'js/progression.js',
  'js/program.js',
  'js/history.js',
  'js/settings.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Fichier par fichier : un échec isolé ne bloque pas l'installation
    await Promise.all(ASSETS.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok && !res.redirected) await cache.put(url, res);
      } catch { /* sera mis en cache au prochain passage réseau */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('muscu-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(event, req));
});

async function networkFirst(event, req) {
  const cache = await caches.open(CACHE);
  const isNav = req.mode === 'navigate';

  const network = fetch(req).then((res) => {
    if (res && res.ok && res.type === 'basic' && !res.redirected) {
      const copy = res.clone();
      event.waitUntil(cache.put(isNav ? 'index.html' : req, copy).catch(() => {}));
    }
    return res;
  });
  event.waitUntil(network.catch(() => {}));

  // Réseau lent (salle de sport) : au-delà du délai, on sert le cache s'il existe
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT, 'timeout'));
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== 'timeout') return first;
    const cached = await fromCache(cache, req, isNav);
    return cached || await network;
  } catch {
    const cached = await fromCache(cache, req, isNav);
    if (cached) return cached;
    return new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function fromCache(cache, req, isNav) {
  if (isNav) return (await cache.match('index.html')) || (await cache.match('./'));
  return cache.match(req, { ignoreSearch: true });
}
