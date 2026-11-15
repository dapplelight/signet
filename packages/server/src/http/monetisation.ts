/**
 * Monetisation routes on signet-db's `createOfferings` and `createCustomers`
 * (typed structurally, so this package does not depend on signet-db):
 * offerings and remote paywalls for the app, the Customer Center for the
 * signed-in (or anonymous) customer, and an admin API for offerings,
 * placements, customer timelines and requests.
 *
 * ```ts
 * const subject = (c: Context) => c.get("session")?.sub
 * app.route("/api/billing", monetisationRoutes({ offerings, customers, subject, userId: subject }))
 * app.route("/api/admin/billing", monetisationAdminRoutes({
 *   offerings, customers, authorize: (c) => c.get("session")?.role === "admin",
 *   actor: (c) => ({ type: "user", id: c.get("session").sub }),
 * }))
 * ```
 *
 * Purchases go through the checkout you already have (signet-payments
 * `checkout` on the web, StoreKit / Play Billing then `verifyPurchase` in the
 * app): the offering only says which product to buy.
 */

import { type Context, Hono } from "hono"
import { type ApiErrorStatus, ApiException } from "./errors.js"

type Actor = { type: "user" | "agent" | "system"; id: string }
type Maybe<T> = T | null | undefined | Promise<T | null | undefined>
type Audience = {
  country?: string
  platform?: string
  attributes?: Record<string, string | number | boolean | null | undefined>
}

/** What the routes need from signet-db's `createOfferings(...)`, as it is. */
export type OfferingStore = {
  current(placement: string, audience?: Audience): Promise<unknown>
  publish(
    key: string,
    input: { products: never[]; paywall?: never; note?: string },
    opts: { actor: Actor },
  ): Promise<unknown>
  get(key: string, version?: number | null): Promise<unknown>
  versions(key: string): Promise<unknown[]>
  list(): Promise<unknown[]>
  setPlacement(
    placement: string,
    input: { offering: string; version?: number | null; overrides?: never[] },
    opts: { actor: Actor },
  ): Promise<unknown>
  placements(): Promise<unknown[]>
}

/** What the routes need from signet-db's `createCustomers(...)`, as it is. */
export type CustomerStore = {
  anonymousId(opts?: { orgId?: string }): Promise<string>
  merge(
    input: { anonymousId: string; userId: string; orgId?: string },
    opts?: { actor?: Actor },
  ): Promise<{ merged: boolean; reason?: string }>
  overview(subject: string): Promise<unknown>
  timeline(subject: string, opts?: { limit?: number }): Promise<unknown>
  cancel(subject: string, opts?: { reason?: string }): Promise<unknown>
  acceptRetention(subject: string): Promise<unknown>
  requestRefund(
    subject: string,
    input: { gateway: string; paymentId: string; reason: string },
  ): Promise<unknown>
  contactSupport(
    subject: string,
    input: { message: string; email?: string; topic?: string },
  ): Promise<unknown>
  requests(filter?: {
    subject?: string
    kind?: never
    status?: never
    limit?: number
  }): Promise<unknown[]>
  setRequestStatus(id: string, status: never, opts: { actor: Actor }): Promise<unknown>
}

export type MonetisationRoutesOptions = {
  offerings?: OfferingStore
  customers: CustomerStore
  /** The customer the Customer Center acts on: the signed-in user, or an anonymous id the app holds. Undefined is 401. */
  subject: (c: Context) => Maybe<string>
  /** The signed-in user (not an anonymous id), for merge. Undefined is 401. */
  userId?: (c: Context) => Maybe<string>
  /** The tenant's org id for merges, e.g. `(c) => currentTenant(c).id`. */
  orgId?: (c: Context) => Maybe<string>
  /**
   * Who sees which offering. Default: `country` from the `cf-ipcountry`
   * header (Cloudflare), else the query; `platform` from the query. Query
   * attributes are not trusted: add them here from the session.
   */
  audience?: (c: Context) => Audience | Promise<Audience>
}

/** Write signet-db errors (by shape) as the error envelope. */
const STATUS: Record<string, ApiErrorStatus> = {
  BAD_VALUE: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
}
const onError = (e: Error) => {
  const code = (e as { code?: unknown }).code
  if (e.name === "SignetDbError" && typeof code === "string" && STATUS[code])
    throw new ApiException(
      STATUS[code] as ApiErrorStatus,
      e.message,
      code === "BAD_VALUE" ? "VALIDATION_FAILED" : code,
    )
  throw e
}

const body = async (c: Context): Promise<Record<string, unknown>> => {
  try {
    const v = await c.req.json()
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    throw new ApiException(400, "Invalid JSON body", "INVALID_JSON")
  }
}

