import { afterEach, describe, expect, test } from "bun:test"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { createCustomers, timelineKind } from "../src/customers"
import { createEntitlements, definePlans } from "../src/entitlements"
import { createOfferings, plansFromProducts } from "../src/offerings"
import { backends, ddl, type Instance } from "./harness"

const plans = definePlans({
  free: { features: ["export"] },
  pro: { features: ["export", "sso"] },
  team: { features: ["export", "sso", "audit"] },
})
const actor = { type: "user" as const, id: "admin-1" }
const products = [
  { id: "pro.monthly", store: "appstore", plan: "pro", interval: "month" as const },
  { id: "pro_monthly", store: "googleplay", plan: "pro", interval: "month" as const },
  {
    id: "price_pro_m",
    store: "web",
    plan: "pro",
    interval: "month" as const,
    price: { amount: 49900, currency: "INR" },
  },
  {
    id: "price_team_y",
    store: "web",
    plan: "team",
    interval: "year" as const,
    price: { amount: 999900, currency: "INR" },
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
  test("plansFromProducts keys store products by store, web by bare id", () => {
    expect(plansFromProducts(products)).toEqual({
      "appstore:pro.monthly": "pro",
      "googleplay:pro_monthly": "pro",
      price_pro_m: "pro",
      price_team_y: "team",
    })
  })
  test("timelineKind tells grace periods from billing issues by store state", () => {
    const at = new Date()
    const e = (type: string, raw?: unknown) => ({
      id: "1",
      gateway: "appstore",
      type,
      occurredAt: at,
      raw,
    })
    expect(timelineKind(e("subscription.created"))).toBe("purchase")
    expect(timelineKind(e("subscription.charged"))).toBe("renewal")
    expect(timelineKind(e("subscription.past_due", { payload: { data: { status: 4 } } }))).toBe(
      "grace_period",
    )
    expect(timelineKind(e("subscription.past_due", { payload: { data: { status: 3 } } }))).toBe(
      "billing_issue",
    )
    expect(
      timelineKind(
        e("subscription.past_due", {
          subscription: { subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" },
        }),
      ),
    ).toBe("grace_period")
    expect(timelineKind(e("dispute.opened"))).toBe("dispute")
    expect(timelineKind(e("payout.processed"))).toBeUndefined()
  })
})

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  afterEach(async () => {
    await open?.close()
    open = undefined
  })

  async function make() {
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
    const entitlements = createEntitlements(i.db, {
      plans,
      default: "free",
      tables: ent,
      billing: { plans: plansFromProducts(products) },
    })
    const offerings = createOfferings(i.db, { tables: mon, plans })
    const customers = createCustomers(i.db, { tables: { ...ent, ...mon }, entitlements })
    return { i, entitlements, offerings, customers, tables: { ...ent, ...mon } }
  }

  test("offerings: versions are immutable, placements resolve per audience, pins roll back", async () => {
    const { offerings } = await make()
    const v1 = await offerings.publish(
      "default",
      { products, paywall: { title: "Go pro", highlight: "pro", plans: ["pro", "team"] } },
      { actor },
    )
    expect(v1.version).toBe(1)
    const v2 = await offerings.publish(
      "default",
      { products, paywall: { title: "Go further", highlight: "team" } },
      { actor },
    )
    expect(v2.version).toBe(2)
    expect((await offerings.get("default", 1))?.paywall?.title).toBe("Go pro")
    await offerings.publish("india", { products: products.slice(2) }, { actor })

    expect(
      await code(offerings.setPlacement("onboarding", { offering: "missing" }, { actor })),
    ).toBe("BAD_VALUE")
    await offerings.setPlacement(
      "onboarding",
      {
        offering: "default",
        overrides: [
          { when: { country: ["in"] }, offering: "india" },
          {
            when: { platform: ["appstore"], attributes: { cohort: ["beta"] } },
            offering: "default",
            version: 1,
          },
        ],
      },
      { actor },
    )
    const plain = await offerings.current("onboarding", { country: "US" })
    expect([plain?.key, plain?.version, plain?.override]).toEqual(["default", 2, null])
    const india = await offerings.current("onboarding", { country: "IN", platform: "web" })
    expect([india?.key, india?.override]).toEqual(["india", 0])
    const beta = await offerings.current("onboarding", {
      platform: "appstore",
      attributes: { cohort: "beta" },
    })
    expect([beta?.key, beta?.version, beta?.override]).toEqual(["default", 1, 1])
    expect(await offerings.current("onboarding", { platform: "appstore" })).toMatchObject({
      version: 2,
    })

    // A new version serves at once; pinning rolls it back, no app release either way.
    await offerings.publish("default", { products, paywall: { title: "v3" } }, { actor })
    expect((await offerings.current("onboarding"))?.paywall?.title).toBe("v3")
    await offerings.setPlacement("onboarding", { offering: "default", version: 1 }, { actor })
    expect((await offerings.current("onboarding"))?.paywall?.title).toBe("Go pro")
    expect(await offerings.current("nowhere")).toBeNull()
    expect((await offerings.versions("default")).map((o) => o.version)).toEqual([3, 2, 1])
    expect((await offerings.list()).map((o) => [o.key, o.version])).toEqual([
      ["default", 3],
      ["india", 1],
    ])
  })

  test("offerings: concurrent publishes get distinct versions; bad input is refused", async () => {
    const { offerings } = await make()
    const many = await Promise.all(
      [1, 2, 3, 4].map((n) => offerings.publish("burst", { products, note: `n${n}` }, { actor })),
    )
    expect(many.map((o) => o.version).sort()).toEqual([1, 2, 3, 4])
    const refused = [
      offerings.publish("x", { products: [] }, { actor }),
      offerings.publish("x", { products: [{ id: "a", store: "web", plan: "gold" }] }, { actor }),
      offerings.publish("x", { products: [...products, products[0] as never] }, { actor }),
      offerings.publish("x", { products, paywall: { highlight: "free" } }, { actor }),
      offerings.publish(
        "x",
        {
          products: [
            { id: "a", store: "web", plan: "pro", price: { amount: 4.99, currency: "USD" } },
          ],
        },
        { actor },
      ),
      offerings.publish("bad key!", { products }, { actor }),
    ]
    for (const r of refused) expect(await code(r)).toBe("BAD_VALUE")
  })

  test("merge: moves subscriptions and grants once; repeats and races never double or misroute", async () => {
    const { entitlements, customers } = await make()
    const anon = await customers.anonymousId()
    expect(anon.startsWith("anon_")).toBe(true)
    await entitlements.applySubscription(
      { gateway: "stripe", gatewayId: "sub_1", status: "active", productId: "price_pro_m" },
      { subject: anon },
    )
    await entitlements.grant(anon, "audit", { actor })
    expect((await entitlements.get(anon)).plan).toBe("pro")

    const runs = await Promise.all(
      [1, 2, 3, 4, 5].map(() => customers.merge({ anonymousId: anon, userId: "u1" })),
    )
    expect(runs.every((r) => r.merged)).toBe(true)
    const moved = runs.reduce((n, r) => n + (r.merged ? r.moved.subscriptions : 0), 0)
    expect(moved).toBe(1)
    const u1 = await entitlements.get("u1")
    expect(u1.plan).toBe("pro")
    expect(u1.entitlements.find((e) => e.plan === "pro")?.sources.length).toBe(1)
    expect(u1.features).toContain("audit")
    expect((await entitlements.get(anon)).plan).toBe("free")
    expect(await customers.resolve(anon)).toBe("u1")

    // Merged again later: nothing left to move.
    const again = await customers.merge({ anonymousId: anon, userId: "u1" })
    expect(again).toMatchObject({ merged: true, already: true, moved: { subscriptions: 0 } })
    // Into a different account: refused, and u1 keeps everything.
    expect(await customers.merge({ anonymousId: anon, userId: "u2" })).toEqual({
      merged: false,
      reason: "already_merged",
    })
    expect((await entitlements.get("u2")).plan).toBe("free")
    // A renewal for the subscription after the merge applies to u1, not the anon id.
    expect(
      await entitlements.applySubscription(
        { gateway: "stripe", gatewayId: "sub_1", status: "active", productId: "price_pro_m" },
        { subject: await customers.resolve(anon) },
      ),
    ).toMatchObject({ applied: true, subject: "u1" })
  })

  test("merge: a race into two accounts has exactly one winner", async () => {
    const { entitlements, customers } = await make()
    const anon = await customers.anonymousId()
    await entitlements.applySubscription(
      { gateway: "stripe", gatewayId: "sub_r", status: "active", productId: "price_pro_m" },
      { subject: anon },
    )
    const [a, b] = await Promise.all([
      customers.merge({ anonymousId: anon, userId: "ua" }),
      customers.merge({ anonymousId: anon, userId: "ub" }),
    ])
    expect([a, b].filter((r) => r.merged).length).toBe(1)
    expect([a, b].find((r) => !r.merged)).toEqual({ merged: false, reason: "already_merged" })
    const plansNow = [
      (await entitlements.get("ua")).plan,
      (await entitlements.get("ub")).plan,
    ].sort()
    expect(plansNow).toEqual(["free", "pro"])
  })

  test("merge: never across orgs, into another anonymous id, from a real user, or for a non-member", async () => {
    const { entitlements, customers, i, tables } = await make()
    const inA = await customers.anonymousId({ orgId: "org_a" })
    expect(await customers.merge({ anonymousId: inA, userId: "u1", orgId: "org_b" })).toEqual({
      merged: false,
      reason: "other_org",
    })
    expect(await customers.merge({ anonymousId: inA, userId: "u1" })).toEqual({
      merged: false,
      reason: "other_org",
    })
    const other = await customers.anonymousId({ orgId: "org_a" })
    expect(await customers.merge({ anonymousId: inA, userId: other, orgId: "org_a" })).toEqual({
      merged: false,
      reason: "target_is_anonymous",
    })
    // A signed-in user's id is not anonymous: merging two accounts is refused.
    await entitlements.applySubscription(
      { gateway: "stripe", gatewayId: "sub_u2", status: "active", productId: "price_pro_m" },
      { subject: "u2" },
    )
    expect(await customers.merge({ anonymousId: "u2", userId: "u3" })).toEqual({
      merged: false,
      reason: "not_anonymous",
    })
    expect((await entitlements.get("u2")).plan).toBe("pro")
    expect(await customers.merge({ anonymousId: inA, userId: inA })).toEqual({
      merged: false,
      reason: "same_subject",
    })

    const gated = createCustomers(i.db, {
      tables,
      entitlements,
      isMember: (u, o) => u === "member" && o === "org_a",
    })
    expect(await gated.merge({ anonymousId: inA, userId: "outsider", orgId: "org_a" })).toEqual({
      merged: false,
      reason: "not_member",
    })
    expect(await gated.merge({ anonymousId: inA, userId: "member", orgId: "org_a" })).toMatchObject(
      {
        merged: true,
      },
    )
  })
})
