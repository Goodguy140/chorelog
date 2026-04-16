/* Service worker: PWA installability + Web Push + offline shell (static assets only; /api never cached). */
const CACHE = 'chorelog-static-v1';
const WRITE_QUEUE_DB = 'chorelog-offline-writes-v1';
const WRITE_QUEUE_STORE = 'requests';
const WRITE_QUEUE_SYNC_TAG = 'chorelog-sync-writes';

function openWriteQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WRITE_QUEUE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(WRITE_QUEUE_STORE)) {
        const store = db.createObjectStore(WRITE_QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open DB'));
  });
}

async function queueWriteRequest(req) {
  const cloned = req.clone();
  const headers = {};
  cloned.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const bodyText = await cloned.text();
  const row = {
    url: cloned.url,
    method: cloned.method,
    headers,
    bodyText,
    credentials: cloned.credentials || 'include',
    mode: cloned.mode || 'same-origin',
    createdAt: Date.now(),
  };
  const db = await openWriteQueueDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(WRITE_QUEUE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Queue write failed'));
    tx.objectStore(WRITE_QUEUE_STORE).add(row);
  });
  db.close();
}

async function listQueuedWrites() {
  const db = await openWriteQueueDb();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(WRITE_QUEUE_STORE, 'readonly');
    const req = tx.objectStore(WRITE_QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    req.onerror = () => reject(req.error || new Error('Queue read failed'));
  });
  db.close();
  return rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

async function removeQueuedWrite(id) {
  const db = await openWriteQueueDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(WRITE_QUEUE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Queue remove failed'));
    tx.objectStore(WRITE_QUEUE_STORE).delete(id);
  });
  db.close();
}

async function notifyClients(type, payload = {}) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  await Promise.all(
    clients.map((client) => client.postMessage({ type, ...payload })),
  );
}

async function replayQueuedWrites() {
  const rows = await listQueuedWrites();
  let replayed = 0;
  for (const row of rows) {
    try {
      const res = await fetch(row.url, {
        method: row.method,
        headers: row.headers,
        body: row.bodyText || undefined,
        credentials: row.credentials || 'include',
        mode: row.mode || 'same-origin',
      });
      if (!res.ok && res.status >= 500) break;
      await removeQueuedWrite(row.id);
      replayed += 1;
    } catch {
      break;
    }
  }
  if (replayed > 0) {
    await notifyClients('CHORELOG_OFFLINE_REPLAY_APPLIED', { replayed });
  }
}

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
  const url = new URL(req.url);
  if (req.method !== 'GET' && url.origin === self.location.origin && url.pathname.startsWith('/api')) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          await queueWriteRequest(req);
          if ('sync' in self.registration) {
            try {
              await self.registration.sync.register(WRITE_QUEUE_SYNC_TAG);
            } catch {
              /* ignore */
            }
          }
          await notifyClients('CHORELOG_OFFLINE_WRITE_QUEUED');
          return new Response(
            JSON.stringify({
              ok: true,
              queued: true,
              offline: true,
              message: 'Write queued for background sync',
            }),
            {
              status: 202,
              headers: {
                'Content-Type': 'application/json',
                'X-Chorelog-Queued': '1',
              },
            },
          );
        }
      })(),
    );
    return;
  }
  if (req.method !== 'GET') return;
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

self.addEventListener('sync', (event) => {
  if (event.tag !== WRITE_QUEUE_SYNC_TAG) return;
  event.waitUntil(replayQueuedWrites());
});

self.addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'CHORELOG_TRIGGER_SYNC') {
    event.waitUntil(replayQueuedWrites());
  }
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
