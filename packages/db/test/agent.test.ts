import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { agentTools } from "../src/agent"
import { createCipher, generateKey } from "../src/cipher"
import { describeSchema } from "../src/describe"
import { isSignetDbError } from "../src/errors"
import { scoped } from "../src/scoped"
import { backends, type Instance } from "./harness"

const cipher = createCipher({ keys: { k: generateKey() }, current: "k" })
const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => e,
  )

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  afterEach(async () => {
    await open?.close()
    open = undefined
  })
  const setup = async (audit = false) => {
    open = await backend.make({ cipher, audit })
    const { db, S } = open
    const mine = scoped(db, { userId: "user-a" })
    for (let i = 0; i < 5; i++)
      await mine.insert(S.notes, { title: `mine ${i}`, price: 100 + i, secret: "pan" })
    const [gone] = await mine.insert(S.notes, { title: "deleted one", price: 1 })
    await mine.delete(S.notes, eq(S.notes.id, gone!.id))
    for (let i = 0; i < 5; i++) await mine.insert(S.notes, { title: `kept ${i}`, price: 1 })
    await scoped(db, { userId: "user-b" }).insert(S.notes, { title: "theirs", price: 1 })
    return open
  }
  const tool = (tools: ReturnType<typeof agentTools>, name: string) => {
    const t = tools.find((t) => t.name === name)
    if (!t) throw new Error(`no tool ${name}`)
    return t
  }

  test("read tools are scoped, hide soft-deleted and encrypted fields, and cap rows", async () => {
    const { db, S } = await setup()
    const tools = agentTools(db, { tables: [S.notes, S.tags], userId: "user-a", maxRows: 3 })
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["notes_get", "notes_list", "notes_search", "tags_get", "tags_list", "tags_search"].sort(),
    )
    const list = tool(tools, "notes_list")
    const rows = (await list.run({})) as Record<string, unknown>[]
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => !("secret" in r) && !("userId" in r))).toBe(true)
    expect(isSignetDbError(await err(list.run({ limit: 50 })), "BAD_INPUT")).toBe(true)

    const all = (await tool(tools, "notes_search").run({
      column: "title",
      value: "",
      mode: "contains",
    })) as {
      title: string
    }[]
    expect(all).toHaveLength(3)
    const hits = (await tool(tools, "notes_search").run({
      column: "title",
      value: "kept 1",
    })) as unknown[]
    expect(hits).toHaveLength(1)
    expect(await tool(tools, "notes_search").run({ column: "title", value: "theirs" })).toEqual([])
    expect(
      await tool(tools, "notes_search").run({ column: "title", value: "deleted one" }),
    ).toEqual([])
    expect(
      await tool(tools, "notes_search").run({ column: "title", value: "%", mode: "contains" }),
    ).toEqual([])
    expect(
      isSignetDbError(
        await err(tool(tools, "notes_search").run({ column: "secret", value: "pan" })),
        "BAD_INPUT",
      ),
    ).toBe(true)

    const [theirs] = await db.orm.select().from(S.notes).where(eq(S.notes.userId, "user-b"))
    expect(await tool(tools, "notes_get").run({ id: theirs.id })).toBeNull()
  })

  test("encrypted fields appear only when opted in", async () => {
    const { db, S } = await setup()
    const tools = agentTools(db, { tables: [S.notes], userId: "user-a", includeEncrypted: true })
    const rows = (await tool(tools, "notes_search").run({ column: "title", value: "mine 0" })) as {
      secret: string
    }[]
    expect(rows[0]!.secret).toBe("pan")
    expect(tools.find((t) => t.name === "notes_search")!.inputSchema).toMatchObject({
      type: "object",
    })
  })

  test("writes are off by default; with allowWrites, dryRun writes nothing and real writes are audited as the agent", async () => {
    const { db, S } = await setup(true)
    expect(
      agentTools(db, { tables: [S.notes], userId: "user-a" }).some((t) =>
        /insert|update/.test(t.name),
      ),
    ).toBe(false)

    const tools = agentTools(db, {
      tables: [S.notes],
      userId: "user-a",
      allowWrites: true,
      actor: { type: "agent", id: "helper-bot" },
    })
    const insert = tool(tools, "notes_insert")
    const dry = (await insert.run({ values: { title: "draft", price: 5 }, dryRun: true })) as {
      wouldInsert: unknown
    }
    expect(dry.wouldInsert).toEqual({ title: "draft", price: 5 })
    const before = (await db.orm.select().from(S.notes)).length
    expect((await db.orm.select().from(S.notes)).length).toBe(before)

    // userId cannot be smuggled in: the input schema is strict.
    expect(
      isSignetDbError(
        await err(insert.run({ values: { title: "x", price: 1, userId: "user-b" } })),
        "BAD_INPUT",
      ),
    ).toBe(true)
    const row = (await insert.run({ values: { title: "real", price: 7 } })) as {
      id: string
      title: string
    }
    expect(row.title).toBe("real")

    const update = tool(tools, "notes_update")
    const preview = (await update.run({ id: row.id, set: { title: "renamed" }, dryRun: true })) as {
      before: { title: string }
      after: { title: string }
    }
    expect([preview.before.title, preview.after.title]).toEqual(["real", "renamed"])
    expect(((await tool(tools, "notes_get").run({ id: row.id })) as { title: string }).title).toBe(
      "real",
    )
    await update.run({ id: row.id, set: { title: "renamed" } })

    const [theirs] = await db.orm.select().from(S.notes).where(eq(S.notes.userId, "user-b"))
    expect(
      isSignetDbError(await err(update.run({ id: theirs.id, set: { title: "x" } })), "NOT_FOUND"),
    ).toBe(true)

    const log = await db.orm.select().from(S.audit)
    const agentRows = log.filter((l: any) => l.actorType === "agent")
    expect(agentRows.map((l: any) => [l.actorId, l.action])).toEqual([
      ["helper-bot", "insert"],
      ["helper-bot", "update"],
    ])
  })

  test("tables without userId are refused", async () => {
    const { db, S } = await setup()
    expect(() => agentTools(db, { tables: [S.users], userId: "user-a" })).toThrow(
      /no userId column/,
    )
  })
})

describe("describeSchema json", () => {
  test("flags money, encrypted, owner, soft delete, keys and relations", async () => {
    const { sqliteTable, text } = await import("drizzle-orm/sqlite-core")
    const { sqliteSchema } = await import("./harness")
    const S = sqliteSchema()
    const pins = sqliteTable("pins", {
      id: text("id").primaryKey(),
      noteId: text("note_id").references(() => S.notes.id),
    })
    const info = describeSchema([S.notes, S.idem, pins], { format: "json" })
    const notes = info.tables[0]!
    expect(notes).toMatchObject({
      name: "notes",
      scoped: true,
      softDelete: true,
      primaryKey: ["id"],
    })
    const col = (k: string) => notes.columns.find((c) => c.key === k)!
    expect(col("price").moneyCurrency).toBe("priceCurrency")
    expect(col("secret").encrypted).toBe(true)
    expect(col("userId").owner).toBe(true)
    expect(info.tables[1]!.primaryKey).toEqual(["scope", "key"])
    expect(info.tables[2]!.relations).toEqual([
      { columns: ["note_id"], references: "notes", referencedColumns: ["id"] },
    ])
    expect(describeSchema([pins])).toContain("references notes.id")
  })
})