const field = (b: Record<string, unknown>, name: string, max = 200): string => {
  const v = b[name]
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new ApiException(400, `${name} is required.`, "VALIDATION_FAILED", {
      formErrors: [],
      fieldErrors: { [name]: ["Required"] },
    })
  return v.trim()
}
const optional = (b: Record<string, unknown>, name: string, max = 200) =>
  b[name] === undefined ? undefined : field(b, name, max)

const need = async (fn: (c: Context) => Maybe<string>, c: Context) => {
  const v = await fn(c)
  if (!v) throw new ApiException(401, "Sign in first.", "UNAUTHORIZED")
  return v
}

const defaultAudience = (c: Context): Audience => {
  const country = c.req.header("cf-ipcountry") ?? c.req.query("country")
  const platform = c.req.query("platform")
  return {
    ...(country && /^[A-Za-z]{2}$/.test(country) ? { country: country.toUpperCase() } : {}),
    ...(platform ? { platform } : {}),
  }
}

/**
 * The app's routes. Mount with `app.route("/api/billing", monetisationRoutes(opts))`.
 *
 *   GET  /offerings/:placement     the offering and paywall for this audience (404 none)
 *   POST /anonymous                a new anonymous app-user id: { anonymousId }
 *   POST /merge                    { anonymousId }: move its purchases to the signed-in user
 *                                  (409 MERGE_REFUSED with the reason)
 *   GET  /customer                 Customer Center: plan, renewal date, manage link, retention offer
 *   GET  /customer/timeline        the customer's own history
 *   POST /customer/cancel          { reason? }: web cancels; stores answer with manageUrl
 *   POST /customer/retention       accept the retention offer
 *   POST /customer/refund          { gateway, paymentId, reason }
 *   POST /customer/support         { message, email?, topic? }
 *
 * These are cookie-authenticated writes: put `csrfMiddleware` in front when
 * the session cookie is `SameSite=None`.
 */
export function monetisationRoutes(opts: MonetisationRoutesOptions) {
  const { customers } = opts
  const app = new Hono()
  app.onError(onError)
  const me = (c: Context) => need(opts.subject, c)
  return app
    .get("/offerings/:placement", async (c) => {
      if (!opts.offerings) throw new ApiException(404, "No offerings here.", "NOT_FOUND")
      const audience = await (opts.audience ?? defaultAudience)(c)
      const offering = await opts.offerings.current(c.req.param("placement"), audience)
      if (!offering) throw new ApiException(404, "No offering for this placement.", "NOT_FOUND")
      return c.json({ offering })
    })
    .post("/anonymous", async (c) => {
      const orgId = (await opts.orgId?.(c)) ?? undefined
      return c.json({ anonymousId: await customers.anonymousId(orgId ? { orgId } : {}) }, 201)
    })
    .post("/merge", async (c) => {
      if (!opts.userId) throw new ApiException(404, "Merging is not enabled.", "NOT_FOUND")
      const userId = await need(opts.userId, c)
      const anonymousId = field(await body(c), "anonymousId")
      const orgId = (await opts.orgId?.(c)) ?? undefined
      const r = await customers.merge(
        { anonymousId, userId, ...(orgId ? { orgId } : {}) },
        { actor: { type: "user", id: userId } },
      )
      if (!r.merged)
        throw new ApiException(
          409,
          "These purchases cannot move to this account.",
          "MERGE_REFUSED",
          {
            formErrors: [r.reason ?? "refused"],
            fieldErrors: { anonymousId: [r.reason ?? "refused"] },
          },
        )
      return c.json(r)
    })
    .get("/customer", async (c) => c.json(await customers.overview(await me(c))))
    .get("/customer/timeline", async (c) =>
      c.json(await customers.timeline(await me(c), { limit: 200 })),
    )
    .post("/customer/cancel", async (c) => {
      const reason = optional(await body(c), "reason", 2000)
      return c.json(await customers.cancel(await me(c), reason ? { reason } : {}))
    })
    .post("/customer/retention", async (c) => c.json(await customers.acceptRetention(await me(c))))
    .post("/customer/refund", async (c) => {
      const b = await body(c)
      const r = await customers.requestRefund(await me(c), {
        gateway: field(b, "gateway", 40),
        paymentId: field(b, "paymentId"),
        reason: field(b, "reason", 2000),
      })
      return c.json(r, (r as { created?: boolean }).created ? 201 : 200)
    })
    .post("/customer/support", async (c) => {
      const b = await body(c)
      const email = optional(b, "email", 320)
      const topic = optional(b, "topic", 100)
      const request = await customers.contactSupport(await me(c), {
        message: field(b, "message", 5000),
        ...(email ? { email } : {}),
        ...(topic ? { topic } : {}),
      })
      return c.json({ request }, 201)
    })
}

