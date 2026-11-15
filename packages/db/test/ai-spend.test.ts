// AI spend caps on every backend: user, org and global caps per day and
// month, admin rows over defaults, signet-ai's real extractor refused through
// the ledger, onUsage for streams, and signet-server's middleware and admin
// routes over the real store.
import { afterEach, describe, expect, test } from "bun:test"
import { z } from "zod"
import { createExtractor } from "../../ai/src/extract"
import { aiSpendAdminRoutes, requireAiSpend } from "../../server/src/http/ai-spend"
import { errorHandler } from "../../server/src/http/errors"
import {
  createAiSpend,
  parseSpendKey,
  periodEnd,
  type SpendCaps,
  spendKey,
  usdToUnits,
} from "../src/ai-spend"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { backends, ddl, type Instance } from "./harness"

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
}

describe("pure", () => {
  test("usdToUnits rounds up to whole micro-dollars without float noise", () => {
    expect(usdToUnits(0.01)).toBe(10_000)
    expect(usdToUnits(0.07)).toBe(70_000)
    expect(usdToUnits(0.0000001)).toBe(1)
    expect(usdToUnits(0)).toBe(0)
    expect(usdToUnits(-1)).toBe(0)
  })
  test("spendKey round-trips; a plain key is a user id", () => {
    expect(parseSpendKey(spendKey({ userId: "u1", orgId: "o1" }))).toEqual({
      userId: "u1",
      orgId: "o1",
    })
    expect(parseSpendKey(spendKey({ orgId: "o1" }))).toEqual({ orgId: "o1" })
    expect(parseSpendKey("u7")).toEqual({ userId: "u7" })
    expect(parseSpendKey('["a"]')).toEqual({ userId: '["a"]' })
    expect(parseSpendKey(undefined)).toEqual({})
  })
  test("periodEnd is the next UTC day or month", () => {
    const at = new Date("2026-12-31T23:59:00Z")
    expect(periodEnd("day", at).toISOString()).toBe("2027-01-01T00:00:00.000Z")
    expect(periodEnd("month", new Date("2026-11-15T10:00:00Z")).toISOString()).toBe(
      "2026-12-01T00:00:00.000Z",
    )
  })
})

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  afterEach(async () => {
    await open?.close()
    open = undefined
  })

  let clock = new Date("2026-11-15T10:00:00Z")
  async function make(caps?: SpendCaps) {
    clock = new Date("2026-11-15T10:00:00Z")
    open = await backend.make({})
    const pg = open.db.dialect === "pg"
    const usageCounters = (pg ? pgc : sqc).entitlementTables().usageCounters
    const aiSpendCaps = pg ? pgc.aiSpendCaps() : sqc.aiSpendCaps()
    for (const t of [usageCounters, aiSpendCaps]) await open.exec(ddl(t))
    return createAiSpend(open.db, {
      tables: { usageCounters, aiSpendCaps } as never,
      ...(caps ? { caps } : {}),
      now: () => clock,
    })
  }

  test("user, org and global counters; caps per day and month; refused at the cap", async () => {
    const spend = await make({ user: { day: 100 }, org: { month: 250 }, global: { day: 1000 } })
    const a = { userId: "a", orgId: "o" }
    expect(await spend.check(a)).toEqual({ ok: true })
    await spend.record(a, 60)
    await spend.record(a, 40)
    const r = await spend.check(a)
    expect(r).toMatchObject({
      ok: false,
      scope: "user",
      subject: "a",
      period: "day",
      capUnits: 100,
      usedUnits: 100,
    })
    expect(r.ok ? null : r.resetsAt.toISOString()).toBe("2026-11-16T00:00:00.000Z")
    // Another user in the same org still has room, until the org's month fills.
    const b = { userId: "b", orgId: "o" }
    expect((await spend.check(b)).ok).toBe(true)
    expect(await spend.check(b, 101)).toMatchObject({ ok: false, scope: "user" })
    await spend.record(b, 99)
    await spend.record({ userId: "c", orgId: "o" }, 60)
    expect(await spend.check({ userId: "c", orgId: "o" })).toMatchObject({
      ok: false,
      scope: "org",
      period: "month",
      usedUnits: 259,
    })
    // The next day the user's daily cap resets; the org's month does not.
    clock = new Date("2026-11-16T09:00:00Z")
    expect(await spend.check({ userId: "a" })).toEqual({ ok: true })
    expect(await spend.check(a)).toMatchObject({ ok: false, scope: "org" })
    const u = await spend.usage("user", "a")
    expect(u.day).toMatchObject({ used: 0, cap: 100, remaining: 100 })
    expect(u.month).toMatchObject({ used: 100, cap: null, remaining: null })
    expect((await spend.usage("global")).month.used).toBe(259)
  })

  test("global cap refuses everyone; record ignores zero and negatives", async () => {
    const spend = await make({ global: { month: 50 } })
    await spend.record({}, 0)
    await spend.record({}, -5)
    expect((await spend.usage("global")).month.used).toBe(0)
    await spend.record({ userId: "x" }, 50)
    expect(await spend.check({ userId: "y" })).toMatchObject({
      ok: false,
      scope: "global",
      subject: "*",
    })
  })

  test("admin rows beat options: own row, then *, then option; null is unlimited", async () => {
    const spend = await make({ user: { day: 10 } })
    const actor = { id: "admin-1" }
    await spend.record({ userId: "a" }, 20)
    expect((await spend.check({ userId: "a" })).ok).toBe(false)
    await spend.setCap({ scope: "user", period: "day", units: 30 }, { actor })
    expect((await spend.check({ userId: "a" })).ok).toBe(true)
    await spend.setCap({ scope: "user", subject: "a", period: "day", units: 5 }, { actor })
    expect(await spend.check({ userId: "a" })).toMatchObject({ ok: false, capUnits: 5 })
    await spend.setCap({ scope: "user", subject: "a", period: "day", units: null }, { actor })
    expect((await spend.check({ userId: "a" }, 1_000_000)).ok).toBe(true)
    const rows = await spend.caps()
    expect(rows.map((r) => [r.id, r.units, r.updatedBy])).toEqual([
      ["user:*:day", 30, "admin-1"],
      ["user:a:day", null, "admin-1"],
    ])
    expect(await spend.removeCap("user", "a", "day")).toBe(true)
    expect(await spend.removeCap("user", "a", "day")).toBe(false)
    expect((await spend.usage("user", "a")).day.cap).toBe(30)
    for (const bad of [
      spend.setCap({ scope: "global", subject: "x", period: "day", units: 1 }),
      spend.setCap({ scope: "user", period: "week" as never, units: 1 }),
      spend.setCap({ scope: "team" as never, period: "day", units: 1 }),
      spend.setCap({ scope: "user", period: "day", units: -1 }),
      spend.setCap({ scope: "user", period: "day", units: 0.5 }),
      spend.setCap({ scope: "user", subject: "", period: "day", units: 1 }),
    ])
      expect(await code(bad)).toBe("BAD_VALUE")
  })

  test("top lists the biggest spenders this period with their caps", async () => {
    const spend = await make({ user: { month: 1000 } })
    await spend.record({ userId: "small" }, 5)
    await spend.record({ userId: "big", orgId: "o1" }, 500)
    await spend.record({ userId: "mid" }, 50)
    expect(await spend.top("user", "month", 2)).toEqual([
      { subject: "big", used: 500, cap: 1000 },
      { subject: "mid", used: 50, cap: 1000 },
    ])
    expect(await spend.top("org")).toEqual([{ subject: "o1", used: 500, cap: null }])
    expect(await code(spend.top("global" as never))).toBe("BAD_VALUE")
  })

  test("concurrent records all count", async () => {
    const spend = await make()
    await Promise.all(Array.from({ length: 10 }, () => spend.record({ userId: "a" }, 3)))
    expect((await spend.usage("user", "a")).day.used).toBe(30)
  })

  test("signet-ai's extractor: the ledger records cost and refuses over the cap", async () => {
    // $0.01 a call is 10,000 units; the cap allows two calls a day.
    const spend = await make({ user: { day: 20_000 } })
    let paid = 0
    const extractor = createExtractor({
      providers: [
        {
          name: "p",
          model: "m",
          pricing: { perCallUsd: 0.01 },
          async generate<T>() {
            paid++
            return { value: { ok: true } as T }
          },
        },
      ],
      ledger: spend.ledger,
      now: () => clock.getTime(),
    })
    const args = {
      schema: z.object({ ok: z.boolean() }),
      input: "x",
      instructions: "y",
      budget: { key: spendKey({ userId: "a", orgId: "o" }) },
    }
    await extractor.extract(args)
    await extractor.extract(args)
    expect(await code(extractor.extract(args))).toBe("AI_BUDGET_EXCEEDED")
    expect(paid).toBe(2)
    expect((await spend.usage("org", "o")).day.used).toBe(20_000)
    expect(await spend.ledger.spentUsd(clock.getTime(), "a")).toBeCloseTo(0.02)
    // A plain key is a user id; another user is not affected.
    await extractor.extract({ ...args, budget: { key: "b" } })
    expect(paid).toBe(3)
  })

  test("onUsage records stream spend under the report's key; cache hits cost nothing", async () => {
    const spend = await make()
    await spend.onUsage({ costUsd: 0.002, key: spendKey({ userId: "a" }) })
    await spend.onUsage({ costUsd: 0, key: "a" })
    expect((await spend.usage("user", "a")).day.used).toBe(2000)
  })

  test("concurrent requests that all pass requireAiSpend: the ledger's refusal is a 429 envelope", async () => {
    // One call ($0.01 = 10,000 units) fits the cap; four requests arrive at once.
    const spend = await make({ user: { day: 10_000 } })
    let paid = 0
    const extractor = createExtractor({
      providers: [
        {
          name: "p",
          model: "m",
          pricing: { perCallUsd: 0.01 },
          async generate<T>() {
            paid++
            return { value: { ok: true } as T }
          },
        },
      ],
      ledger: spend.ledger,
      now: () => clock.getTime(),
    })
    const admin = aiSpendAdminRoutes({ spend, authorize: () => true })
    const app = new (admin.constructor as new () => typeof admin)()
    app.onError(errorHandler({ isProduction: () => true }))
    app.use("/ai/*", requireAiSpend({ spend, subject: () => ({ userId: "a" }) }))
    // Every request is past the middleware before any model call runs; the calls
    // then run one after another, as provider latency would order them.
    let passed = 0
    let release: () => void = () => {}
    const allIn = new Promise<void>((r) => {
      release = r
    })
    let queue: Promise<unknown> = Promise.resolve()
    app.post("/ai/ask", async (c: any) => {
      if (++passed === 4) release()
      await allIn
      const run = queue.then(() =>
        extractor.extract({
          schema: z.object({ ok: z.boolean() }),
          input: "x",
          instructions: "y",
          cache: false,
          budget: { key: "a" },
        }),
      )
      queue = run.catch(() => {})
      await run
      return c.json({ ok: true })
    })
    const res = await Promise.all(
      Array.from({ length: 4 }, () => app.request("/ai/ask", { method: "POST" })),
    )
    const statuses = res.map((r) => r.status).sort()
    expect(statuses).toEqual([200, 429, 429, 429])
    for (const r of res.filter((r) => r.status === 429))
      expect(await r.json()).toMatchObject({ success: false, code: "AI_SPEND_CAP_EXCEEDED" })
    expect(paid).toBe(1)
    expect((await spend.usage("user", "a")).day.used).toBe(10_000)
  })

  test("signet-server: requireAiSpend and the admin routes over the real store", async () => {
    const spend = await make({ user: { day: 100 } })
    const admin = aiSpendAdminRoutes({
      spend,
      authorize: () => true,
      actor: () => ({ type: "user", id: "admin-1" }),
    })
    // hono is signet-server's dependency, not this package's: reuse its class.
    const app = new (admin.constructor as new () => typeof admin)()
    app.onError(errorHandler({ isProduction: () => false }))
    app.use(
      "/ai/*",
      requireAiSpend({ spend, subject: (c: any) => ({ userId: c.req.header("x-user") }) }),
    )
    app.post("/ai/ask", async (c: any) => {
      await spend.record({ userId: c.req.header("x-user") }, 60)
      return c.json({ ok: true })
    })
    app.route("/admin", admin)
    const ask = () => app.request("/ai/ask", { method: "POST", headers: { "x-user": "a" } })
    expect((await ask()).status).toBe(200)
    expect((await ask()).status).toBe(200)
    const refused = await ask()
    expect(refused.status).toBe(429)
    expect(await refused.json()).toMatchObject({
      success: false,
      code: "AI_SPEND_CAP_EXCEEDED",
      details: { formErrors: ["user:day"] },
    })
    const put = await app.request("/admin/caps", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "user", subject: "a", period: "day", units: 1000 }),
    })
    expect(put.status).toBe(200)
    expect((await ask()).status).toBe(200)
    const usage = (await (await app.request("/admin/usage/user/a")).json()) as {
      day: { used: number; cap: number }
    }
    expect(usage.day).toMatchObject({ used: 180, cap: 1000 })
    const overview = (await (await app.request("/admin/usage")).json()) as {
      top: { users: Array<{ subject: string }> }
    }
    expect(overview.top.users[0]?.subject).toBe("a")
    const bad = await app.request("/admin/caps", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "global", subject: "x", period: "day", units: 1 }),
    })
    expect(bad.status).toBe(400)
  })
})
