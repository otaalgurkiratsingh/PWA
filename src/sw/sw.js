/* TrainLuma service worker — app shell and static assets ONLY.
 * Never caches API responses, health data, or photos. Personal data lives in IndexedDB.
 * The build id and precache list are injected at build time by vite.config.ts. */
const BUILD_ID = '__BUILD_ID__';
const PRECACHE = __PRECACHE__;
const CACHE = `rozana-shell-${BUILD_ID}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  // Do not skipWaiting automatically: the page asks the user first (never mid-workout).
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rozana-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch third-party/API traffic

  if (req.mode === 'navigate') {
    // Network first for the page so updates arrive; fall back to the cached shell offline.
    event.respondWith(fetch(req).catch(() => caches.match('/index.html').then((r) => r || Response.error())));
    return;
  }
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((r) => r || fetch(req)));
  }
});

// ---------- reminders (Web Push) ----------
// The payload is end-to-end encrypted to this device by the `notify` function; the browser
// decrypts it before this handler runs. Only same-origin in-app links are followed.
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const title = str(data.title, 80) || 'TrainLuma';
  const url = typeof data.url === 'string' && data.url.startsWith('/#/') ? data.url : '/#/today';
  const kind = KINDS.includes(data.kind) ? data.kind : '';
  // At most one action button ("Log it"), and only one the app knows.
  const actions = Array.isArray(data.actions)
    ? data.actions.filter((a) => a && a.action === 'log' && typeof a.title === 'string').slice(0, 1).map((a) => ({ action: 'log', title: a.title.slice(0, 24) }))
    : [];
  event.waitUntil(
    self.registration.showNotification(title, {
      body: str(data.body, 240),
      tag: str(data.tag, 64) || undefined,
      icon: '/icons/icon-192.png?v=tl3',
      badge: '/icons/icon-192.png?v=tl3',
      data: { url, kind },
      actions,
    }),
  );
});

// Dismissals and opens are kept here until the app sends them (it can reach the account; this
// worker can't). Three dismissals of a kind stop it for good (the server enforces that).
const KINDS = ['routine', 'gym', 'insight'];
function record(kind, what) {
  if (!KINDS.includes(kind)) return Promise.resolve();
  return new Promise((resolve) => {
    const req = indexedDB.open('trainluma-sw', 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('notification-events')) req.result.createObjectStore('notification-events', { keyPath: 'id', autoIncrement: true }); };
    req.onerror = () => resolve();
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction('notification-events', 'readwrite');
        tx.objectStore('notification-events').add({ kind, what, at: new Date().toISOString() });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
      } catch {
        db.close();
        resolve();
      }
    };
  });
}

self.addEventListener('notificationclose', (event) => {
  const d = event.notification.data || {};
  event.waitUntil(record(d.kind, 'dismissed'));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const raw = d.url;
  // "Log it" opens the one-tap confirm for the routine meal (the same link as tapping the note).
  const url = typeof raw === 'string' && raw.startsWith('/#/') ? raw : '/#/today';
  event.waitUntil(
    record(d.kind, 'opened').then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true })).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
