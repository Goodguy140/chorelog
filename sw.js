/* Service worker: PWA installability + Web Push + offline shell (static assets only; /api never cached). */
const CACHE = 'chorelog-static-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) {
          try {
            await cache.put(req, res.clone());
          } catch {
            /* ignore quota / opaque */
          }
        }
        return res;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const nav = (await cache.match('/')) || (await cache.match('/index.html'));
          if (nav) return nav;
        }
        throw new Error('offline');
      }
    })(),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    const txt = event.data && event.data.text();
    if (txt) payload = JSON.parse(txt);
  } catch {
    /* ignore */
  }
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title : 'Chorelog';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const url = typeof payload.url === 'string' && payload.url.startsWith('/') ? payload.url : '/';
  const tag = typeof payload.tag === 'string' && payload.tag ? payload.tag : 'chorelog';
  const options = {
    body,
    icon: '/icons/app-icon.svg',
    badge: '/icons/app-icon.svg',
    data: { url },
    tag,
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url =
    event.notification.data && typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/';
  const path = url.startsWith('/') ? url : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const c of clientList) {
        if (c.url && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(path);
    }),
  );
});
