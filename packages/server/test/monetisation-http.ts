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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
