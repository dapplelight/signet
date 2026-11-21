import { ApiError, createApiClient, errorCopy } from "@dapplelight/signet-lib/api"
import { queryDefaults } from "@dapplelight/signet-lib/api/query-client"
import { QueryClient } from "@tanstack/react-query"
import { analytics } from "./analytics"
import { API_URL, USER_AGENT } from "./config"
import { session } from "./session"

export const queryClient = new QueryClient({ defaultOptions: queryDefaults() })

/**
 * The API, with this phone's bearer token on every request. A 401 is retried
 * once after a refresh; a 401 that stands means the session is gone (revoked,
 * or the refresh token expired), so it is cleared and the gate shows sign-in
 * (lib/auth.ts forgets the rest of the signed-in state).
 */
export const api = createApiClient({
  baseUrl: API_URL,
  credentials: "omit",
  token: session.token,
  refresh: session.refresh,
  headers: async () => ({ ...(await analytics.headers()), "User-Agent": USER_AGENT }),
  onAuthError: () => void session.clear(),
})

/** What to tell the person: the server's own message for a refusal, else Signet's default copy. */
export function messageOf(e: unknown): string {
  if (e instanceof ApiError && e.code && e.status < 500) return e.message
  return errorCopy(e instanceof ApiError ? e.code : undefined).detail
}

/** The signed-in user, as /api/account/me returns them. */
export type User = {
  id: string
  phone: string
  name: string | null
  email: string | null
  role: string
}

/** A signed-in device, as /api/sessions lists them. */
export type Device = {
  id: string
  device: string
  ip: string | null
  createdAt: number
  lastSeenAt: number
  expiresAt: number
  current: boolean
}
