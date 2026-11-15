/**
 * A persistent cache for `createExtractor` from `@dapplelight/signet-ai`, on an
 * `aiCache()` table (SQLite, D1 or Postgres), so answers survive restarts and
 * are shared by every process on the database.
 *
 * ```ts
 * import { dbCache } from "@dapplelight/signet-db"
 * const extractor = createExtractor({ providers, cache: dbCache(db, schema.aiCache) })
 * ```
 *
 * Structural: this package does not depend on signet-ai. The entry type is
 * inferred when the call sits inside `createExtractor({ cache })`; held in a
 * variable first, write `dbCache<CacheEntry>(db, table)`. Entries are JSON with an expiry,
 * checked on read; an expired or unreadable row is a miss. When the db has a
 * cipher the JSON is encrypted, since a model's answer often repeats the
 * personal data it was given. Run `pruneAiCache` from a cron to drop expired rows.
 */

import { and, eq, getTableColumns, lt, lte, type Table } from "drizzle-orm"
import { isCiphertext } from "./cipher.js"
import type { SignetDb } from "./db.js"

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: aiCache columns are known by name
type Cols = Record<string, any>

export type DbCache<E> = {
  get(key: string): Promise<E | undefined>
  set(key: string, entry: E, ttlSeconds: number): Promise<void>
}

export function dbCache<E = unknown>(db: SignetDb<unknown>, table: Table): DbCache<E> {
  const c = getTableColumns(table) as Cols
  const o = db.orm as AnyOrm
  return {
    async get(key) {
      const [row]: Cols[] = await o.select().from(table).where(eq(c.key, key))
      if (!row) return undefined
      if (row.expiresAt.getTime() <= Date.now()) {
        // Guarded on the expiry, so a fresh write racing this read survives.
        await o.delete(table).where(and(eq(c.key, key), lte(c.expiresAt, new Date())))
        return undefined
      }
      try {
        const text =
          db.cipher && isCiphertext(row.entry) ? await db.cipher.decrypt(row.entry) : row.entry
        return JSON.parse(text) as E
      } catch {
        return undefined // undecryptable (rotated key) or corrupt: a miss, not an outage
      }
    },
    async set(key, entry, ttlSeconds) {
      const text = JSON.stringify(entry)
      const stored = db.cipher ? await db.cipher.encrypt(text) : text
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
      await o
        .insert(table)
        .values({ key, entry: stored, expiresAt })
        .onConflictDoUpdate({ target: c.key, set: { entry: stored, expiresAt } })
    },
  }
}

/** Delete expired cache rows. Run it from a cron. Returns how many. */
export async function pruneAiCache(db: SignetDb<unknown>, table: Table): Promise<number> {
  const c = getTableColumns(table) as Cols
  const rows = await (db.orm as AnyOrm)
    .delete(table)
    .where(lt(c.expiresAt, new Date()))
    .returning({ key: c.key })
  return rows.length
}
