import { useCallback, useEffect, useState } from "react"
import type { Reply } from "../background"
import { session } from "./auth"

/**
 * Signed in or not, for the popup and options page. Sign-in runs in the service
 * worker (the popup closes when the sign-in window opens); the session watches
 * chrome.storage, so its result reaches every open page through subscribe().
 */
export function useAuth() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    session.get().then((t) => setSignedIn(t !== null))
    return session.subscribe((t) => setSignedIn(t !== null))
  }, [])

  const ask = useCallback(async (type: "signin" | "signout") => {
    setError(null)
    const reply = (await chrome.runtime.sendMessage({ type })) as Reply | undefined
    if (reply && !reply.ok) setError(reply.error)
  }, [])

  return {
    signedIn,
    error,
    signIn: () => ask("signin"),
    signOut: () => ask("signout"),
  }
}
