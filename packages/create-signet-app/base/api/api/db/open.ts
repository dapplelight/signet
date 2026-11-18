import { Database } from "bun:sqlite" // @bun
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { DatabaseSync } from "node:sqlite" // @!bun
import { fromDrizzle } from "@dapplelight/signet-db" // @!bun
import { createDb } from "@dapplelight/signet-db/sqlite" // @bun
import { paymentsSchema } from "@dapplelight/signet-payments" // @payments
// !bun:begin
import { createTableRelationsHelpers, extractTablesRelationalConfig } from "drizzle-orm"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session"
import { BaseSQLiteDatabase, SQLiteSyncDialect } from "drizzle-orm/sqlite-core"
// !bun:end
import { migrate } from "drizzle-orm/bun-sqlite/migrator" // @bun
import type { Db } from "./index.ts" // @bun
import type { Db, Orm } from "./index.ts" // @!bun
import * as schema from "./schema.ts"

const MIGRATIONS = join(import.meta.dirname, "../../drizzle")

/**
 * Open (or create) the database and bring it up to date. `query` runs raw SQL
 * with `?` placeholders, for signet-payments' store.
 */
export function openDb(path: string): {
  db: Db
  query: (sql: string, params: unknown[]) => Record<string, unknown>[]
} {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  // bun:begin
  const sqlite = new Database(path)
  if (path !== ":memory:") sqlite.run("pragma journal_mode = wal")
  const db = createDb(sqlite, { schema, audit: schema.audit, idempotency: schema.idempotency })
  // bun:end
  // !bun:begin
  // node:sqlite runs under Node 22.18+, Deno 2 and Bun alike (bun test uses it).
  const sqlite = new DatabaseSync(path)
  if (path !== ":memory:") sqlite.exec("pragma journal_mode = wal")
  const db = fromDrizzle(orm(sqlite), {
    dialect: "sqlite",
    atomicity: "sync-transaction",
    audit: schema.audit,
    idempotency: schema.idempotency,
  })
  // !bun:end
  // Your tables: the migrations drizzle-kit writes from api/db/schema.ts.
  migrate(db.orm, { migrationsFolder: MIGRATIONS })
  // payments:begin
  // signet-payments' webhook inbox, payment records and ledger: its own
  // CREATE TABLE IF NOT EXISTS statements, versioned with the package.
  for (const statement of paymentsSchema("sqlite")) sqlite.run(statement) // @bun
  for (const statement of paymentsSchema("sqlite")) sqlite.exec(statement) // @!bun
  // payments:end
  return {
    db,
    query: (s, p) => sqlite.query<Record<string, unknown>, never[]>(s).all(...(p as never[])), // @bun
    query: (s, p) => sqlite.prepare(s).all(...(p as never[])) as Record<string, unknown>[], // @!bun
  }
}
// !bun:begin

/**
 * Drizzle over node:sqlite: the better-sqlite3 driver's session (its entry
 * would load the better-sqlite3 package) on the client below.
 */
function orm(sqlite: DatabaseSync): Orm {
  const dialect = new SQLiteSyncDialect()
  const tables = extractTablesRelationalConfig(schema, createTableRelationsHelpers)
  const relational = {
    fullSchema: schema,
    schema: tables.tables,
    tableNamesMap: tables.tableNamesMap,
  }
  const session = new BetterSQLiteSession(betterSqlite(sqlite), dialect, relational, {})
  return new BaseSQLiteDatabase("sync", dialect, session as never, relational as never) as Orm
}

type Params = never[]

/**
 * node:sqlite in the shape that session calls: prepare (run, all, get, and
 * raw for rows as arrays) and transaction.
 */
function betterSqlite(sqlite: DatabaseSync) {
  const begin = (mode: string) => (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
    sqlite.exec(`begin ${mode}`)
    try {
      const result = fn(...args)
      sqlite.exec("commit")
      return result
    } catch (err) {
      sqlite.exec("rollback")
      throw err
    }
  }
  return {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql)
      let arrays: ReturnType<DatabaseSync["prepare"]> | undefined
      const raw = () => {
        if (!arrays) {
          arrays = sqlite.prepare(sql)
          arrays.setReturnArrays(true)
        }
        return arrays
      }
      return {
        run: (...p: Params) => stmt.run(...p),
        all: (...p: Params) => stmt.all(...p),
        get: (...p: Params) => stmt.get(...p),
        raw: () => ({ all: (...p: Params) => raw().all(...p), get: (...p: Params) => raw().get(...p) }),
      }
    },
    transaction: (fn: (...args: unknown[]) => unknown) => ({
      deferred: begin("deferred")(fn),
      immediate: begin("immediate")(fn),
      exclusive: begin("exclusive")(fn),
    }),
  } as never
}
// !bun:end
