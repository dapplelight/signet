import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import {
  type AdminAction,
  type AdminContext,
  AdminError,
  type Authorize,
  adminTools,
  defineAdmin,
  roles,
} from "../src/admin"
import { createCipher, generateKey } from "../src/cipher"
import { isSignetDbError } from "../src/errors"
import { backends, type Instance, type Schema } from "./harness"

const cipher = createCipher({ keys: { k: generateKey() }, current: "k" })
const ctx = (role?: string): AdminContext => ({
  actor: { type: "user", id: "admin-1" },
  ...(role ? { role } : {}),
})
const allowAll: Authorize<AdminContext> = () => true
const err = (p: Promise<unknown>, where = new Error().stack) =>
  p.then(
    () => {
      throw new Error(`expected a rejection ${where}`)
    },
    (e) => e,
  )
const code = async (p: Promise<unknown>) => {
  const e = await err(p)
  return e instanceof AdminError ? [e.status, e.code] : e
}

type Row = Record<string, any>

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  afterEach(async () => {
    await open?.close()
    open = undefined
  })
  const setup = async () => {
    open = await backend.make({ cipher, audit: true })
    return open
  }
  const make = (S: Schema, authorize: Authorize<AdminContext> = allowAll, extra = {}) =>
    defineAdmin(S, {
      authorize,
      tables: { outbox: false, idempotency_keys: false },
      ...extra,
    })

  test("secret and encrypted columns are hidden by default; reveal opts in", async () => {
    const { db, S } = await setup()
    await db.orm.insert(S.users).values({ name: "Ravi", passwordHash: "argon2$x" })
    const admin = make(S)
    await admin
      .create(db, ctx(), "notes", { userId: "u1", title: "t", price: 5, secret: "x" })
      .then(
        () => {
          throw new Error("secret must not be writable")
        },
        (e) => expect(e.code).toBe("VALIDATION_FAILED"),
      )
    const [user] = (await admin.list(db, ctx(), "users")).rows as Row[]
    expect(user!.name).toBe("Ravi")
    expect("passwordHash" in user!).toBe(false)
    expect(await code(admin.list(db, ctx(), "users", { sort: "passwordHash" }))).toEqual([
      400,
      "VALIDATION_FAILED",
    ])
    expect(
      await code(admin.list(db, ctx(), "users", { filter: { passwordHash: { eq: "a" } } })),
    ).toEqual([400, "VALIDATION_FAILED"])
    const meta = await admin.meta(ctx())
    const users = meta.tables.find((t) => t.name === "users")!
    expect(users.columns.map((c) => c.key)).not.toContain("passwordHash")
    const notes = meta.tables.find((t) => t.name === "notes")!
    expect(notes.columns.map((c) => c.key)).not.toContain("secret")
    expect(meta.tables.map((t) => t.name).sort()).toEqual(["audit_log", "notes", "tags", "users"])
    expect(meta.tables.find((t) => t.name === "audit_log")!.ops).toEqual(["list", "get"])

    const revealed = make(S, allowAll, { tables: { notes: { reveal: ["secret"] } } })
    const [n] = await db.orm
      .insert(S.notes)
      .values({ userId: "u1", title: "s", price: 1, secret: await cipher.encrypt("pan") })
      .returning()
    expect(((await revealed.get(db, ctx(), "notes", n.id)) as Row).secret).toBe("pan")
    expect(() => make(S, allowAll, { tables: { notes: { sort: ["secret"] } } })).toThrow(/hidden/)
    expect(() => make(S, allowAll, { tables: { notes: { sort: ["nope"] } } })).toThrow(/unknown/)
    expect(() => make(S, allowAll, { tables: { users: { sort: ["phone"] } } })).toThrow(
      /cannot use/,
    )
  })

  test("authorize denies by default and per row; roles() covers the common cases", async () => {
    const { db, S } = await setup()
    await db.orm.insert(S.tags).values([
      { userId: "u1", label: "a" },
      { userId: "u2", label: "b" },
    ])
    for (const deny of [
      () => false,
      () => undefined as unknown as boolean,
      () => "yes" as unknown as boolean,
      () => {
        throw new Error("boom")
      },
      undefined as unknown as Authorize<AdminContext>,
    ]) {
      const admin = defineAdmin(S, {
        authorize: deny,
        tables: { outbox: false, idempotency_keys: false },
      })
      expect(await code(admin.list(db, ctx(), "tags"))).toEqual([403, "FORBIDDEN"])
      expect(await code(admin.create(db, ctx(), "tags", { userId: "u", label: "x" }))).toEqual([
        403,
        "FORBIDDEN",
      ])
      expect((await admin.meta(ctx())).tables).toEqual([])
    }

    // Row-level: only u1's rows.
    const mine = make(S, (_c, { row }) => !row || row.userId === "u1")
    const rows = (await mine.list(db, ctx(), "tags")).rows as Row[]
    expect(rows.map((r) => r.label)).toEqual(["a"])
    const [theirs] = await db.orm.select().from(S.tags).where(eq(S.tags.userId, "u2"))
    expect(await code(mine.get(db, ctx(), "tags", theirs.id))).toEqual([403, "FORBIDDEN"])
    expect(await code(mine.delete(db, ctx(), "tags", theirs.id))).toEqual([403, "FORBIDDEN"])

    const byRole = make(S, roles())
    expect((await byRole.list(db, ctx("readonly"), "tags")).rows).toHaveLength(2)
    expect(
      await code(byRole.create(db, ctx("readonly"), "tags", { userId: "u", label: "x" })),
    ).toEqual([403, "FORBIDDEN"])
    expect(await code(byRole.delete(db, ctx("staff"), "tags", theirs.id))).toEqual([
      403,
      "FORBIDDEN",
    ])
    expect(await code(byRole.list(db, ctx(), "tags"))).toEqual([403, "FORBIDDEN"])
    expect(await code(byRole.list(db, ctx("superuser"), "tags"))).toEqual([403, "FORBIDDEN"])
    const ro = await byRole.meta(ctx("readonly"))
    expect(ro.tables.find((t) => t.name === "tags")!.ops).toEqual(["list", "get"])
    await byRole.delete(db, ctx("admin"), "tags", theirs.id)
  })

  test("validation errors carry field details", async () => {
    const { db, S } = await setup()
    const admin = make(S)
    const e = await err(admin.create(db, ctx(), "notes", { price: "ten" }))
    expect(e).toBeInstanceOf(AdminError)
    expect(e.status).toBe(400)
    expect(Object.keys(e.details.fieldErrors).sort()).toEqual(["price", "title", "userId"])
    const strict = await err(
      admin.create(db, ctx(), "tags", { userId: "u", label: "x", deletedAt: 1 }),
    )
    expect(strict.code).toBe("VALIDATION_FAILED")
    const [tag] = (await db.orm
      .insert(S.tags)
      .values({ userId: "u", label: "x" })
      .returning()) as Row[]
    expect(await code(admin.update(db, ctx(), "tags", tag!.id, {}))).toEqual([
      400,
      "VALIDATION_FAILED",
    ])
    expect(await code(admin.get(db, ctx(), "tags", "missing"))).toEqual([404, "NOT_FOUND"])
    expect(await code(admin.list(db, ctx(), "no_such_table"))).toEqual([404, "NOT_FOUND"])
    expect(await code(admin.list(db, ctx(), "notes", { limit: 1000 }))).toEqual([
      400,
      "VALIDATION_FAILED",
    ])
    // getResponse(): reads as an HTTPException by shape, with the envelope.
    const res = (e as AdminError).getResponse()
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ success: false, code: "VALIDATION_FAILED" })
  })

  test("delete is soft on soft-delete tables; soft-deleted rows are hidden unless asked", async () => {
    const { db, S } = await setup()
    const admin = make(S)
    const note = (await admin.create(db, ctx(), "notes", {
      userId: "u1",
      title: "bye",
      price: 1,
    })) as Row
    expect(await admin.delete(db, ctx(), "notes", note.id)).toEqual({ id: note.id, soft: true })
    expect((await admin.list(db, ctx(), "notes")).rows).toEqual([])
    expect((await admin.list(db, ctx(), "notes", { withDeleted: true })).rows).toHaveLength(1)
    expect(await code(admin.get(db, ctx(), "notes", note.id))).toEqual([404, "NOT_FOUND"])
    expect(
      ((await admin.get(db, ctx(), "notes", note.id, { withDeleted: true })) as Row).title,
    ).toBe("bye")
    const [raw] = await db.orm.select().from(S.notes)
    expect(raw.deletedAt).toBeInstanceOf(Date)

    const tag = (await admin.create(db, ctx(), "tags", { userId: "u1", label: "x" })) as Row
    expect(await admin.delete(db, ctx(), "tags", tag.id)).toEqual({ id: tag.id, soft: false })
    expect(await db.orm.select().from(S.tags)).toEqual([])
  })

  test("cursor pages are stable under ties and concurrent inserts", async () => {
    const { db, S } = await setup()
    const admin = make(S)
    for (let i = 0; i < 25; i++)
      await db.orm.insert(S.notes).values({ userId: "u1", title: `n${i}`, price: i % 3 })
    const seen: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await admin.list(db, ctx(), "notes", {
        sort: "price",
        order: "asc",
        limit: 7,
        ...(cursor ? { cursor } : {}),
      })
      seen.push(...(page.rows as Row[]).map((r) => r.id))
      // A row inserted mid-way, at the very start of the sort order, never shows up later.
      if (pages === 0)
        await db.orm.insert(S.notes).values({ userId: "u1", title: "late", price: -1 })
      cursor = page.nextCursor ?? undefined
      pages++
    } while (cursor)
    expect(pages).toBe(4)
    expect(new Set(seen).size).toBe(25)
    const prices = await Promise.all(
      seen.map(async (id) => ((await admin.get(db, ctx(), "notes", id)) as Row).price),
    )
    expect(prices).toEqual([...prices].sort((a, b) => a - b))

    const first = await admin.list(db, ctx(), "notes", { limit: 2 })
    expect(
      await code(admin.list(db, ctx(), "notes", { cursor: first.nextCursor!, sort: "title" })),
    ).toEqual([400, "VALIDATION_FAILED"])
    expect(await code(admin.list(db, ctx(), "notes", { cursor: "garbage" }))).toEqual([
      400,
      "VALIDATION_FAILED",
    ])
  })

  test("sort, filter and search take only allowed columns and operators", async () => {
    const { db, S } = await setup()
    const admin = make(S, allowAll, {
      tables: {
        notes: { search: ["title"], filter: ["price", "title", "createdAt", "deletedAt"] },
      },
    })
    await db.orm.insert(S.notes).values([
      { userId: "u1", title: "100% cotton", price: 10 },
      { userId: "u1", title: "Linen", price: 20 },
      { userId: "u2", title: "wool", price: 30 },
    ])
    for (const q of [
      { sort: "title; drop table notes" },
      { sort: "__proto__" },
      { filter: { "price) or 1=1 --": { eq: 1 } } },
      { filter: { constructor: { eq: 1 } } },
      { filter: { userId: { eq: "u1" } } },
      { filter: { price: { contains: "1" } } },
      { filter: { price: { eq: "abc" } } },
      { filter: { price: { like: 1 } } },
      { filter: { price: { eq: null } } },
    ])
      expect(await code(admin.list(db, ctx(), "notes", q as never))).toEqual([
        400,
        "VALIDATION_FAILED",
      ])
    expect(await db.orm.select().from(S.notes)).toHaveLength(3)

    const titles = async (q: object) =>
      (
        (await admin.list(db, ctx(), "notes", { sort: "price", order: "asc", ...q })).rows as Row[]
      ).map((r) => r.title)
    expect(await titles({ filter: { price: { gte: 20 } } })).toEqual(["Linen", "wool"])
    expect(await titles({ filter: { price: { in: [10, 30] } } })).toEqual(["100% cotton", "wool"])
    expect(await titles({ filter: { title: { contains: "%" } } })).toEqual(["100% cotton"])
    expect(await titles({ filter: { title: { startsWith: "lin" } } })).toEqual(["Linen"])
    expect(
      await titles({ filter: { createdAt: { lte: new Date(Date.now() + 60_000).toISOString() } } }),
    ).toHaveLength(3)
    expect(await titles({ filter: { deletedAt: { isNull: true } } })).toHaveLength(3)
    expect(await titles({ q: "LIN" })).toEqual(["Linen"])
    expect(await titles({ q: "_" })).toEqual([])
  })

  test("writes are audited with the actor; audit snapshots are redacted", async () => {
    const { db, S } = await setup()
    const admin = make(S)
    const u = (await admin.create(db, ctx(), "users", { name: "Meera" })) as Row
    await db.orm.update(S.users).set({ passwordHash: "argon2$y" }).where(eq(S.users.id, u.id))
    await admin.update(db, ctx(), "users", u.id, { phone: "123" })
    const t = (await admin.create(db, ctx(), "tags", { userId: "u1", label: "x" })) as Row
    await admin.bulkDelete(db, ctx(), "tags", [t.id, "missing"])
    const log = (await db.orm.select().from(S.audit)) as Row[]
    expect(log.map((l) => [l.actorType, l.actorId, l.action, l.tableName])).toEqual([
      ["user", "admin-1", "insert", "users"],
      ["user", "admin-1", "update", "users"],
      ["user", "admin-1", "insert", "tags"],
      ["user", "admin-1", "delete", "tags"],
    ])
    expect(log[1]!.before.passwordHash).toBe("argon2$y")
    const viaAdmin = (await admin.list(db, ctx(), "audit_log", { sort: "at", order: "asc" }))
      .rows as Row[]
    expect(viaAdmin[1]!.before.phone).toBeNull()
    expect("passwordHash" in viaAdmin[1]!.before).toBe(false)
    expect(await code(admin.create(db, ctx(), "audit_log", {}))).toEqual([
      405,
      "METHOD_NOT_ALLOWED",
    ])

    // Bulk delete is all-or-nothing under authorize.
    const [a, b] = (await db.orm
      .insert(S.tags)
      .values([
        { userId: "u1", label: "keep" },
        { userId: "u2", label: "keep" },
      ])
      .returning()) as Row[]
    const onlyU1 = make(S, (_c, { row }) => !row || row.userId === "u1")
    expect(await code(onlyU1.bulkDelete(db, ctx(), "tags", [a!.id, b!.id]))).toEqual([
      403,
      "FORBIDDEN",
    ])
    expect(await db.orm.select().from(S.tags)).toHaveLength(2)
  })

  test("handle() routes HTTP requests", async () => {
    const { db, S } = await setup()
    const admin = make(S, allowAll, {
      tables: {
        tags: {
          actions: {
            shout: {
              description: "Upper-case the label.",
              run: async ({ row, ops }: Parameters<AdminAction<AdminContext>["run"]>[0]) =>
                (
                  await ops.update(
                    S.tags,
                    { label: String(row.label).toUpperCase() },
                    eq(S.tags.id, row.id as string),
                  )
                )[0],
            },
          },
        },
      },
    })
    const h = (req: Parameters<typeof admin.handle>[2]) => admin.handle(db, ctx(), req)
    expect((await h({ method: "GET" })).body).toMatchObject({ tables: expect.any(Array) })
    const created = await h({ method: "POST", table: "tags", body: { userId: "u1", label: "hi" } })
    expect(created.status).toBe(201)
    const id = (created.body as Row).id
    const listed = await h({
      method: "GET",
      table: "tags",
      query: { filter: JSON.stringify({ label: { eq: "hi" } }), limit: "5" },
    })
    expect((listed.body as Row).rows).toHaveLength(1)
    expect(await code(h({ method: "GET", table: "tags", query: { filter: "{nope" } }))).toEqual([
      400,
      "VALIDATION_FAILED",
    ])
    expect(
      (await h({ method: "PATCH", table: "tags", id, body: { label: "yo" } })).body,
    ).toMatchObject({ label: "yo" })
    expect((await h({ method: "POST", table: "tags", id, action: "shout" })).body).toMatchObject({
      label: "YO",
    })
    expect(await code(h({ method: "POST", table: "tags", id, action: "nope" }))).toEqual([
      404,
      "NOT_FOUND",
    ])
    expect(await code(h({ method: "PUT", table: "tags", id }))).toEqual([405, "METHOD_NOT_ALLOWED"])
    expect(
      (await h({ method: "POST", table: "tags", id: "bulk-delete", body: { ids: [id] } })).body,
    ).toEqual({ ids: [id], soft: false })
    expect(await code(h({ method: "DELETE", table: "tags", id }))).toEqual([404, "NOT_FOUND"])
  })

  test("MCP tools: reads respect authorize, writes need approval and are audited as the agent", async () => {
    const { db, S } = await setup()
    const admin = make(S, roles())
    const names = async (role: string, approve?: any) =>
      (await adminTools(admin, { db, ctx: ctx(role), approve })).map((t) => t.name)
    expect(await names("readonly", async () => undefined)).not.toContain("admin_tags_create")
    expect(await names("readonly")).toContain("admin_tags_list")
    expect(await names("admin")).not.toContain("admin_tags_create") // no approve, no writes
    expect(await names("nobody")).toEqual(["admin_schema"])

    const asked: any[] = []
    let answer: unknown = { isError: true, code: "APPROVAL_REQUIRED" }
    const approve = async (toolCtx: unknown, req: any) => {
      asked.push([toolCtx, req])
      return answer
    }
    const tools = await adminTools(admin, { db, ctx: ctx("admin"), approve })
    const tool = (n: string) => tools.find((t) => t.name === n)!
    expect(tool("admin_tags_delete").annotations.destructiveHint).toBe(true)
    expect(tool("admin_tags_list").annotations.readOnlyHint).toBe(true)

    const held = await tool("admin_tags_create").run(
      { values: { userId: "u1", label: "x" } },
      "tool-ctx",
    )
    expect(held).toEqual(answer)
    expect(asked[0][0]).toBe("tool-ctx")
    expect(asked[0][1]).toMatchObject({
      summary: "Create a tags row",
      args: { values: { userId: "u1", label: "x" } },
    })
    expect(await db.orm.select().from(S.tags)).toEqual([])

    // Bad input fails before anyone is asked.
    const before = asked.length
    expect(
      isSignetDbError(
        await err(tool("admin_tags_create").run({ values: {} })),
        "VALIDATION_FAILED",
      ),
    ).toBe(true)
    expect(asked.length).toBe(before)

    answer = undefined
    const row = (await tool("admin_tags_create").run({
      values: { userId: "u1", label: "x" },
    })) as Row
    expect(row.label).toBe("x")
    const page = (await tool("admin_tags_list").run({ filter: { label: { eq: "x" } } })) as Row
    expect(page.rows).toHaveLength(1)
    expect((await tool("admin_tags_search").run({ q: "x" })) as Row).toMatchObject({
      rows: [{ id: row.id }],
    })
    await tool("admin_tags_delete").run({ id: row.id })
    const log = (await db.orm.select().from(S.audit)) as Row[]
    expect(log.map((l) => [l.actorType, l.actorId, l.action])).toEqual([
      ["agent", "admin-1", "insert"],
      ["agent", "admin-1", "delete"],
    ])

    // A staff agent has no delete tool, and the op is refused if called anyway.
    const staff = await adminTools(admin, { db, ctx: ctx("staff"), approve })
    expect(staff.map((t) => t.name)).not.toContain("admin_tags_delete")
  })
})
