/**
 * monetisationRoutes() and monetisationAdminRoutes(): who may call what (401
 * signed out, admin deny by default), input validation, merge refusals as
 * 409, and signet-db errors written as the envelope. The stores are in-memory
 * stand-ins shaped like signet-db's createOfferings / createCustomers; the
 * real ones run end to end in signet-test.
 */
import { type Context, Hono } from "hono"
import { errorHandler } from "../src/http/errors"
import {
  type ChartStore,
  type CustomerStore,
  monetisationAdminRoutes,
  monetisationRoutes,
  type OfferingStore,
} from "../src/http/monetisation"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

class FakeDbError extends Error {
  readonly name = "SignetDbError"
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const seen: { audience?: unknown; merge?: unknown; refund?: unknown; published?: unknown } = {}
const offerings: OfferingStore = {
  async current(placement, audience) {
    seen.audience = audience
    return placement === "onboarding"
      ? { key: "default", version: 2, products: [], paywall: null }
      : null
  },
  async publish(key, input) {
    if (!Array.isArray(input.products) || !input.products.length)
      throw new FakeDbError("BAD_VALUE", "An offering needs at least one product.")
    seen.published = { key, input }
    return { key, version: 1 }
  },
  async get(key) {
    return key === "default" ? { key, version: 2 } : null
  },
  async versions() {
    return [{ version: 2 }, { version: 1 }]
  },
  async list() {
    return [{ key: "default", version: 2 }]
  },
  async setPlacement(placement, input) {
    return { placement, ...input }
  },
  async placements() {
    return []
  },
}
const customers: CustomerStore = {
  async anonymousId() {
    return "anon_x"
  },
  async merge(input) {
    seen.merge = input
    return input.anonymousId === "anon_taken"
      ? { merged: false, reason: "already_merged" }
      : { merged: true }
  },
  async overview(subject) {
    return { subject, plan: "pro" }
  },
  async timeline(subject) {
    return { subject, entries: [] }
  },
  async cancel(subject) {
    return { cancelled: true, subject }
  },
  async acceptRetention() {
    return { accepted: false, reason: "not_eligible" }
  },
  async requestRefund(subject, input) {
    if (input.paymentId === "not-mine")
      throw new FakeDbError("NOT_FOUND", "No such payment for this customer.")
    seen.refund = { subject, ...input }
    return { request: { id: "r1" }, created: true }
  },
  async contactSupport(subject, input) {
    return { id: "s1", subject, ...input }
  },
  async requests() {
    return []
  },
  async setRequestStatus(id, status) {
    return id === "r1" ? { id, status } : null
  },
}

const who = (c: Context) => c.req.header("x-user") ?? null
const app = new Hono()
app.onError(errorHandler({ isProduction: () => true }))
app.route(
  "/billing",
  monetisationRoutes({ offerings, customers, subject: who, userId: who, orgId: () => "org_a" }),
)
app.route(
  "/admin",
  monetisationAdminRoutes({
    offerings,
    customers,
    authorize: (c) => c.req.header("x-role") === "admin",
    actor: (c) => ({ type: "user", id: who(c) ?? "?" }),
  }),
)

const req = (path: string, init: RequestInit & { user?: string; role?: string } = {}) =>
  app.request(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.user ? { "x-user": init.user } : {}),
      ...(init.role ? { "x-role": init.role } : {}),
      ...(init.headers as Record<string, string>),
    },
  })
const post = (path: string, body: unknown, extra: { user?: string; role?: string } = {}) =>
  req(path, { method: "POST", body: JSON.stringify(body), ...extra })

