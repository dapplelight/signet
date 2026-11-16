/// <reference lib="webworker" />
// The service worker vite-plugin-pwa builds from this file (injectManifest).
// It precaches the built app, serves public/offline.html for a page load with
// no network, applies an update when the "Reload" toast is tapped, and shows
// web push notifications. Authenticated API responses are never cached here:
// /api/* always goes to the network, so nothing private outlives sign-out.
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching"
import { NavigationRoute, registerRoute } from "workbox-routing"

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

const OFFLINE_CACHE = "offline-fallback"

registerRoute(
  new NavigationRoute(
    async ({ request }) => {
      try {
        return await fetch(request)
      } catch {
        return (
          (await caches.match("/offline.html", { cacheName: OFFLINE_CACHE })) ?? Response.error()
        )
      }
    },
    // OAuth callbacks and API navigations never get the app shell or the offline page.
    { denylist: [/^\/api\//] },
  ),
)

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((c) => c.add("/offline.html")))
})

// registerType "prompt": the page posts SKIP_WAITING when the person taps Reload.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting()
})
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

// Web push: { title, message, url, tag } as JSON; plain text also works.
self.addEventListener("push", (event) => {
  let p: { title?: string; message?: string; url?: string; tag?: string } = {}
  try {
    p = event.data?.json() ?? {}
  } catch {
    p = { message: event.data?.text() ?? "" }
  }
  event.waitUntil(
    self.registration.showNotification(p.title ?? "__APP_NAME__", {
      body: p.message ?? "",
      tag: p.tag,
      data: { url: p.url ?? "/" },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data?.url as string | undefined) ?? "/"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => "focus" in c) as WindowClient | undefined
      if (open) return open.navigate(url).then(() => open.focus())
      return self.clients.openWindow(url)
    }),
  )
})
