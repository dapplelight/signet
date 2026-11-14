/**
 * Idempotency keys: run an operation once per (scope, key), store its result,
 * and return the stored result when the same request is retried.
 *
 * ```ts
 * const order = await withIdempotency(db, req.header("idempotency-key"), userId, () =>
 *   scoped(db, { userId }).insert(orders, body),
 * )
 * ```
 *
 * A retry while the first call is still running is rejected with
 * `IDEMPOTENCY_IN_FLIGHT` (answer 409). If the operation throws, its key is
 * released so the client can retry. Results are stored as JSON, so a replay
 * returns the JSON form (Dates as ISO strings). When the db has a cipher the
 * stored JSON is encrypted, so decrypted `encrypted()` fields in a result never
 * sit in the table as plaintext.
 */

import { and, eq, getTableColumns, lt, type Table } from "drizzle-orm"
import { isCiphertext } from "./cipher.js"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"

export type IdempotencyOptions = {
  /** How long a finished result is replayed. Default 24 h. */
  ttlMs?: number
  /** How long an unfinished claim blocks retries (covers a crash mid-operation). Default 60 s. */
  leaseMs?: number
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: idempotency columns are known by name
type Cols = Record<string, any>

function table(db: SignetDb<unknown>): Table {
  if (!db.idempotency) {
    throw new SignetDbError(
      "NO_IDEMPOTENCY_TABLE",
      "No idempotency table. Define idempotencyKeys() in the schema, migrate it, and pass createDb(..., { idempotency }).",
    )
  }
  return db.idempotency
}

export async function withIdempotency<R>(
  db: SignetDb<unknown>,
  key: string,
  scope: string,
  fn: () => Promise<R>,
  options: IdempotencyOptions = {},
): Promise<R> {
  const { ttlMs = 86_400_000, leaseMs = 60_000 } = options
  if (!key) throw new SignetDbError("BAD_VALUE", "withIdempotency needs a non-empty key.")
  const t = table(db)
  const c = getTableColumns(t) as Cols
  const o = db.orm as AnyOrm
  const mine = and(eq(c.scope, scope), eq(c.key, key))

  for (let attempt = 0; attempt < 2; attempt++) {
    const claimed = await o
      .insert(t)
      .values({ scope, key, status: "pending", expiresAt: new Date(Date.now() + leaseMs) })
      .onConflictDoNothing()
      .returning()
    if (claimed.length) {
      let result: R
      try {
        result = await fn()
      } catch (err) {
        await o.delete(t).where(mine)
        throw err
      }
      // The result may hold decrypted encrypted() fields: never store it as plain JSON.
      const stored = db.cipher
        ? await db.cipher.encrypt(JSON.stringify(result ?? null))
        : (result ?? null)
      await o
        .update(t)
        .set({ status: "done", result: stored, expiresAt: new Date(Date.now() + ttlMs) })
        .where(mine)
      return result
    }
    const [row]: Cols[] = await o.select().from(t).where(mine)
    if (!row) continue // released between our insert and select
    if (row.expiresAt.getTime() <= Date.now()) {
      await o.delete(t).where(and(mine, eq(c.expiresAt, row.expiresAt)))
      continue
    }
    if (row.status === "done")
      return (
        db.cipher && isCiphertext(row.result)
          ? JSON.parse(await db.cipher.decrypt(row.result))
          : row.result
      ) as R
    throw new SignetDbError(
      "IDEMPOTENCY_IN_FLIGHT",
      `A request with idempotency key "${key}" is still running. Retry after it finishes (respond 409).`,
    )
  }
  throw new SignetDbError(
    "IDEMPOTENCY_IN_FLIGHT",
    `Idempotency key "${key}" is contended; retry shortly.`,
  )
}

/** Delete expired keys. Run it from a cron. Returns how many. */
export async function pruneIdempotency(db: SignetDb<unknown>): Promise<number> {
  const t = table(db)
  const c = getTableColumns(t) as Cols
  const rows = await (db.orm as AnyOrm)
    .delete(t)
    .where(lt(c.expiresAt, new Date()))
    .returning({ key: c.key })
  return rows.length
}
