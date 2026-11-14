import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { createCipher, generateKey, isCiphertext } from "../src/cipher"
import { isSignetDbError } from "../src/errors"
import { pruneIdempotency, withIdempotency } from "../src/idempotency"
import { drainOutbox, enqueue, type OutboxMessage, pruneOutbox } from "../src/outbox"
import { scoped } from "../src/scoped"
import { toZod } from "../src/zod"
import { backends, type Instance, pgSchema, sqliteSchema } from "./harness"

describe("toZod", () => {
  for (const [name, S] of [
    ["sqlite", sqliteSchema()],
    ["pg", pgSchema()],
  ] as const) {
    test(`${name}: insert strips managed keys, validates money, coerces dates`, () => {
      const insert = toZod(S.notes, { mode: "insert" })
      const ok = insert.parse({
        title: "t",
        price: 1999,
        secret: "plain",
        userId: "someone-else",
        id: "x",
        createdAt: "2020-01-01",
      })
      expect(ok).toEqual({ title: "t", price: 1999, secret: "plain" })
      expect(insert.safeParse({ price: 1 }).success).toBe(false) // title missing
      expect(insert.safeParse({ title: "t", price: 19.99 }).success).toBe(false)
      expect(insert.safeParse({ title: "t", price: 1, priceCurrency: "inr" }).success).toBe(false)
      expect(insert.safeParse({ title: "t", price: 1, priceCurrency: "USD" }).success).toBe(true)

      const update = toZod(S.notes, { mode: "update" })
      expect(update.parse({ title: "new" })).toEqual({ title: "new" })
      expect(update.safeParse({ title: null }).success).toBe(false)
      expect(update.parse({ secret: null })).toEqual({ secret: null })

      const select = toZod(S.notes, { mode: "select" })
      const row = select.parse({
        id: "a",
        userId: "u",
        title: "t",
        secret: null,
        price: 1,
        priceCurrency: "INR",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      })
      expect(row.userId).toBe("u")
      expect(select.safeParse({ ...row, createdAt: "2020-01-01" }).success).toBe(false)

      const keep = toZod(S.notes, { mode: "insert", keep: ["userId"] })
      expect(keep.parse({ title: "t", price: 1, userId: "u" }).userId).toBe("u")
      expect(
        toZod(S.audit, { mode: "insert" }).parse({
          actorType: "user",
          actorId: "u",
          action: "x",
          tableName: "t",
          before: { a: 1 },
        }).before,
      ).toEqual({ a: 1 })
    })
  }
})

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  const make = async () => (open = await backend.make({}))
  afterEach(async () => {
    await open?.close()
    open = undefined
  })

  test("outbox: enqueue in the same batch as the change; drain delivers once and marks sent", async () => {
    const { db, S } = await make()
    await db.batch([
      (tx: any) => tx.insert(S.tags).values({ userId: "u", label: "a" }),
      enqueue(db, "tag.created", { label: "a" }),
      enqueue(db, "tag.created", { label: "b" }),
    ])
    const got: OutboxMessage[] = []
    expect(await drainOutbox(db, { send: (m) => void got.push(m) })).toEqual({
      sent: 2,
      failed: 0,
      dead: 0,
    })
    expect(got.map((m) => m.payload)).toEqual([{ label: "a" }, { label: "b" }])
    expect(got[0]!.topic).toBe("tag.created")
    expect(await drainOutbox(db, { send: (m) => void got.push(m) })).toEqual({
      sent: 0,
      failed: 0,
      dead: 0,
    })
    expect(await pruneOutbox(db, -1000)).toBe(2)
  })

  test("outbox: a failed batch writes neither the change nor the message", async () => {
    const { db, S } = await make()
    await expect(
      db.batch([
        enqueue(db, "tag.created", {}),
        (tx: any) => tx.insert(S.tags).values({ userId: null as never, label: "a" }),
      ]),
    ).rejects.toThrow()
    expect(await db.orm.select().from(S.outbox)).toEqual([])
  })

  test("outbox: failures retry with backoff, then go dead", async () => {
    const { db, S } = await make()
    await db.batch([enqueue(db, "t", { n: 1 })])
    const failing = {
      send: () => {
        throw new Error("queue down")
      },
    }
    const opts = { maxAttempts: 2, backoff: () => 0 }
    expect(await drainOutbox(db, failing, opts)).toEqual({ sent: 0, failed: 1, dead: 0 })
    const [row] = await db.orm.select().from(S.outbox)
    expect(row.attempts).toBe(1)
    expect(row.lastError).toBe("queue down")
    expect(await drainOutbox(db, failing, opts)).toEqual({ sent: 0, failed: 0, dead: 1 })
    expect((await db.orm.select().from(S.outbox))[0].status).toBe("dead")
  })

  test("outbox: a claimed row is leased away from a second drainer", async () => {
    const { db } = await make()
    await db.batch([enqueue(db, "t", {})])
    let inner: unknown
    await drainOutbox(db, {
      send: async () => {
        inner = await drainOutbox(db, { send: () => {} })
      },
    })
    expect(inner).toEqual({ sent: 0, failed: 0, dead: 0 })
  })

  test("idempotency: runs once, replays the stored result, scopes keys", async () => {
    const { db } = await make()
    let runs = 0
    const op = async () => ({ n: ++runs })
    expect(await withIdempotency(db, "k1", "user-a", op)).toEqual({ n: 1 })
    expect(await withIdempotency(db, "k1", "user-a", op)).toEqual({ n: 1 })
    expect(await withIdempotency(db, "k1", "user-b", op)).toEqual({ n: 2 })
    expect(runs).toBe(2)
  })

  test("idempotency: with a cipher the stored result is encrypted and still replays", async () => {
    const cipher = createCipher({ keys: { k: generateKey() }, current: "k" })
    open = await backend.make({ cipher })
    const { db, S } = open
    const op = () =>
      scoped(db, { userId: "u" }).insert(S.notes, { title: "t", price: 1, secret: "ABCDE1234F" })
    const first = await withIdempotency(db, "k1", "u", op)
    const [row] = await db.orm.select().from(S.idem)
    expect(JSON.stringify(row.result)).not.toContain("ABCDE1234F")
    expect(isCiphertext(row.result)).toBe(true)
    const replay = await withIdempotency(db, "k1", "u", async () => [] as typeof first)
    expect(replay[0]?.secret).toBe("ABCDE1234F")
    expect(replay[0]?.id).toBe(first[0]?.id)
  })

  test("idempotency: rejects a concurrent duplicate; releases the key when fn throws", async () => {
    const { db } = await make()
    let release!: () => void
    const slow = withIdempotency(
      db,
      "k",
      "s",
      () => new Promise<string>((r) => (release = () => r("done"))),
    )
    await Bun.sleep(20)
    const dup = await withIdempotency(db, "k", "s", async () => "again").catch((e) => e)
    expect(isSignetDbError(dup, "IDEMPOTENCY_IN_FLIGHT")).toBe(true)
    release()
    expect(await slow).toBe("done")

    await expect(
      withIdempotency(db, "x", "s", async () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom")
    expect(await withIdempotency(db, "x", "s", async () => "second try")).toBe("second try")
  })

  test("idempotency: expired keys run again and are pruned", async () => {
    const { db, S } = await make()
    let runs = 0
    await withIdempotency(db, "k", "s", async () => ++runs, { ttlMs: -1 })
    expect(await withIdempotency(db, "k", "s", async () => ++runs, { ttlMs: -1 })).toBe(2)
    expect(await pruneIdempotency(db)).toBe(1)
    expect(await db.orm.select().from(S.idem).where(eq(S.idem.key, "k"))).toEqual([])
  })
})
