import { afterEach, describe, expect, test } from "bun:test"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import {
  assignOf,
  checkVariants,
  createExperiments,
  type Experiment,
  pickVariant,
  twoProportionTest,
} from "../src/experiments"
import { backends, ddl, type Instance } from "./harness"

const actor = { type: "user" as const, id: "admin-1" }
const variants = [
  { key: "control", weight: 50 },
  { key: "short", weight: 50, value: { offering: "annual-first" } },
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
  test("pickVariant is sticky and splits by weight", () => {
    const three = checkVariants([
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
      { key: "c", weight: 2 },
    ])
    const tally: Record<string, number> = { a: 0, b: 0, c: 0 }
    for (let i = 0; i < 20_000; i++) {
      const v = pickVariant(three, "exp", `user-${i}`)
      expect(pickVariant(three, "exp", `user-${i}`).key).toBe(v.key)
      tally[v.key] = (tally[v.key] ?? 0) + 1
    }
    expect(Math.abs((tally.a as number) / 20_000 - 0.25)).toBeLessThan(0.02)
    expect(Math.abs((tally.b as number) / 20_000 - 0.25)).toBeLessThan(0.02)
    expect(Math.abs((tally.c as number) / 20_000 - 0.5)).toBeLessThan(0.02)
    // A different salt reshuffles.
    const moved = Array.from({ length: 200 }, (_, i) => `u${i}`).filter(
      (id) => pickVariant(three, "exp", id).key !== pickVariant(three, "other", id).key,
    )
    expect(moved.length).toBeGreaterThan(50)
  })

  test("checkVariants refuses bad input", () => {
    expect(() => checkVariants([{ key: "a", weight: 1 }])).toThrow("2 to 10")
    expect(() =>
      checkVariants([
        { key: "a", weight: 1 },
        { key: "a", weight: 1 },
      ]),
    ).toThrow("twice")
    expect(() =>
      checkVariants([
        { key: "a", weight: 0 },
        { key: "b", weight: 1 },
      ]),
    ).toThrow("positive")
    expect(() =>
      checkVariants([
        { key: "a b", weight: 1 },
        { key: "b", weight: 1 },
      ]),
    ).toThrow("letters")
  })

  test("twoProportionTest matches the textbook z-test", () => {
    // 100/1000 vs 130/1000: z ≈ 2.10, p ≈ 0.036
    const p = twoProportionTest(100, 1000, 130, 1000) as number
    expect(p).toBeGreaterThan(0.034)
    expect(p).toBeLessThan(0.038)
    // Same rates: p = 1
    expect(twoProportionTest(10, 100, 10, 100)).toBeCloseTo(1, 5)
    // Nothing to test
    expect(twoProportionTest(0, 0, 1, 10)).toBeNull()
    expect(twoProportionTest(0, 10, 0, 10)).toBeNull()
  })

  test("assignOf: control when not running or outside the audience, winner when rolled out", () => {
    const e: Experiment = {
      key: "x",
      description: null,
      status: "draft",
      variants,
      goal: "signup",
      audience: { plan: ["pro"] },
      salt: "x",
      winner: null,
      startedAt: null,
      stoppedAt: null,
      updatedBy: null,
      updatedAt: new Date(),
    }
    expect(assignOf(e, { id: "u" }).reason).toBe("not_running")
    expect(assignOf({ ...e, status: "running" }, { id: "u" })).toMatchObject({
      variant: "control",
      reason: "not_eligible",
    })
    expect(assignOf({ ...e, status: "running" }, { id: "u", plan: "pro" }).reason).toBe("assigned")
    expect(assignOf({ ...e, status: "rolled_out", winner: "short" }, { id: "u" })).toEqual({
      experiment: "x",
      variant: "short",
      value: { offering: "annual-first" },
      reason: "winner",
    })
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
    const tables = (pg ? pgc.experimentTables() : sqc.experimentTables()) as ReturnType<
      typeof sqc.experimentTables
    >
    const events = (pg ? pgc.analyticsEvents() : sqc.analyticsEvents()) as ReturnType<
      typeof sqc.analyticsEvents
    >
    for (const t of [...Object.values(tables), events]) await i.exec(ddl(t))
    let clock = 1_000_000
    const ex = createExperiments(i.db, { tables, events, now: () => new Date(clock) })
    const track = async (
      name: string,
      ts: number,
      who: { userId?: string; anonymousId?: string },
    ) => (i.db.orm as any).insert(events).values({ name, ts, ...who })
    return { i, ex, track, tick: (ms: number) => (clock += ms), at: () => clock }
  }

  test("lifecycle: draft, edit, start, stop, resume, roll out; wrong moves are CONFLICT", async () => {
    const { ex } = await make()
    await ex.create("copy", { variants, goal: "signup" }, { actor })
    expect(await code(ex.create("copy", { variants, goal: "signup" }, { actor }))).toBe("CONFLICT")
    expect(await code(ex.create("bad key", { variants, goal: "signup" }, { actor }))).toBe(
      "BAD_VALUE",
    )
    expect(await code(ex.stop("copy", { actor }))).toBe("CONFLICT")
    expect(
      (await ex.update("copy", { description: "Shorter onboarding" }, { actor })).description,
    ).toBe("Shorter onboarding")
    const started = await ex.start("copy", { actor })
    expect(started.status).toBe("running")
    expect(started.startedAt).not.toBeNull()
    expect(await code(ex.update("copy", { goal: "other" }, { actor }))).toBe("CONFLICT")
    expect((await ex.stop("copy", { actor })).status).toBe("stopped")
    expect((await ex.start("copy", { actor })).status).toBe("running")
    expect(await code(ex.rollout("copy", "nope", { actor }))).toBe("BAD_VALUE")
    const done = await ex.rollout("copy", "short", { actor })
    expect(done).toMatchObject({ status: "rolled_out", winner: "short" })
    expect(await code(ex.start("copy", { actor }))).toBe("CONFLICT")
    expect(await code(ex.start("missing", { actor }))).toBe("NOT_FOUND")
    expect((await ex.list()).map((e) => e.key)).toEqual(["copy"])
    expect(await ex.assign("missing", { id: "u" })).toBeNull()
  })

  test("expose records once per subject, only while running", async () => {
    const { i, ex } = await make()
    await ex.create("copy", { variants, goal: "signup" }, { actor })
    expect(await ex.expose("copy", { id: "u1" })).toMatchObject({
      reason: "not_running",
      first: false,
    })
    await ex.start("copy", { actor })
    const a = await ex.expose("copy", { id: "u1" })
    expect(a?.first).toBe(true)
    expect(a?.variant).toBe((await ex.assign("copy", { id: "u1" }))?.variant as string)
    expect((await ex.expose("copy", { id: "u1" }))?.first).toBe(false)
    const rows = await (i.db.orm as any)
      .select()
      .from((i.db.dialect === "pg" ? pgc : sqc).experimentTables().experimentExposures)
    expect(rows.length).toBe(1)
  })

  test("results: conversions after exposure, by user or anonymous id, with a z-test", async () => {
    const { ex, track, tick, at } = await make()
    await ex.create("copy", { variants, goal: "signup" }, { actor })
    expect(await code(ex.results("missing"))).toBe("NOT_FOUND")
    await ex.start("copy", { actor })
    const groups: Record<string, string[]> = { control: [], short: [] }
    for (let n = 0; n < 400; n++) {
      const id = `u${n}`
      const a = await ex.expose("copy", { id })
      groups[a?.variant as string]?.push(id)
    }
    // A goal event before exposure does not count.
    await track("signup", at() - 1, { userId: groups.control?.[0] as string })
    tick(1000)
    // control: 10% convert; short: 30%, half of them by anonymous id.
    const c = groups.control as string[]
    const s = groups.short as string[]
    for (const id of c.slice(1, 1 + Math.round(c.length * 0.1)))
      await track("signup", at(), { userId: id })
    const sConv = s.slice(0, Math.round(s.length * 0.3))
    for (const [k, id] of sConv.entries())
      await track("signup", at(), k % 2 ? { anonymousId: id } : { userId: id })
    // Converting twice counts once; other events do not count.
    await track("signup", at(), { userId: sConv[0] as string })
    await track("page_view", at(), { userId: s[s.length - 1] as string })

    const r = await ex.results("copy")
    expect(r.control).toBe("control")
    const [rc, rs] = r.variants
    expect(rc?.exposed).toBe(c.length)
    expect(rc?.converted).toBe(Math.round(c.length * 0.1))
    expect(rs?.exposed).toBe(s.length)
    expect(rs?.converted).toBe(sConv.length)
    expect(rc?.pValue).toBeNull()
    expect(rs?.pValue as number).toBeLessThan(0.05)
    expect(rs?.significant).toBe(true)
    expect(rs?.lift as number).toBeGreaterThan(1)
    // Another goal reads another event.
    const other = await ex.results("copy", { goal: "page_view" })
    expect(other.variants[1]?.converted).toBe(1)
  })

  test("results without the events table is BAD_CONFIG", async () => {
    const { i } = await make()
    const ex = createExperiments(i.db, {
      tables: (i.db.dialect === "pg" ? pgc : sqc).experimentTables() as never,
    })
    expect(await code(ex.results("copy"))).toBe("BAD_CONFIG")
  })
})
