/**
 * AI spend caps over HTTP, on signet-db's `createAiSpend` (typed structurally,
 * so this package does not depend on signet-db): a middleware that refuses AI
 * routes once the user's, org's or global cap is reached, and admin routes to
 * read spend and set caps.
 *
 * ```ts
 * const who = (c: Context) => ({ userId: c.get("session")?.sub, orgId: c.get("orgId") })
 * app.use("/api/ai/*", requireAiSpend({ spend, subject: who }))
 * app.route("/api/admin/ai-spend", aiSpendAdminRoutes({
 *   spend, authorize: (c) => c.get("session")?.role === "admin",
 *   actor: (c) => ({ type: "user", id: c.get("session").sub }),
 * }))
 * ```
 */

import { type Context, Hono, type MiddlewareHandler } from "hono"
import { type ApiErrorStatus, ApiException } from "./errors.js"

type Scope = "user" | "org" | "global"
type Period = "day" | "month"
type Subject = { userId?: string | null; orgId?: string | null }
type Actor = { type: "user" | "agent" | "system"; id: string }

/** What these routes need from signet-db's `createAiSpend(...)`, as it is. */
export type AiSpendStore = {
  check(
    subject: Subject,
    estimateUnits?: number,
  ): Promise<
    | { ok: true }
    | {
        ok: false
        scope: Scope
        subject: string
        period: Period
        capUnits: number
        usedUnits: number
        resetsAt: Date
      }
  >
  usage(scope: Scope, id?: string): Promise<unknown>
  top(scope: "user" | "org", period?: Period, limit?: number): Promise<unknown[]>
  caps(): Promise<unknown[]>
  setCap(
    input: { scope: Scope; subject?: string; period: Period; units: number | null },
    opts?: { actor?: { id: string } },
  ): Promise<unknown>
  removeCap(scope: Scope, subject: string, period: Period): Promise<boolean>
}

export type RequireAiSpendOptions = {
  spend: AiSpendStore
  /** Who the call is charged to. */
  subject: (c: Context) => Subject | Promise<Subject>
  /** Cost units the call is expected to need. Default 0: refuse only once a cap is reached. */
  estimateUnits?: number | ((c: Context) => number)
  /** The message for a refusal. Default names the scope and period. */
  message?: (r: { scope: Scope; period: Period }) => string
}

const defaultMessage = ({ scope, period }: { scope: Scope; period: Period }) =>
  `${scope === "global" ? "The app's" : scope === "org" ? "Your organisation's" : "Your"} ${
    period === "day" ? "daily" : "monthly"
  } AI limit is used up.`

/**
 * Refuses an AI route over a cap: 429 `AI_SPEND_CAP_EXCEEDED` in the error
 * envelope, `details.formErrors` naming the cap (`user:day`, `org:month`,
 * `global:day`...), and `Retry-After` until the period rolls over. Fails
 * closed: a store error is a 503 `AI_SPEND_UNAVAILABLE`.
 */
export function requireAiSpend(opts: RequireAiSpendOptions): MiddlewareHandler {
  return async (c, next) => {
    const estimate =
      typeof opts.estimateUnits === "function" ? opts.estimateUnits(c) : (opts.estimateUnits ?? 0)
    const requestId = c.get("reqId" as never) as string | undefined
    const rid = requestId ? { requestId } : {}
    let r: Awaited<ReturnType<AiSpendStore["check"]>>
    try {
      r = await opts.spend.check(await opts.subject(c), estimate)
    } catch {
      return c.json(
        {
          success: false as const,
          error: "AI usage could not be checked. Try again.",
          code: "AI_SPEND_UNAVAILABLE",
          ...rid,
        },
        503,
      )
    }
    if (r.ok) return next()
    const seconds = Math.max(1, Math.ceil((r.resetsAt.getTime() - Date.now()) / 1000))
    c.header("Retry-After", String(seconds))
    return c.json(
      {
        success: false as const,
        error: (opts.message ?? defaultMessage)(r),
        code: "AI_SPEND_CAP_EXCEEDED",
        details: { formErrors: [`${r.scope}:${r.period}`], fieldErrors: {} },
        ...rid,
      },
      429,
    )
  }
}

