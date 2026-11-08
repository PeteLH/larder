// Larder service worker: offline copy of the app, push reminders, and receiving files shared from other apps.
const CACHE = 'larder-v1.6';
const SHELL = ['./', 'index.html', 'app.js', 'core.js', 'config.js', 'version.js', 'style.css', 'fonts/fonts.css', 'fonts/inter.woff2', 'fonts/bricolage.woff2', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-180.png', 'vendor/html5-qrcode.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'larder-share').map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Android "Share → Larder" arrives as a POST; stash it and hand over to the app.
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const fd = await e.request.formData();
      const c = await caches.open('larder-share');
      await c.put('shared', new Response(fd));
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
self.addEventListener('push', e => {
  let msg = {};
  try { msg = e.data.json(); } catch { msg = { title: 'Larder', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(msg.title || 'Larder', {
    body: msg.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: msg.tag || 'larder', renotify: true,
    data: { url: msg.url || './' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.navigate(target); return c.focus(); }
    return clients.openWindow(target);
  }));
});
