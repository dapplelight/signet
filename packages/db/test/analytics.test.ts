import { afterEach, describe, expect, test } from "bun:test"
import { analyticsTools, createAnalyticsStore, type StoredEventInput } from "../src/analytics"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { backends, ddl, type Instance } from "./harness"

const DAY = 86_400_000
// A Wednesday, noon UTC.
const NOW = Date.parse("2026-11-11T12:00:00Z")
const MON = Date.parse("2026-11-09T00:00:00Z")

for (const backend of backends) {
  describe(`analytics store on ${backend.name}`, () => {
    let open: Instance | undefined
    afterEach(async () => {
      await open?.close()
      open = undefined
    })

    async function make(opts: { consented?: string[]; retentionDays?: number | null } = {}) {
      open = await backend.make({})
      const i = open
      const table = i.db.dialect === "pg" ? pgc.analyticsEvents() : sqc.analyticsEvents()
      await i.exec(ddl(table))
      const privacy = opts.consented
        ? {
            has: async (u: string, p: string) =>
              p === "analytics" && opts.consented?.includes(u) === true,
          }
        : undefined
      const store = createAnalyticsStore(i.db, {
        table: table as never,
        privacy,
        retentionDays: opts.retentionDays,
        now: () => new Date(NOW),
      })
      return { ...i, store, table }
    }

    const ev = (
      name: string,
      ts: number,
      extra: Partial<StoredEventInput> = {},
    ): StoredEventInput => ({
      name,
      ts,
      anonymousId: "a1",
      sessionId: "s1",
      ...extra,
    })

    test("write, count, uniques, identify links anonymous events", async () => {
      const { store } = await make()
      expect(
        await store.write([
          ev("pageview", NOW - 3 * DAY),
          ev("pageview", NOW - 2 * DAY, { sessionId: "s2" }),
          ev("pageview", NOW - DAY, { anonymousId: "a2", sessionId: "s3" }),
          { name: "" } as StoredEventInput,
        ]),
      ).toBe(3)
      expect(await store.count({ event: "pageview" })).toBe(3)
      expect(await store.uniques({ event: "pageview" })).toBe(2)
      expect(await store.uniques({ by: "session" })).toBe(3)
      // a1 signs in as u1, then a2 turns out to be u1 on another device.
      await store.write([ev("$identify", NOW - 60_000, { userId: "u1" })])
      await store.write([ev("$identify", NOW - 30_000, { anonymousId: "a2", userId: "u1" })])
      expect(await store.uniques({ event: "pageview" })).toBe(1)
    })

    test("consent: no consent keeps events anonymous and skips linking", async () => {
      const { store, db, table } = await make({ consented: ["yes"] })
      await store.write([
        ev("pageview", NOW - DAY, { userId: "no" }),
        ev("$identify", NOW - DAY, { userId: "no" }),
        ev("pageview", NOW - DAY, { anonymousId: "a9", userId: "yes" }),
      ])
      const rows = (await (
        db.orm as never as {
          select(): { from(t: unknown): Promise<Array<{ name: string; userId: string | null }>> }
        }
      )
        .select()
        .from(table)) as Array<{ name: string; userId: string | null }>
      expect(rows.map((r) => [r.name, r.userId]).sort()).toEqual(
        [
          ["pageview", "yes"],
          ["pageview", null],
        ].sort() as never,
      )
      expect(await store.identify("a1", "no")).toBe(0)
    })

    test("series fills empty buckets; weeks start on Monday", async () => {
      const { store } = await make()
      await store.write([
        ev("signup", MON + 1000),
        ev("signup", MON + 2000),
        ev("signup", MON + 2 * DAY),
      ])
      const days = await store.series({ event: "signup", from: MON, to: MON + 3 * DAY })
      expect(days).toEqual([
        { start: MON, value: 2 },
        { start: MON + DAY, value: 0 },
        { start: MON + 2 * DAY, value: 1 },
      ])
      const weeks = await store.series({ event: "signup", bucket: "week", from: MON, to: NOW })
      expect(weeks).toEqual([{ start: MON, value: 3 }])
      const unique = await store.series({ event: "signup", unique: true, from: MON, to: MON + DAY })
      expect(unique).toEqual([{ start: MON, value: 1 }])
      // IST: the 2 a.m. UTC Monday event is the same local day as 1 a.m.
      const ist = await store.series({
        event: "signup",
        from: MON,
        to: MON + DAY,
        utcOffsetMinutes: 330,
      })
      expect(ist[0]?.start).toBe(MON - 330 * 60_000)
    })

    test("breakdown and where filters, booleans included", async () => {
      const { store } = await make()
      await store.write([
        ev("signup", NOW - 1000, { props: { plan: "pro", trial: true, seats: 3 } }),
        ev("signup", NOW - 2000, { props: { plan: "pro", trial: false } }),
        ev("signup", NOW - 3000, { props: { plan: "free" } }),
        ev("signup", NOW - 4000),
      ])
      expect(await store.breakdown({ event: "signup", property: "plan" })).toEqual([
        { value: "pro", count: 2 },
        { value: "free", count: 1 },
        { value: null, count: 1 },
      ])
      expect(await store.count({ event: "signup", where: { trial: true } })).toBe(1)
      expect(await store.count({ event: "signup", where: { seats: 3 } })).toBe(1)
      expect(await store.count({ event: "signup", where: { plan: "pro", trial: false } })).toBe(1)
    })

    test("props from a public client are bounded: scalars only, 20 keys, 256 chars", async () => {
      const { store, db, table } = await make()
      const props: Record<string, unknown> = {
        long: "x".repeat(5000),
        nested: { deep: [1, 2] },
        list: [1],
        nan: Number.NaN,
        "bad key": "v",
        ok: 1,
        flag: true,
      }
      for (let i = 0; i < 40; i++) props[`k${i}`] = i
      await store.write([ev("big", NOW - 1000, { props: props as never })])
      const rows = (await (
        db.orm as never as {
          select(): { from(t: unknown): Promise<Array<{ props: Record<string, unknown> }>> }
        }
      )
        .select()
        .from(table)) as Array<{ props: Record<string, unknown> }>
      const saved = rows[0]?.props ?? {}
      expect((saved.long as string).length).toBe(256)
      expect(Object.keys(saved).length).toBe(20)
      for (const k of ["nested", "list", "nan", "bad key"]) expect(k in saved).toBe(false)
      expect(saved.flag).toBe("true")
      expect(saved.ok).toBe(1)
    })

    test("a cut emoji or a lone surrogate is stored as valid Unicode", async () => {
      const { store } = await make()
      const cut = `${"x".repeat(255)}😀` // the 256-char cut lands between the surrogates
      const written = await store.write([
        ev("e", NOW - 1000, { props: { cut, lone: "a\uD800b", tail: "\uDC00" } }),
        ev("name\uD83D", NOW - 1000),
      ])
      expect(written).toBe(2)
      expect(await store.count({ where: { cut: "x".repeat(255) } })).toBe(1)
      expect(await store.count({ where: { lone: "a\uFFFDb" } })).toBe(1)
      expect(await store.count({ event: "name" })).toBe(1)
    })

    test("injection: values are bound, property names are checked", async () => {
      const { store } = await make()
      await store.write([
        ev("x'; drop table analytics_events; --", NOW - 1000, { props: { k: "v' or '1'='1" } }),
      ])
      expect(await store.count({ event: "x'; drop table analytics_events; --" })).toBe(1)
      expect(await store.count({ where: { k: "' or '1'='1" } })).toBe(0)
      expect(await store.count({ where: { k: "v' or '1'='1" } })).toBe(1)
      await expect(store.breakdown({ property: "k') --" })).rejects.toThrow("not a plain name")
      await expect(store.count({ where: { "a.b": "1" } })).rejects.toThrow("not a plain name")
      expect(await store.count({})).toBe(1)
    })

    test("funnel counts people in order, within the window", async () => {
      const { store } = await make()
      await store.write([
        ev("view", NOW - 5000, { anonymousId: "p1" }),
        ev("cart", NOW - 4000, { anonymousId: "p1" }),
        ev("buy", NOW - 3000, { anonymousId: "p1" }),
        ev("view", NOW - 5000, { anonymousId: "p2" }),
        ev("buy", NOW - 4000, { anonymousId: "p2" }), // skipped cart
        ev("cart", NOW - 9000, { anonymousId: "p3" }), // cart before view
        ev("view", NOW - 8000, { anonymousId: "p3" }),
        ev("view", NOW - 3 * DAY, { anonymousId: "p4" }),
        ev("cart", NOW - 1000, { anonymousId: "p4" }), // too late
      ])
      const f = await store.funnel({ steps: ["view", "cart", "buy"], withinMs: DAY })
      expect(f.map((s) => s.count)).toEqual([4, 1, 1])
      expect(f[1]?.rate).toBe(0.25)
      await expect(store.funnel({ steps: ["view"] })).rejects.toThrow("2 to 10")
    })

    test("retention cohorts by week", async () => {
      const { store } = await make()
      const W = 7 * DAY
      const start = MON - 2 * W
      await store.write([
        ev("signup", start + DAY, { anonymousId: "p1" }),
        ev("visit", start + W + DAY, { anonymousId: "p1" }),
        ev("visit", start + 2 * W + DAY, { anonymousId: "p1" }),
        ev("signup", start + 2 * DAY, { anonymousId: "p2" }),
        ev("signup", start + W, { anonymousId: "p3" }),
        ev("visit", start + 2 * W, { anonymousId: "p3" }),
      ])
      const rows = await store.retention({
        startEvent: "signup",
        returnEvent: "visit",
        from: start,
        to: NOW,
        periods: 3,
      })
      expect(rows).toEqual([
        { cohort: start, size: 2, returned: [0, 1, 1] },
        { cohort: start + W, size: 1, returned: [0, 1, 0] },
      ])
    })

    test("trend compares this period with the last", async () => {
      const { store } = await make()
      const evs = [
        ...Array.from({ length: 6 }, (_, i) => ev("signup", NOW - DAY - i * 1000)),
        ...Array.from({ length: 5 }, (_, i) => ev("signup", NOW - 8 * DAY - i * 1000)),
      ]
      await store.write(evs)
      expect(await store.trend({ event: "signup" })).toEqual({
        current: 6,
        previous: 5,
        change: 0.2,
      })
      expect(await store.trend({ event: "nothing" })).toEqual({
        current: 0,
        previous: 0,
        change: null,
      })
    })

    test("prune keeps retentionDays; tools answer read-only", async () => {
      const { store } = await make({ retentionDays: 30 })
      await store.write([ev("old", NOW - 31 * DAY), ev("new", NOW - DAY)])
      expect(await store.prune()).toBe(1)
      expect(await store.events({ from: 0 })).toEqual([{ name: "new", count: 1 }])

      const tools = analyticsTools({ store })
      expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true)
      const q = tools.find((t) => t.name === "query_analytics")
      expect(await q?.run({ kind: "count", event: "new" })).toEqual({ count: 1 })
      expect(await q?.run({ kind: "trend", event: "new", period: "day" })).toEqual({
        trend: { current: 1, previous: 0, change: null },
      })
      await expect(
        q?.run({ kind: "count", from: "yesterday-ish" }) as Promise<unknown>,
      ).rejects.toThrow("ISO")
    })
  })
}
