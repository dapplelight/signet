/**
 * Record who is calling for the audit log: actor, client IP, user agent and
 * request id, read with `c.get("audit")`. Requires `hono` as an optional peer.
 * Typed structurally, so this package does not depend on signet-db: the value
 * is what signet-db's `audited(db, { actor, request })` and `audit()` take.
 *
 * ```ts
 * app.use("*", requestId())
 * app.use("*", auditContext({ trust: "cloudflare", actor: async (c) => {
 *   const u = await currentUser(c)
 *   return u ? { type: "user", id: u.id } : undefined
 * } }))
 * ```
 *
 * `adminRoutes` passes `request` to signet-db's admin handler on its own.
 */

import type { Context, MiddlewareHandler, Next } from "hono"
import { type ClientIpTrust, clientIp } from "./rate-limit.js"

export type AuditActor = { type: "user" | "agent" | "system"; id: string }

/** Matches signet-db's `AuditRequest`. */
export type AuditRequestInfo = {
  ip: string | null
  userAgent: string | null
  requestId: string | null
}

export type AuditContext = { actor?: AuditActor; request: AuditRequestInfo }

export type AuditContextOptions = {
  /** Which proxy to believe about the client IP, see `ClientIpTrust`. Default `"none"`: no IP is recorded. */
  trust?: ClientIpTrust
  /** The caller; undefined for anonymous requests. */
  actor?: (c: Context) => AuditActor | undefined | null | Promise<AuditActor | undefined | null>
}

const MAX_UA = 512 // the header is caller-controlled and lands in a table

export function auditContext(opts: AuditContextOptions = {}): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const actor = opts.actor ? await opts.actor(c) : undefined
    const ctx: AuditContext = {
      ...(actor ? { actor } : {}),
      request: {
        ip: clientIp(c, opts.trust ?? "none"),
        userAgent: c.req.header("user-agent")?.slice(0, MAX_UA) ?? null,
        requestId: (c.get("reqId") as string | undefined) ?? null,
      },
    }
    c.set("audit", ctx)
    await next()
  }
}
