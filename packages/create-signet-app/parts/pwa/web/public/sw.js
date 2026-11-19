// The service worker: the app shell works offline. src/lib/pwa.ts registers it
// in built apps only. Pages come from the network and fall back to the cached
// shell (index.html); built files under /assets/ have hashed names, so once
// cached they are served from the cache. /api and /mcp always go to the
// network, so nothing private is cached. A route chunk never loaded while
// online is not cached; visit it once, or list it in cacheShell.
// ponytail: one cache that grows by a few files per deploy; change VERSION to
// start a fresh one.
const VERSION = "v1"
const CACHE = `app-shell-${VERSION}`

async function cacheShell() {
  const cache = await caches.open(CACHE)
  const res = await fetch("/", { cache: "no-cache" })
  const html = await res.clone().text()
  const assets = [...html.matchAll(/\/assets\/[^"'\s]+/g)].map((m) => m[0])
  await cache.put("/", res)
  await cache.addAll(["/manifest.webmanifest", "/icon.svg", ...new Set(assets)])
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp")) return

  if (request.mode === "navigate") {
    // Every page is index.html (the server's SPA fallback): keep the newest.
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            event.waitUntil(caches.open(CACHE).then((c) => c.put("/", copy)))
          }
          return res
        })
        .catch(async () => (await caches.match("/")) ?? Response.error()),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok && url.pathname.startsWith("/assets/")) {
            const copy = res.clone()
            event.waitUntil(caches.open(CACHE).then((c) => c.put(request, copy)))
          }
          return res
        }),
    ),
  )
})
