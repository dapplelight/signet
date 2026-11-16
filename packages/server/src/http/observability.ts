/**
 * Admin routes for AI cost over time, on signet-db's `createAiSpend` with an
 * `aiSpendLedger` table (typed structurally, so this package does not depend
 * on signet-db). Read-only. Subjects appear only as the hash the ledger
 * stores; a raw user or org id is never echoed back.
 *
 * ```ts
 * app.route("/api/admin/observability", observabilityAdminRoutes({
 *   spend, authorize: (c) => c.get("session")?.role === "admin",
 * }))
 * ```
 */

import { type Context, Hono } from "hono"
import { type ApiErrorStatus, ApiException } from "./errors.js"

type Scope = "user" | "org" | "global"

/** What these routes need from signet-db's `createAiSpend({ tables: { aiSpendLedger } })`, as it is. */
export type AiSpendLedgerStore = {
  series(q: {
    scope?: Scope
    subject?: string
    days: number
  }): Promise<Array<{ day: string; units: number; calls: number; cacheSavedUnits: number }>>
  byModel(q: { days: number }): Promise<unknown[]>
  topSpenders(q: { scope?: "user" | "org"; days: number; limit?: number }): Promise<unknown[]>
}

export type ObservabilityAdminOptions = {
  spend: AiSpendLedgerStore
  /** Deny by default: every route calls it, and anything but true is 403. */
  authorize: (c: Context) => unknown
  /** Who is asking. Accepted so one options object serves `aiSpendAdminRoutes` too; these routes only read. */
  actor?: (c: Context) => unknown
}

const SCOPES = new Set(["user", "org", "global"])
const MAX_DAYS = 400 // the ledger's default retentionDays
const DEFAULT_DAYS = 30

const STATUS: Record<string, ApiErrorStatus> = { BAD_VALUE: 400 }
const onError = (e: Error) => {
  const code = (e as { code?: unknown }).code
  if (e.name === "SignetDbError" && typeof code === "string" && STATUS[code])
    throw new ApiException(STATUS[code] as ApiErrorStatus, e.message, "VALIDATION_FAILED")
  throw e
}

const bad = (field: string, message: string) =>
  new ApiException(400, message, "VALIDATION_FAILED", {
    formErrors: [],
    fieldErrors: { [field]: [message] },
  })

/**
 * Admin routes. Mount with
 * `app.route("/api/admin/observability", observabilityAdminRoutes(opts))`.
 * `days` is 1 to 400 (default 30).
 *
 *   GET /cost/series?days&scope&subject   { series }  spend per UTC day; scope user, org or global (default global);
 *                                         subject is a raw id, hashed on the server, and needs scope user or org
 *   GET /cost/by-model?days               { models }  spend per model, biggest first
 *   GET /cost/top?days&scope              { top }     biggest spenders by subject hash; scope user (default) or org
 *   GET /cost/cache-savings?days          { savings } what cache hits saved: totals and per day
 */
export function observabilityAdminRoutes(opts: ObservabilityAdminOptions) {
  const { spend } = opts
  const app = new Hono()
  app.onError(onError)
  app.use(async (c, next) => {
    if ((await opts.authorize(c)) !== true)
      throw new ApiException(403, "You do not have permission to do that.", "FORBIDDEN")
    await next()
  })
  const daysOf = (c: Context): number => {
    const v = c.req.query("days")
    if (v === undefined) return DEFAULT_DAYS
    const n = Number(v)
    if (!/^\d+$/.test(v) || n < 1 || n > MAX_DAYS)
      throw bad("days", `days is a whole number from 1 to ${MAX_DAYS}.`)
    return n
  }
  return app
    .get("/cost/series", async (c) => {
      const days = daysOf(c)
      const scope = c.req.query("scope")
      if (scope !== undefined && !SCOPES.has(scope))
        throw bad("scope", "scope is user, org or global.")
      const subject = c.req.query("subject")
      if (subject !== undefined && (!subject || subject.length > 200))
        throw bad("subject", "subject is a user or org id.")
      if (subject !== undefined && scope !== "user" && scope !== "org")
        throw bad("scope", "subject needs a scope of user or org.")
      return c.json({
        series: await spend.series({
          days,
          ...(scope ? { scope: scope as Scope } : {}),
          ...(subject ? { subject } : {}),
        }),
      })
    })
    .get("/cost/by-model", async (c) =>
      c.json({ models: await spend.byModel({ days: daysOf(c) }) }),
    )
    .get("/cost/top", async (c) => {
      const days = daysOf(c)
      const scope = c.req.query("scope") ?? "user"
      if (scope !== "user" && scope !== "org") throw bad("scope", "scope is user or org.")
      return c.json({ top: await spend.topSpenders({ days, scope }) })
    })
    .get("/cost/cache-savings", async (c) => {
      const rows = await spend.series({ days: daysOf(c) })
      return c.json({
        savings: {
          cacheSavedUnits: rows.reduce((t, r) => t + r.cacheSavedUnits, 0),
          spentUnits: rows.reduce((t, r) => t + r.units, 0),
          series: rows.map((r) => ({ day: r.day, cacheSavedUnits: r.cacheSavedUnits })),
        },
      })
    })
}
