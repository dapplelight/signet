/**
 * Gap-free named counters on the `sequences()` table, e.g. invoice numbers
 * that restart every financial year: `nextSequence(db, table, "invoice:INV:2026-27")`.
 */

import { sql, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any

/**
 * The next value of counter `key`, starting at 1. One upsert statement, so
 * concurrent callers get distinct values on SQLite, D1 and Postgres. A value
 * is used up even if the caller then fails; it is never handed out twice.
 */
export async function nextSequence(
  db: SignetDb<unknown>,
  table: Table,
  key: string,
): Promise<number> {
  if (!key) throw new SignetDbError("BAD_VALUE", "nextSequence needs a key.")
  // biome-ignore lint/suspicious/noExplicitAny: sequence columns are known by name
  const c = table as any
  const [row] = await (db.orm as AnyOrm)
    .insert(table)
    .values({ key, value: 1 })
    .onConflictDoUpdate({ target: c.key, set: { value: sql`${c.value} + 1` } })
    .returning({ value: c.value })
  return Number(row.value)
}
