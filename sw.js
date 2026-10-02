// Service worker : réseau d'abord (mises à jour rapides), cache en repli (hors ligne en salle).
const VERSION = '2026-10-02-7';
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
  'js/media.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'img/ex/chest-row-incline/0.jpg',
  'img/ex/chest-row-incline/1.jpg',
  'img/ex/crunch/0.jpg',
  'img/ex/crunch/1.jpg',
  'img/ex/curl-cable/0.jpg',
  'img/ex/curl-cable/1.jpg',
  'img/ex/curl-marteau-cable/0.jpg',
  'img/ex/curl-marteau-cable/1.jpg',
  'img/ex/dc-incline-halteres/0.jpg',
  'img/ex/dc-incline-halteres/1.jpg',
  'img/ex/developpe-barre/0.jpg',
  'img/ex/developpe-barre/1.jpg',
  'img/ex/ecarte-banc/0.jpg',
  'img/ex/ecarte-banc/1.jpg',
  'img/ex/ecarte-incline/0.jpg',
  'img/ex/ecarte-incline/1.jpg',
  'img/ex/elevation-laterale/0.jpg',
  'img/ex/elevation-laterale/1.jpg',
  'img/ex/extension-triceps-haut/0.jpg',
  'img/ex/extension-triceps-haut/1.jpg',
  'img/ex/fentes-marchees/0.jpg',
  'img/ex/fentes-marchees/loop.mp4',
  'img/ex/leg-curl/0.jpg',
  'img/ex/leg-curl/1.jpg',
  'img/ex/mollet-presse/0.jpg',
  'img/ex/mollet-presse/1.jpg',
  'img/ex/oiseau-incline/0.jpg',
  'img/ex/oiseau-incline/1.jpg',
  'img/ex/pushdown-cable/0.jpg',
  'img/ex/pushdown-cable/1.jpg',
  'img/ex/step-up/0.jpg',
  'img/ex/step-up/1.jpg',
  'img/ex/tirage-un-bras/0.jpg',
  'img/ex/tirage-un-bras/1.jpg',
  'img/ex/traction-pronation/0.jpg',
  'img/ex/traction-pronation/1.jpg',
  'img/ex/wallball-thruster/0.jpg',
  'img/ex/wallball-thruster/1.jpg',
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
  // Illustrations : elles ne changent pas, cache d'abord
  if (url.pathname.includes('/img/ex/')) { event.respondWith(cacheFirst(req)); return; }
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

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}
