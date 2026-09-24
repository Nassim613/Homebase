const CACHE = 'homebase-v16';
const ASSETS = ['./', './index.html', './styles.css', './storage.js', './auth.js', './sync.js', './garage.js', './builds.js', './noah.js', './import.js', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];

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

// ---------- Push notifications ----------
// Messages are sent data-only (see notifyNewRecords_ in the Apps Script), so nothing
// is displayed automatically and this decides what the notification says. That also
// means the Firebase SDK isn't needed in here at all — this is a plain Web Push
// event, which is far less to keep running in the background.
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (err) { payload = {}; }
  const data = payload.data || payload;
  const title = data.title || 'Homebase';
  const options = {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'homebase',
    data: { tab: data.tab || 'finance' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses an already-open Homebase and switches it to the
// right tab, rather than opening a second copy of the app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const tab = (e.notification.data && e.notification.data.tab) || 'finance';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('/Homebase') && 'focus' in client) {
          client.postMessage({ type: 'notification-tab', tab });
          return client.focus();
        }
      }
      return self.clients.openWindow('./index.html?tab=' + encodeURIComponent(tab));
    })
  );
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
