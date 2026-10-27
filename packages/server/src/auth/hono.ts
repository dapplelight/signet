/**
 * Hono middleware. Requires `hono` as a peer dependency.
 *
 * Imported from "@dapplelight/signet-server/auth/hono" so apps that do not use Hono never
 * pull it in.
 */

import type { MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import { hashIncomingToken, verifySharedToken } from "./bearer.js"
import { readSessionCookie, type SessionOptions, verifySession } from "./session.js"

/** Gate on a stateless session cookie. Sets `session` in the context. */
export function requireSession(opts: SessionOptions): MiddlewareHandler {
  return async (c, next) => {
    const token = readSessionCookie(c.req.header("cookie"), opts)
    const session = await verifySession(token, opts)
    if (!session) throw new HTTPException(401, { message: "Unauthorized" })
    c.set("session", session)
    await next()
  }
}

/** Gate on a single shared bearer token held in an environment secret. */
export function requireSharedToken(
  getExpected: (c: never) => string | undefined,
): MiddlewareHandler {
  return async (c, next) => {
    if (!verifySharedToken(c.req.raw.headers, getExpected(c as never))) {
      throw new HTTPException(401, { message: "Unauthorized" })
    }
    await next()
  }
}

export type DualAuthOptions<U> = {
  session: SessionOptions
  /** API token prefix, e.g. "app". Tokens look like `app_<64 hex>`. */
  tokenPrefix: string
  /** Look up a user by the SHA-256 hash of their API token. */
  findUserByTokenHash: (hash: string) => Promise<U | null>
  /** Look up a user by the session's `sub` claim. */
  findUserBySub: (sub: string) => Promise<U | null>
  /** Fired after a successful token auth. Do not await — keep it off the hot path. */
  onTokenUsed?: (hash: string) => void
}

/**
 * Accept either a machine API token or a browser session, in that order.
 *
 * The pattern app-a arrived at: one protected route serves both the web app and
 * the CLI/MCP client without duplicating the route.
 */
export function requireAuth<U>(opts: DualAuthOptions<U>): MiddlewareHandler {
  return async (c, next) => {
    const hash = await hashIncomingToken(c.req.raw.headers, opts.tokenPrefix)
    if (hash) {
      const user = await opts.findUserByTokenHash(hash)
      if (!user) throw new HTTPException(401, { message: "Invalid API token" })
      c.set("user", user)
      opts.onTokenUsed?.(hash)
      return next()
    }

    const token = readSessionCookie(c.req.header("cookie"), opts.session)
    const session = await verifySession(token, opts.session)
    if (!session?.sub) throw new HTTPException(401, { message: "Unauthorized" })
    const user = await opts.findUserBySub(session.sub)
    if (!user) throw new HTTPException(401, { message: "User not found" })
    c.set("user", user)
    await next()
  }
}
