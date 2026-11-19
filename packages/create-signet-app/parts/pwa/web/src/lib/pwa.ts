// The installable app: registers public/sw.js (the offline app shell) and
// keeps the browser's install prompt for InstallButton. Chromium browsers fire
// beforeinstallprompt; Safari installs from its Share menu, so there the
// button never shows.

type InstallPromptEvent = Event & { prompt: () => Promise<void> }

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const set = (e: InstallPromptEvent | null) => {
  deferred = e
  for (const l of listeners) l()
}

/** Call once, before the app renders: the prompt can fire before React mounts. */
export function registerPwa(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    set(e as InstallPromptEvent)
  })
  window.addEventListener("appinstalled", () => set(null))
  // `dev` has no service worker: it would cache Vite's modules under you.
  if (import.meta.env.PROD && "serviceWorker" in navigator)
    navigator.serviceWorker.register("/sw.js").catch(() => {})
}

export function subscribeInstall(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

export const canInstall = (): boolean => deferred !== null

/** Shows the browser's install dialog. It can be shown once per event. */
export async function install(): Promise<void> {
  const e = deferred
  set(null)
  await e?.prompt()
}
