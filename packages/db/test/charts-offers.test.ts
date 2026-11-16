import { afterEach, describe, expect, test } from "bun:test"
import { chartsCsv, createCharts } from "../src/charts"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { createCustomers, timelineKind } from "../src/customers"
import { createEntitlements, definePlans } from "../src/entitlements"
import {
  createOfferings,
  type OfferHistory,
  offerEligible,
  plansFromProducts,
} from "../src/offerings"
import { backends, ddl, type Instance } from "./harness"

const plans = definePlans({
  free: { features: ["export"] },
  pro: { features: ["export", "sso"] },
})
const actor = { type: "user" as const, id: "admin-1" }
const DAY = 86_400_000
const at = (d: string) => new Date(`${d}T12:00:00Z`)
const products = [
  {
    id: "pro.monthly",
    store: "appstore",
    plan: "pro" as const,
    interval: "month" as const,
    offers: [
      { id: "trial7", type: "free_trial" as const, days: 7 },
      {
        id: "winback50",
        type: "win_back" as const,
        price: { amount: 249, currency: "USD" },
        days: 30,
        eligibility: { lapsedDays: 30 },
      },
    ],
  },
  {
    id: "pro_monthly",
    store: "googleplay",
    plan: "pro" as const,
    interval: "month" as const,
    price: { amount: 49900, currency: "INR" },
  },
  {
    id: "price_pro_y",
    store: "web",
    plan: "pro" as const,
    interval: "year" as const,
    price: { amount: 120000, currency: "INR" },
    offers: [
      {
        id: "intro_half",
        type: "intro" as const,
        price: { amount: 60000, currency: "INR" },
        days: 365,
      },
    ],
  },
]

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
}