console.log("app routes")
{
  const r = await req("/billing/offerings/onboarding?platform=appstore&country=us", {
    headers: { "cf-ipcountry": "IN" },
  })
  ok(
    "offering for a placement is public",
    r.status === 200 && (await r.json()).offering.key === "default",
  )
  ok(
    "audience: country from cf-ipcountry over the query, platform from the query",
    JSON.stringify(seen.audience) === JSON.stringify({ country: "IN", platform: "appstore" }),
    seen.audience,
  )
  ok("unknown placement is 404", (await req("/billing/offerings/nowhere")).status === 404)
  ok("customer center needs a subject: 401", (await req("/billing/customer")).status === 401)
  ok(
    "customer center answers for the caller",
    (await (await req("/billing/customer", { user: "u1" })).json()).subject === "u1",
  )
  ok("cancel signed out is 401", (await post("/billing/customer/cancel", {})).status === 401)
  ok(
    "cancel",
    (await (await post("/billing/customer/cancel", {}, { user: "u1" })).json()).cancelled === true,
  )

  const missing = await post("/billing/customer/refund", { gateway: "stripe" }, { user: "u1" })
  const mj = await missing.json()
  ok(
    "refund without paymentId is 400 VALIDATION_FAILED",
    missing.status === 400 && mj.code === "VALIDATION_FAILED",
    mj,
  )
  const notMine = await post(
    "/billing/customer/refund",
    { gateway: "stripe", paymentId: "not-mine", reason: "x" },
    { user: "u1" },
  )
  ok(
    "another customer's payment: signet-db NOT_FOUND becomes 404",
    notMine.status === 404 && (await notMine.json()).code === "NOT_FOUND",
  )
  const refund = await post(
    "/billing/customer/refund",
    { gateway: "stripe", paymentId: "pi_1", reason: "Charged twice" },
    { user: "u1" },
  )
  ok(
    "refund request created: 201, for the caller",
    refund.status === 201 && (seen.refund as { subject: string }).subject === "u1",
  )
  ok(
    "support message: 201",
    (await post("/billing/customer/support", { message: "Help" }, { user: "u1" })).status === 201,
  )
  ok(
    "support without message: 400",
    (await post("/billing/customer/support", {}, { user: "u1" })).status === 400,
  )
  ok(
    "bad JSON: 400 INVALID_JSON",
    (
      await (
        await req("/billing/customer/support", { method: "POST", body: "{", user: "u1" })
      ).json()
    ).code === "INVALID_JSON",
  )

  ok(
    "merge signed out: 401",
    (await post("/billing/merge", { anonymousId: "anon_x" })).status === 401,
  )
  const merged = await post("/billing/merge", { anonymousId: "anon_x" }, { user: "u1" })
  ok(
    "merge into the signed-in user, in the tenant's org",
    merged.status === 200 &&
      JSON.stringify(seen.merge) ===
        JSON.stringify({ anonymousId: "anon_x", userId: "u1", orgId: "org_a" }),
    seen.merge,
  )
  const refused = await post("/billing/merge", { anonymousId: "anon_taken" }, { user: "u1" })
  const rj = await refused.json()
  ok(
    "refused merge: 409 MERGE_REFUSED with the reason",
    refused.status === 409 && rj.code === "MERGE_REFUSED",
    rj,
  )
  ok("anonymous id: 201", (await post("/billing/anonymous", {})).status === 201)
}

