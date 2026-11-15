/**
 * Status page routes on signet-db's `createStatus` (typed by shape): a
 * public summary for the status page, and admin routes for components,
 * incidents and maintenance mode. Pair with `maintenanceMode` from
 * `../middleware/maintenance`, and keep the status route on its allowlist.
 *
 * ```ts
 * app.route("/api/status", statusRoutes({ status }))
 * app.route("/api/admin/status", statusAdminRoutes({
 *   status, authorize: (c) => c.get("session")?.role === "admin",
 *   actor: (c) => ({ type: "user", id: c.get("session").sub }),
 * }))
 * ```
 */

import { type Context, Hono } from "hono"
import type { MaintenanceState } from "../middleware/maintenance.js"
import { ApiException } from "./errors.js"
import { type Actor, adminGate, jsonBody, storeError } from "./store-helpers.js"

/** What the routes need from signet-db's `createStatus(...)`, as it is. */
export type StatusStore = {
  summary(opts?: { days?: number }): Promise<unknown>
  components(): Promise<unknown[]>
  incidents(opts?: { days?: number; limit?: number }): Promise<unknown[]>
  setComponent(key: string, input: never, opts: { actor: Actor }): Promise<unknown>
  removeComponent(key: string, opts: { actor: Actor }): Promise<boolean>
  openIncident(input: never, opts: { actor: Actor }): Promise<unknown>
  updateIncident(id: string, input: never, opts: { actor: Actor }): Promise<unknown>
  maintenance(): Promise<MaintenanceState>
  setMaintenance(
    input: { on: boolean; message?: string | null; until?: Date | null },
    opts: { actor: Actor },
  ): Promise<unknown>
}

/**
 * The public route. Mount with `app.route("/api/status", statusRoutes({ status }))`.
 *
 *   GET /   { status, components, incidents, maintenance }, cacheable for `maxAge` seconds (default 30)
 */
export function statusRoutes(opts: { status: Pick<StatusStore, "summary">; maxAge?: number }) {
  return new Hono().get("/", async (c) => {
    c.header("Cache-Control", `public, max-age=${opts.maxAge ?? 30}`)
    return c.json(await opts.status.summary())
  })
}

export type StatusAdminOptions = {
  status: StatusStore
  /** Deny by default: every route calls it, and anything but true is 403. */
  authorize: (c: Context) => unknown
  /** Who made the change, for the audit log. */
  actor: (c: Context) => Actor | Promise<Actor>
}

/**
 * Admin routes. Mount with `app.route("/api/admin/status", statusAdminRoutes(opts))`.
 *
 *   GET    /components              every component
 *   PUT    /components/:key         { name?, description?, status?, position? }
 *   DELETE /components/:key
 *   GET    /incidents?days=         open incidents and those resolved in `days` (default 30)
 *   POST   /incidents               { title, impact, components?, message, status? }
 *   POST   /incidents/:id/updates   { status, message, impact? }; "resolved" closes it
 *   GET    /maintenance
 *   PUT    /maintenance             { on, message?, until? (ISO date) }
 */
export function statusAdminRoutes(opts: StatusAdminOptions) {
  const { status } = opts
  const app = new Hono()
  app.onError(storeError)
  app.use(adminGate(opts.authorize))
  const actor = async (c: Context) => ({ actor: await opts.actor(c) })
  return app
    .get("/components", async (c) => c.json({ components: await status.components() }))
    .put("/components/:key", async (c) =>
      c.json({
        component: await status.setComponent(
          c.req.param("key"),
          (await jsonBody(c)) as never,
          await actor(c),
        ),
      }),
    )
    .delete("/components/:key", async (c) => {
      if (!(await status.removeComponent(c.req.param("key"), await actor(c))))
        throw new ApiException(404, "No such component.", "NOT_FOUND")
      return c.json({ removed: true })
    })
    .get("/incidents", async (c) => {
      const days = Number(c.req.query("days") ?? 30)
      if (!Number.isFinite(days) || days < 0 || days > 3650)
        throw new ApiException(400, "days is 0 to 3650.", "VALIDATION_FAILED")
      return c.json({ incidents: await status.incidents({ days, limit: 200 }) })
    })
    .post("/incidents", async (c) =>
      c.json(
        { incident: await status.openIncident((await jsonBody(c)) as never, await actor(c)) },
        201,
      ),
    )
    .post("/incidents/:id/updates", async (c) =>
      c.json({
        incident: await status.updateIncident(
          c.req.param("id"),
          (await jsonBody(c)) as never,
          await actor(c),
        ),
      }),
    )
    .get("/maintenance", async (c) => c.json({ maintenance: await status.maintenance() }))
    .put("/maintenance", async (c) => {
      const b = await jsonBody(c)
      let until: Date | null = null
      if (b.until != null) {
        until = new Date(String(b.until))
        if (Number.isNaN(until.getTime()))
          throw new ApiException(400, "until is an ISO date.", "VALIDATION_FAILED")
      }
      if (typeof b.on !== "boolean")
        throw new ApiException(400, "on is true or false.", "VALIDATION_FAILED")
      const message = typeof b.message === "string" ? b.message : null
      return c.json({
        maintenance: await status.setMaintenance({ on: b.on, message, until }, await actor(c)),
      })
    })
}
