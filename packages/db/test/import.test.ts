import { afterEach, describe, expect, test } from "bun:test"
import { z } from "zod"
import { isSignetDbError } from "../src/errors"
import { bulkInsert } from "../src/import"
import { audited, scoped } from "../src/scoped"
import { backends, type Instance } from "./harness"

describe.each(backends)("bulkInsert on $name", (backend) => {
  let open: Instance | undefined
  const make = async (o: Parameters<typeof backend.make>[0] = {}) => (open = await backend.make(o))
  afterEach(async () => {
    await open?.close()
    open = undefined
  })

  const tags = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => ({ id: `t${from + i}`, label: `tag ${from + i}` }))

  test("inserts in chunks, sets the owner, and a second run skips everything", async () => {
    const { db, S } = await make()
    const a = scoped(db, { userId: "user-a" })
    const first = await bulkInsert(a, S.tags, tags(7), { key: "id", chunkSize: 3 })
    expect(first).toEqual({ inserted: 7, skipped: 0, errors: [] })
    const rows = await a.select(S.tags)
    expect(rows).toHaveLength(7)
    expect(rows.every((r) => r.userId === "user-a")).toBe(true)

    const again = await bulkInsert(a, S.tags, tags(9), { key: "id", chunkSize: 3 })
    expect(again).toEqual({ inserted: 2, skipped: 7, errors: [] })
    expect(await a.select(S.tags)).toHaveLength(9)
  })

  test("reports invalid rows by index and field, imports the rest", async () => {
    const { db, S } = await make()
    const a = scoped(db, { userId: "user-a" })
    const report = await bulkInsert(
      a,
      S.tags,
      [{ id: "t1", label: "ok" }, { id: "t2" }, { label: "no id" }, { id: "t1", label: "dup" }],
      { key: "id" },
    )
    expect(report.inserted).toBe(1)
    expect(report.skipped).toBe(1) // t1 repeated in the same file
    expect(report.errors.map((e) => [e.row, e.field])).toEqual([
      [1, "label"],
      [2, "id"],
    ])
  })

  test("a custom schema shapes rows; scope fields in the input are stripped", async () => {
    const { db, S } = await make()
    const a = scoped(db, { userId: "user-a" })
    const schema = z.object({ id: z.string(), label: z.string().trim().toLowerCase() })
    const report = await bulkInsert(a, S.tags, [{ id: "x1", label: "  LOUD ", userId: "user-b" }], {
      key: "id",
      schema,
    })
    expect(report).toEqual({ inserted: 1, skipped: 0, errors: [] })
    const [row] = await a.select(S.tags)
    expect(row?.label).toBe("loud")
    expect(row?.userId).toBe("user-a")
  })

  test("rows the database refuses are found one by one, the chunk's others still go in", async () => {
    const { db, S } = await make()
    await scoped(db, { userId: "user-b" }).insert(S.tags, { id: "t1", label: "b's" })
    const a = scoped(db, { userId: "user-a" })
    // user-a cannot see b's t1, so it is not skipped; the primary key refuses it.
    const report = await bulkInsert(a, S.tags, tags(3), { key: "id", chunkSize: 10 })
    expect(report.inserted).toBe(2)
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]?.row).toBe(1)
    expect((await a.select(S.tags)).map((r) => r.id).sort()).toEqual(["t0", "t2"])
  })

  test("goes through audited(): every inserted row is in the audit log", async () => {
    const { db, S } = await make({ audit: true })
    const a = audited(scoped(db, { userId: "user-a" }))
    await bulkInsert(a, S.tags, tags(4), { key: "id", chunkSize: 2 })
    const log = (await (db.orm as any).select().from(S.audit)) as { action: string }[]
    expect(log.filter((l) => l.action === "insert")).toHaveLength(4)
  })

  test("an unknown key column is a config error", async () => {
    const { db, S } = await make()
    const err = await bulkInsert(scoped(db, { userId: "u" }), S.tags, [], { key: "nope" }).catch(
      (e: unknown) => e,
    )
    expect(isSignetDbError(err, "UNKNOWN_KEY")).toBe(true)
  })
})