export type MonetisationAdminOptions = {
  offerings?: OfferingStore
  customers?: CustomerStore
  /** Deny by default: every route calls it, and anything but true is 403. */
  authorize: (c: Context) => unknown
  /** Who made the change, for the audit log. */
  actor: (c: Context) => Actor | Promise<Actor>
}

const REQUEST_STATUS = new Set(["open", "done", "declined"])
const REQUEST_KIND = new Set(["refund", "cancel", "retention", "support"])

/**
 * Admin routes. Mount with `app.route("/api/admin/billing", monetisationAdminRoutes(opts))`.
 *
 *   GET   /offerings                    every offering's latest version
 *   GET   /offerings/:key               { offering, versions }
 *   POST  /offerings/:key               publish a new version: { products, paywall?, note? }
 *   GET   /placements                   every placement
 *   PUT   /placements/:placement        { offering, version?, overrides? }
 *   GET   /customers/:subject           Customer Center overview, as the customer sees it
 *   GET   /customers/:subject/timeline  purchases, renewals, refunds... and ledger totals
 *   GET   /requests?kind=&status=&subject=
 *   PATCH /requests/:id                 { status: "done" | "declined" | "open" }
 */
export function monetisationAdminRoutes(opts: MonetisationAdminOptions) {
  const app = new Hono()
  app.onError(onError)
  app.use(async (c, next) => {
    if ((await opts.authorize(c)) !== true)
      throw new ApiException(403, "You do not have permission to do that.", "FORBIDDEN")
    await next()
  })
  const offerings = () => {
    if (!opts.offerings) throw new ApiException(404, "Offerings are not enabled.", "NOT_FOUND")
    return opts.offerings
  }
  const customers = () => {
    if (!opts.customers) throw new ApiException(404, "Customers are not enabled.", "NOT_FOUND")
    return opts.customers
  }
  return app
    .get("/offerings", async (c) => c.json({ offerings: await offerings().list() }))
    .get("/offerings/:key", async (c) => {
      const key = c.req.param("key")
      const offering = await offerings().get(key)
      if (!offering) throw new ApiException(404, "No such offering.", "NOT_FOUND")
      return c.json({ offering, versions: await offerings().versions(key) })
    })
    .post("/offerings/:key", async (c) => {
      const b = await body(c)
      const offering = await offerings().publish(
        c.req.param("key"),
        {
          products: b.products as never[],
          ...(b.paywall !== undefined ? { paywall: b.paywall as never } : {}),
          ...(typeof b.note === "string" ? { note: b.note } : {}),
        },
        { actor: await opts.actor(c) },
      )
      return c.json({ offering }, 201)
    })
    .get("/placements", async (c) => c.json({ placements: await offerings().placements() }))
    .put("/placements/:placement", async (c) => {
      const b = await body(c)
      const version = b.version
      if (version !== undefined && version !== null && !Number.isSafeInteger(version))
        throw new ApiException(400, "version is an integer.", "VALIDATION_FAILED")
      const placement = await offerings().setPlacement(
        c.req.param("placement"),
        {
          offering: field(b, "offering", 64),
          version: (version as number | null | undefined) ?? null,
          ...(b.overrides !== undefined ? { overrides: b.overrides as never[] } : {}),
        },
        { actor: await opts.actor(c) },
      )
      return c.json({ placement })
    })
    .get("/customers/:subject", async (c) =>
      c.json(await customers().overview(c.req.param("subject"))),
    )
    .get("/customers/:subject/timeline", async (c) =>
      c.json(await customers().timeline(c.req.param("subject"), { limit: 500 })),
    )
    .get("/requests", async (c) => {
      const kind = c.req.query("kind")
      const status = c.req.query("status")
      const subject = c.req.query("subject")
      if (kind && !REQUEST_KIND.has(kind))
        throw new ApiException(400, "Unknown kind.", "VALIDATION_FAILED")
      if (status && !REQUEST_STATUS.has(status))
        throw new ApiException(400, "Unknown status.", "VALIDATION_FAILED")
      return c.json({
        requests: await customers().requests({
          ...(kind ? { kind: kind as never } : {}),
          ...(status ? { status: status as never } : {}),
          ...(subject ? { subject } : {}),
        }),
      })
    })
    .patch("/requests/:id", async (c) => {
      const status = field(await body(c), "status", 20)
      if (!REQUEST_STATUS.has(status))
        throw new ApiException(400, "status is open, done or declined.", "VALIDATION_FAILED")
      const request = await customers().setRequestStatus(c.req.param("id"), status as never, {
        actor: await opts.actor(c),
      })
      if (!request) throw new ApiException(404, "No such request.", "NOT_FOUND")
      return c.json({ request })
    })
}
