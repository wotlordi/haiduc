/* Haiduc offline support: keeps the app's own files on the device so it opens without internet.
   Notes and tasks are NOT cached here (the app keeps its own copy); requests to Supabase always go to the network. */
const VERSION = 'haiduc-v1';
const APP_FILES = ['./', 'index.html', 'app.js', 'style.css', 'config.js', 'manifest.webmanifest',
  'img/logo.png', 'img/favicon-32.png', 'img/favicon-64.png', 'img/icon-192.png', 'img/apple-touch-icon.png'];
const LIBRARY_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.all(APP_FILES.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;            // live data: never cached here

  if (url.origin === self.location.origin) {                    // app files: newest from the network, saved copy when offline
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await withTimeout(fetch(req, { cache: 'no-cache' }), 6000);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return (await cache.match(req, { ignoreSearch: true }))
          || (req.mode === 'navigate' ? await cache.match('index.html') : undefined)
          || Response.error();
      }
    })());
    return;
  }

  if (LIBRARY_HOSTS.includes(url.hostname)) {                   // libraries and fonts: fixed versions, saved after first use
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })());
  }
});
