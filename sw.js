// Offline support. App files come from the network when it answers quickly, so updates show
// up on the next open; with no connection (or a slow one) they come from the cache.
// The Supabase, reading and PDF libraries from the CDN have fixed versions and are cached.
// Bump VERSION (and APP_VERSION in js/app.js) whenever app files change.
const VERSION = 'bayit-v8';
const ASSETS = [
  './', './index.html', './styles.css', './config.js', './manifest.webmanifest',
  './js/app.js', './js/store.js', './js/logic.js', './js/categories.js', './js/seed.js', './js/receiptText.js', './js/ocr.js', './js/receiptPdf.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];
const CDN = 'https://cdn.jsdelivr.net';
const NETWORK_WAIT_MS = 3000;

self.addEventListener('install', event => {
  // "reload" skips the browser's own cache, so the new version really is new.
  event.waitUntil(caches.open(VERSION)
    .then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'bayit-share').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  const fromNetwork = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_WAIT_MS, null));
  try {
    const res = await Promise.race([fromNetwork, timeout]);
    if (res) return res;
  } catch (e) { /* offline: use the cache */ }
  const cached = await cache.match(req, { ignoreSearch: true });
  return cached || fromNetwork;
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

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
  if (url.origin === self.location.origin) event.respondWith(networkFirst(req));
  else if (url.origin === CDN) event.respondWith(cacheFirst(req));
});
