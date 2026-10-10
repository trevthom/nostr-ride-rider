// ════════════════════════════════════════════════════════════
//  SERVICE WORKER — Makes the app installable and fast, and shows system
//  notifications reliably on phones (page code calls
//  registration.showNotification, which works where `new Notification` does not).
//
//  Caching (nothing here touches relays, tiles or APIs):
//    • page navigations     network first, saved copy when offline
//    • /assets/* (hashed)   cache first (the file name changes with the content)
//    • Tailwind + fonts CDN stale-while-revalidate, so the app is styled offline
//
//  This does NOT deliver push messages while the app is closed: that needs a
//  push server (see docs/index.md, "Reliability").
// ════════════════════════════════════════════════════════════

const CACHE = "nostrride-v1:" + self.registration.scope;
const CDN = ["cdn.tailwindcss.com", "fonts.googleapis.com", "fonts.gstatic.com"];

// On install, keep the page and its script/style files, so the first OFFLINE start works too.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        const res = await fetch(self.registration.scope, { cache: "reload" });
        const html = await res.clone().text();
        await cache.put(self.registration.scope, res);
        const assets = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href);
        await Promise.all(assets.map((u) => cache.add(u).catch(() => {})));
      } catch { /* offline during install: the cache fills as the app is used */ }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("nostrride-") && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || (await cache.match(self.registration.scope)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const fresh = fetch(request).then((res) => { if (res.ok || res.type === "opaque") cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await fresh) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (request.mode === "navigate") event.respondWith(networkFirst(request));
    else if (url.pathname.includes("/assets/")) event.respondWith(cacheFirst(request));
  } else if (CDN.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// Tapping a notification brings the app forward.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const mine = all.find((c) => c.url.startsWith(self.registration.scope));
      if (mine) return mine.focus();
      return self.clients.openWindow(self.registration.scope);
    })()
  );
});
