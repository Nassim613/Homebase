const CACHE = 'homebase-v6';
const ASSETS = ['./', './index.html', './styles.css', './storage.js', './auth.js', './sync.js', './garage.js', './import.js', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith('http')) return; // skip chrome-extension:// and other unsupported schemes
  // Never cache the live sync API — this always needs a fresh network hit. Caching it
  // would mean a pull could silently serve stale data instead of your actual current
  // Sheet contents, which matters even more now that the auth token keeps this URL
  // stable for up to an hour at a time instead of changing on every request.
  if (e.request.url.includes('script.google.com')) return;
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => cached))
  );
});
