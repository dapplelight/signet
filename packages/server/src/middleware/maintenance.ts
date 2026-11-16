/**
 * Maintenance mode. Requires `hono` as an optional peer.
 *
 * While on, every request outside the allowlist gets a 503 with
 * `Retry-After` and the standard envelope (`code: "MAINTENANCE"`). The state
 * comes from a callback, usually signet-db's `status.maintenance()`, toggled
 * from admin (`statusAdminRoutes`' `PUT /maintenance`).
 *
 * ```ts
 * app.use("*", maintenanceMode({
 *   state: () => status.maintenance(),
 *   paths: ["/health", "/api/status", "/api/admin"],     // health checks, the status page, admin
 *   allow: (c) => c.get("session")?.role === "admin",    // admins keep working everywhere
 * }))
 * ```
 */

import type { Context, MiddlewareHandler, Next } from "hono"

export type MaintenanceState = { on: boolean; message?: string | null; until?: Date | null }

export type MaintenanceOptions = {
  /** Whether maintenance is on now. Read at most once per `cacheMs`. */
  state: (c: Context) => MaintenanceState | Promise<MaintenanceState>
  /**
   * Path prefixes that always pass: health checks, the status page, admin.
   * Default `["/health", "/healthz"]`. A prefix matches itself and anything
   * under it (`/api/admin` matches `/api/admin/status`, not `/api/administer`).
   */
  paths?: readonly string[]
  /** Lets a request through anyway, e.g. an admin session. */
  allow?: (c: Context) => boolean | Promise<boolean>
  /** How long a state read is reused, in ms. Default 5000; 0 reads every request. */
  cacheMs?: number
  /** Retry-After in seconds when the state has no `until`. Default 300. */
  retryAfterSeconds?: number
  /** The envelope's message when the state has none. */
  message?: string
  /** Where the request id lives, for the envelope. Default: `c.get("reqId")`. */
  getRequestId?: (c: Context) => string | undefined
  /** Clock, for tests. */
  now?: () => number
}

export function maintenanceMode(opts: MaintenanceOptions): MiddlewareHandler {
  const paths = opts.paths ?? ["/health", "/healthz"]
  const cacheMs = opts.cacheMs ?? 5000
  const now = opts.now ?? Date.now
  // ponytail: per-isolate cache, so a toggle reaches every isolate within cacheMs.
  let cached: { state: MaintenanceState; at: number } | null = null

  const read = async (c: Context) => {
    if (cached && now() - cached.at < cacheMs) return cached.state
    let state: MaintenanceState
    try {
      state = await opts.state(c)
    } catch {
      // Store unreadable: keep the last good state (or "off" with none) and
      // retry after cacheMs, so an outage never turns into a 500 on every route.
      state = cached?.state ?? { on: false }
    }
    cached = { state, at: now() }
    return state
  }

  return async (c: Context, next: Next) => {
    const path = c.req.path
    if (paths.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`)))
      return next()
    const state = await read(c)
    if (!state.on || (opts.allow && (await opts.allow(c)))) return next()
    const until = state.until ? Math.ceil((state.until.getTime() - now()) / 1000) : 0
    c.header("Retry-After", String(until > 0 ? until : (opts.retryAfterSeconds ?? 300)))
    c.header("Cache-Control", "no-store")
    const reqId = (opts.getRequestId ?? ((x) => x.get("reqId" as never) as string | undefined))(c)
    return c.json(
      {
        success: false as const,
        error: state.message || opts.message || "We are down for maintenance. Try again soon.",
        code: "MAINTENANCE",
        ...(reqId ? { requestId: reqId } : {}),
      },
      503,
    )
  }
}
