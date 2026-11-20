// Ledger floors: a post that would take an account below its floor writes
// nothing, also when many posts race. Runs on the memory store, SQLite, PGlite,
// and a real Postgres server when SIGNET_TEST_PG_URL is set (CI's db-postgres
// job), which is the only one where statements truly run concurrently.
import { Database } from "bun:sqlite"
import { afterAll, describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import postgres from "postgres"
import { isPaymentsError } from "../src/errors"
import { balance, post, transfer } from "../src/ledger"
import { memoryStore, type PaymentsStore, paymentsSchema, sqlStore } from "../src/store"

type Make = () => Promise<PaymentsStore>
const cleanups: (() => Promise<unknown>)[] = []
afterAll(async () => {
  for (const c of cleanups) await c()
})

const sqlite: Make = async () => {
  const db = new Database(":memory:")
  for (const s of paymentsSchema("sqlite")) db.run(s)
  return sqlStore(
    { query: (s, p) => db.query(s).all(...(p as never[])) as Record<string, unknown>[] },
    { dialect: "sqlite" },
  )
}

const pglite: Make = async () => {
  const db = new PGlite()
  cleanups.push(() => db.close())
  for (const s of paymentsSchema("pg")) await db.exec(s)
  const query = async (s: string, p: unknown[]) =>
    (await db.query(s, p)).rows as Record<string, unknown>[]
  return sqlStore(
    {
      query,
      transaction: (work) =>
        db.transaction((tx) =>
          work(async (s, p) => (await tx.query(s, p)).rows as Record<string, unknown>[]),
        ),
    },
    { dialect: "pg" },
  )
}

const PG_URL = process.env.SIGNET_TEST_PG_URL
let schemaN = 0
const realPg: Make = async () => {
  // A fresh schema per store, so runs never see each other's rows.
  const schema = `pay_floor_${process.pid}_${++schemaN}`
  const admin = postgres(PG_URL as string, { max: 1, onnotice: () => {} })
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  await admin.end()
  const sql = postgres(PG_URL as string, {
    max: 10,
    onnotice: () => {},
    connection: { search_path: schema },
  })
  cleanups.push(async () => {
    await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await sql.end()
  })
  for (const s of paymentsSchema("pg")) await sql.unsafe(s)
  return sqlStore(
    {
      query: (s, p) => sql.unsafe(s, p as never[]) as never,
      transaction: (work) =>
        sql.begin((tx) => work((s, p) => tx.unsafe(s, p as never[]) as never)) as never,
    },
    { dialect: "pg" },
  )
}

const backends: [string, Make][] = [
  ["memory", async () => memoryStore()],
  ["sqlite", sqlite],
  ["pglite", pglite],
  ...(PG_URL ? ([["postgres", realPg]] as [string, Make][]) : []),
]

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return isPaymentsError(e) ? e.code : String(e)
  }
}

// Coins: grants debit the wallet (balance goes up), spends credit it.
const grant = (txId: string, n: number) => ({
  txId,
  kind: "grant",
  legs: transfer("wallet:u1", "iap", n, "COINS"),
})
const spend = (txId: string, n: number) => ({
  txId,
  kind: "spend",
  legs: transfer("spent", "wallet:u1", n, "COINS"),
})
const floor = { floor: { "wallet:u1": 0 } }

for (const [name, make] of backends) {
  describe(`ledger floor (${name})`, () => {
    test("a spend within the balance posts; one past it writes nothing", async () => {
      const db = await make()
      await post(db, grant("g1", 100))
      expect(await post(db, spend("s1", 60), floor)).toBe(true)
      expect(await code(post(db, spend("s2", 50), floor))).toBe("INSUFFICIENT_BALANCE")
      expect(await balance(db, "wallet:u1", "COINS")).toBe(40)
      expect((await db.entries({ account: "spent" })).map((e) => e.txId)).toEqual(["s1"])
    })

    test("a repeated txId is still a no-op, with or without a floor", async () => {
      const db = await make()
      await post(db, grant("g1", 100))
      expect(await post(db, spend("s1", 100), floor)).toBe(true)
      // Already posted: false, not INSUFFICIENT_BALANCE, though the balance is now 0.
      expect(await post(db, spend("s1", 100), floor)).toBe(false)
      expect(await post(db, grant("g1", 100))).toBe(false)
      expect(await balance(db, "wallet:u1", "COINS")).toBe(0)
    })

    test("posts that add to a floored account are never refused", async () => {
      const db = await make()
      expect(await post(db, grant("g1", 5), floor)).toBe(true)
      expect(await balance(db, "wallet:u1", "COINS")).toBe(5)
    })

    test("concurrent spends never take the balance below the floor", async () => {
      const db = await make()
      await post(db, grant("g1", 100))
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => code(post(db, spend(`s${i}`, 10), floor))),
      )
      expect(results.filter((r) => r === "OK")).toHaveLength(10)
      expect(results.filter((r) => r === "INSUFFICIENT_BALANCE")).toHaveLength(20)
      expect(await balance(db, "wallet:u1", "COINS")).toBe(0)
    })

    test("a second store keeps coins apart from the first", async () => {
      const money = await make()
      const coins = await make()
      await post(money, {
        txId: "c1",
        kind: "capture",
        legs: transfer("receivable:x", "revenue", 9900, "INR"),
      })
      await post(coins, grant("g1", 500))
      expect(await balance(money, "wallet:u1", "COINS")).toBe(0)
      expect(await balance(coins, "revenue", "INR")).toBe(0)
      expect(await balance(coins, "wallet:u1", "COINS")).toBe(500)
    })
  })
}

test("a floor on Postgres without a transaction is refused up front", async () => {
  const db = sqlStore({ query: () => [] }, { dialect: "pg" })
  expect(await code(post(db, spend("s1", 1), floor))).toBe("UNSUPPORTED")
})

test("a floor must be integer minor units", async () => {
  expect(await code(post(memoryStore(), spend("s1", 1), { floor: { "wallet:u1": 0.5 } }))).toBe(
    "BAD_INPUT",
  )
})