console.log("admin routes")
{
  ok(
    "deny by default: no role is 403",
    (await req("/admin/offerings", { user: "a1" })).status === 403,
  )
  ok(
    "deny by default: staff is 403",
    (await req("/admin/requests", { user: "a1", role: "staff" })).status === 403,
  )
  ok(
    "admin lists offerings",
    (await req("/admin/offerings", { user: "a1", role: "admin" })).status === 200,
  )
  const bad = await post(
    "/admin/offerings/default",
    { products: [] },
    { user: "a1", role: "admin" },
  )
  ok(
    "publish with no products: 400 VALIDATION_FAILED",
    bad.status === 400 && (await bad.json()).code === "VALIDATION_FAILED",
  )
  const good = await post(
    "/admin/offerings/default",
    { products: [{ id: "p", store: "web", plan: "pro" }], paywall: { title: "T" } },
    { user: "a1", role: "admin" },
  )
  ok("publish: 201", good.status === 201)
  const put = await req("/admin/placements/onboarding", {
    method: "PUT",
    body: JSON.stringify({ offering: "default", version: "2" }),
    user: "a1",
    role: "admin",
  })
  ok("placement version must be an integer", put.status === 400)
  ok(
    "timeline for a customer",
    (await req("/admin/customers/u1/timeline", { user: "a1", role: "admin" })).status === 200,
  )
  ok(
    "requests filter is validated",
    (await req("/admin/requests?kind=bogus", { user: "a1", role: "admin" })).status === 400,
  )
  const patch = (id: string, status: string) =>
    req(`/admin/requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
      user: "a1",
      role: "admin",
    })
  ok("close a request", (await patch("r1", "done")).status === 200)
  ok("unknown status: 400", (await patch("r1", "closed")).status === 400)
  ok("unknown request: 404", (await patch("nope", "done")).status === 404)
}

console.log("charts, offers, impressions and promotional grants")
{
  const got: Record<string, unknown> = {}
  const more: CustomerStore = {
    ...customers,
    async withOffers(subject, offering) {
      got.withOffers = subject
      return { ...(offering as object), offersFor: subject }
    },
    async logImpression(subject, input) {
      got.impression = { subject, ...input }
      return { logged: true }
    },
    async redeemOffer(_subject, _offering, offerId) {
      return offerId === "trial7" ? { redeemed: true } : { redeemed: false, reason: "already_used" }
    },
    async grantPromotional(subject, input) {
      if (input.plan === "gold") throw new FakeDbError("BAD_VALUE", "gold is not a plan.")
      got.grant = { subject, ...input }
      return { id: "g1", plan: input.plan }
    },
    async endPromotional(_subject, id) {
      return id === "g1"
    },
  }
  const charts: ChartStore = {
    async metrics(q) {
      got.query = q
      if (q.audience === "nope") throw new FakeDbError("NOT_FOUND", "No audience nope.")
      return { from: q.from, to: q.to, days: [] }
    },
    async csv(q) {
      return `day\n${q.from}\n`
    },
    async audiences() {
      return [{ id: "a1", name: "App Store" }]
    },
    async saveAudience(name, filter) {
      return { id: "a2", name, filter }
    },
    async removeAudience(id) {
      return id === "a1"
    },
  }
  const app2 = new Hono()
  app2.onError(errorHandler({ isProduction: () => true }))
  app2.route("/billing", monetisationRoutes({ offerings, customers: more, subject: who }))
  app2.route(
    "/admin",
    monetisationAdminRoutes({
      customers: more,
      charts,
      authorize: (c) => c.req.header("x-role") === "admin",
      actor: (c) => ({ type: "user", id: who(c) ?? "?" }),
    }),
  )
  const r2 = (path: string, init: RequestInit & { user?: string; role?: string } = {}) =>
    app2.request(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.user ? { "x-user": init.user } : {}),
        ...(init.role ? { "x-role": init.role } : {}),
      },
    })
  const p2 = (path: string, body: unknown, extra: { user?: string; role?: string } = {}) =>
    r2(path, { method: "POST", body: JSON.stringify(body), ...extra })
  const admin = { user: "a1", role: "admin" }

  const anon = await (await r2("/billing/offerings/onboarding")).json()
  ok("offers for a visitor with no subject", anon.offering.offersFor === null)
  const mine = await (await r2("/billing/offerings/onboarding", { user: "u1" })).json()
  ok("offers cut to the signed-in customer", mine.offering.offersFor === "u1")
  ok(
    "impression needs a subject",
    (await p2("/billing/offerings/onboarding/impression", {})).status === 401,
  )
  const imp = await r2("/billing/offerings/onboarding/impression?country=in", {
    method: "POST",
    user: "u1",
  })
  ok(
    "impression logs the served offering, version, placement and country",
    imp.status === 204 &&
      JSON.stringify(got.impression) ===
        JSON.stringify({
          subject: "u1",
          offering: "default",
          version: 2,
          placement: "onboarding",
          country: "IN",
        }),
    got.impression,
  )
  ok(
    "impression for an unknown placement: 404",
    (await r2("/billing/offerings/none/impression", { method: "POST", user: "u1" })).status === 404,
  )
  ok(
    "redeem an offer",
    (await p2("/billing/offerings/onboarding/redeem", { offerId: "trial7" }, { user: "u1" }))
      .status === 200,
  )
  const refused = await p2(
    "/billing/offerings/onboarding/redeem",
    { offerId: "trial7x" },
    { user: "u1" },
  )
  const rj = await refused.json()
  ok(
    "a used offer: 409 OFFER_REFUSED with the reason",
    refused.status === 409 &&
      rj.code === "OFFER_REFUSED" &&
      rj.details.fieldErrors.offerId[0] === "already_used",
  )

  ok("charts are admin only", (await r2("/admin/charts", { user: "a1" })).status === 403)
  const ch = await r2(
    "/admin/charts?from=2026-03-01&to=2026-03-31&store=appstore&country=IN&offering=default&audience=a1",
    admin,
  )
  ok(
    "charts pass dates and filters through",
    ch.status === 200 &&
      JSON.stringify(got.query) ===
        JSON.stringify({
          from: "2026-03-01",
          to: "2026-03-31",
          store: "appstore",
          country: "IN",
          offering: "default",
          audience: "a1",
        }),
    got.query,
  )
  ok("charts default to the last 30 days", (await r2("/admin/charts", admin)).status === 200)
  ok("bad dates: 400", (await r2("/admin/charts?from=03/01/2026", admin)).status === 400)
  ok("unknown audience: 404", (await r2("/admin/charts?audience=nope", admin)).status === 404)
  const csv = await r2("/admin/charts/csv?from=2026-03-01&to=2026-03-02", admin)
  ok(
    "CSV export is an attachment",
    csv.status === 200 &&
      (csv.headers.get("content-type") ?? "").startsWith("text/csv") &&
      (csv.headers.get("content-disposition") ?? "").includes(
        "subscriptions-2026-03-01-2026-03-02.csv",
      ) &&
      (await csv.text()) === "day\n2026-03-01\n",
  )
  ok("list audiences", (await (await r2("/admin/audiences", admin)).json()).audiences.length === 1)
  ok(
    "save an audience: 201",
    (await p2("/admin/audiences", { name: "IN", filter: { country: "IN" } }, admin)).status === 201,
  )
  ok(
    "an audience needs a filter object",
    (await p2("/admin/audiences", { name: "IN", filter: "IN" }, admin)).status === 400,
  )
  ok(
    "delete an audience; unknown is 404",
    (await r2("/admin/audiences/a1", { method: "DELETE", ...admin })).status === 200 &&
      (await r2("/admin/audiences/zz", { method: "DELETE", ...admin })).status === 404,
  )
  const g = await p2(
    "/admin/customers/u1/promotional",
    { plan: "pro", days: 14, note: "Beta" },
    admin,
  )
  ok(
    "grant a promotional plan: 201",
    g.status === 201 &&
      JSON.stringify(got.grant) ===
        JSON.stringify({ subject: "u1", plan: "pro", days: 14, note: "Beta" }),
    got.grant,
  )
  ok(
    "promotional: unknown plan is 400, bad days 400, no auth 403",
    (await p2("/admin/customers/u1/promotional", { plan: "gold", days: 3 }, admin)).status ===
      400 &&
      (await p2("/admin/customers/u1/promotional", { plan: "pro", days: 1.5 }, admin)).status ===
        400 &&
      (await p2("/admin/customers/u1/promotional", { plan: "pro", days: 3 }, { user: "a1" }))
        .status === 403,
  )
  ok(
    "end a grant; an unknown one is 404",
    (await r2("/admin/customers/u1/promotional/g1", { method: "DELETE", ...admin })).status ===
      200 &&
      (await r2("/admin/customers/u1/promotional/g9", { method: "DELETE", ...admin })).status ===
        404,
  )
  ok("offer requests are listable", (await r2("/admin/requests?kind=offer", admin)).status === 200)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
