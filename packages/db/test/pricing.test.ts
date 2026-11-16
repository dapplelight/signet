import { afterEach, describe, expect, test } from "bun:test"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { createExperiments } from "../src/experiments"
import { createOfferings } from "../src/offerings"
import { createPricing, type PricingEvent, pricingReadout } from "../src/pricing"
import { backends, ddl, type Instance } from "./harness"

const actor = { type: "user" as const, id: "admin-1" }
const plans = { free: {}, pro: {} }
const monthly = [
  { id: "pro.monthly", store: "web", plan: "pro", interval: "month" as const },
] as never[]
const annual = [
  { id: "pro.annual", store: "web", plan: "pro", interval: "year" as const },
] as never[]
const variants = [
  { key: "control", weight: 50 },
  { key: "annual", weight: 50, value: { offering: "annual-first" } },
]

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
}

describe("pricingReadout (pure)", () => {
  const V = [
    { key: "control", weight: 1 },
    { key: "annual", weight: 1, value: { offering: "annual-first", version: 2 } },
  ]
  const day = 86_400_000
  test("conversion, trial conversion, revenue per exposed user and an LTV estimate", () => {
    const exposures = [
      { subject: "a", variant: "control", exposedAt: 1000 },
      { subject: "b", variant: "control", exposedAt: 1000 },
      { subject: "c", variant: "annual", exposedAt: 1000 },
      { subject: "d", variant: "annual", exposedAt: 1000 },
      { subject: "e", variant: "annual", exposedAt: 1000 },
      { subject: "f", variant: "annual", exposedAt: 1000 },
      { subject: "x", variant: "gone", exposedAt: 1000 }, // not a variant: ignored
    ]
    const ev = (
      subject: string,
      kind: string,
      at: number,
      amount: number | null = null,
      sub = `s-${subject}`,
    ): PricingEvent => ({
      subject,
      kind,
      amount,
      currency: amount == null ? null : "INR",
      occurredAt: new Date(at),
      subscriptionId: sub,
    })
    const events = [
      // control: a buys monthly 100 twice, then expires; a purchase before exposure does not count.
      ev("a", "purchase", 500, 999),
      ev("a", "purchase", 2000, 100),
      ev("a", "renewal", 2000 + 30 * day, 100),
      ev("a", "expiration", 2000 + 60 * day),
      // annual: c trials then pays 1000; d trials and never pays; e buys 1000, refunded 1000.
      ev("c", "trial", 2000, 0),
      ev("c", "purchase", 2000 + 7 * day, 1000),
      ev("d", "trial", 2000, 0),
      ev("e", "purchase", 3000, 1000),
      ev("e", "refund", 4000, 1000),
      ev("f", "renewal", 3000, 1000),
    ]
    const r = pricingReadout(V, exposures, events)
    const [c, a] = r.variants
    expect(r.control).toBe("control")
    expect(c).toMatchObject({
      offering: null,
      exposed: 2,
      converted: 1,
      rate: 0.5,
      trials: 0,
      trialConversion: null,
      revenue: { INR: 200 },
      revenuePerExposed: { INR: 100 },
      lift: null,
      pValue: null,
    })
    // 2 charges, 1 ended: churn 0.5, 2 expected payments of 100 on average.
    expect(c?.ltv).toEqual({
      estimate: true,
      perCurrency: { INR: 200 },
      churn: 0.5,
      expectedPayments: 2,
    })
    expect(a).toMatchObject({
      offering: { offering: "annual-first", version: 2 },
      exposed: 4,
      converted: 3, // c, d (trials) and e; f only renewed
      rate: 0.75,
      trials: 2,
      trialConverted: 1,
      trialConversion: 0.5,
      revenue: { INR: 2000 }, // 1000 + 1000 + 1000 − 1000
      revenuePerExposed: { INR: 500 },
    })
    expect(a?.lift).toBeCloseTo(0.5, 10)
    // 3 charges, 1 ended (the refund): churn 1/3, 3 payments of 1000.
    expect(a?.ltv?.expectedPayments).toBeCloseTo(3, 10)
    expect(a?.ltv?.perCurrency.INR).toBeCloseTo(3000, 6)
    expect(a?.pValue).not.toBeNull()
  })

  test("no churn caps the estimate; no charges gives none; nobody exposed is all zero", () => {
    const r = pricingReadout(
      V,
      [{ subject: "a", variant: "annual", exposedAt: 0 }],
      [{ subject: "a", kind: "purchase", amount: 500, currency: "USD", occurredAt: 1 }],
      { maxPayments: 12 },
    )
    expect(r.variants[1]?.ltv).toEqual({
      estimate: true,
      perCurrency: { USD: 6000 },
      churn: 0,
      expectedPayments: 12,
    })
    expect(r.variants[0]).toMatchObject({ exposed: 0, rate: 0, ltv: null, revenuePerExposed: {} })
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
    const xt = (pg ? pgc.experimentTables() : sqc.experimentTables()) as ReturnType<
      typeof sqc.experimentTables
    >
    const mon = (pg ? pgc.monetisationTables() : sqc.monetisationTables()) as ReturnType<
      typeof sqc.monetisationTables
    >
    for (const t of [...Object.values(xt), ...Object.values(mon)]) await i.exec(ddl(t))
    let clock = 1_000_000
    const experiments = createExperiments(i.db, { tables: xt, now: () => new Date(clock) })
    const offerings = createOfferings(i.db, { tables: mon, plans, experiments })
    const pricing = createPricing(i.db, {
      tables: { ...xt, ...mon },
      offerings,
      experiments,
    })
    await offerings.publish("default", { products: monthly }, { actor })
    await offerings.publish("annual-first", { products: annual }, { actor })
    await experiments.create("price-test", { variants, goal: "subscribed" }, { actor })
    let n = 0
    const event = (subject: string, kind: string, at: number, amount?: number) =>
      (i.db.orm as any).insert(mon.customerEvents).values({
        id: `e${n++}`,
        subject,
        kind,
        gateway: "stripe",
        eventType: kind,
        subscriptionId: `sub-${subject}`,
        amount: amount ?? null,
        currency: amount == null ? null : "INR",
        approximate: false,
        occurredAt: new Date(at),
      })
    return {
      i,
      mon,
      xt,
      experiments,
      offerings,
      pricing,
      event,
      at: () => clock,
      tick: (d: number) => (clock += d),
    }
  }

  test("a placement links only a valid experiment", async () => {
    const { i, mon, experiments, offerings } = await make()
    const plain = createOfferings(i.db, { tables: mon, plans })
    expect(
      await code(
        plain.setPlacement(
          "onboarding",
          { offering: "default", experiment: "price-test" },
          { actor },
        ),
      ),
    ).toBe("BAD_CONFIG")
    expect(
      await code(
        offerings.setPlacement(
          "onboarding",
          { offering: "default", experiment: "nope" },
          { actor },
        ),
      ),
    ).toBe("BAD_VALUE")
    await experiments.create(
      "bad-values",
      {
        variants: [
          { key: "a", weight: 1 },
          { key: "b", weight: 1, value: { steps: 3 } },
        ],
        goal: "x",
      },
      { actor },
    )
    expect(
      await code(
        offerings.setPlacement(
          "onboarding",
          { offering: "default", experiment: "bad-values" },
          { actor },
        ),
      ),
    ).toBe("BAD_VALUE")
    await experiments.create(
      "unpublished",
      {
        variants: [
          { key: "a", weight: 1 },
          { key: "b", weight: 1, value: { offering: "missing" } },
        ],
        goal: "x",
      },
      { actor },
    )
    expect(
      await code(
        offerings.setPlacement(
          "onboarding",
          { offering: "default", experiment: "unpublished" },
          { actor },
        ),
      ),
    ).toBe("BAD_VALUE")
    const p = await offerings.setPlacement(
      "onboarding",
      { offering: "default", experiment: "price-test" },
      { actor },
    )
    expect(p.experiment).toBe("price-test")
    // A full replace with no experiment unlinks it.
    expect(
      (await offerings.setPlacement("onboarding", { offering: "default" }, { actor })).experiment,
    ).toBeNull()
  })

  test("current assigns sticky through the placement and records the exposure once", async () => {
    const { i, xt, experiments, offerings } = await make()
    await offerings.setPlacement(
      "onboarding",
      {
        offering: "default",
        experiment: "price-test",
        overrides: [{ when: { country: ["IN"] }, offering: "default" }],
      },
      { actor },
    )
    // Draft: everyone gets the placement's own, nothing recorded.
    const draft = await offerings.current("onboarding", {}, "u1")
    expect(draft).toMatchObject({
      key: "default",
      experiment: { variant: "control", reason: "not_running" },
    })
    await experiments.start("price-test", { actor })
    const seen: Record<string, string> = {}
    for (let k = 0; k < 40; k++) {
      const id = `u${k}`
      const first = await offerings.current("onboarding", {}, id)
      const again = await offerings.current("onboarding", {}, id)
      expect(again?.key).toBe(first?.key as string)
      expect(again?.experiment?.variant).toBe(first?.experiment?.variant as string)
      expect(first?.key).toBe(first?.experiment?.variant === "annual" ? "annual-first" : "default")
      seen[first?.experiment?.variant as string] = first?.key as string
    }
    expect(Object.keys(seen).sort()).toEqual(["annual", "control"])
    const rows = await (i.db.orm as any).select().from(xt.experimentExposures)
    expect(rows.length).toBe(40)
    // No subject: the placement's own, no assignment; an override still wins.
    expect(await offerings.current("onboarding", {})).toMatchObject({
      key: "default",
      experiment: null,
    })
    expect(await offerings.current("onboarding", { country: "in" }, "u-new")).toMatchObject({
      override: 0,
      experiment: null,
    })
    expect((await (i.db.orm as any).select().from(xt.experimentExposures)).length).toBe(40)
  })

  test("readout attributes purchases after exposure, through merges; rollout serves the winner", async () => {
    const { i, mon, experiments, offerings, pricing, event, at, tick } = await make()
    await offerings.setPlacement(
      "onboarding",
      { offering: "default", experiment: "price-test" },
      { actor },
    )
    await experiments.start("price-test", { actor })
    const by: Record<string, string[]> = { control: [], annual: [] }
    for (let k = 0; k < 30; k++) {
      const id = `anon-${k}`
      const c = await offerings.current("onboarding", {}, id)
      by[c?.experiment?.variant as string]?.push(id)
    }
    const ctl = by.control as string[]
    const ann = by.annual as string[]
    // One annual subject bought anonymously, then merged into an account.
    await (i.db.orm as any)
      .insert(mon.customerIdentities)
      .values({ id: ann[0], subject: "user-merged", createdAt: new Date(at()) })
    await event(ctl[0] as string, "purchase", at() - 1, 999) // before exposure: ignored
    tick(1000)
    await event(ctl[0] as string, "purchase", at(), 100)
    await event("user-merged", "trial", at(), 0)
    await event("user-merged", "purchase", at() + 10, 1000)
    await event(ann[1] as string, "purchase", at(), 1000)

    const r = await pricing.readout("price-test")
    expect(r.placements).toEqual(["onboarding"])
    const [c, a] = r.variants
    expect(c).toMatchObject({ exposed: ctl.length, converted: 1, revenue: { INR: 100 } })
    expect(a).toMatchObject({
      offering: { offering: "annual-first" },
      exposed: ann.length,
      converted: 2,
      trials: 1,
      trialConverted: 1,
      revenue: { INR: 2000 },
    })
    expect(a?.revenuePerExposed.INR).toBeCloseTo(2000 / ann.length, 6)
    expect(a?.ltv?.estimate).toBe(true)

    expect(await code(pricing.rollout("price-test", "nope", { actor }))).toBe("BAD_VALUE")
    const done = await pricing.rollout("price-test", "annual", { actor })
    expect(done.experiment).toMatchObject({ status: "rolled_out", winner: "annual" })
    expect(done.placements[0]).toMatchObject({
      offering: "annual-first",
      version: null,
      experiment: null,
    })
    expect((await offerings.current("onboarding", {}, ctl[0]))?.key).toBe("annual-first")
    // A retry after a partial failure is safe; the readout still reads.
    await (i.db.orm as any)
      .update(mon.placements)
      .set({ offering: "default", experiment: "price-test" })
    expect((await pricing.rollout("price-test", "annual", { actor })).placements[0]).toMatchObject({
      offering: "annual-first",
      experiment: null,
    })
    // Nothing runs it now.
    expect(await code(pricing.rollout("price-test", "annual", { actor }))).toBe("BAD_VALUE")
    expect((await pricing.readout("price-test")).status).toBe("rolled_out")
    expect(await code(pricing.readout("missing"))).toBe("NOT_FOUND")
  })

  test("readout counts a merged account once, in its earliest exposure's variant", async () => {
    const { i, xt, mon, experiments, offerings, pricing, event, at } = await make()
    await offerings.setPlacement(
      "onboarding",
      { offering: "default", experiment: "price-test" },
      { actor },
    )
    await experiments.start("price-test", { actor })
    const t0 = at()
    const orm = i.db.orm as any
    // Anonymous id seen first (annual), then its account seen later (control).
    await orm.insert(xt.experimentExposures).values([
      {
        id: "price-test|anon-x",
        experiment: "price-test",
        subject: "anon-x",
        variant: "annual",
        exposedAt: t0,
      },
      {
        id: "price-test|acct-x",
        experiment: "price-test",
        subject: "acct-x",
        variant: "control",
        exposedAt: t0 + 5,
      },
    ])
    await orm
      .insert(mon.customerIdentities)
      .values({ id: "anon-x", subject: "acct-x", createdAt: new Date(t0) })
    await event("acct-x", "purchase", t0 + 10, 1000)

    const [c, a] = (await pricing.readout("price-test")).variants
    expect(c).toMatchObject({ exposed: 0, converted: 0, revenue: {} })
    expect(a).toMatchObject({ exposed: 1, converted: 1, revenue: { INR: 1000 } })
  })

  test("rolling out the control keeps the placement's own offering", async () => {
    const { experiments, offerings, pricing } = await make()
    await offerings.setPlacement(
      "onboarding",
      { offering: "default", version: 1, experiment: "price-test" },
      { actor },
    )
    await experiments.start("price-test", { actor })
    const done = await pricing.rollout("price-test", "control", { actor })
    expect(done.placements[0]).toMatchObject({ offering: "default", version: 1, experiment: null })
    // A rolled-out experiment cannot be linked again.
    expect(
      await code(
        offerings.setPlacement(
          "onboarding",
          { offering: "default", experiment: "price-test" },
          { actor },
        ),
      ),
    ).toBe("BAD_VALUE")
  })
})
