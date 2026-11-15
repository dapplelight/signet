import { afterEach, describe, expect, test } from "bun:test"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { createCustomers } from "../src/customers"
import { createEntitlements, definePlans } from "../src/entitlements"
import {
  createFunnels,
  type FunnelCheckoutInput,
  type FunnelTrackedEvent,
  funnelSteps,
  periodEnd,
} from "../src/funnels"
import { createOfferings, plansFromProducts } from "../src/offerings"
import { backends, ddl, type Instance } from "./harness"

const plans = definePlans({
  free: { features: [] },
  pro: { features: ["sso"] },
  team: { features: ["sso", "audit"] },
})
const actor = { type: "user" as const, id: "admin-1" }
const products = [
  { id: "pro.monthly", store: "appstore", plan: "pro" as const, interval: "month" as const },
  {
    id: "price_pro_m",
    store: "web",
    plan: "pro" as const,
    interval: "month" as const,
    price: { amount: 1000, currency: "USD" },
  },
  {
    id: "price_team_y",
    store: "web",
    plan: "team" as const,
    interval: "year" as const,
    price: { amount: 9000, currency: "USD" },
  },
]
const FUNNEL = {
  key: "spring",
  placement: "web",
  title: "Spring",
  questions: [
    {
      id: "goal",
      title: "Your goal?",
      options: [
        { value: "focus", label: "Focus" },
        { value: "sleep", label: "Sleep" },
      ],
    },
    {
      id: "topics",
      title: "Topics",
      multiple: true,
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    },
  ],
}
const T0 = new Date("2026-11-01T10:00:00Z")

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
}

