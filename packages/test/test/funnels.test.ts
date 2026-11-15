// Web-to-app funnels end to end on the fakes: the hosted page's API and
// redemption from signet-server, signet-db's funnels, offerings, customers
// and entitlements over SQLite, and a Stripe checkout through the real
// adapter and signet-payments' webhook inbox. Nothing is granted before the
// signed webhook; the redemption link works once, for one account.
import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import * as sqc from "@dapplelight/signet-db/columns/sqlite"
import { createCustomers } from "@dapplelight/signet-db/customers"
import { createEntitlements, definePlans } from "@dapplelight/signet-db/entitlements"
import { createFunnels, funnelSteps } from "@dapplelight/signet-db/funnels"
import { createOfferings, plansFromProducts } from "@dapplelight/signet-db/offerings"
import { createDb } from "@dapplelight/signet-db/sqlite"
import { createPayments, memoryStore } from "@dapplelight/signet-payments"
import { funnelRoutes } from "@dapplelight/signet-server/http/funnels"
import { fakeClock } from "../src/clock"
import { fakeGateway } from "../src/payments"
import { ddl } from "./harness"

const plans = definePlans({ free: { features: [] }, pro: { features: ["sso"] } })
const PRODUCTS = [
  {
    id: "price_pro",
    store: "web",
    plan: "pro" as const,
    interval: "month" as const,
    price: { amount: 2000, currency: "USD" },
  },
]
const FUNNEL = {
  key: "spring",
  placement: "web",
  title: "Spring",
  questions: [
    {
      id: "goal",
      title: "Goal?",
      options: [
        { value: "focus", label: "Focus" },
        { value: "sleep", label: "Sleep" },
      ],
    },
  ],
}
const SECRET = "funnel-e2e-secret-0123456789-abcdefghij"
type Any = any

