import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { createCipher, generateKey, isCiphertext } from "../src/cipher"
import type { SignetDb } from "../src/db"
import { describeSchema } from "../src/describe"
import { isSignetDbError } from "../src/errors"
import { idTime, newId } from "../src/id"
import { checkMigrationSql } from "../src/migrations/check"
import { addMoney, compareMoney, formatMoney, moneyOf, subtractMoney, sumMoney } from "../src/money"
import { defineQuery } from "../src/query"
import { scoped } from "../src/scoped"
import { seed } from "../src/seed"
import { createDb } from "../src/sqlite"
import { ddl, pgSchema, sqliteSchema } from "./harness"

describe("newId", () => {
  test("26 chars, time-ordered, monotonic within a millisecond, decodes its time", () => {
    const t = Date.UTC(2026, 0, 2, 3, 4, 5, 6)
    const ids = [newId(t), newId(t), newId(t), newId(t + 1), newId(t + 1000)]
    expect(ids.every((i) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(i))).toBe(true)
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
    expect(idTime(ids[0]!).getTime()).toBe(t)
    expect(() => idTime("!!")).toThrow()
  })
})

describe("money", () => {
  const inr = (amount: number) => ({ amount, currency: "INR" })
  test("adds, subtracts, sums and compares in integer minor units", () => {
    expect(addMoney(inr(10), inr(20))).toEqual(inr(30))
    expect(subtractMoney(inr(10), inr(25))).toEqual(inr(-15))
    expect(sumMoney([inr(1), inr(2), inr(3)])).toEqual(inr(6))
    expect(sumMoney([], "INR")).toEqual(inr(0))
    expect(compareMoney(inr(5), inr(7))).toBe(-1)
    expect(moneyOf({ price: 1999, priceCurrency: "INR" }, "price")).toEqual(inr(1999))
  })
  test("refuses floats and mixed currencies", () => {
    expect(() => addMoney(inr(0.1), inr(0.2))).toThrow(/minor units/)
    try {
      addMoney(inr(1), { amount: 1, currency: "USD" })
      throw new Error("no throw")
    } catch (e) {
      expect(isSignetDbError(e, "CURRENCY_MISMATCH")).toBe(true)
    }
  })
  test("formats exactly, per currency exponent", () => {
    expect(formatMoney(inr(123456789))).toBe("₹12,34,567.89")
    expect(formatMoney(inr(-5))).toBe("-₹0.05")
    expect(formatMoney({ amount: 1500, currency: "JPY" }, "en-US")).toBe("¥1,500")
    expect(formatMoney({ amount: 1234, currency: "BHD" }, "en-US")).toMatch(/^BHD\s1\.234$/)
    // 2^53 - 1 paise: a float division would round the last digit.
    expect(formatMoney(inr(9007199254740991), "en-US")).toBe("₹90,071,992,547,409.91")
  })
})

describe("cipher", () => {
  test("round-trips, stores the key id, rotates, and reports stale keys", async () => {
    const old = generateKey()
    const v1 = createCipher({ keys: { k1: old }, current: "k1" })
    const ct = await v1.encrypt("secret")
    expect(isCiphertext(ct)).toBe(true)
    expect(v1.keyIdOf(ct)).toBe("k1")

    const stale: string[] = []
    const v2 = createCipher({
      keys: { k1: old, k2: generateKey() },
      current: "k2",
      onStaleKey: ({ keyId }) => stale.push(keyId),
    })
    expect(await v2.decrypt(ct)).toBe("secret")
    expect(stale).toEqual(["k1"])
    const rotated = await v2.rotate(ct)
    expect(v2.keyIdOf(rotated)).toBe("k2")
    expect(await v2.rotate(rotated)).toBe(rotated)
    expect(v1.decrypt(rotated)).rejects.toThrow(/not in keys/)
  })
  test("rejects tampering and bad config", async () => {
    const c = createCipher({ keys: { k1: generateKey() }, current: "k1" })
    const ct = await c.encrypt("x")
    const tampered = `${ct.slice(0, -2)}${ct.endsWith("A") ? "B" : "A"}=`
    expect(c.decrypt(tampered)).rejects.toThrow()
    expect(() => createCipher({ keys: { k1: generateKey() }, current: "k9" })).toThrow(/current/)
  })
})

