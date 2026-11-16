// The dated AI spend ledger on every backend: upserted day rows, hashed
// subjects (raw ids never stored), series, byModel, topSpenders, cache savings
// and pruning. The caps API is covered by ai-spend.test.ts.
import { afterEach, describe, expect, test } from "bun:test"
import { createAiSpend } from "../src/ai-spend"
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

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  afterEach(async () => {
    await open?.close()
    open = undefined
  })

  let clock = new Date("2026-11-15T10:00:00Z")
  let table: unknown
  async function make(
    extra: { hashSubject?: (id: string) => string; retentionDays?: number } = {},
  ) {
    clock = new Date("2026-11-15T10:00:00Z")
    open = await backend.make({})
    const c = open.db.dialect === "pg" ? pgc : sqc
    const usageCounters = c.entitlementTables().usageCounters
    const aiSpendCaps = c.aiSpendCaps()
    const aiSpendLedger = c.aiSpendLedger()
    table = aiSpendLedger
    for (const t of [usageCounters, aiSpendCaps, aiSpendLedger]) await open.exec(ddl(t))
    return createAiSpend(open.db, {
      tables: { usageCounters, aiSpendCaps, aiSpendLedger } as never,
      now: () => clock,
      ...extra,
    })
  }
  const rows = async () =>
    (await (open as Instance).db.orm.select().from(table)) as Array<Record<string, unknown>>

  test("record upserts one row per day, model, scope and subject", async () => {
    const spend = await make()
    const a = { userId: "user-a", orgId: "org-a" }
    await spend.record(a, 100, clock, { model: "m1" })
    await spend.record(a, 50, clock, { model: "m1" })
    await spend.record(a, 10, clock, { model: "m2" })
    expect(await spend.series({ days: 1 })).toEqual([
      { day: "2026-11-15", units: 160, calls: 3, cacheSavedUnits: 0 },
    ])
    // global + user + org rows for each of two models
    expect(await rows()).toHaveLength(6)
  })

  test("subjects are hashed with SHA-256 by default; raw ids are never stored", async () => {
    const spend = await make()
    await spend.record({ userId: "user-a", orgId: "org-a" }, 5, clock, { model: "m1" })
    const stored = await rows()
    expect(JSON.stringify(stored)).not.toContain("user-a")
    expect(JSON.stringify(stored)).not.toContain("org-a")
    const user = stored.find((r) => r.scope === "user")
    expect(user?.subject).toBe(await sha256("user-a"))
    expect(stored.find((r) => r.scope === "global")?.subject).toBe("*")
    expect(await spend.topSpenders({ scope: "user", days: 1 })).toEqual([
      { subject: await sha256("user-a"), units: 5, calls: 1 },
    ])
  })

  test("hashSubject is config: a custom hash is stored and used to look a subject up", async () => {
    const spend = await make({ hashSubject: (id) => `h(${id.length})` })
    await spend.record({ userId: "user-a" }, 5, clock)
    expect((await rows()).find((r) => r.scope === "user")?.subject).toBe("h(6)")
    expect(await spend.series({ scope: "user", subject: "other1", days: 1 })).toEqual([
      { day: "2026-11-15", units: 5, calls: 1, cacheSavedUnits: 0 },
    ])
  })

  test("series by scope and subject over a window of days", async () => {
    const spend = await make()
    const day = (d: string) => new Date(`${d}T09:00:00Z`)
    await spend.record({ userId: "a", orgId: "o" }, 30, day("2026-11-13"), { model: "m1" })
    await spend.record({ userId: "b", orgId: "o" }, 20, day("2026-11-14"), { model: "m1" })
    await spend.record({ userId: "a", orgId: "o" }, 10, day("2026-11-15"), { model: "m1" })
    const total = (await spend.series({ days: 3 })).map((d) => [d.day, d.units])
    expect(total).toEqual([
      ["2026-11-13", 30],
      ["2026-11-14", 20],
      ["2026-11-15", 10],
    ])
    expect((await spend.series({ days: 2 })).map((d) => d.day)).toEqual([
      "2026-11-14",
      "2026-11-15",
    ])
    const a = await spend.series({ scope: "user", subject: "a", days: 3 })
    expect(a.map((d) => d.units)).toEqual([30, 10])
    expect(
      (await spend.series({ scope: "org", subject: "o", days: 3 })).map((d) => d.units),
    ).toEqual([30, 20, 10])
    expect(await spend.series({ scope: "user", subject: "nobody", days: 3 })).toEqual([])
  })

  test("byModel sums the global rows, biggest first; topSpenders ranks hashes", async () => {
    const spend = await make()
    await spend.record({ userId: "a" }, 10, clock, { model: "small" })
    await spend.record({ userId: "b" }, 70, clock, { model: "big" })
    await spend.record({ userId: "a" }, 30, clock, { model: "big" })
    expect(await spend.byModel({ days: 1 })).toEqual([
      { model: "big", units: 100, calls: 2, cacheSavedUnits: 0 },
      { model: "small", units: 10, calls: 1, cacheSavedUnits: 0 },
    ])
    const top = await spend.topSpenders({ scope: "user", days: 1, limit: 1 })
    expect(top).toEqual([{ subject: await sha256("b"), units: 70, calls: 1 }])
  })

  test("a cache hit costs nothing but its saving lands in the ledger, not the counters", async () => {
    const spend = await make()
    await spend.onUsage({ costUsd: 0.002, key: "a", model: "m1" })
    await spend.onUsage({ costUsd: 0, savedUsd: 0.002, key: "a", model: "m1" })
    expect(await spend.series({ days: 1 })).toEqual([
      { day: "2026-11-15", units: 2000, calls: 2, cacheSavedUnits: 2000 },
    ])
    expect((await spend.usage("user", "a")).day.used).toBe(2000)
  })

  test("pruning drops days older than retentionDays and runs on record", async () => {
    const spend = await make({ retentionDays: 3 })
    const day = (d: string) => new Date(`${d}T09:00:00Z`)
    await spend.record({}, 1, day("2026-11-10"))
    await spend.record({}, 1, day("2026-11-11"))
    // Recording on the 13th prunes everything before the 11th (3 days kept: 11, 12, 13).
    await spend.record({}, 1, day("2026-11-13"))
    expect((await rows()).map((r) => r.day).sort()).toEqual(["2026-11-11", "2026-11-13"])
    expect(await spend.prune(day("2026-11-20"))).toBe(2)
    expect(await rows()).toHaveLength(0)
  })

  test("bad input is BAD_VALUE; days may not pass retentionDays", async () => {
    const spend = await make({ retentionDays: 30 })
    for (const days of [0, -1, 1.5, 31, Number.NaN])
      expect(await code(spend.series({ days }))).toBe("BAD_VALUE")
    expect(await code(spend.byModel({ days: 31 }))).toBe("BAD_VALUE")
    expect(await code(spend.series({ scope: "x" as never, days: 1 }))).toBe("BAD_VALUE")
    expect(await code(spend.series({ subject: "a", days: 1 }))).toBe("BAD_VALUE")
    expect(await code(spend.series({ scope: "global", subject: "a", days: 1 }))).toBe("BAD_VALUE")
    expect(await code(spend.topSpenders({ scope: "global" as never, days: 1 }))).toBe("BAD_VALUE")
  })

  test("without a ledger table record still counts and the ledger methods say so", async () => {
    open = await backend.make({})
    const c = open.db.dialect === "pg" ? pgc : sqc
    const usageCounters = c.entitlementTables().usageCounters
    const aiSpendCaps = c.aiSpendCaps()
    for (const t of [usageCounters, aiSpendCaps]) await open.exec(ddl(t))
    const spend = createAiSpend(open.db, { tables: { usageCounters, aiSpendCaps } as never })
    await spend.record({ userId: "a" }, 5)
    expect((await spend.usage("user", "a")).day.used).toBe(5)
    expect(await spend.prune()).toBe(0)
    expect(await code(spend.series({ days: 1 }))).toContain("Pass aiSpendLedger")
  })
})
