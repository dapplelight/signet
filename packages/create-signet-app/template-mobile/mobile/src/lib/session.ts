import {
  createSession,
  type SessionTokens,
  tokenEndpointRefresh,
} from "@dapplelight/signet-lib/session"
import { useEffect, useState } from "react"
import { API_URL } from "./config"
import { secureStorage } from "./storage"

/** The client id the API knows this app by (services.ts, `clientLogin`). */
export const CLIENT_ID = "mobile"

/**
 * The signed-in tokens, kept in the secure store. A stale access token is
 * refreshed at the API's token endpoint before a request; a refused refresh
 * clears the session, and the auth gate in app/_layout.tsx sends you to sign-in.
 */
export const session = createSession({
  storage: secureStorage,
  refresh: tokenEndpointRefresh(`${API_URL}/api/mobile/token`, CLIENT_ID),
})

/** The tokens, null when signed out, undefined while the secure store is read. */
export function useSession(): SessionTokens | null | undefined {
  const [tokens, setTokens] = useState<SessionTokens | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    const off = session.subscribe((t) => live && setTokens(t))
    session.get().then(
      (t) => live && setTokens(t),
      () => live && setTokens(null),
    )
    return () => {
      live = false
      off()
    }
  }, [])
  return tokens
}
