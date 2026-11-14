import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import {
  type BillingEvent,
  createEntitlements,
  definePlans,
  entitlementTools,
  periodOf,
} from "../src/entitlements"
import { bucket, createFlags, defineFlags, evaluateFlag } from "../src/flags"
import { backends, ddl, type Instance } from "./harness"

const plans = definePlans({
  free: { features: ["export"], limits: { seats: 1, aiCredits: 5 } },
  pro: { features: ["export", "sso"], limits: { seats: 10, aiCredits: 100 } },
  team: { features: ["export", "sso", "audit"], limits: { seats: Number.POSITIVE_INFINITY } },
})

const flagDefs = defineFlags({
  newEditor: {
    default: false,
    description: "The rewritten editor",
    rules: [
      { when: { attributes: { country: ["IN", "LK"] } }, value: true },
      { when: { plan: ["team"] }, value: true },
    ],
    rollout: { percent: 25, value: true },
  },
  theme: { default: "light", rules: [{ when: { plan: ["pro"] }, value: "dark" }] },
})

const admin = { type: "user" as const, id: "admin-1" }

describe("plans and flags (pure)", () => {
  test("only declared keys type-check", () => {
    type E = ReturnType<typeof createEntitlements<typeof plans>>
    const check = (e: E) => {
      e.can("s", "sso")
      e.limit("s", "aiCredits")
      // @ts-expect-error not a declared feature
      e.can("s", "nope")
      // @ts-expect-error not a declared limit
      e.limit("s", "nope")
      // @ts-expect-error not a plan
      e.setPlan("s", "gold", { actor: admin })
    }
    expect(typeof check).toBe("function")
  })

  test("defineFlags rejects values of the wrong type", () => {
    expect(() =>
      defineFlags({ x: { default: false, rules: [{ when: {}, value: "yes" }] } }),
    ).toThrow(/boolean/)
    expect(() => defineFlags({ x: { default: 1, rollout: { percent: 120, value: 2 } } })).toThrow()
  })

  test("evaluation order: override > rules (in order) > rollout > default", () => {
    const d = flagDefs.newEditor
    const inSet = Array.from({ length: 400 }, (_, i) => `u${i}`)
    const rolled = inSet.find((id) => bucket("newEditor", id) < 2500) as string
    const notRolled = inSet.find((id) => bucket("newEditor", id) >= 2500) as string

    expect(evaluateFlag("newEditor", d, { id: notRolled }, { value: true }).reason).toBe("override")
    expect(
      evaluateFlag("newEditor", d, { id: rolled, attributes: { country: "IN" } }, { value: false }),
    ).toEqual({ value: false, reason: "override" })
    expect(evaluateFlag("newEditor", d, { id: notRolled, attributes: { country: "LK" } })).toEqual({
      value: true,
      reason: "rule",
      rule: 0,
    })
    expect(evaluateFlag("newEditor", d, { id: notRolled, plan: "team" })).toEqual({
      value: true,
      reason: "rule",
      rule: 1,
    })
    expect(evaluateFlag("newEditor", d, { id: rolled })).toEqual({ value: true, reason: "rollout" })
    expect(evaluateFlag("newEditor", d, { id: notRolled, attributes: { country: "US" } })).toEqual({
      value: false,
      reason: "default",
    })
    // An override of the wrong type is ignored, not trusted.
    expect(evaluateFlag("newEditor", d, { id: notRolled }, { value: "x" }).reason).toBe("default")
  })

  test("rollout is stable, close to the percent, and only grows when raised", () => {
    expect(bucket("f", "user-42")).toBe(bucket("f", "user-42"))
    expect(bucket("f", "user-42")).not.toBe(bucket("g", "user-42"))
    const ids = Array.from({ length: 10_000 }, (_, i) => `user-${i}`)
    const on = (percent: number) =>
      new Set(
        ids.filter(
          (id) =>
            evaluateFlag("f", { default: false, rollout: { percent, value: true } }, { id }).value,
        ),
      )
    const ten = on(10)
    const thirty = on(30)
    expect(ten.size).toBeGreaterThan(900)
    expect(ten.size).toBeLessThan(1100)
    for (const id of ten) expect(thirty.has(id)).toBe(true)
    expect(on(0).size).toBe(0)
    expect(on(100).size).toBe(ids.length)
  })

  test("periods", () => {
    const at = new Date("2026-11-15T23:59:00Z")
    expect(periodOf("month", at)).toBe("2026-11")
    expect(periodOf("day", at)).toBe("2026-11-15")
    expect(periodOf("total", at)).toBe("all")
  })
})

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  afterEach(async () => {
    await open?.close()
    open = undefined
  })

  let clock = new Date("2026-11-01T00:00:00Z")
  const now = () => clock
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms)
  }

  async function make() {
    clock = new Date("2026-11-01T00:00:00Z")
    open = await backend.make({ audit: true })
    const i = open
    const pg = i.db.dialect === "pg"
    const tables = pg
      ? (pgc.entitlementTables() as unknown as ReturnType<typeof sqc.entitlementTables>)
      : sqc.entitlementTables()
    const flagTable = pg ? pgc.flagOverrides() : sqc.flagOverrides()
    for (const t of [...Object.values(tables), flagTable]) await i.exec(ddl(t))
    const ent = createEntitlements(i.db, {
      plans,
      default: "free",
      tables,
      now,
      periods: { seats: "total" },
      billing: {
        plans: {
          plan_pro: "pro",
          plan_team: "team",
          "appstore:com.example.pro.monthly": "pro",
          "googleplay:pro_monthly": "pro",
          // The same id in two stores: the gateway-prefixed key wins.
          shared_id: "pro",
          "appstore:shared_id": "team",
        },
        graceMs: 86_400_000,
      },
    })
    const flags = createFlags(i.db, flagDefs, { table: flagTable, entitlements: ent, now })
    return { ...i, ent, flags, tables, flagTable }
  }

  const sub = (
    id: string,
    type: string,
    at: string,
    plan?: string,
    subscriptionId = "sub_1",
  ): BillingEvent => ({
    id,
    gateway: "razorpay",
    type,
    occurredAt: new Date(at),
    subscriptionId,
    raw: plan ? { payload: { subscription: { entity: { plan_id: plan } } } } : {},
  })

  test("default plan, setPlan, and overrides with expiry; writes audited", async () => {
    const { ent, db, S } = await make()
    expect(await ent.get("org-1")).toMatchObject({ plan: "free", storedPlan: null, status: null })
    expect(await ent.can("org-1", "sso")).toBe(false)
    expect(await ent.limit("org-1", "seats")).toBe(1)

    await ent.setPlan("org-1", "pro", { actor: admin })
    expect(await ent.can("org-1", "sso")).toBe(true)
    expect(await ent.limit("org-1", "seats")).toBe(10)

    await ent.grant("org-1", "audit", {
      actor: admin,
      expiresAt: new Date(clock.getTime() + 60_000),
    })
    await ent.revoke("org-1", "export", { actor: admin })
    await ent.setLimit("org-1", "seats", 25, { actor: admin })
    let r = await ent.get("org-1")
    expect(r.features.sort()).toEqual(["audit", "sso"])
    expect(r.limits.seats).toBe(25)
    expect(r.overrides).toHaveLength(3)

    // The newest override per key wins; null is unlimited.
    await ent.setLimit("org-1", "seats", null, { actor: admin })
    expect(await ent.limit("org-1", "seats")).toBe(Number.POSITIVE_INFINITY)

    advance(61_000)
    r = await ent.get("org-1")
    expect(r.features).toEqual(["sso"]) // the grant expired; the revoke did not
    const revoke = r.overrides.find((o) => o.key === "export") as { id: string }
    expect(await ent.removeOverride("org-1", revoke.id, { actor: admin })).toBe(true)
    expect(await ent.can("org-1", "export")).toBe(true)

    // Another subject is untouched; unknown keys throw at runtime too.
    expect(await ent.can("org-2", "audit")).toBe(false)
    await expect(ent.can("org-1", "nope" as never)).rejects.toThrow(/Unknown feature/)

    const log = await (db.orm as any).select().from(S.audit)
    const tables = new Set(log.map((e: any) => e.tableName))
    expect(tables).toEqual(new Set(["subject_plans", "entitlement_overrides"]))
    expect(log.every((e: any) => e.actorId === "admin-1")).toBe(true)
  })

  test("billing: applies, is idempotent, and an older event never downgrades a newer state", async () => {
    const { ent, db, S } = await make()
    // First event names the subject; later ones find it by subscription id.
    expect(
      await ent.applyBillingEvent(
        sub("e1", "subscription.activated", "2026-11-01T10:00:00Z", "plan_pro"),
        {
          subject: "org-1",
        },
      ),
    ).toEqual({ applied: true, subject: "org-1", plan: "pro", status: "active" })
    expect(await ent.get("org-1")).toMatchObject({ plan: "pro", status: "active" })

    const upgrade = sub("e3", "subscription.updated", "2026-11-03T10:00:00Z", "plan_team")
    expect((await ent.applyBillingEvent(upgrade)).applied).toBe(true)
    expect((await ent.get("org-1")).plan).toBe("team")

    // The same delivery again replays the stored result and changes nothing.
    const auditBefore = (await (db.orm as any).select().from(S.audit)).length
    expect(await ent.applyBillingEvent(upgrade)).toEqual({
      applied: true,
      subject: "org-1",
      plan: "team",
      status: "active",
    })
    expect((await (db.orm as any).select().from(S.audit)).length).toBe(auditBefore)

    // Delivered late: older than the stored state, so ignored.
    expect(
      await ent.applyBillingEvent(sub("e2", "subscription.cancelled", "2026-11-02T10:00:00Z")),
    ).toMatchObject({ applied: false, reason: "stale" })
    expect(await ent.get("org-1")).toMatchObject({ plan: "team", status: "active" })

    // Unknown subscription or gateway plan: not applied, and not cached, so a retry can apply.
    expect(
      await ent.applyBillingEvent(
        sub("e9", "subscription.activated", "2026-11-04T00:00:00Z", "plan_pro", "sub_x"),
      ),
    ).toEqual({ applied: false, reason: "no_subject" })
    expect(
      await ent.applyBillingEvent(
        sub("e9", "subscription.activated", "2026-11-04T00:00:00Z", "plan_pro", "sub_x"),
        {
          subject: "org-9",
        },
      ),
    ).toMatchObject({ applied: true, plan: "pro" })
    expect(
      await ent.applyBillingEvent(
        sub("e10", "subscription.updated", "2026-11-05T00:00:00Z", "plan_gold"),
      ),
    ).toMatchObject({ applied: false, reason: "unknown_plan" })
    expect(
      await ent.applyBillingEvent({ ...sub("p1", "payment.captured", "2026-11-05T00:00:00Z") }),
    ).toEqual({ applied: false, reason: "not_subscription" })

    const log = await (db.orm as any)
      .select()
      .from(S.audit)
      .where(eq(S.audit.actorId, "billing:razorpay"))
    expect(log.length).toBeGreaterThan(0)
  })

  test("billing: past_due keeps the plan through the grace period; cancelled drops to default", async () => {
    const { ent } = await make()
    clock = new Date("2026-11-10T00:00:00Z")
    await ent.applyBillingEvent(
      sub("a", "subscription.charged", "2026-11-01T00:00:00Z", "plan_pro"),
      {
        subject: "org-1",
      },
    )
    await ent.applyBillingEvent(sub("b", "subscription.past_due", "2026-11-09T12:00:00Z"))
    expect(await ent.get("org-1")).toMatchObject({ plan: "pro", status: "past_due" })
    advance(86_400_000) // past graceUntil (one day after the event)
    expect(await ent.get("org-1")).toMatchObject({
      plan: "free",
      storedPlan: "pro",
      status: "past_due",
    })
    await ent.applyBillingEvent(sub("c", "subscription.charged", "2026-11-11T00:00:00Z"))
    expect(await ent.get("org-1")).toMatchObject({
      plan: "pro",
      status: "active",
      graceUntil: null,
    })
    await ent.applyBillingEvent(sub("d", "subscription.cancelled", "2026-11-12T00:00:00Z"))
    expect(await ent.get("org-1")).toMatchObject({ plan: "free", status: "cancelled" })
  })

  test("billing: created/updated take the gateway's status (Stripe, Paddle)", async () => {
    const { ent } = await make()
    const stripe = (id: string, type: string, at: string, status: string): BillingEvent => ({
      id,
      gateway: "stripe",
      type,
      occurredAt: new Date(at),
      subscriptionId: "sub_S",
      raw: { data: { object: { status, items: { data: [{ price: { id: "plan_pro" } }] } } } },
    })
    await ent.applyBillingEvent(
      stripe("s1", "subscription.created", "2026-11-01T00:00:00Z", "active"),
      {
        subject: "org-s",
      },
    )
    expect(await ent.get("org-s")).toMatchObject({ plan: "pro", status: "active" })
    await ent.applyBillingEvent(
      stripe("s2", "subscription.updated", "2026-11-02T00:00:00Z", "past_due"),
    )
    expect(await ent.get("org-s")).toMatchObject({ plan: "pro", status: "past_due" })
    const grace = (await ent.get("org-s")).graceUntil
    // A second past_due update in the same lapse does not restart the grace clock.
    await ent.applyBillingEvent(
      stripe("s3", "subscription.updated", "2026-11-02T12:00:00Z", "past_due"),
    )
    expect((await ent.get("org-s")).graceUntil).toEqual(grace)
    await ent.applyBillingEvent(
      stripe("s4", "subscription.updated", "2026-11-03T00:00:00Z", "active"),
    )
    expect(await ent.get("org-s")).toMatchObject({ status: "active", graceUntil: null })

    // Paddle: data.status. No plan id in this payload, so the stored plan is kept.
    await ent.setPlan("org-p", "pro", { actor: admin })
    await ent.applyBillingEvent(
      {
        id: "p1",
        gateway: "paddle",
        type: "subscription.updated",
        occurredAt: new Date("2026-11-02T00:00:00Z"),
        subscriptionId: "sub_P",
        raw: { data: { status: "trialing" } },
      },
      { subject: "org-p" },
    )
    expect(await ent.get("org-p")).toMatchObject({ plan: "pro", status: "trialing" })
  })

  test("billing: each subscription is its own source; an old one lapsing cannot downgrade a newer one", async () => {
    const { ent } = await make()
    await ent.applyBillingEvent(
      sub("a1", "subscription.activated", "2026-11-01T00:00:00Z", "plan_pro", "sub_A"),
      {
        subject: "org-1",
      },
    )
    // Upgrade by cancel-and-recreate: B activates, then A's cancellation arrives later.
    expect(
      await ent.applyBillingEvent(
        sub("b1", "subscription.activated", "2026-11-02T00:00:00Z", "plan_team", "sub_B"),
        {
          subject: "org-1",
        },
      ),
    ).toMatchObject({ applied: true, plan: "team" })
    for (const type of [
      "subscription.cancelled",
      "subscription.expired",
      "subscription.past_due",
      "subscription.paused",
    ]) {
      expect(
        await ent.applyBillingEvent(
          sub(`a-${type}`, type, "2026-11-03T00:00:00Z", undefined, "sub_A"),
          {
            subject: "org-1",
          },
        ),
      ).toMatchObject({ applied: true, subject: "org-1", plan: "pro" })
      // A lapsed on its own row; B is still active, so team stays.
      expect(await ent.get("org-1")).toMatchObject({
        plan: "team",
        status: "active",
        source: { gateway: "razorpay", subscriptionId: "sub_B" },
      })
    }
    // B's own cancellation still applies.
    expect(
      (
        await ent.applyBillingEvent(
          sub("b2", "subscription.cancelled", "2026-11-04T00:00:00Z", undefined, "sub_B"),
        )
      ).applied,
    ).toBe(true)
    expect((await ent.get("org-1")).plan).toBe("free")
  })

  const DAY = 86_400_000
  const apple = (
    id: string,
    type: string,
    at: string,
    o: { status: number; expires?: string; grace?: string; product?: string; tx?: string },
  ): BillingEvent => {
    const product = o.product ?? "com.example.pro.monthly"
    return {
      id,
      gateway: "appstore",
      type,
      occurredAt: new Date(at),
      subscriptionId: o.tx ?? "2000000001",
      productId: product,
      raw: {
        payload: { notificationType: "X", data: { status: o.status } },
        transaction: {
          productId: product,
          ...(o.expires ? { expiresDate: Date.parse(o.expires) } : {}),
        },
        renewalInfo: o.grace ? { gracePeriodExpiresDate: Date.parse(o.grace) } : {},
      },
    }
  }
  const google = (
    id: string,
    type: string,
    at: string,
    o: { state: string; expiry?: string; token?: string; linked?: string; product?: string },
  ): BillingEvent => {
    const product = o.product ?? "pro_monthly"
    return {
      id,
      gateway: "googleplay",
      type,
      occurredAt: new Date(at),
      subscriptionId: o.token ?? "tok-1",
      productId: product,
      raw: {
        notification: {},
        subscription: {
          subscriptionState: `SUBSCRIPTION_STATE_${o.state}`,
          lineItems: [{ productId: product, ...(o.expiry ? { expiryTime: o.expiry } : {}) }],
          ...(o.linked ? { linkedPurchaseToken: o.linked } : {}),
        },
      },
    }
  }

  test("stores: App Store, Google Play and web sources roll up into one entitlement per plan", async () => {
    const { ent } = await make()
    await ent.applyBillingEvent(
      apple("a1", "subscription.created", "2026-11-01T00:00:00Z", {
        status: 1,
        expires: "2026-12-01T00:00:00Z",
      }),
      { subject: "u1" },
    )
    await ent.applyBillingEvent(
      google("g1", "subscription.created", "2026-11-01T00:00:00Z", {
        state: "ACTIVE",
        expiry: "2026-12-15T00:00:00Z",
      }),
      { subject: "u1" },
    )
    await ent.applyBillingEvent(
      {
        ...sub("w1", "subscription.activated", "2026-11-01T00:00:00Z", "plan_pro", "sub_W"),
        raw: {
          payload: {
            subscription: {
              entity: {
                plan_id: "plan_pro",
                current_end: Date.parse("2026-11-20T00:00:00Z") / 1000,
              },
            },
          },
        },
      },
      { subject: "u1" },
    )
    const r = await ent.get("u1")
    expect(r.plan).toBe("pro")
    expect(r.currentPeriodEnd).toEqual(new Date("2026-12-15T00:00:00Z")) // latest of the three
    expect(r.entitlements).toHaveLength(1)
    const [e] = r.entitlements
    expect(e?.active).toBe(true)
    expect(e?.sources.map((x) => x.gateway).sort()).toEqual(["appstore", "googleplay", "razorpay"])
    expect(e?.sources.find((x) => x.gateway === "razorpay")?.currentPeriodEnd).toEqual(
      new Date("2026-11-20T00:00:00Z"),
    )

    // Same product id in two stores: the gateway-prefixed key decides.
    await ent.applyBillingEvent(
      apple("a2", "subscription.created", "2026-11-01T00:00:00Z", {
        status: 1,
        product: "shared_id",
        tx: "2000000009",
        expires: "2026-12-01T00:00:00Z",
      }),
      { subject: "u2" },
    )
    await ent.applyBillingEvent(
      google("g2", "subscription.created", "2026-11-01T00:00:00Z", {
        state: "ACTIVE",
        product: "shared_id",
        token: "tok-9",
        expiry: "2026-12-01T00:00:00Z",
      }),
      { subject: "u3" },
    )
    expect((await ent.get("u2")).plan).toBe("team")
    expect((await ent.get("u3")).plan).toBe("pro")
  })

  test("stores: two sources overlap, one expires, the other keeps the plan", async () => {
    const { ent } = await make()
    await ent.applyBillingEvent(
      apple("a1", "subscription.created", "2026-11-01T00:00:00Z", {
        status: 1,
        expires: "2026-12-01T00:00:00Z",
      }),
      { subject: "u1" },
    )
    await ent.applyBillingEvent(
      google("g1", "subscription.created", "2026-11-02T00:00:00Z", {
        state: "ACTIVE",
        expiry: "2026-12-02T00:00:00Z",
      }),
      { subject: "u1" },
    )
    expect((await ent.get("u1")).currentPeriodEnd).toEqual(new Date("2026-12-02T00:00:00Z"))
    // Google expires; Apple still covers the plan, so its period end is the entitlement's.
    expect(
      await ent.applyBillingEvent(
        google("g2", "subscription.expired", "2026-11-05T00:00:00Z", {
          state: "EXPIRED",
          expiry: "2026-11-05T00:00:00Z",
        }),
      ),
    ).toMatchObject({ applied: true, subject: "u1", status: "expired" })
    let r = await ent.get("u1")
    expect(r).toMatchObject({
      plan: "pro",
      status: "active",
      currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
      source: { gateway: "appstore", subscriptionId: "2000000001" },
    })
    expect(r.entitlements[0]?.sources.find((x) => x.gateway === "googleplay")?.active).toBe(false)
    // Apple renews: the period moves on.
    await ent.applyBillingEvent(
      apple("a2", "subscription.charged", "2026-11-30T00:00:00Z", {
        status: 1,
        expires: "2027-01-01T00:00:00Z",
      }),
    )
    expect((await ent.get("u1")).currentPeriodEnd).toEqual(new Date("2027-01-01T00:00:00Z"))
    // Apple expires too: back to the default plan.
    await ent.applyBillingEvent(
      apple("a3", "subscription.expired", "2027-01-01T00:00:00Z", {
        status: 2,
        expires: "2027-01-01T00:00:00Z",
      }),
    )
    r = await ent.get("u1")
    expect(r).toMatchObject({ plan: "free", currentPeriodEnd: null, source: null })
    expect(r.entitlements[0]).toMatchObject({ plan: "pro", active: false })
  })

  test("stores: App Store grace period, billing retry, auto-renew off, refund", async () => {
    const { ent } = await make()
    const exp = "2026-11-10T00:00:00Z"
    await ent.applyBillingEvent(
      apple("a1", "subscription.created", "2026-11-01T00:00:00Z", { status: 1, expires: exp }),
      { subject: "u1" },
    )
    // DID_FAIL_TO_RENEW with Billing Grace Period: access until gracePeriodExpiresDate.
    await ent.applyBillingEvent(
      apple("a2", "subscription.past_due", "2026-11-10T00:00:00Z", {
        status: 4,
        expires: exp,
        grace: "2026-11-16T00:00:00Z",
      }),
    )
    clock = new Date("2026-11-15T00:00:00Z")
    expect(await ent.get("u1")).toMatchObject({
      plan: "pro",
      status: "past_due",
      graceUntil: new Date("2026-11-16T00:00:00Z"),
    })
    // Grace over, now in billing retry: no access.
    await ent.applyBillingEvent(
      apple("a3", "subscription.past_due", "2026-11-16T00:00:00Z", { status: 3, expires: exp }),
    )
    expect(await ent.get("u1")).toMatchObject({
      plan: "free",
      status: "past_due",
      graceUntil: null,
    })
    // Recovered (DID_RENEW).
    await ent.applyBillingEvent(
      apple("a4", "subscription.charged", "2026-11-17T00:00:00Z", {
        status: 1,
        expires: "2026-12-17T00:00:00Z",
      }),
    )
    expect((await ent.get("u1")).plan).toBe("pro")
    // Auto-renew off is still status 1: access runs to expiresDate.
    await ent.applyBillingEvent(
      apple("a5", "subscription.cancelled", "2026-11-18T00:00:00Z", {
        status: 1,
        expires: "2026-12-17T00:00:00Z",
      }),
    )
    expect(await ent.get("u1")).toMatchObject({ plan: "pro", status: "active" })
    // A refund (REFUND, status 5) ends it now.
    expect(
      await ent.applyBillingEvent(
        apple("a6", "refund.processed", "2026-11-19T00:00:00Z", {
          status: 5,
          expires: "2026-12-17T00:00:00Z",
        }),
      ),
    ).toMatchObject({ applied: true, status: "expired" })
    expect((await ent.get("u1")).plan).toBe("free")
    // A web refund event is not a subscription change.
    expect(
      (await ent.applyBillingEvent(sub("r1", "refund.processed", "2026-11-19T00:00:00Z"))).reason,
    ).toBe("not_subscription")
  })

  test("stores: Google Play grace period, account hold, cancel, revoke, linked token", async () => {
    const { ent } = await make()
    await ent.applyBillingEvent(
      google("g1", "subscription.created", "2026-11-01T00:00:00Z", {
        state: "ACTIVE",
        expiry: "2026-11-10T00:00:00Z",
      }),
      { subject: "u1" },
    )
    await ent.applyBillingEvent(
      google("g2", "subscription.past_due", "2026-11-10T00:00:00Z", {
        state: "IN_GRACE_PERIOD",
        expiry: "2026-11-13T00:00:00Z",
      }),
    )
    clock = new Date("2026-11-12T00:00:00Z")
    expect(await ent.get("u1")).toMatchObject({ plan: "pro", status: "past_due" })
    await ent.applyBillingEvent(
      google("g3", "subscription.past_due", "2026-11-13T00:00:00Z", {
        state: "ON_HOLD",
        expiry: "2026-11-13T00:00:00Z",
      }),
    )
    expect((await ent.get("u1")).plan).toBe("free")
    await ent.applyBillingEvent(
      google("g4", "subscription.charged", "2026-11-14T00:00:00Z", {
        state: "ACTIVE",
        expiry: "2026-12-14T00:00:00Z",
      }),
    )
    // Cancelled keeps access until expiryTime.
    await ent.applyBillingEvent(
      google("g5", "subscription.cancelled", "2026-11-15T00:00:00Z", {
        state: "CANCELED",
        expiry: "2026-12-14T00:00:00Z",
      }),
    )
    expect(await ent.get("u1")).toMatchObject({
      plan: "pro",
      currentPeriodEnd: new Date("2026-12-14T00:00:00Z"),
    })
    // Resubscribe on a new token linked to the old one: same subject, no claim needed.
    expect(
      await ent.applyBillingEvent(
        google("g6", "subscription.created", "2026-11-16T00:00:00Z", {
          state: "ACTIVE",
          token: "tok-2",
          linked: "tok-1",
          expiry: "2027-11-16T00:00:00Z",
        }),
      ),
    ).toMatchObject({ applied: true, subject: "u1" })
    // The old token is revoked; the new one keeps the plan.
    await ent.applyBillingEvent(
      google("g7", "subscription.expired", "2026-11-16T00:00:01Z", {
        state: "EXPIRED",
        expiry: "2026-11-16T00:00:01Z",
      }),
    )
    expect(await ent.get("u1")).toMatchObject({
      plan: "pro",
      currentPeriodEnd: new Date("2027-11-16T00:00:00Z"),
      source: { gateway: "googleplay", subscriptionId: "tok-2" },
    })
  })

  test("stores: an active source whose period ended with no event lapses after graceMs", async () => {
    const { ent } = await make()
    await ent.applyBillingEvent(
      apple("a1", "subscription.created", "2026-11-01T00:00:00Z", {
        status: 1,
        expires: "2026-11-05T00:00:00Z",
      }),
      { subject: "u1" },
    )
    clock = new Date("2026-11-05T12:00:00Z")
    expect((await ent.get("u1")).plan).toBe("pro") // a renewal event may be late
    advance(DAY)
    expect((await ent.get("u1")).plan).toBe("free")
  })

  test("restore: applySubscription re-attaches; another subject's subscription is refused", async () => {
    const { ent } = await make()
    const live = {
      gateway: "appstore",
      gatewayId: "2000000001",
      status: "active" as const,
      productId: "com.example.pro.monthly",
      currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
      raw: {
        transaction: {
          productId: "com.example.pro.monthly",
          expiresDate: Date.parse("2026-12-01T00:00:00Z"),
        },
        renewalInfo: {},
        status: 1,
      },
    }
    expect(await ent.applySubscription(live, { subject: "u1" })).toMatchObject({
      applied: true,
      plan: "pro",
      status: "active",
    })
    expect(await ent.get("u1")).toMatchObject({
      plan: "pro",
      currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
    })
    // Restoring again (same user) is fine; another user is refused, by event too.
    advance(1000)
    expect((await ent.applySubscription(live, { subject: "u1" })).applied).toBe(true)
    expect(await ent.applySubscription(live, { subject: "u2" })).toEqual({
      applied: false,
      subject: "u2",
      reason: "other_subject",
    })
    expect(
      await ent.applyBillingEvent(
        apple("a9", "subscription.charged", "2026-11-30T00:00:00Z", {
          status: 1,
          expires: "2027-01-01T00:00:00Z",
        }),
        { subject: "u2" },
      ),
    ).toMatchObject({ applied: false, reason: "other_subject" })
    expect((await ent.get("u2")).plan).toBe("free")

    // A web subscription read live: status and currentPeriodEnd; cancelled keeps access until then.
    expect(
      await ent.applySubscription(
        {
          gateway: "stripe",
          gatewayId: "sub_S",
          status: "cancelled",
          productId: "plan_team",
          currentPeriodEnd: new Date("2026-11-20T00:00:00Z"),
        },
        { subject: "u3" },
      ),
    ).toMatchObject({ applied: true, plan: "team", status: "cancelled" })
    expect((await ent.get("u3")).plan).toBe("team")
    clock = new Date("2026-11-21T00:00:00Z")
    expect((await ent.get("u3")).plan).toBe("free")
  })

  test("plans: the last declared active plan wins; setPlan is one more source", async () => {
    const { ent } = await make()
    await ent.applyBillingEvent(
      apple("a1", "subscription.created", "2026-11-01T00:00:00Z", {
        status: 1,
        expires: "2026-12-01T00:00:00Z",
      }),
      { subject: "u1" },
    )
    await ent.setPlan("u1", "team", { actor: admin })
    expect(await ent.get("u1")).toMatchObject({
      plan: "team",
      source: { gateway: "manual", subscriptionId: "u1" },
      currentPeriodEnd: null,
    })
    expect((await ent.get("u1")).entitlements.map((e) => e.plan)).toEqual(["pro", "team"])
    // Moving the manual source down does not cut the paid store plan.
    await ent.setPlan("u1", "free", { actor: admin })
    expect((await ent.get("u1")).plan).toBe("pro")
  })

  test("consume: concurrent requests never exceed the limit; resets each period", async () => {
    const { ent } = await make()
    const results = await Promise.all(
      Array.from({ length: 20 }, () => ent.consume("org-1", "aiCredits", 1)),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(5)
    const [u] = await ent.usage("org-1", "aiCredits")
    expect(u).toMatchObject({ used: 5, limit: 5, remaining: 0, period: "2026-11" })

    const big = await ent.consume("org-2", "aiCredits", 6)
    expect(big).toMatchObject({ ok: false, used: 0, remaining: 5 })
    expect(await ent.consume("org-2", "aiCredits", 5)).toMatchObject({ ok: true, remaining: 0 })
    await expect(ent.consume("org-2", "aiCredits", 0)).rejects.toThrow(/positive integer/)

    clock = new Date("2026-12-01T00:00:00Z")
    expect(await ent.consume("org-1", "aiCredits", 2)).toMatchObject({
      ok: true,
      used: 2,
      period: "2026-12",
    })

    // An unlimited limit always succeeds; "total" never resets.
    await ent.setPlan("org-3", "team", { actor: admin })
    expect((await ent.consume("org-3", "seats", 1000)).ok).toBe(true)
    expect((await ent.usage("org-3", "seats"))[0]).toMatchObject({ period: "all", used: 1000 })
  })

  test("flags: stored overrides (subject > everyone), expiry, plan targeting from entitlements", async () => {
    const { flags, ent, db, S } = await make()
    const id = Array.from({ length: 400 }, (_, i) => `u${i}`).find(
      (x) => bucket("newEditor", x) >= 2500,
    ) as string
    expect(await flags.get("newEditor", { id })).toEqual({ value: false, reason: "default" })

    await ent.setPlan(id, "pro", { actor: admin })
    expect(await flags.get("theme", { id })).toEqual({ value: "dark", reason: "rule", rule: 0 })

    await flags.set("newEditor", true, { subject: "*", actor: admin })
    expect(await flags.get("newEditor", { id })).toEqual({ value: true, reason: "override" })
    await flags.set("newEditor", false, {
      subject: id,
      actor: admin,
      expiresAt: new Date(clock.getTime() + 1000),
    })
    expect((await flags.get("newEditor", { id })).value).toBe(false)
    advance(2000)
    expect((await flags.get("newEditor", { id })).value).toBe(true) // back to the everyone override
    expect(await flags.clear("newEditor", { subject: "*", actor: admin })).toBe(true)

    const all = await flags.all({ id, attributes: { country: "IN" } })
    expect(all.newEditor).toEqual({ value: true, reason: "rule", rule: 0 })
    expect(all.theme.value).toBe("dark")
    await expect(flags.set("theme", 3 as never, { subject: id, actor: admin })).rejects.toThrow()

    const log = await (db.orm as any)
      .select()
      .from(S.audit)
      .where(eq(S.audit.tableName, "flag_overrides"))
    expect(log).toHaveLength(3)
  })

  test("agent tools: reads per subject; writes need approval and record the actor", async () => {
    const { ent, flags, db, S } = await make()
    await ent.setPlan("org-1", "pro", { actor: admin })
    const reader = entitlementTools({ entitlements: ent, flags, subject: "org-1" })
    expect(reader.map((t) => t.name)).toEqual([
      "get_plan",
      "check_entitlement",
      "usage",
      "list_flags",
    ])
    const tool = (list: typeof reader, name: string) =>
      list.find((t) => t.name === name) as (typeof reader)[0]

    expect(await tool(reader, "get_plan").run({})).toMatchObject({
      plan: "pro",
      limits: { seats: 10 },
    })
    expect(await tool(reader, "check_entitlement").run({ feature: "sso" })).toEqual({
      feature: "sso",
      allowed: true,
    })
    await expect(tool(reader, "check_entitlement").run({ feature: "x" })).rejects.toThrow(
      /Unknown feature/,
    )
    expect(await tool(reader, "usage").run({ key: "aiCredits" })).toMatchObject({
      usage: [{ key: "aiCredits", used: 0, limit: 100 }],
    })
    expect(((await tool(reader, "list_flags").run({})) as any).flags).toHaveLength(2)

    const agent = { type: "agent" as const, id: "support-bot" }
    const unapproved = entitlementTools({
      entitlements: ent,
      flags,
      subject: "org-1",
      allowWrites: true,
      actor: agent,
    })
    const gate = (await tool(unapproved, "set_plan").run({ plan: "team", reason: "comp" })) as any
    expect(gate.structuredContent.code).toBe("APPROVAL_REQUIRED")
    expect(gate.structuredContent.approval.summary).toBe("Move org-1 from pro to team")
    expect((await ent.get("org-1")).plan).toBe("pro")

    const asked: unknown[] = []
    const approved = entitlementTools({
      entitlements: ent,
      flags,
      allSubjects: true,
      allowWrites: true,
      actor: agent,
      approve: (_ctx, r) => {
        asked.push(r.summary)
      },
    })
    await tool(approved, "set_plan").run({ subject: "org-1", plan: "team", reason: "comp" })
    await tool(approved, "grant_feature").run({ subject: "org-2", feature: "sso", reason: "trial" })
    await tool(approved, "set_flag").run({
      everyone: true,
      flag: "theme",
      value: "dark",
      reason: "launch",
    })
    await expect(
      tool(approved, "set_flag").run({ subject: "org-2", flag: "theme", value: true, reason: "x" }),
    ).rejects.toThrow(/takes a string/)
    expect(asked).toEqual([
      "Move org-1 from pro to team",
      "Grant sso for org-2",
      'Set flag theme to "dark" for everyone',
    ])
    expect((await ent.get("org-1")).plan).toBe("team")
    expect(await ent.can("org-2", "sso")).toBe(true)
    expect((await flags.get("theme", { id: "org-9" })).value).toBe("dark")

    const log = await (db.orm as any)
      .select()
      .from(S.audit)
      .where(eq(S.audit.actorId, "support-bot"))
    expect(log.length).toBe(3)
    expect(log.every((e: any) => e.actorType === "agent")).toBe(true)
  })
})
