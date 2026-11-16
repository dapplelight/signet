// The service worker: no DOM here, so no window or document. It owns sign-in
// because the popup closes the moment the sign-in window takes focus, and a
// closed popup cannot finish the token exchange. Pages send a message and
// follow the result through session.subscribe().
import { signIn, signOut } from "./lib/auth"

type Message = { type: "signin" } | { type: "signout" }
export type Reply = { ok: true } | { ok: false; error: string }

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const m = message as Message
  const run = m.type === "signin" ? signIn : m.type === "signout" ? signOut : null
  if (!run) return undefined
  run().then(
    () => sendResponse({ ok: true } satisfies Reply),
    (e: unknown) =>
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      } satisfies Reply),
  )
  return true // the reply is async
})
