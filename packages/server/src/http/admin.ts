/**
 * Mount an admin API (signet-db's `defineAdmin`) as Hono routes. Requires
 * `hono` as an optional peer. Typed structurally, so this package does not
 * depend on signet-db: anything with signet-db's `handle()` shape works.
 *
 * ```ts
 * app.onError(errorHandler({ isProduction }))
 * app.route("/admin", adminRoutes(admin, {
 *   db: (c) => createDb(c.env.DB, { audit }),
 *   ctx: async (c) => {
 *     const user = await currentUser(c)
 *     return user ? { actor: { type: "user", id: user.id }, role: user.role } : undefined
 *   },
 * }))
 * ```
 *
 * A missing context is 401. signet-db's `AdminError` (403, 404, 400 with
 * field details…) is rethrown as `ApiException`, so `errorHandler` writes the
 * standard envelope with the request id.
 */

import { type Context, Hono } from "hono"
import { type ApiErrorStatus, ApiException } from "./errors.js"

/** The request signet-db's admin `handle()` takes. */
export type AdminHttpRequest = {
  method: string
  table?: string
  id?: string
  action?: string
  query?: Record<string, string | undefined>
  body?: unknown
}

/** What `adminRoutes` needs from signet-db's `defineAdmin(...)`. */
export type AdminHandler<D, C> = {
  handle(db: D, ctx: C, req: AdminHttpRequest): Promise<{ status: 200 | 201; body: unknown }>
}

export type AdminRoutesOptions<D, C> = {
  /** The request's db, e.g. `createDb(c.env.DB, { audit })`. */
  db: (c: Context) => D | Promise<D>
  /** The caller; undefined or null answers 401 before anything runs. */
  ctx: (c: Context) => C | null | undefined | Promise<C | null | undefined>
}

type AdminErrorLike = Error & {
  status: ApiErrorStatus
  code: string
  details?: { formErrors: string[]; fieldErrors: Record<string, string[]> }
}

// By shape: signet-db's AdminError is a SignetDbError with an HTTP status.
const isAdminError = (e: unknown): e is AdminErrorLike =>
  e instanceof Error &&
  e.name === "SignetDbError" &&
  typeof (e as { status?: unknown }).status === "number" &&
  typeof (e as { code?: unknown }).code === "string"

export function adminRoutes<D, C>(admin: AdminHandler<D, C>, options: AdminRoutesOptions<D, C>) {
  const app = new Hono()
  const run = async (c: Context) => {
    const ctx = await options.ctx(c)
    if (ctx === undefined || ctx === null)
      throw new ApiException(401, "Sign in to use the admin API.", "UNAUTHORIZED")
    let body: unknown
    if (c.req.method === "POST" || c.req.method === "PATCH") {
      const text = await c.req.text()
      if (text) {
        try {
          body = JSON.parse(text)
        } catch {
          throw new ApiException(400, "Invalid JSON body", "INVALID_JSON")
        }
      }
    }
    const { table, id, action } = c.req.param() as Record<string, string | undefined>
    // From auditContext(), if mounted: lets signet-db record ip, user agent and request id.
    const request = (c.get("audit") as { request?: unknown } | undefined)?.request
    const withRequest =
      request && typeof ctx === "object" && !("request" in ctx) ? { ...ctx, request } : ctx
    try {
      const res = await admin.handle(await options.db(c), withRequest as C, {
        method: c.req.method,
        ...(table !== undefined ? { table } : {}),
        ...(id !== undefined ? { id } : {}),
        ...(action !== undefined ? { action } : {}),
        query: c.req.query(),
        body,
      })
      return c.json(res.body as object, res.status)
    } catch (e) {
      if (isAdminError(e)) throw new ApiException(e.status, e.message, e.code, e.details)
      throw e
    }
  }
  app.get("/", run)
  app.on(["GET", "POST"], "/:table", run)
  app.on(["GET", "PATCH", "DELETE", "POST"], "/:table/:id", run)
  app.post("/:table/:id/:action", run)
  return app
}