async function world() {
  const clock = fakeClock("2026-11-01T10:00:00Z")
  const sqlite = new Database(":memory:")
  const ent = sqc.entitlementTables()
  const mon = sqc.monetisationTables()
  const fun = sqc.funnelTables()
  const audit = sqc.auditLog()
  const idempotency = sqc.idempotencyKeys()
  for (const t of [
    ...Object.values(ent),
    ...Object.values(mon),
    ...Object.values(fun),
    audit,
    idempotency,
  ])
    sqlite.run(ddl(t))
  const db = createDb(sqlite, { audit, idempotency })
  const entitlements = createEntitlements(db, {
    plans,
    default: "free",
    tables: ent,
    now: () => clock.date(),
    billing: { plans: plansFromProducts(PRODUCTS) },
  })
  const offerings = createOfferings(db, { tables: mon, plans })
  const admin = { type: "user" as const, id: "admin-1" }
  await offerings.publish("web", { products: PRODUCTS }, { actor: admin })
  await offerings.setPlacement("web", { offering: "web" }, { actor: admin })
  const store = memoryStore()
  const customers = createCustomers(db, {
    tables: { ...ent, ...mon },
    entitlements,
    payments: store,
    now: () => clock.date(),
  })
  const stripe = fakeGateway("stripe", { now: clock.now })
  const tracked: { name: string; anonymousId?: string; userId?: string }[] = []
  let payments: ReturnType<typeof createPayments>
  const funnels = createFunnels(db, {
    tables: { ...fun, customerEvents: mon.customerEvents },
    funnels: [FUNNEL],
    discounts: [{ code: "SPRING25", percentOff: 25, maxRedemptions: 10, plans: ["pro"] }],
    offerings,
    customers,
    entitlements,
    now: () => clock.date(),
    checkout: (input) => payments.checkout(input),
    track: (e) => {
      tracked.push(e)
    },
  })
  payments = createPayments({
    gateways: [stripe],
    db: store,
    onEvent: async (event) => {
      await entitlements.applyBillingEvent(event)
      await customers.record(event)
      await funnels.applyEvent(event)
    },
  })
  // Mounted at "/f" in an app; here on its own, so paths have no prefix. Without the
  // app's errorHandler an ApiException is thrown; `call` writes it as the envelope.
  const app = funnelRoutes({
    funnels,
    secret: SECRET,
    redeemUrl: "example://redeem",
    userId: (c) => c.req.header("x-user"),
    page: { stripePublishableKey: "pk_test_example" },
  })
  const call = async (
    path: string,
    init: { method?: string; body?: unknown; user?: string } = {},
  ): Promise<Response> => {
    try {
      return await app.request(`https://pay.example.test${path.replace(/^\/f/, "")}`, {
        method: init.method ?? (init.body ? "POST" : "GET"),
        headers: {
          "content-type": "application/json",
          "x-signet-anonymous-id": "v_e2e",
          ...(init.user ? { "x-user": init.user } : {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      })
    } catch (e) {
      const x = e as { status: number; message: string; code?: string }
      return Response.json({ error: x.message, code: x.code }, { status: x.status })
    }
  }
  const webhook = async (r: Request) => {
    return (await payments.handleWebhook("stripe", r)).status
  }
  return { clock, entitlements, customers, funnels, stripe, store, call, webhook, tracked }
}

describe("web-to-app funnel, end to end", () => {
  test("pay on the web with a URL discount, unlock in the app once", async () => {
    const w = await world()
    const page = await w.call("/f/spring")
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("pk_test_example")
    const cfg = (await (await w.call("/f/spring/config?code=spring25")).json()) as Any
    expect(cfg.discounts.price_pro).toEqual({
      valid: true,
      code: "SPRING25",
      off: 500,
      amount: 1500,
      currency: "USD",
    })
    expect((await w.call("/f/spring/events", { body: { step: "goal" } })).status).toBe(204)
    expect((await w.call("/f/spring/events", { body: { step: "plans" } })).status).toBe(204)

    const co = await w.call("/f/spring/checkout", {
      body: {
        productId: "price_pro",
        answers: { goal: "sleep" },
        code: "spring25",
        email: "buyer@example.test",
        amount: 1, // ignored: the server prices it
      },
    })
    expect(co.status).toBe(201)
    const { session, checkout } = (await co.json()) as Any
    expect(checkout.clientSecret).toBeTruthy()
    // The gateway was asked for the discounted amount the server priced.
    expect(w.stripe.state.payments.get(checkout.gatewayId).amount).toBe(1500)
    expect((await (await w.call(`/f/sessions/${session.id}`)).json()).redemption).toBeUndefined()

    // A forged webhook is refused before anything is granted.
    const forged = new Request("https://pay.example.test/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=00" },
      body: JSON.stringify({ id: "evt_x", type: "payment_intent.succeeded" }),
    })
    expect(await w.webhook(forged)).toBe(400)
    expect((await w.entitlements.get(session.subject)).plan).toBe("free")

    // The buyer pays; Stripe's signed webhook arrives twice.
    const hook = await w.stripe.complete(checkout.gatewayId)
    expect(await w.webhook(hook.clone())).toBe(200)
    expect(await w.webhook(hook)).toBe(200)
    const anon = await w.entitlements.get(session.subject)
    expect(anon.plan).toBe("pro")
    expect(anon.entitlements[0]?.sources.length).toBe(1)

    const status = (await (await w.call(`/f/sessions/${session.id}`)).json()) as Any
    expect(status.session.status).toBe("paid")
    expect(status.redemption.link.startsWith("example://redeem?token=")).toBe(true)
    const token = status.redemption.token

    // The app opens the link after install and sign-in.
    expect((await w.call("/f/redeem", { body: { token } })).status).toBe(401)
    const redeemed = await w.call("/f/redeem", { body: { token }, user: "u1" })
    expect(redeemed.status).toBe(200)
    expect(((await redeemed.json()) as Any).already).toBe(false)
    expect((await w.entitlements.get("u1")).plan).toBe("pro")
    expect((await w.entitlements.get(session.subject)).plan).toBe("free")
    expect((await w.store.listPayments({ userId: "u1", limit: 5 })).length).toBe(1)
    const kinds = (await w.customers.timeline("u1")).entries.map((e) => e.kind).sort()
    expect(kinds).toEqual(["discount", "purchase"])

    // The same link again: a no-op for u1, refused for anyone else.
    expect(
      ((await (await w.call("/f/redeem", { body: { token }, user: "u1" })).json()) as Any).already,
    ).toBe(true)
    const other = await w.call("/f/redeem", { body: { token }, user: "u2" })
    expect(other.status).toBe(409)
    expect((await w.entitlements.get("u2")).plan).toBe("free")
    expect((await (await w.call(`/f/sessions/${session.id}`)).json()).redemption).toBeUndefined()

    // Drop-off: every step, in order, under the browser's visitor id.
    expect(w.tracked.map((e) => e.name)).toEqual([
      "funnel:spring:goal",
      "funnel:spring:plans",
      "funnel:spring:checkout",
      "funnel:spring:purchased",
      "funnel:spring:redeemed",
    ])
    expect(w.tracked.every((e) => e.anonymousId === "v_e2e")).toBe(true)
    expect(funnelSteps(FUNNEL).filter((s) => s !== "funnel:spring:checkout").length).toBe(4)
  })

  test("two accounts racing one link: exactly one gets the plan", async () => {
    const w = await world()
    const { session, checkout } = (await (
      await w.call("/f/spring/checkout", { body: { productId: "price_pro" } })
    ).json()) as Any
    expect(await w.webhook(await w.stripe.complete(checkout.gatewayId))).toBe(200)
    const { redemption } = (await (await w.call(`/f/sessions/${session.id}`)).json()) as Any
    const [a, b] = await Promise.all([
      w.call("/f/redeem", { body: { token: redemption.token }, user: "ua" }),
      w.call("/f/redeem", { body: { token: redemption.token }, user: "ub" }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(
      [(await w.entitlements.get("ua")).plan, (await w.entitlements.get("ub")).plan].sort(),
    ).toEqual(["free", "pro"])
  })

  test("an expired link is refused; a failed payment never unlocks", async () => {
    const w = await world()
    const { session, checkout } = (await (
      await w.call("/f/spring/checkout", { body: { productId: "price_pro" } })
    ).json()) as Any
    expect(await w.webhook(await w.stripe.complete(checkout.gatewayId, { status: "failed" }))).toBe(
      200,
    )
    expect((await w.entitlements.get(session.subject)).plan).toBe("free")
    expect(
      ((await (await w.call(`/f/sessions/${session.id}`)).json()) as Any).redemption,
    ).toBeUndefined()

    const s2 = (await (
      await w.call("/f/spring/checkout", { body: { productId: "price_pro" } })
    ).json()) as Any
    expect(await w.webhook(await w.stripe.complete(s2.checkout.gatewayId))).toBe(200)
    const { redemption } = (await (await w.call(`/f/sessions/${s2.session.id}`)).json()) as Any
    const realNow = Date.now
    Date.now = () => realNow() + 8 * 86_400_000
    try {
      const r = await w.call("/f/redeem", { body: { token: redemption.token }, user: "u1" })
      expect(r.status).toBe(400)
      expect(((await r.json()) as Any).code).toBe("BAD_TOKEN")
    } finally {
      Date.now = realNow
    }
    expect((await w.entitlements.get("u1")).plan).toBe("free")
  })
})
