import { afterEach, describe, expect, test } from "bun:test"
import { nextSequence } from "../src"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { createPrivacy, privacyTools } from "../src/privacy"
import { backends, ddl, type Instance } from "./harness"

const DAY = 86_400_000
const staff = { type: "user" as const, id: "staff-1" }

for (const backend of backends) {
  describe(`privacy and sequences on ${backend.name}`, () => {
    let open: Instance | undefined
    afterEach(async () => {
      await open?.close()
      open = undefined
    })
    let clock = new Date("2026-11-01T00:00:00Z")
    const advance = (ms: number) => {
      clock = new Date(clock.getTime() + ms)
    }

    async function make() {
      clock = new Date("2026-11-01T00:00:00Z")
      open = await backend.make({})
      const i = open
      const pg = i.db.dialect === "pg"
      const tables = pg
        ? (pgc.privacyTables() as unknown as ReturnType<typeof sqc.privacyTables>)
        : sqc.privacyTables()
      const seq = pg ? pgc.sequences() : sqc.sequences()
      for (const t of [...Object.values(tables), seq]) await i.exec(ddl(t))
      const privacy = createPrivacy(i.db, {
        tables,
        userTables: [i.S.tags],
        respondWithinMs: 30 * DAY,
        now: () => clock,
      })
      return { ...i, privacy, seq }
    }

    test("nextSequence: per key, from 1", async () => {
      const { db, seq } = await make()
      const k = "invoice:INV:2026-27"
      expect(await nextSequence(db, seq, k)).toBe(1)
      expect(await nextSequence(db, seq, k)).toBe(2)
      expect(await nextSequence(db, seq, "invoice:INV:2027-28")).toBe(1)
      const many = await Promise.all(Array.from({ length: 5 }, () => nextSequence(db, seq, k)))
      expect(many.sort()).toEqual([3, 4, 5, 6, 7])
    })

    test("consent: give, idempotent per version, withdraw, history", async () => {
      const { privacy: p } = await make()
      const c = await p.give("u1", "marketing", { noticeVersion: "v1", source: "signup" })
      expect(c).toMatchObject({
        purpose: "marketing",
        noticeVersion: "v1",
        source: "signup",
        withdrawnAt: null,
      })
      expect((await p.give("u1", "marketing", { noticeVersion: "v1" })).id).toBe(c.id)
      advance(1)
      await p.give("u1", "marketing", { noticeVersion: "v2" })
      await p.give("u1", "analytics", { noticeVersion: "v1" })
      expect(await p.has("u1", "marketing")).toBe(true)
      expect(await p.has("u1", "marketing", { noticeVersion: "v3" })).toBe(false)
      expect(await p.has("u2", "marketing")).toBe(false)
      advance(1)
      expect(await p.withdraw("u1", "marketing")).toBe(2)
      expect(await p.has("u1", "marketing")).toBe(false)
      expect((await p.active("u1")).map((x) => x.purpose)).toEqual(["analytics"])
      const h = await p.history("u1")
      expect(h.length).toBe(3)
      expect(h.filter((x) => x.withdrawnAt).length).toBe(2)
      await expect(p.give("u1", "x", { noticeVersion: "" })).rejects.toThrow(/noticeVersion/)
    })

    test("requests: one open per kind, export returns data, erasure deletes and withdraws", async () => {
      const { privacy: p, db, S } = await make()
      await (db.orm as any).insert(S.tags).values([
        { userId: "u1", label: "a" },
        { userId: "u1", label: "b" },
        { userId: "u2", label: "c" },
      ])
      await p.give("u1", "marketing", { noticeVersion: "v1" })
      const ex = await p.requestExport("u1")
      expect(ex).toMatchObject({ kind: "export", status: "pending" })
      expect(ex.dueAt?.getTime()).toBe(clock.getTime() + 30 * DAY)
      expect((await p.requestExport("u1")).id).toBe(ex.id)
      const done = await p.fulfil(ex.id, { actor: staff })
      expect(done.request).toMatchObject({ status: "completed", closedBy: "user:staff-1" })
      expect(done.data?.tags?.length).toBe(2)
      await expect(p.fulfil(ex.id, { actor: staff })).rejects.toThrow(/already completed/)

      const er = await p.requestErasure("u1")
      advance(31 * DAY)
      expect((await p.overdue()).map((r) => r.id)).toEqual([er.id])
      const gone = await p.fulfil(er.id, { actor: staff })
      expect(gone.request.result).toEqual({ tags: 2 })
      expect(await p.has("u1", "marketing")).toBe(false)
      expect((await (db.orm as any).select().from(S.tags)).length).toBe(1)
      expect(await p.overdue()).toEqual([])

      const r2 = await p.requestErasure("u2")
      const rej = await p.reject(r2.id, { actor: staff, reason: "Identity not verified" })
      expect(rej).toMatchObject({ status: "rejected", note: "Identity not verified" })
      expect((await p.listRequests({ subject: "u1" })).length).toBe(2)
      expect((await p.listRequests({ status: "rejected" })).length).toBe(1)
      await expect(p.fulfil("nope", { actor: staff })).rejects.toThrow(/No data request/)
    })

    test("tools: subject-bound, writes gated", async () => {
      const { privacy: p } = await make()
      await p.give("u1", "marketing", { noticeVersion: "v1" })
      const tools = privacyTools({ privacy: p, subject: "u1" })
      const t = (n: string, list = tools) => {
        const x = list.find((y) => y.name === n)
        if (!x) throw new Error(`no tool ${n}`)
        return x
      }
      expect(((await t("list_consents").run({})) as { active: unknown[] }).active.length).toBe(1)
      const r = (await t("request_erasure").run({})) as { structuredContent: { code: string } }
      expect(r.structuredContent.code).toBe("APPROVAL_REQUIRED")
      expect(await p.listRequests()).toEqual([])
      const yes = privacyTools({ privacy: p, subject: "u1", approve: () => undefined })
      expect(await t("withdraw_consent", yes).run({ purpose: "marketing" })).toEqual({
        withdrawn: 1,
      })
      expect(((await t("request_data_export", yes).run({})) as { kind: string }).kind).toBe(
        "export",
      )
    })
  })
}
