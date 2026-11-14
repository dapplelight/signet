import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { createCipher, generateKey, isCiphertext } from "../src/cipher"
import { isSignetDbError } from "../src/errors"
import { audited, scoped } from "../src/scoped"
import { deleteUser, exportUser } from "../src/user-data"
import { backends, type Instance } from "./harness"

const cipher = createCipher({ keys: { k1: generateKey() }, current: "k1" })

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  const make = async (o: Parameters<typeof backend.make>[0] = { cipher }) =>
    (open = await backend.make(o))
  afterEach(async () => {
    await open?.close()
    open = undefined
  })

  test("scoped reads, updates and deletes only see the user's rows", async () => {
    const { db, S } = await make()
    const a = scoped(db, { userId: "user-a" })
    const b = scoped(db, { userId: "user-b" })
    const [note] = await a.insert(S.notes, { title: "a's note", price: 1999 })
    await b.insert(S.notes, { title: "b's note", price: 500 })

    expect(note!.userId).toBe("user-a")
    expect(note!.priceCurrency).toBe("INR")
    expect(note!.id).toHaveLength(26)
    expect((await a.select(S.notes)).map((n) => n.title)).toEqual(["a's note"])
    expect(await b.update(S.notes, { title: "hijacked" }, eq(S.notes.id, note!.id))).toEqual([])
    expect(await b.delete(S.notes, eq(S.notes.id, note!.id), { hard: true })).toEqual([])
    expect((await a.select(S.notes))[0]!.title).toBe("a's note")
  })

  test("scoped refuses cross-user writes", async () => {
    const { db, S } = await make()
    const a = scoped(db, { userId: "user-a" })
    const insert = a.insert(S.notes, { title: "x", price: 1, userId: "user-b" } as never)
    expect(insert).rejects.toThrow(/not the scope's/)
    const update = a.update(S.notes, { userId: "user-b" } as never)
    await update.catch((e) => expect(isSignetDbError(e, "CROSS_USER_WRITE")).toBe(true))
    await expect(update).rejects.toThrow()
  })

  test("timestamps: updatedAt moves on update, createdAt does not", async () => {
    const { db, S } = await make()
    const a = scoped(db, { userId: "user-a" })
    const [n] = await a.insert(S.notes, { title: "t", price: 1 })
    await Bun.sleep(5)
    const [u] = await a.update(S.notes, { title: "t2" }, eq(S.notes.id, n!.id))
    expect(u!.createdAt.getTime()).toBe(n!.createdAt.getTime())
    expect(u!.updatedAt.getTime()).toBeGreaterThan(n!.updatedAt.getTime())
  })

  test("soft delete hides rows until withDeleted; hard delete removes them", async () => {
    const { db, S } = await make()
    const a = scoped(db, { userId: "user-a" })
    const [n] = await a.insert(S.notes, { title: "gone", price: 1 })
    const [d] = await a.delete(S.notes, eq(S.notes.id, n!.id))
    expect(d!.deletedAt).toBeInstanceOf(Date)
    expect(await a.select(S.notes)).toEqual([])
    expect(await a.select(S.notes, undefined, { withDeleted: true })).toHaveLength(1)
    await a.delete(S.notes, eq(S.notes.id, n!.id), { hard: true, withDeleted: true })
    expect(await a.select(S.notes, undefined, { withDeleted: true })).toEqual([])
  })

  test("encrypted columns: ciphertext at rest, plaintext through scoped, plaintext writes refused", async () => {
    const { db, S } = await make()
    const a = scoped(db, { userId: "user-a" })
    const [n] = await a.insert(S.notes, { title: "t", price: 1, secret: "PAN ABCDE1234F" })
    expect(n!.secret).toBe("PAN ABCDE1234F")
    const [raw] = await db.orm.select().from(S.notes)
    expect(isCiphertext(raw.secret)).toBe(true)
    expect(raw.secret).not.toContain("ABCDE")
    expect((await a.select(S.notes))[0]!.secret).toBe("PAN ABCDE1234F")

    expect(() =>
      db.orm.insert(S.notes).values({ userId: "u", title: "t", price: 1, secret: "plain" }).toSQL(),
    ).toThrow(/plaintext/)
  })

  test("encrypted columns fail closed: a wrong key reads as null", async () => {
    const { db, S, exec } = await make()
    await scoped(db, { userId: "user-a" }).insert(S.notes, { title: "t", price: 1, secret: "s" })
    const paths: string[][] = []
    const other = createCipher({
      keys: { k1: generateKey() },
      current: "k1",
      onUndecrypted: (i) => paths.push(i.paths),
    })
    const wrong = { ...db, cipher: other }
    expect((await scoped(wrong, { userId: "user-a" }).select(S.notes))[0]!.secret).toBeNull()
    expect(paths).toEqual([["0.secret"]])
    void exec
  })

  test("audited writes who/what/when/before/after, with ciphertext only", async () => {
    const { db, S } = await make({ cipher, audit: true })
    const a = audited(scoped(db, { userId: "user-a" }))
    const [n] = await a.insert(S.notes, { title: "v1", price: 100, secret: "hidden" })
    await a.update(S.notes, { title: "v2" }, eq(S.notes.id, n!.id))
    await a.delete(S.notes, eq(S.notes.id, n!.id))
    const admin = audited(db, { actor: { type: "agent", id: "cleanup-bot" } })
    await admin.delete(S.tags, eq(S.tags.label, "none"))

    const log = await db.orm.select().from(S.audit).orderBy(S.audit.id)
    expect(log.map((l: any) => l.action)).toEqual(["insert", "update", "delete"])
    expect(log.every((l: any) => l.actorType === "user" && l.actorId === "user-a")).toBe(true)
    expect(log.every((l: any) => l.rowId === n!.id && l.tableName === "notes")).toBe(true)
    expect(log[0].before).toBeNull()
    expect(log[1].before.title).toBe("v1")
    expect(log[1].after.title).toBe("v2")
    expect(log[2].after.deletedAt).not.toBeNull()
    expect(JSON.stringify(log)).not.toContain("hidden")
  })

  test("audited needs an audit table and an actor", async () => {
    const { db } = await make()
    expect(() => audited(scoped(db, { userId: "u" }))).toThrow(/audit table/)
  })

  test("unscoped updates and deletes need a where clause", async () => {
    const { db, S } = await make({ cipher, audit: true })
    const admin = audited(db, { actor: { type: "system", id: "job" } })
    expect(admin.delete(S.tags)).rejects.toThrow(/where clause/)
  })

  test("exportUser returns all of a user's rows, decrypted; deleteUser removes them atomically with an audit entry", async () => {
    const { db, S } = await make({ cipher, audit: true })
    const [user] = await db.orm.insert(S.users).values({ name: "Asha Verma" }).returning()
    const uid = user.id as string
    const s = scoped(db, { userId: uid })
    await s.insert(S.notes, [
      { title: "one", price: 1, secret: "s1" },
      { title: "two", price: 2 },
    ])
    await s.delete(S.notes, eq(S.notes.title, "two"))
    await s.insert(S.tags, { label: "home" })
    await scoped(db, { userId: "someone-else" }).insert(S.tags, { label: "work" })

    const tables = [S.notes, S.tags, [S.users, S.users.id]] as const
    const out = await exportUser(db, uid, tables)
    expect(out.notes!.map((n) => n.title).sort()).toEqual(["one", "two"])
    expect(out.notes!.find((n) => n.title === "one")!.secret).toBe("s1")
    expect(out.users!).toHaveLength(1)
    expect(JSON.parse(JSON.stringify(out)).tags[0].label).toBe("home")

    const counts = await deleteUser(db, uid, tables)
    expect(counts).toEqual({ notes: 2, tags: 1, users: 1 })
    expect(await exportUser(db, uid, tables)).toEqual({ notes: [], tags: [], users: [] })
    expect(await db.orm.select().from(S.tags)).toHaveLength(1)
    const [entry] = await db.orm.select().from(S.audit).where(eq(S.audit.action, "delete_user"))
    expect(entry.before).toEqual(counts)
    expect(entry.rowId).toBe(uid)
  })

  test("deleteUser rolls back every table if a later statement fails", async () => {
    const { db, S, exec } = await make()
    if (db.dialect === "sqlite") await exec("pragma foreign_keys = on")
    const s = scoped(db, { userId: "u1" })
    await s.insert(S.notes, { title: "keep", price: 1 })
    const [tag] = await s.insert(S.tags, { label: "keep" })
    // A row outside the user's data still points at the tag, so deleting tags fails.
    await exec(`create table pins (id text primary key, tag_id text not null references tags(id))`)
    await exec(`insert into pins (id, tag_id) values ('p1', '${tag!.id}')`)
    await expect(deleteUser(db, "u1", [S.notes, S.tags])).rejects.toThrow()
    expect(await s.select(S.notes)).toHaveLength(1)
    expect(await s.select(S.tags)).toHaveLength(1)
  })
})