describe("seed", () => {
  const S = sqliteSchema()
  test("deterministic, realistic by column name, skips defaults", () => {
    const a = seed(S.users, 5, undefined, { seed: 42 })
    expect(seed(S.users, 5, undefined, { seed: 42 })).toEqual(a)
    expect(seed(S.users, 5, undefined, { seed: 43 })).not.toEqual(a)
    for (const u of a) {
      expect(u.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
      expect(u.phone).toMatch(/^\+91[6-9]\d{9}$/)
      expect(u.pinCode).toMatch(/^[1-8]\d{5}$/)
      expect(u.id).toBeUndefined()
    }
  })
  test("overrides, money and encrypted columns, and inserts through scoped", async () => {
    const rows = seed(S.notes, 3, (i) => ({ title: `note ${i}` }))
    expect(rows.map((r) => r.title)).toEqual(["note 0", "note 1", "note 2"])
    expect(rows.every((r) => Number.isInteger(r.price) && r.priceCurrency === undefined)).toBe(true)
    expect(rows.every((r) => r.createdAt === undefined && r.deletedAt === undefined)).toBe(true)
    const db = createDb(":memory:", {
      cipher: createCipher({ keys: { k: generateKey() }, current: "k" }),
    })
    for (const t of Object.values(S)) db.orm.run(ddl(t))
    const { userId: _, ...owned } = rows[0]!
    expect(await scoped(db, { userId: "u" }).insert(S.notes, owned)).toHaveLength(1)
  })
})

describe("describeSchema", () => {
  test("lists tables and columns with the notes an agent needs", () => {
    const text = describeSchema(sqliteSchema())
    expect(text).toContain("table notes")
    expect(text).toContain("  id text primary key")
    expect(text).toMatch(/secret text .*encrypted at rest/)
    expect(text).toMatch(/user_id text not null .*owner/)
    expect(text).toMatch(/price integer not null .*minor units; currency in priceCurrency/)
    expect(text).toMatch(/deleted_at integer .*soft delete/)
    expect(describeSchema(Object.values(pgSchema()))).toContain("timestamp with time zone")
  })
})

describe("checkMigrationSql", () => {
  const kinds = (sql: string) => checkMigrationSql(sql).map((i) => i.kind)
  test("flags drops, renames and NOT NULL without default", () => {
    expect(kinds('DROP TABLE "users";')).toEqual(["drop-table"])
    expect(kinds("ALTER TABLE `notes` DROP COLUMN `title`;")).toEqual(["drop-column"])
    expect(kinds('ALTER TABLE "notes" RENAME COLUMN "title" TO "name";')).toEqual(["rename"])
    expect(kinds('ALTER TABLE "notes" RENAME TO "memos";')).toEqual(["rename"])
    expect(kinds('ALTER TABLE "notes" ADD COLUMN "kind" text NOT NULL;')).toEqual([
      "not-null-without-default",
    ])
    expect(kinds('ALTER TABLE "notes" ALTER COLUMN "kind" SET NOT NULL;')).toEqual([
      "not-null-without-default",
    ])
  })
  test("passes safe changes, SQLite rebuilds and allowed statements", () => {
    expect(kinds('ALTER TABLE "notes" ADD COLUMN "kind" text DEFAULT \'x\' NOT NULL;')).toEqual([])
    expect(kinds('CREATE TABLE "a" ("id" text PRIMARY KEY NOT NULL);')).toEqual([])
    const rebuild = [
      "CREATE TABLE `__new_notes` (`id` text PRIMARY KEY NOT NULL);",
      "INSERT INTO `__new_notes`(`id`) SELECT `id` FROM `notes`;",
      "DROP TABLE `notes`;",
      "ALTER TABLE `__new_notes` RENAME TO `notes`;",
    ].join("--> statement-breakpoint\n")
    expect(kinds(rebuild)).toEqual([])
    expect(kinds("-- signet-allow: drop-table\nDROP TABLE old_stuff;")).toEqual([])
  })
  test("reports the line of each statement", () => {
    const issues = checkMigrationSql("CREATE TABLE a (id text);\n\nDROP TABLE b;\n", "0001.sql")
    expect(issues[0]).toMatchObject({ file: "0001.sql", line: 3, kind: "drop-table" })
  })
  test("the CLI exits 1 on findings and 0 when clean", async () => {
    const dir = `${import.meta.dir}/.tmp-migrations`
    await Bun.write(`${dir}/ok/0001.sql`, "CREATE TABLE a (id text);")
    await Bun.write(`${dir}/bad/0002.sql`, "DROP TABLE a;")
    const run = (p: string) =>
      Bun.spawnSync(["bun", `${import.meta.dir}/../src/migrations/cli.ts`, p], { stderr: "pipe" })
    expect(run(`${dir}/ok`).exitCode).toBe(0)
    const bad = run(`${dir}/bad`)
    expect(bad.exitCode).toBe(1)
    expect(bad.stderr.toString()).toContain("drop-table")
    await Bun.$`rm -rf ${dir}`
  })
})

describe("defineQuery", () => {
  test("is a plain { key, run } object with inferred types", async () => {
    const S = sqliteSchema()
    const db = createDb()
    for (const t of Object.values(S)) db.orm.run(ddl(t))
    const tagsOf = (userId: string) =>
      defineQuery({
        key: ["tags", userId] as const,
        run: (d: SignetDb) => scoped(d, { userId }).select(S.tags, eq(S.tags.label, "home")),
      })
    await scoped(db, { userId: "u" }).insert(S.tags, { label: "home" })
    const q = tagsOf("u")
    const rows = await q.run(db)
    const label: string = rows[0]!.label
    const key: readonly ["tags", string] = q.key
    expect(label).toBe("home")
    expect(key).toEqual(["tags", "u"])
  })
})

// Compile-time checks, never called: they fail `bun run typecheck` if inference breaks.
export function _typeChecks() {
  const S = sqliteSchema()
  const s = scoped(createDb(), { userId: "u" })
  // @ts-expect-error userId is set by the scope, not by the caller
  void s.insert(S.notes, { title: "t", price: 1, userId: "u" })
  // @ts-expect-error title is required
  void s.insert(S.notes, { price: 1 })
  void s.select(S.notes).then((rows) => {
    const createdAt: Date = rows[0]!.createdAt
    const price: number = rows[0]!.price
    return [createdAt, price]
  })
}