describe("pure", () => {
  const offer = products[0]?.offers?.[0] as never
  const winback = products[0]?.offers?.[1] as never
  const h = (o: Partial<OfferHistory> = {}): OfferHistory => ({
    subscribed: false,
    active: false,
    lapsedAt: null,
    trialed: false,
    redeemed: new Set(),
    ...o,
  })
  const now = at("2026-05-01")
  test("free trial: never subscribed, once, never while active", () => {
    expect(offerEligible(offer, h(), now)).toBe(true)
    expect(offerEligible(offer, h({ trialed: true }), now)).toBe(false)
    expect(offerEligible(offer, h({ subscribed: true }), now)).toBe(false)
    expect(offerEligible(offer, h({ active: true }), now)).toBe(false)
    expect(offerEligible(offer, h({ redeemed: new Set(["trial7"]) }), now)).toBe(false)
  })
  test("win-back: lapsed at least N days, to the day; never for new or active customers", () => {
    const lapsed = (days: number) =>
      h({ subscribed: true, lapsedAt: new Date(now.getTime() - days * DAY) })
    expect(offerEligible(winback, lapsed(29), now)).toBe(false)
    expect(offerEligible(winback, lapsed(30), now)).toBe(true)
    expect(offerEligible(winback, h(), now)).toBe(false)
    expect(offerEligible(winback, h({ subscribed: true }), now)).toBe(false) // end unknown
    expect(offerEligible(winback, { ...lapsed(90), active: true }, now)).toBe(false)
    expect(offerEligible(winback, { ...lapsed(90), redeemed: new Set(["winback50"]) }, now)).toBe(
      false,
    )
    const again = { ...(winback as object), eligibility: { lapsedDays: 30, once: false } } as never
    expect(offerEligible(again, { ...lapsed(90), redeemed: new Set(["winback50"]) }, now)).toBe(
      true,
    )
  })
  test("intro with neverSubscribed: false reaches returning customers", () => {
    const intro = { id: "i", type: "intro", price: { amount: 1, currency: "USD" } } as never
    const open = { ...(intro as object), eligibility: { neverSubscribed: false } } as never
    expect(offerEligible(intro, h({ subscribed: true }), now)).toBe(false)
    expect(offerEligible(open, h({ subscribed: true }), now)).toBe(true)
  })
  test("a zero-amount purchase or FREE_TRIAL offer is a trial; CONSUMPTION_REQUEST is a refund request", () => {
    const e = (o: { type: string } & Record<string, unknown>) => ({
      id: "1",
      gateway: "appstore",
      occurredAt: now,
      ...o,
    })
    expect(timelineKind(e({ type: "subscription.created", amount: 0 }))).toBe("trial")
    expect(
      timelineKind(
        e({
          type: "subscription.created",
          amount: 499,
          raw: { transaction: { offerDiscountType: "FREE_TRIAL" } },
        }),
      ),
    ).toBe("trial")
    expect(timelineKind(e({ type: "subscription.created", amount: 499 }))).toBe("purchase")
    expect(timelineKind(e({ type: "unknown", gatewayType: "CONSUMPTION_REQUEST" }))).toBe(
      "refund_request",
    )
  })
})

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  afterEach(async () => {
    await open?.close()
    open = undefined
  })

  async function make(clock = { now: at("2026-03-31") }, consented = new Set<string>()) {
    open = await backend.make({ audit: true })
    const i = open
    const pg = i.db.dialect === "pg"
    const ent = (pg ? pgc.entitlementTables() : sqc.entitlementTables()) as ReturnType<
      typeof sqc.entitlementTables
    >
    const mon = (pg ? pgc.monetisationTables() : sqc.monetisationTables()) as ReturnType<
      typeof sqc.monetisationTables
    >
    for (const t of [...Object.values(ent), ...Object.values(mon)]) await i.exec(ddl(t))
    const now = () => clock.now
    const entitlements = createEntitlements(i.db, {
      plans,
      default: "free",
      tables: ent,
      billing: { plans: plansFromProducts(products) },
      now,
    })
    const offerings = createOfferings(i.db, { tables: mon, plans })
    const customers = createCustomers(i.db, {
      tables: { ...ent, ...mon },
      entitlements,
      now,
      consumption: { consented: (s) => consented.has(s) },
    })
    const charts = createCharts(i.db, {
      tables: mon,
      fx: { base: "USD", rates: { INR: 0.012 } },
      now,
    })
    return { i, entitlements, offerings, customers, charts, clock }
  }

  let n = 0
  const ev = (o: {
    gateway: string
    type: string
    day: string
    sub?: string
    product?: string
    amount?: number
    currency?: string
  }) => ({
    id: `e${++n}`,
    gateway: o.gateway,
    type: o.type,
    occurredAt: at(o.day),
    ...(o.sub ? { subscriptionId: o.sub } : {}),
    ...(o.product ? { productId: o.product } : {}),
    ...(o.amount !== undefined ? { amount: o.amount } : {}),
    ...(o.currency ? { currency: o.currency } : {}),
    ...(o.gateway === "appstore" && o.amount !== undefined ? { approximate: true } : {}),
  })

  /** The fixture: five customers in March 2026 (see each line). */
  async function fixture(w: Awaited<ReturnType<typeof make>>) {
    const { customers, offerings } = w
    await offerings.publish("default", { products }, { actor })
    const rec = (subject: string, e: ReturnType<typeof ev>, country?: string) =>
      customers.record(e, { subject, ...(country ? { country } : {}) })
    const a = { gateway: "appstore", product: "pro.monthly" }
    // u1: App Store trial on the 1st, converts on the 8th at 4.99 USD.
    await rec(
      "u1",
      ev({
        ...a,
        type: "subscription.created",
        day: "2026-03-01",
        sub: "A",
        amount: 0,
        currency: "USD",
      }),
      "US",
    )
    await rec(
      "u1",
      ev({
        ...a,
        type: "subscription.charged",
        day: "2026-03-08",
        sub: "A",
        amount: 499,
        currency: "USD",
      }),
    )
    // u2: saw the "default" paywall on the 1st, bought the web yearly plan on the 2nd.
    w.clock.now = at("2026-03-01")
    await customers.logImpression("u2", { offering: "default", version: 1, country: "IN" })
    await customers.logImpression("u2", { offering: "default", version: 1 }) // same day: once
    w.clock.now = at("2026-03-31")
    await rec(
      "u2",
      ev({
        gateway: "stripe",
        product: "price_pro_y",
        type: "subscription.activated",
        day: "2026-03-02",
        sub: "B",
        amount: 120000,
        currency: "INR",
      }),
    )
    // u3: Google Play with no amount on the event (MRR from the product price), expired on the 10th.
    await rec(
      "u3",
      ev({
        gateway: "googleplay",
        product: "pro_monthly",
        type: "subscription.created",
        day: "2026-03-03",
        sub: "C",
      }),
    )
    await rec(
      "u3",
      ev({ gateway: "googleplay", type: "subscription.expired", day: "2026-03-10", sub: "C" }),
    )
    // u4: App Store purchase on the 5th, refunded on the 6th.
    await rec(
      "u4",
      ev({
        ...a,
        type: "subscription.created",
        day: "2026-03-05",
        sub: "D",
        amount: 499,
        currency: "USD",
      }),
    )
    await rec(
      "u4",
      ev({
        ...a,
        type: "refund.processed",
        day: "2026-03-06",
        sub: "D",
        amount: 499,
        currency: "USD",
      }),
    )
    // u5: trial on the 20th, never converts.
    await rec(
      "u5",
      ev({
        ...a,
        type: "subscription.created",
        day: "2026-03-20",
        sub: "E",
        amount: 0,
        currency: "USD",
      }),
    )
  }

  test("charts: a period ending today is not churned until the day has passed", async () => {
    const w = await make({ now: at("2026-04-01") })
    await w.offerings.publish("default", { products }, { actor })
    await w.customers.record(
      ev({
        gateway: "appstore",
        product: "pro.monthly",
        type: "subscription.charged",
        day: "2026-03-01",
        sub: "R",
        amount: 499,
        currency: "USD",
      }),
      { subject: "r1" },
    )
    // Coverage ends on the 1st (today): the renewal may still be on its way.
    const today = await w.charts.metrics({ from: "2026-03-30", to: "2026-04-01" })
    expect(today.days.at(-1)).toMatchObject({ activeSubscribers: 1, churned: 0 })
    expect(today.summary).toMatchObject({ activeSubscribers: 1, churned: 0, mrr: { USD: 499 } })
    // A day on with no renewal, it counts as churned on the day coverage ended.
    w.clock.now = at("2026-04-02")
    const next = await w.charts.metrics({ from: "2026-03-30", to: "2026-04-02" })
    expect(next.days.at(-2)).toMatchObject({ day: "2026-04-01", churned: 1 })
    expect(next.summary).toMatchObject({ activeSubscribers: 0, churned: 1 })
  })

  test("charts: metric math on a fixed fixture, per day and summed", async () => {
    const w = await make()
    await fixture(w)
    const r = await w.charts.metrics({ from: "2026-03-01", to: "2026-03-31" })
    expect(r.days).toHaveLength(31)
    expect(r.currencies).toEqual(["INR", "USD"])
    expect(r.approximate).toBe(true)
    const day = (d: string) => r.days.find((x) => x.day === d)
    expect(day("2026-03-05")).toMatchObject({ activeSubscribers: 3, activeTrials: 1 })
    expect(day("2026-03-05")?.mrr).toEqual({ INR: 10000 + 49900, USD: 499 })
    expect(day("2026-03-06")).toMatchObject({ churned: 1, refundCount: 1, refunds: { USD: 499 } })
    expect(day("2026-03-08")).toMatchObject({
      trialConversions: 1,
      newSubscriptions: 1,
      newRevenue: { USD: 499 },
      activeTrials: 0,
    })
    expect(day("2026-03-10")?.churned).toBe(1)
    expect(day("2026-03-21")?.activeTrials).toBe(1)
    expect(day("2026-03-27")?.activeTrials).toBe(0)
    expect(day("2026-03-01")?.impressions).toBe(1)
    expect(day("2026-03-02")?.conversions).toBe(1)
    expect(r.summary).toEqual({
      mrr: { INR: 10000, USD: 499 },
      mrrTotal: 499 + 120, // 100 INR at 0.012
      activeSubscribers: 2,
      activeTrials: 0,
      newRevenue: { INR: 120000, USD: 998 },
      renewalRevenue: {},
      refunds: { USD: 499 },
      refundCount: 1,
      newSubscriptions: 4,
      trialsStarted: 2,
      trialConversion: 0.5,
      churned: 2,
      churnRate: null,
      impressions: 1,
      conversions: 1,
      paywallConversion: 1,
    })
    // Churn rate over subscribers active the day before the range: u2 and u3; u3 churns.
    const later = await w.charts.metrics({ from: "2026-03-07", to: "2026-03-31" })
    expect([later.summary.churned, later.summary.churnRate]).toEqual([1, 0.5])
    // A renewal a month later is renewal revenue, and coverage carries on.
    await w.customers.record(
      ev({
        gateway: "appstore",
        product: "pro.monthly",
        type: "subscription.charged",
        day: "2026-04-08",
        sub: "A",
        amount: 499,
        currency: "USD",
      }),
      { subject: "u1" },
    )
    w.clock.now = at("2026-04-30")
    const april = await w.charts.metrics({ from: "2026-04-01", to: "2026-04-30" })
    expect(april.summary).toMatchObject({
      renewalRevenue: { USD: 499 },
      newRevenue: {},
      churned: 0,
      activeSubscribers: 2,
    })
  })

  test("charts: filters by store, plan, country and offering; audiences; CSV", async () => {
    const w = await make()
    await fixture(w)
    const q = { from: "2026-03-01", to: "2026-03-31" }
    const apple = await w.charts.metrics({ ...q, store: "appstore" })
    expect(apple.summary).toMatchObject({
      activeSubscribers: 1,
      mrr: { USD: 499 },
      newRevenue: { USD: 998 },
      trialsStarted: 2,
    })
    expect((await w.charts.metrics({ ...q, store: "web" })).summary.mrr).toEqual({ INR: 10000 })
    expect((await w.charts.metrics({ ...q, store: "stripe" })).summary.mrr).toEqual({ INR: 10000 })
    expect((await w.charts.metrics({ ...q, plan: "pro" })).summary.newSubscriptions).toBe(4)
    expect((await w.charts.metrics({ ...q, plan: "team" })).summary.newSubscriptions).toBe(0)
    const india = await w.charts.metrics({ ...q, country: "in" })
    expect([india.summary.newSubscriptions, india.summary.mrr]).toEqual([1, { INR: 10000 }])
    const fromPaywall = await w.charts.metrics({ ...q, offering: "default" })
    expect(fromPaywall.summary).toMatchObject({
      newSubscriptions: 1,
      impressions: 1,
      conversions: 1,
    })

    const saved = await w.charts.saveAudience("App Store", { store: "appstore" }, { actor })
    expect((await w.charts.audiences()).map((x) => x.name)).toEqual(["App Store"])
    const viaAudience = await w.charts.metrics({ ...q, audience: saved.id })
    expect(viaAudience.summary).toEqual(apple.summary)
    expect(await code(w.charts.saveAudience("Empty", {}, { actor }))).toBe("BAD_VALUE")
    expect(await code(w.charts.metrics({ ...q, audience: "nope" }))).toBe("NOT_FOUND")
    expect(await w.charts.removeAudience(saved.id, { actor })).toBe(true)
    expect(await w.charts.audiences()).toEqual([])

    for (const bad of [
      { from: "2026-03-31", to: "2026-03-01" },
      { from: "03/01/2026", to: "2026-03-31" },
      { from: "2024-01-01", to: "2026-03-31" },
      { ...q, country: "India" },
    ])
      expect(await code(w.charts.metrics(bad))).toBe("BAD_VALUE")

    const csv = chartsCsv(await w.charts.metrics({ from: "2026-03-08", to: "2026-03-08" })).split(
      "\n",
    )
    expect(csv[0]).toBe(
      "day,active_subscribers,active_trials,new_subscriptions,trials_started,trial_conversions,churned,refund_count,impressions,conversions,mrr_INR,mrr_USD,new_revenue_INR,new_revenue_USD,renewal_revenue_INR,renewal_revenue_USD,refunds_INR,refunds_USD,mrr_total_USD",
    )
    expect(csv[1]).toBe(
      "2026-03-08,3,0,1,0,1,0,0,0,0,599.00,4.99,0.00,4.99,0.00,0.00,0.00,0.00,12.18",
    )
  })

  test("promotional entitlements: granted from admin, on the timeline, lapse on their own", async () => {
    const w = await make({ now: at("2026-03-01") })
    const { customers, entitlements, clock } = w
    expect(await code(customers.grantPromotional("u1", { plan: "pro", days: 0 }, { actor }))).toBe(
      "BAD_VALUE",
    )
    expect(await code(customers.grantPromotional("u1", { plan: "gold", days: 3 }, { actor }))).toBe(
      "BAD_VALUE",
    )
    expect(
      await code(
        customers.grantPromotional("u1", { plan: "pro", expiresAt: at("2026-02-01") }, { actor }),
      ),
    ).toBe("BAD_VALUE")
    const g = await customers.grantPromotional(
      "u1",
      { plan: "pro", days: 10, note: "Beta tester" },
      { actor },
    )
    expect(g.expiresAt.getTime()).toBe(at("2026-03-11").getTime())
    expect((await entitlements.get("u1")).plan).toBe("pro")
    const ov = await customers.overview("u1")
    expect([ov.source, ov.canCancel, ov.renews]).toEqual([null, false, false])
    expect((await customers.timeline("u1")).entries.map((e) => [e.kind, e.eventType])).toEqual([
      ["promotional", "promotional.granted: Beta tester"],
    ])
    clock.now = new Date(at("2026-03-11").getTime() - 1)
    expect((await entitlements.get("u1")).plan).toBe("pro")
    clock.now = at("2026-03-11") // lapses exactly at expiry, no grace, nothing run
    expect((await entitlements.get("u1")).plan).toBe("free")
    expect((await customers.timeline("u1")).entries.map((e) => e.kind)).toEqual([
      "expiration",
      "promotional",
    ])
    // Ended early: once, recorded once.
    const h = await customers.grantPromotional("u2", { plan: "pro", days: 30 }, { actor })
    expect(await customers.endPromotional("u2", h.id, { actor })).toBe(true)
    expect(await customers.endPromotional("u2", h.id, { actor })).toBe(false)
    expect((await entitlements.get("u2")).plan).toBe("free")
    expect((await customers.timeline("u2")).entries.map((e) => e.kind)).toEqual([
      "expiration",
      "promotional",
    ])
    // Not revenue, not subscribers.
    const r = await w.charts.metrics({ from: "2026-03-01", to: "2026-03-11" })
    expect([r.summary.newSubscriptions, r.days[0]?.activeSubscribers]).toEqual([0, 0])
  })

  test("offers: eligibility through the paywall, redeemed once, races have one winner", async () => {
    const w = await make({ now: at("2026-03-01") })
    const { customers, offerings, entitlements, clock } = w
    await offerings.publish("default", { products }, { actor })
    await offerings.setPlacement("onboarding", { offering: "default" }, { actor })
    const cur = (await offerings.current("onboarding")) as NonNullable<
      Awaited<ReturnType<typeof offerings.current>>
    >
    const ids = (o: { products: { offers?: { id: string }[] }[] }) =>
      o.products.flatMap((p) => p.offers?.map((x) => x.id) ?? [])
    expect(ids(await customers.withOffers(undefined, cur))).toEqual(["trial7", "intro_half"])
    expect(ids(await customers.withOffers("new", cur))).toEqual(["trial7", "intro_half"])

    // Redeem the intro offer once; a concurrent second claim loses.
    const runs = await Promise.all(
      [1, 2, 3].map(() => customers.redeemOffer("new", cur, "intro_half")),
    )
    expect(runs.filter((r) => r.redeemed)).toHaveLength(1)
    expect(runs.filter((r) => !r.redeemed).map((r) => !r.redeemed && r.reason)).toEqual([
      "already_used",
      "already_used",
    ])
    expect(ids(await customers.withOffers("new", cur))).toEqual(["trial7"])
    expect(await customers.redeemOffer("new", cur, "missing")).toEqual({
      redeemed: false,
      reason: "no_such_offer",
    })
    expect(await customers.redeemOffer("new", cur, "winback50")).toEqual({
      redeemed: false,
      reason: "not_eligible",
    })

    // A subscriber sees nothing; once lapsed 30 days, the win-back appears.
    await entitlements.applySubscription(
      {
        gateway: "appstore",
        gatewayId: "S1",
        status: "active",
        productId: "pro.monthly",
        currentPeriodEnd: at("2026-03-15"),
      },
      { subject: "sub" },
    )
    expect(ids(await customers.withOffers("sub", cur))).toEqual([])
    clock.now = at("2026-04-13")
    expect(ids(await customers.withOffers("sub", cur))).toEqual([])
    clock.now = at("2026-04-15")
    expect(ids(await customers.withOffers("sub", cur))).toEqual(["winback50"])
    expect((await customers.redeemOffer("sub", cur, "winback50")).redeemed).toBe(true)
    expect(ids(await customers.withOffers("sub", cur))).toEqual([])

    // A free trial already used (on the timeline) is not offered again.
    await customers.record(
      ev({
        gateway: "appstore",
        type: "subscription.created",
        day: "2026-04-01",
        sub: "T",
        amount: 0,
        currency: "USD",
      }),
      { subject: "trialed" },
    )
    expect(ids(await customers.withOffers("trialed", cur))).toEqual([])

    // Offers are validated on publish.
    const pub = (offers: unknown) =>
      offerings.publish("bad", { products: [{ ...products[0], offers } as never] }, { actor })
    for (const offers of [
      [{ id: "t", type: "free_trial" }],
      [{ id: "w", type: "win_back", price: { amount: 1, currency: "USD" } }],
      [{ id: "i", type: "intro" }],
      [{ id: "x", type: "lifetime", days: 3 }],
      [
        { id: "t", type: "free_trial", days: 3 },
        { id: "t", type: "free_trial", days: 7 },
      ],
      [
        {
          id: "t",
          type: "free_trial",
          days: 3,
          eligibility: { neverSubscribed: true, lapsedDays: 3 },
        },
      ],
      [{ id: "t", type: "free_trial", days: 3, eligibility: { once: "yes" } }],
      "trial",
    ])
      expect(await code(pub(offers))).toBe("BAD_VALUE")
  })

  test("impressions: once per customer, offering and day; off the timeline; follow merges", async () => {
    const w = await make({ now: at("2026-03-01") })
    const { customers, clock } = w
    const anon = await customers.anonymousId()
    expect((await customers.logImpression(anon, { offering: "default" })).logged).toBe(true)
    expect((await customers.logImpression(anon, { offering: "default" })).logged).toBe(false)
    expect((await customers.logImpression(anon, { offering: "india" })).logged).toBe(true)
    clock.now = at("2026-03-02")
    expect((await customers.logImpression(anon, { offering: "default" })).logged).toBe(true)
    expect(await code(customers.logImpression(anon, { offering: "x", country: "IND" }))).toBe(
      "BAD_VALUE",
    )
    expect((await customers.timeline(anon)).entries).toEqual([])
    await customers.merge({ anonymousId: anon, userId: "u9" })
    expect((await customers.timeline("u9")).entries).toEqual([])
    const r = await w.charts.metrics({ from: "2026-03-01", to: "2026-03-02" })
    expect(r.days.map((d) => d.impressions)).toEqual([2, 1])
  })

  test("CONSUMPTION_REQUEST: an answer built from the customer's data, only with consent", async () => {
    const consented = new Set(["u1"])
    const w = await make({ now: at("2026-03-16") }, consented)
    const { customers, entitlements } = w
    await entitlements.applySubscription(
      {
        gateway: "appstore",
        gatewayId: "A",
        status: "active",
        productId: "pro.monthly",
        currentPeriodEnd: at("2026-03-31"),
      },
      { subject: "u1" },
    )
    const rec = (e: object) => customers.record(e as never, { subject: "u1" })
    await rec({
      id: "t1",
      gateway: "appstore",
      type: "subscription.created",
      occurredAt: at("2026-02-22"),
      subscriptionId: "A",
      paymentId: "100",
      amount: 0,
      currency: "USD",
    })
    await rec({
      id: "t2",
      gateway: "appstore",
      type: "subscription.charged",
      occurredAt: at("2026-03-01"),
      subscriptionId: "A",
      paymentId: "101",
      amount: 499,
      currency: "USD",
    })
    const request = {
      id: "cr1",
      gateway: "appstore",
      type: "unknown",
      gatewayType: "CONSUMPTION_REQUEST",
      occurredAt: at("2026-03-16"),
      subscriptionId: "A",
      paymentId: "101",
      raw: { payload: { data: { consumptionRequestReason: "UNSATISFIED_WITH_PURCHASE" } } },
    }
    expect((await customers.record(request)).kind).toBe("refund_request")
    const r = await customers.consumptionInfo(request)
    // Half of the paid period (1st to 31st, asked on the 16th) used; a trial was given.
    expect(r).toEqual({
      respond: true,
      subject: "u1",
      transactionId: "101",
      body: {
        customerConsented: true,
        deliveryStatus: "DELIVERED",
        sampleContentProvided: true,
        consumptionPercentage: 50000,
      },
    })
    consented.delete("u1")
    expect(await customers.consumptionInfo(request)).toEqual({
      respond: false,
      reason: "no_consent",
    })
    expect(await customers.consumptionInfo({ ...request, gatewayType: "DID_RENEW" })).toEqual({
      respond: false,
      reason: "not_consumption_request",
    })
    expect(
      await customers.consumptionInfo({ ...request, subscriptionId: "nobody", paymentId: "9" }),
    ).toEqual({ respond: false, reason: "no_subject" })
  })

  test("CONSUMPTION_REQUEST: app hooks override; undelivered sends 0; prorated omits the percentage", async () => {
    open = await backend.make({ audit: true })
    const i = open
    const pg = i.db.dialect === "pg"
    const ent = (pg ? pgc.entitlementTables() : sqc.entitlementTables()) as ReturnType<
      typeof sqc.entitlementTables
    >
    const mon = (pg ? pgc.monetisationTables() : sqc.monetisationTables()) as ReturnType<
      typeof sqc.monetisationTables
    >
    for (const t of [...Object.values(ent), ...Object.values(mon)]) await i.exec(ddl(t))
    const entitlements = createEntitlements(i.db, { plans, default: "free", tables: ent })
    let pref: "GRANT_PRORATED" | "DECLINE" = "GRANT_PRORATED"
    const customers = createCustomers(i.db, {
      tables: { ...ent, ...mon },
      entitlements,
      consumption: {
        consented: () => true,
        refundPreference: () => pref,
        sampleContentProvided: () => false,
      },
    })
    const request = {
      id: "cr2",
      gateway: "appstore",
      type: "unknown",
      gatewayType: "CONSUMPTION_REQUEST",
      occurredAt: new Date(),
      paymentId: "555",
    }
    // Not on the customer's timeline: not delivered, so 0.
    pref = "DECLINE"
    expect(await customers.consumptionInfo(request, { subject: "u7" })).toMatchObject({
      body: {
        deliveryStatus: "UNDELIVERED_OTHER",
        consumptionPercentage: 0,
        sampleContentProvided: false,
        refundPreference: "DECLINE",
      },
    })
    pref = "GRANT_PRORATED"
    const r = await customers.consumptionInfo(request, { subject: "u7" })
    expect(r.respond && "consumptionPercentage" in r.body).toBe(false)
    expect(r.respond && r.body.refundPreference).toBe("GRANT_PRORATED")
  })
})