export type AiSpendAdminOptions = {
  spend: AiSpendStore
  /** Deny by default: every route calls it, and anything but true is 403. */
  authorize: (c: Context) => unknown
  /** Who changed a cap, stored on it. */
  actor?: (c: Context) => Actor | Promise<Actor>
}

const SCOPES = new Set(["user", "org", "global"])
const PERIODS = new Set(["day", "month"])

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
 * Admin routes. Mount with `app.route("/api/admin/ai-spend", aiSpendAdminRoutes(opts))`.
 *
 *   GET    /usage                          global day and month, top users and orgs this month
 *   GET    /usage/:scope/:id               one user's or org's spend and caps (global: id "*")
 *   GET    /caps                           every stored cap
 *   PUT    /caps                           { scope, subject?, period, units } (units null: unlimited)
 *   DELETE /caps/:scope/:subject/:period   back to the "*" row or the app's default
 */
export function aiSpendAdminRoutes(opts: AiSpendAdminOptions) {
  const { spend } = opts
  const app = new Hono()
  app.onError(onError)
  app.use(async (c, next) => {
    if ((await opts.authorize(c)) !== true)
      throw new ApiException(403, "You do not have permission to do that.", "FORBIDDEN")
    await next()
  })
  const scopeOf = (v: string | undefined): Scope => {
    if (!v || !SCOPES.has(v)) throw bad("scope", "scope is user, org or global.")
    return v as Scope
  }
  const periodOf = (v: unknown): Period => {
    if (typeof v !== "string" || !PERIODS.has(v)) throw bad("period", "period is day or month.")
    return v as Period
  }
  return app
    .get("/usage", async (c) => {
      const [global, users, orgs] = await Promise.all([
        spend.usage("global"),
        spend.top("user", "month", 20),
        spend.top("org", "month", 20),
      ])
      return c.json({ global, top: { users, orgs } })
    })
    .get("/usage/:scope/:id", async (c) =>
      c.json(await spend.usage(scopeOf(c.req.param("scope")), c.req.param("id"))),
    )
    .get("/caps", async (c) => c.json({ caps: await spend.caps() }))
    .put("/caps", async (c) => {
      let b: Record<string, unknown>
      try {
        b = (await c.req.json()) as Record<string, unknown>
      } catch {
        throw new ApiException(400, "Invalid JSON body", "INVALID_JSON")
      }
      if (!b || typeof b !== "object")
        throw new ApiException(400, "Invalid JSON body", "INVALID_JSON")
      const scope = scopeOf(typeof b.scope === "string" ? b.scope : undefined)
      const units = b.units
      if (units !== null && !(Number.isSafeInteger(units) && (units as number) >= 0))
        throw bad("units", "units is a whole number of cost units, 0 or more, or null.")
      if (b.subject !== undefined && typeof b.subject !== "string")
        throw bad("subject", "subject is a user or org id, or *.")
      const actor = await opts.actor?.(c)
      const cap = await spend.setCap(
        {
          scope,
          ...(typeof b.subject === "string" ? { subject: b.subject } : {}),
          period: periodOf(b.period),
          units: units as number | null,
        },
        actor ? { actor } : {},
      )
      return c.json({ cap })
    })
    .delete("/caps/:scope/:subject/:period", async (c) => {
      const removed = await spend.removeCap(
        scopeOf(c.req.param("scope")),
        c.req.param("subject"),
        periodOf(c.req.param("period")),
      )
      if (!removed) throw new ApiException(404, "No such cap.", "NOT_FOUND")
      return c.json({ removed })
    })
}
