// Keeps the installed app on the latest deploy. An installed PWA that stays
// open rarely re-checks its service worker (browsers do it on navigation), so:
//  - check for an update when the app returns to the foreground, and every 30 min;
//  - when one is waiting, show a "Reload" toast, and apply it by itself the next
//    time the app is in the background, so nothing reloads under someone mid-task.

import { registerSW } from "virtual:pwa-register"
import { toast } from "sonner"
import i18n from "./i18n"

const CHECK_EVERY_MS = 30 * 60 * 1000

type Doc = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">

export function wireUpdateChecks(
  registration: { update: () => Promise<unknown> },
  doc: Doc = document,
  everyMs = CHECK_EVERY_MS,
): () => void {
  // A failed check (offline) is harmless; the next one retries.
  const check = () => void registration.update().catch(() => {})
  const onVisible = () => doc.visibilityState === "visible" && check()
  doc.addEventListener("visibilitychange", onVisible)
  const timer = setInterval(check, everyMs)
  return () => {
    doc.removeEventListener("visibilitychange", onVisible)
    clearInterval(timer)
  }
}

/** Run `apply` once, the first time the page is hidden (now, if it already is). */
export function applyWhenHidden(apply: () => void, doc: Doc = document): () => void {
  let done = false
  const maybe = () => {
    if (done || doc.visibilityState !== "hidden") return
    done = true
    apply()
  }
  maybe()
  doc.addEventListener("visibilitychange", maybe)
  return () => doc.removeEventListener("visibilitychange", maybe)
}

export function registerPwa(): void {
  // `bun run dev` has no service worker; only built and previewed apps do.
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return
  const update = registerSW({
    onRegisteredSW(_url, registration) {
      if (registration) wireUpdateChecks(registration)
    },
    onNeedRefresh() {
      const reload = () => void update(true)
      toast(i18n.t("update.available"), {
        duration: Number.POSITIVE_INFINITY,
        action: { label: i18n.t("update.reload"), onClick: reload },
      })
      applyWhenHidden(reload)
    },
  })
}
