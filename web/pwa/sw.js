/* Plume — service worker : garde l'application disponible hors ligne une fois installée ou visitée.
   Réseau d'abord (la dernière version dès qu'on est en ligne), copie en cache sinon. Les appels aux services d'IA
   (autres sites) ne passent jamais par ici. */
'use strict';
const CACHE = 'plume-__VERSION__';
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('plume-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const withTimeout = (p, ms) => Promise.race([p, new Promise((_r, rej) => setTimeout(() => rej(new Error('délai dépassé')), ms))]);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await (req.mode === 'navigate' ? withTimeout(fetch(req), 4000) : fetch(req));   // connexion très lente : on sert la copie
      if (res && res.ok && !res.redirected) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch (_) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const shell = await caches.match('./'); if (shell) return shell; }
      return Response.error();
    }
  })());
});
