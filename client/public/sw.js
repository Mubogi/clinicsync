/* ClinicSync service worker.
 *
 * Update strategy: network-first for the app shell so a new build activates on
 * the next launch, cache-first only for hashed Vite assets which are immutable.
 * The cache name carries a version — bump it when the strategy changes so old
 * entries are dropped on activate.
 */
const CACHE = "clinicsync-v3";
const SHELL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SHELL, "/manifest.webmanifest", "/favicon.svg"]))
      .catch(() => undefined)
  );
  // Take over as soon as the new worker is installed.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// Let the page trigger an immediate activation when it shows the update prompt.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

const isImmutableAsset = (url) =>
  url.pathname.startsWith("/assets/") &&
  (url.pathname.endsWith(".js") || url.pathname.endsWith(".css") ||
   url.pathname.endsWith(".woff2") || url.pathname.endsWith(".png") ||
   url.pathname.endsWith(".svg"));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never let the service worker cache or serve API traffic.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first so deploys are picked up, fall back to the shell.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(SHELL, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(SHELL);
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Hashed build assets: cache-first (safe — the filename changes each build).
  if (isImmutableAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(request, res.clone());
        }
        return res;
      })()
    );
    return;
  }

  // Everything else: network-first with a cached fallback.
  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw new Error("offline and not cached");
      }
    })()
  );
});