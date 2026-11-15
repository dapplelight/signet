import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { createDb } from "@dapplelight/signet-db/sqlite"
import { paymentsSchema } from "@dapplelight/signet-payments"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import type { Db } from "./index.ts"
import * as schema from "./schema.ts"

const MIGRATIONS = join(import.meta.dirname, "../../drizzle")

/**
 * Open (or create) the database and bring it up to date. `query` runs raw SQL
 * with `?` placeholders, for signet-payments' store.
 */
export function openDb(path: string): {
  db: Db
  query: (sql: string, params: unknown[]) => unknown[]
} {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  if (path !== ":memory:") sqlite.run("pragma journal_mode = wal")
  const db = createDb(sqlite, { schema, audit: schema.audit, idempotency: schema.idempotency })
  // Your tables: the migrations drizzle-kit writes from api/db/schema.ts.
  migrate(db.orm, { migrationsFolder: MIGRATIONS })
  // signet-payments' webhook inbox, payment records and ledger: its own
  // CREATE TABLE IF NOT EXISTS statements, versioned with the package.
  for (const statement of paymentsSchema("sqlite")) sqlite.run(statement)
  return { db, query: (s, p) => sqlite.query(s).all(...(p as never[])) }
}
