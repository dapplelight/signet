// Pricing experiments end to end: signet-db's experiments, offerings,
// customers and pricing over SQLite behind signet-server's monetisation
// routes. A placement runs an experiment, the app's GET /offerings/:placement
// assigns sticky and records the exposure, purchases on the customer timeline
// are attributed to the variant in the admin readout, and one rollout makes
// the winner the placement's offering.
import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import * as sqc from "@dapplelight/signet-db/columns/sqlite"
import { createCustomers } from "@dapplelight/signet-db/customers"
import { createEntitlements, definePlans } from "@dapplelight/signet-db/entitlements"
import { createExperiments } from "@dapplelight/signet-db/experiments"
import { createOfferings } from "@dapplelight/signet-db/offerings"
import { createPricing } from "@dapplelight/signet-db/pricing"
import { createDb } from "@dapplelight/signet-db/sqlite"
import {
  monetisationAdminRoutes,
  monetisationRoutes,
} from "@dapplelight/signet-server/http/monetisation"
import { ddl } from "./harness"

const plans = definePlans({ free: { features: [] }, pro: { features: ["sso"] } })
const admin = { type: "user" as const, id: "admin-1" }

test("a placement's pricing experiment: sticky offering, attributed revenue, one-click rollout", async () => {
  let clock = Date.parse("2026-11-01T10:00:00Z")
  const now = () => new Date(clock)
  const sqlite = new Database(":memory:")
  const ent = sqc.entitlementTables()
  const mon = sqc.monetisationTables()
  const xt = sqc.experimentTables()
  const audit = sqc.auditLog()
  for (const t of [...Object.values(ent), ...Object.values(mon), ...Object.values(xt), audit])
    sqlite.run(ddl(t))
  const db = createDb(sqlite, { audit })
  const entitlements = createEntitlements(db, { plans, default: "free", tables: ent })
  const experiments = createExperiments(db, { tables: xt, now })
  const offerings = createOfferings(db, { tables: mon, plans, experiments })
  const customers = createCustomers(db, { tables: { ...ent, ...mon }, entitlements, now })
  const pricing = createPricing(db, { tables: { ...xt, ...mon }, offerings, experiments })

  const billing = monetisationRoutes({
    offerings,
    customers,
    subject: (c) => c.req.header("x-user"),
  })
  const adminApp = monetisationAdminRoutes({
    offerings,
    customers,
    pricing,
    authorize: (c) => c.req.header("x-role") === "admin",
    actor: () => admin,
  })
  // Mounted as /billing and /admin in an app; here each sub-app answers its own paths.
  const call = (path: string, init: { method?: string; body?: unknown; user?: string } = {}) =>
    (path.startsWith("/billing") ? billing : adminApp).request(
      path.replace(/^\/(billing|admin)/, ""),
      {
        method: init.method ?? "GET",
        headers: {
          "content-type": "application/json",
          "x-role": "admin",
          ...(init.user ? { "x-user": init.user } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      },
    )

  const monthly = {
    id: "pro.m",
    store: "web",
    plan: "pro",
    interval: "month",
    price: { amount: 999, currency: "INR" },
  }
  const annual = {
    id: "pro.y",
    store: "web",
    plan: "pro",
    interval: "year",
    price: { amount: 7999, currency: "INR" },
  }
  expect(
    (await call("/admin/offerings/default", { method: "POST", body: { products: [monthly] } }))
      .status,
  ).toBe(201)
  expect(
    (await call("/admin/offerings/annual-first", { method: "POST", body: { products: [annual] } }))
      .status,
  ).toBe(201)
  await experiments.create(
    "price-test",
    {
      variants: [
        { key: "control", weight: 50 },
        { key: "annual", weight: 50, value: { offering: "annual-first" } },
      ],
      goal: "subscribed",
    },
    { actor: admin },
  )
  const link = await call("/admin/placements/onboarding", {
    method: "PUT",
    body: { offering: "default", experiment: "price-test" },
  })
  expect(link.status).toBe(200)
  await experiments.start("price-test", { actor: admin })

  // The app asks for the placement; every subject keeps its offering.
  const served: Record<string, string> = {}
  for (let i = 0; i < 40; i++) {
    const user = `u${i}`
    const a = (await (await call("/billing/offerings/onboarding", { user })).json()).offering
    const b = (await (await call("/billing/offerings/onboarding", { user })).json()).offering
    expect(b.key).toBe(a.key)
    expect(a.experiment.variant).toBe(a.key === "annual-first" ? "annual" : "control")
    served[user] = a.experiment.variant
  }
  const ctl = Object.keys(served).filter((u) => served[u] === "control")
  const ann = Object.keys(served).filter((u) => served[u] === "annual")
  expect(ctl.length).toBeGreaterThan(5)
  expect(ann.length).toBeGreaterThan(5)

  // Purchases arrive as store and gateway events on the customer timeline.
  clock += 60_000
  let n = 0
  const buy = (subject: string, amount: number, type = "payment.captured") =>
    customers.record(
      {
        id: `evt_${n++}`,
        gateway: "stripe",
        type,
        occurredAt: now(),
        subscriptionId: `sub_${subject}`,
        amount,
        currency: "INR",
      },
      { subject },
    )
  for (const u of ctl.slice(0, 2)) await buy(u, 999)
  for (const u of ann.slice(0, 3)) await buy(u, 7999)
  await buy(ann[3] as string, 0) // a free trial
  clock += 7 * 86_400_000
  await buy(ann[3] as string, 7999, "subscription.charged") // ...that converted

  const res = await call("/admin/pricing/price-test")
  expect(res.status).toBe(200)
  const { readout } = await res.json()
  const [c, a] = readout.variants
  expect(readout.placements).toEqual(["onboarding"])
  expect(c).toMatchObject({
    key: "control",
    exposed: ctl.length,
    converted: 2,
    revenue: { INR: 1998 },
  })
  expect(a).toMatchObject({
    key: "annual",
    exposed: ann.length,
    converted: 4,
    trials: 1,
    trialConverted: 1,
    trialConversion: 1,
    revenue: { INR: 4 * 7999 },
  })
  expect(a.revenuePerExposed.INR).toBeCloseTo((4 * 7999) / ann.length, 6)
  expect(a.ltv.estimate).toBe(true)
  expect(typeof a.pValue).toBe("number")

  // Deny by default (with no error handler mounted, the 403 is thrown as an ApiException).
  const denied = await Promise.resolve(
    adminApp.request("/pricing/price-test/rollout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variant: "annual" }),
    }),
  ).then(
    (r) => r.status,
    (e: { status?: number }) => e.status,
  )
  expect(denied).toBe(403)
  expect((await experiments.get("price-test"))?.status).toBe("running")

  // One click: the winner becomes the placement's offering; the experiment stops.
  const out = await call("/admin/pricing/price-test/rollout", {
    method: "POST",
    body: { variant: "annual" },
  })
  expect(out.status).toBe(200)
  const done = await out.json()
  expect(done.experiment.status).toBe("rolled_out")
  expect(done.placements[0]).toMatchObject({ offering: "annual-first", experiment: null })
  for (const user of [ctl[0], ann[0], "someone-new"]) {
    const o = (await (await call("/billing/offerings/onboarding", { user })).json()).offering
    expect(o).toMatchObject({ key: "annual-first", experiment: null })
  }
})
