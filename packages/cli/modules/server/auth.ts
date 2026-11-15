/**
 * Stored sessions from signet-server (`./auth/sessions`): an HMAC-signed
 * cookie that carries a session id, valid only while that id is in the store,
 * so sessions can be listed and revoked. Added by `signet add auth`.
 *
 * Call `signIn(c, user.id)` once you have checked who the user is, guard
 * routes with `requireAuth()`, and the routes at /api/sessions list and revoke
 * the user's devices.
 */

import { memoryKv } from "@dapplelight/signet-server/adapters"
import {
  requireStoredSession,
  type StoredSessionMiddlewareOptions,
  sessionRoutes,
} from "@dapplelight/signet-server/auth/hono"
import { readSessionCookie, sessionCookie } from "@dapplelight/signet-server/auth/session"
import { kvSessionStore, startSession } from "@dapplelight/signet-server/auth/sessions"
import type { Context } from "hono"
import { env } from "../env.ts"

export const sessions: StoredSessionMiddlewareOptions = {
  cookieName: "app_session",
  // A getter, so env is read per request and never at import: Workers hand
  // the bindings over on the first request.
  get secret() {
    return env.SESSION_SECRET
  },
  // memoryKv keeps sessions in this process only: they are lost on restart and
  // not shared between Workers isolates. Use cloudflareKv or upstashKv from
  // @dapplelight/signet-server/adapters in production.
  store: kvSessionStore(memoryKv()),
}

/** Gate routes on a signed-in session: `.use("/api/me/*", requireAuth())`. */
export const requireAuth = () => requireStoredSession(sessions)

/** GET / lists my sessions, DELETE /:id revokes one, POST /revoke-others the rest. */
export const authRoutes = () => sessionRoutes(sessions)

/** Start a new session for `userId` and set its cookie. Revokes the one the request came with. */
export async function signIn(c: Context, userId: string): Promise<void> {
  const { token } = await startSession(sessions, {
    sub: userId,
    userAgent: c.req.header("user-agent"),
    previousToken: readSessionCookie(c.req.header("cookie"), sessions),
  })
  c.header("Set-Cookie", sessionCookie(token, sessions))
}
