// Offline support: serve the app shell from cache and refresh it in the background.
// The Supabase library from the CDN is cached too, so the app opens with no connection.
// Bump VERSION whenever app files change.
const VERSION = 'bayit-v7';
const ASSETS = [
  './', './index.html', './styles.css', './config.js', './manifest.webmanifest',
  './js/app.js', './js/store.js', './js/logic.js', './js/categories.js', './js/seed.js', './js/receiptText.js', './js/ocr.js', './js/receiptPdf.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];
const CDN = 'https://cdn.jsdelivr.net';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'bayit-share').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // Android share sheet: a receipt PDF or photo shared to the app arrives here.
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      const form = await req.formData();
      const file = form.get('file');
      const text = form.get('text') || form.get('url') || '';
      if (file && file.size) {
        const cache = await caches.open('bayit-share');
        await cache.put('shared-file', new Response(file, { headers: { 'content-type': file.type || 'application/octet-stream', 'x-name': encodeURIComponent(file.name || 'receipt') } }));
        return Response.redirect('./?shared=file', 303);
      }
      return Response.redirect('./?text=' + encodeURIComponent(text), 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin && url.origin !== CDN) return;
  event.respondWith(
    caches.open(VERSION).then(cache =>
      cache.match(req, { ignoreSearch: url.origin === self.location.origin }).then(cached => {
        const fresh = fetch(req).then(res => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    )
  );
});
