/**
 * Per-user data export and erasure: `exportUser` returns every row a user
 * owns as JSON, `deleteUser` hard-deletes them in one atomic batch.
 *
 * A table is matched on its `userId` column, or on the column you name with a
 * `[table, column]` pair, e.g. `[users, users.id]` for the users table itself.
 */

import { type Column, count, eq, getTableName, type Table } from "drizzle-orm"
import { decryptRows } from "./crypt.js"
import { columnsOf, type SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import type { Actor } from "./scoped.js"

export type UserTable = Table | readonly [Table, Column]

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any

function resolve(spec: UserTable): [Table, Column] {
  if (Array.isArray(spec)) return spec as [Table, Column]
  const table = spec as Table
  const col = columnsOf(table).userId
  if (!col) {
    throw new SignetDbError(
      "NO_OWNER_COLUMN",
      `${getTableName(table)} has no userId column. Pass [table, table.<ownerColumn>], e.g. [users, users.id].`,
    )
  }
  return [table, col]
}

/**
 * Every row of `userId` in `tables`, soft-deleted ones included, with
 * encrypted fields decrypted. Keyed by SQL table name; JSON-serialisable.
 */
export async function exportUser(
  db: SignetDb<unknown>,
  userId: string,
  tables: readonly UserTable[],
): Promise<Record<string, Record<string, unknown>[]>> {
  const o = db.orm as AnyOrm
  const out: Record<string, Record<string, unknown>[]> = {}
  for (const spec of tables) {
    const [table, col] = resolve(spec)
    out[getTableName(table)] = await decryptRows(
      db,
      table,
      await o.select().from(table).where(eq(col, userId)),
    )
  }
  return out
}

/**
 * Hard-delete every row of `userId` in `tables`, in the order given (children
 * before parents when foreign keys do not cascade), as one atomic batch. With
 * auditing on (`createDb(..., { audit })`) the same batch writes one
 * `delete_user` audit entry holding the row counts, not the deleted data.
 * Returns the count per table.
 */
export async function deleteUser(
  db: SignetDb<unknown>,
  userId: string,
  tables: readonly UserTable[],
  options: { actor?: Actor } = {},
): Promise<Record<string, number>> {
  if (!userId)
    throw new SignetDbError("NO_USER_ID", "deleteUser() got an empty userId; refusing to run.")
  const o = db.orm as AnyOrm
  const specs = tables.map(resolve)
  const counts: Record<string, number> = {}
  for (const [table, col] of specs) {
    const [row] = await o.select({ n: count() }).from(table).where(eq(col, userId))
    counts[getTableName(table)] = Number(row?.n ?? 0)
  }
  const statements: ((tx: AnyOrm) => unknown)[] = specs.map(
    ([table, col]) =>
      (tx: AnyOrm) =>
        tx.delete(table).where(eq(col, userId)),
  )
  if (db.audit) {
    const audit = db.audit
    statements.push((tx: AnyOrm) =>
      tx.insert(audit).values({
        actorType: options.actor?.type ?? "user",
        actorId: options.actor?.id ?? userId,
        action: "delete_user",
        tableName: "*",
        rowId: userId,
        before: counts,
        after: null,
      }),
    )
  }
  await db.batch(statements)
  return counts
}