describe("pure", () => {
  test("funnelSteps names every step for analytics drop-off, in order", () => {
    expect(funnelSteps(FUNNEL)).toEqual([
      "funnel:spring:goal",
      "funnel:spring:topics",
      "funnel:spring:plans",
      "funnel:spring:checkout",
      "funnel:spring:purchased",
      "funnel:spring:redeemed",
    ])
  })
  test("periodEnd adds one month or year in UTC; once is lifetime", () => {
    expect(periodEnd(T0, "month")?.toISOString()).toBe("2026-12-01T10:00:00.000Z")
    expect(periodEnd(T0, "year")?.toISOString()).toBe("2027-11-01T10:00:00.000Z")
    expect(periodEnd(T0, "once")).toBeUndefined()
  })
})

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  afterEach(async () => {
    await open?.close()
    open = undefined
  })

  async function make(
    opts: {
      discounts?: Parameters<typeof createFunnels>[1]["discounts"]
      failCheckout?: boolean
      isMember?: (u: string, o: string) => boolean
      orgId?: string
    } = {},
  ) {
    open = await backend.make({ audit: true })
    const i = open
    const pg = i.db.dialect === "pg"
    const ent = (pg ? pgc.entitlementTables() : sqc.entitlementTables()) as ReturnType<
      typeof sqc.entitlementTables
    >
    const mon = (pg ? pgc.monetisationTables() : sqc.monetisationTables()) as ReturnType<
      typeof sqc.monetisationTables
    >
    const fun = (pg ? pgc.funnelTables() : sqc.funnelTables()) as ReturnType<
      typeof sqc.funnelTables
    >
    for (const t of [...Object.values(ent), ...Object.values(mon), ...Object.values(fun)])
      await i.exec(ddl(t))
    let clock = T0
    const entitlements = createEntitlements(i.db, {
      plans,
      default: "free",
      tables: ent,
      now: () => clock,
      billing: { plans: plansFromProducts(products) },
    })
    const offerings = createOfferings(i.db, { tables: mon, plans })
    await offerings.publish("web-default", { products }, { actor })
    await offerings.setPlacement("web", { offering: "web-default" }, { actor })
    const customers = createCustomers(i.db, {
      tables: { ...ent, ...mon },
      entitlements,
      ...(opts.isMember ? { isMember: opts.isMember } : {}),
    })
    const checkouts: FunnelCheckoutInput[] = []
    const events: FunnelTrackedEvent[] = []
    const paidMail: string[] = []
    let n = 0
    const funnels = createFunnels(i.db, {
      tables: { ...fun, customerEvents: mon.customerEvents },
      funnels: [FUNNEL],
      discounts: opts.discounts ?? [],
      offerings,
      customers,
      entitlements,
      now: () => clock,
      checkout: async (input) => {
        checkouts.push(input)
        if (opts.failCheckout) throw new Error("gateway down")
        return { gateway: "stripe", gatewayId: `pi_${++n}`, clientSecret: `pi_${n}_secret` }
      },
      track: (e) => {
        events.push(e)
      },
      onPaid: (s) => {
        paidMail.push(`${s.id}:${s.email}`)
      },
    })
    const captured = (gatewayId: string, amount: number, id = `evt_${gatewayId}`) => ({
      id,
      gateway: "stripe",
      type: "payment.captured",
      occurredAt: clock,
      paymentId: gatewayId,
      amount,
      currency: "USD",
    })
    return {
      i,
      entitlements,
      customers,
      funnels,
      checkouts,
      events,
      paidMail,
      captured,
      mon,
      tick: (ms: number) => {
        clock = new Date(clock.getTime() + ms)
      },
    }
  }

  test("config is checked up front", async () => {
    const { funnels } = await make()
    const base = { offerings: {} as never, customers: {} as never, checkout: (() => {}) as never }
    const tables = {} as never
    const db = open?.db as never
    const bad = (cfg: object) => {
      try {
        createFunnels(db, { tables, funnels: [], ...base, ...cfg })
        return "OK"
      } catch (e) {
        return (e as { code?: string }).code
      }
    }
    expect(bad({ funnels: [{ key: "bad key", placement: "web" }] })).toBe("BAD_VALUE")
    expect(bad({ funnels: [FUNNEL, FUNNEL] })).toBe("BAD_VALUE")
    expect(
      bad({
        funnels: [
          {
            key: "x",
            placement: "w",
            questions: [{ id: "plans", title: "t", options: [{ value: "a", label: "a" }] }],
          },
        ],
      }),
    ).toBe("BAD_VALUE")
    expect(
      bad({
        discounts: [{ code: "X1", percentOff: 10, amountOff: { amount: 1, currency: "USD" } }],
      }),
    ).toBe("BAD_VALUE")
    expect(bad({ discounts: [{ code: "X1", percentOff: 101 }] })).toBe("BAD_VALUE")
    expect(bad({ discounts: [{ code: "X1", percentOff: 10, expiresAt: "soon" }] })).toBe(
      "BAD_VALUE",
    )
    expect(bad({ discounts: [{ code: "ok", percentOff: 10 }] })).toBe("OK")
    expect(funnels.funnel("spring")?.title).toBe("Spring")
    expect(await code(funnels.page("missing"))).toBe("NOT_FOUND")
  })

  test("discounts are priced server side: expiry, plan scope, currency, uses, never free", async () => {
    const { funnels, tick } = await make({
      discounts: [
        { code: "spring20", percentOff: 20, expiresAt: "2026-11-02T00:00:00Z", plans: ["pro"] },
        { code: "EUR5", amountOff: { amount: 500, currency: "EUR" } },
        { code: "ALL", percentOff: 100 },
        { code: "ONCE", amountOff: { amount: 100, currency: "USD" }, maxRedemptions: 1 },
      ],
    })
    const p = await funnels.page("spring", { code: "Spring20" })
    expect(p.offering.products.map((x) => x.id)).toEqual(["price_pro_m", "price_team_y"])
    expect(p.discounts).toEqual({
      price_pro_m: { valid: true, code: "SPRING20", off: 200, amount: 800, currency: "USD" },
      price_team_y: { valid: false, code: "SPRING20", reason: "not_for_plan" },
    })
    const pro = p.offering.products[0] as never
    expect(await funnels.quote("EUR5", pro)).toMatchObject({ valid: false, reason: "currency" })
    expect(await funnels.quote("ALL", pro)).toMatchObject({ valid: false, reason: "free" })
    expect(await funnels.quote("NOPE", pro)).toMatchObject({ valid: false, reason: "unknown" })
    await funnels.start("spring", { productId: "price_pro_m", code: "once" })
    expect(await funnels.quote("ONCE", pro)).toMatchObject({ valid: false, reason: "used_up" })
    tick(86_400_000)
    expect(await funnels.quote("SPRING20", pro)).toMatchObject({ valid: false, reason: "expired" })
    expect(
      await code(funnels.start("spring", { productId: "price_pro_m", code: "SPRING20" })),
    ).toBe("BAD_VALUE")
  })

  test("start: prices the product, checks answers, and charges exactly that under the session id", async () => {
    const { funnels, checkouts, events } = await make({
      discounts: [{ code: "TEN", percentOff: 10 }],
    })
    for (const input of [
      { productId: "pro.monthly" }, // a store product, not sold on the web
      { productId: "price_nope" },
      { productId: "price_pro_m", answers: { goal: "fly" } },
      { productId: "price_pro_m", answers: { goal: ["focus", "sleep"] } },
      { productId: "price_pro_m", answers: { other: "x" } },
      { productId: "price_pro_m", email: "not an email" },
    ])
      expect(await code(funnels.start("spring", input))).toBe("BAD_VALUE")
    expect(checkouts.length).toBe(0)

    const { session, checkout } = await funnels.start("spring", {
      productId: "price_pro_m",
      answers: { goal: "focus", topics: ["a", "b"] },
      code: "ten",
      email: "buyer@example.test",
      visitor: "v_1",
      returnUrl: (id) => `https://pay.example.test/f/spring?session=${id}`,
    })
    expect(session.id.startsWith("fs_")).toBe(true)
    expect(session.subject.startsWith("anon_")).toBe(true)
    expect([session.amount, session.discountCode, session.discountOff, session.status]).toEqual([
      900,
      "TEN",
      100,
      "open",
    ])
    expect(session.answers).toEqual({ goal: "focus", topics: ["a", "b"] })
    expect(checkout.clientSecret).toBe("pi_1_secret")
    expect(checkouts[0]).toMatchObject({
      amount: 900,
      currency: "USD",
      idempotencyKey: session.id,
      reference: session.id,
      userId: session.subject,
      customer: { email: "buyer@example.test" },
      returnUrl: `https://pay.example.test/f/spring?session=${session.id}`,
      metadata: { funnel: "spring", funnelSession: session.id },
    })
    expect((await funnels.get(session.id))?.checkoutId).toBe("pi_1")
    expect(events.map((e) => [e.name, e.anonymousId])).toEqual([["funnel:spring:checkout", "v_1"]])

    await funnels.step("spring", "goal", { anonymousId: "v_1" })
    expect(events.at(-1)?.name).toBe("funnel:spring:goal")
    expect(await code(funnels.step("spring", "purchased"))).toBe("BAD_VALUE")
  })

  test("maxRedemptions holds under concurrent checkouts; a failed checkout gives its use back", async () => {
    const { funnels } = await make({
      discounts: [{ code: "TWO", percentOff: 10, maxRedemptions: 2 }],
    })
    const runs = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        code(funnels.start("spring", { productId: "price_pro_m", code: "TWO" })),
      ),
    )
    expect(runs.filter((r) => r === "OK").length).toBe(2)
    expect(runs.filter((r) => r === "BAD_VALUE").length).toBe(3)

    await open?.close()
    const down = await make({
      discounts: [{ code: "ONE", percentOff: 10, maxRedemptions: 1 }],
      failCheckout: true,
    })
    expect(
      await code(down.funnels.start("spring", { productId: "price_pro_m", code: "ONE" })),
    ).toBe("Error: gateway down")
    const pro = (await down.funnels.page("spring")).offering.products[0] as never
    expect(await down.funnels.quote("ONE", pro)).toMatchObject({ valid: true })
  })

  test("abandoned checkouts do not use up a limited code; a late capture still grants", async () => {
    const { funnels, tick, captured, entitlements } = await make({
      discounts: [{ code: "ONE", percentOff: 10, maxRedemptions: 1 }],
    })
    const start = () => funnels.start("spring", { productId: "price_pro_m", code: "ONE" })
    const first = (await start()).session
    // Unpaid, but still inside the hold: the one use is taken.
    expect(await code(start())).toBe("BAD_VALUE")
    const pro = (await funnels.page("spring")).offering.products[0] as never
    expect(await funnels.quote("ONE", pro)).toMatchObject({ valid: false, reason: "used_up" })

    // Past the hold, the quote sees it free, and so does the next buyer.
    tick(3_600_001)
    expect(await funnels.quote("ONE", pro)).toMatchObject({ valid: true })
    const second = (await start()).session
    expect((await funnels.get(first.id))?.status).toBe("expired")
    expect((await funnels.get(second.id))?.status).toBe("open")
    // The code is held again by the new checkout, not given out twice.
    expect(await code(start())).toBe("BAD_VALUE")

    // The first buyer did pay after all: granted, and the use is counted again.
    const late = await funnels.applyEvent(captured("pi_1", 900))
    expect(late).toMatchObject({ applied: true, session: { id: first.id, status: "paid" } })
    expect((await entitlements.get(first.subject)).plan).toBe("pro")
    tick(3_600_001)
    expect(await funnels.quote("ONE", pro)).toMatchObject({ valid: false, reason: "used_up" })
  })

  test("a paid checkout keeps its use for good", async () => {
    const { funnels, tick, captured } = await make({
      discounts: [{ code: "ONE", percentOff: 10, maxRedemptions: 1 }],
    })
    await funnels.start("spring", { productId: "price_pro_m", code: "ONE" })
    await funnels.applyEvent(captured("pi_1", 900))
    tick(10 * 3_600_000)
    const pro = (await funnels.page("spring")).offering.products[0] as never
    expect(await funnels.quote("ONE", pro)).toMatchObject({ valid: false, reason: "used_up" })
  })

  test("only a verified capture for the priced amount grants, once, and the discount lands on the timeline", async () => {
    const { funnels, entitlements, customers, captured, events, paidMail } = await make({
      discounts: [{ code: "TEN", percentOff: 10 }],
    })
    const { session } = await funnels.start("spring", {
      productId: "price_pro_m",
      code: "TEN",
      email: "b@example.test",
      visitor: "v_9",
    })
    expect(await funnels.applyEvent({ ...captured("pi_other", 900) })).toMatchObject({
      applied: false,
      reason: "not_funnel",
    })
    // A tampered or partial capture is not the price this server set.
    expect(await funnels.applyEvent(captured("pi_1", 1000))).toMatchObject({
      applied: false,
      reason: "amount_mismatch",
    })
    expect((await entitlements.get(session.subject)).plan).toBe("free")
    expect(await funnels.redeem(session.id, "u1")).toEqual({ redeemed: false, reason: "not_paid" })

    const ok = await funnels.applyEvent(captured("pi_1", 900))
    expect(ok).toMatchObject({ applied: true, session: { status: "paid", paymentId: "pi_1" } })
    const anon = await entitlements.get(session.subject)
    expect([anon.plan, anon.currentPeriodEnd?.toISOString()]).toEqual([
      "pro",
      "2026-12-01T10:00:00.000Z",
    ])
    expect(await funnels.applyEvent(captured("pi_1", 900, "evt_again"))).toMatchObject({
      applied: false,
      reason: "duplicate",
    })
    const tl = await customers.timeline(session.subject)
    expect(tl.entries.map((e) => [e.kind, e.eventType, e.amount])).toEqual([
      ["discount", "funnel.discount:TEN", 100],
    ])
    expect(
      events.filter((e) => e.name === "funnel:spring:purchased").map((e) => e.anonymousId),
    ).toEqual(["v_9"])
    expect(paidMail).toEqual([`${session.id}:b@example.test`])
  })

  test("redeem: moves the purchase to the account once; repeats are no-ops, a second account and a race are refused", async () => {
    const { funnels, entitlements, captured, customers, events } = await make()
    const { session } = await funnels.start("spring", { productId: "price_team_y" })
    await funnels.applyEvent(captured("pi_1", 9000))

    const first = await funnels.redeem(session.id, "u1")
    expect(first).toMatchObject({
      redeemed: true,
      already: false,
      session: { status: "redeemed", redeemedBy: "u1" },
    })
    expect((await entitlements.get("u1")).plan).toBe("team")
    expect((await entitlements.get(session.subject)).plan).toBe("free")
    expect(await customers.resolve(session.subject)).toBe("u1")
    expect(await funnels.redeem(session.id, "u1")).toMatchObject({ redeemed: true, already: true })
    expect(await funnels.redeem(session.id, "u2")).toEqual({
      redeemed: false,
      reason: "already_redeemed",
    })
    expect((await entitlements.get("u2")).plan).toBe("free")
    expect(events.filter((e) => e.name === "funnel:spring:redeemed").map((e) => e.userId)).toEqual([
      "u1",
    ])

    const s2 = (await funnels.start("spring", { productId: "price_pro_m" })).session
    await funnels.applyEvent(captured("pi_2", 1000))
    const race = await Promise.all([funnels.redeem(s2.id, "ua"), funnels.redeem(s2.id, "ub")])
    expect(race.filter((r) => r.redeemed).length).toBe(1)
    expect(
      [(await entitlements.get("ua")).plan, (await entitlements.get("ub")).plan].sort(),
    ).toEqual(["free", "pro"])
    expect(await funnels.redeem("fs_missing", "u1")).toEqual({
      redeemed: false,
      reason: "not_found",
    })
  })

  test("a refused merge frees the claim; a refund ends access wherever it was merged", async () => {
    const { funnels, entitlements, captured } = await make({ isMember: (u) => u === "member" })
    const { session } = await funnels.start("spring", { productId: "price_pro_m", orgId: "org_a" })
    await funnels.applyEvent(captured("pi_1", 1000))
    expect(await funnels.redeem(session.id, "outsider")).toEqual({
      redeemed: false,
      reason: "not_member",
    })
    expect((await funnels.get(session.id))?.status).toBe("paid")
    expect(await funnels.redeem(session.id, "member")).toMatchObject({ redeemed: true })
    expect((await entitlements.get("member")).plan).toBe("pro")

    const refund = await funnels.applyEvent({
      id: "evt_r",
      gateway: "stripe",
      type: "refund.processed",
      occurredAt: new Date(T0.getTime() + 1000),
      paymentId: "pi_1",
      amount: 1000,
      currency: "USD",
    })
    expect(refund).toMatchObject({ applied: true, session: { status: "refunded" } })
    expect((await entitlements.get("member")).plan).toBe("free")
    expect(await funnels.redeem(session.id, "member")).toEqual({
      redeemed: false,
      reason: "refunded",
    })
  })
})
