import type { KeyValue } from "@dapplelight/signet-server/adapters"
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm"
import type { Orm } from "./index.ts"
import { kv } from "./schema.ts"

/**
 * signet-server's `KeyValue` over the kv table. bun:sqlite runs each statement
 * synchronously in one process, so `incr` is exact.
 * ponytail: one process per database file; running several API replicas, move
 * this to Upstash (`upstashKv` from @dapplelight/signet-server/adapters/upstash).
 */
export function sqlKv(orm: Orm): KeyValue {
  const live = (key: string) =>
    and(eq(kv.key, key), or(isNull(kv.expiresAt), gt(kv.expiresAt, Date.now())))
  const expiry = (ttlSeconds?: number) => (ttlSeconds ? Date.now() + ttlSeconds * 1000 : null)
  return {
    async get(key) {
      return orm.select({ value: kv.value }).from(kv).where(live(key)).get()?.value ?? null
    },
    async set(key, value, opts) {
      const expiresAt = expiry(opts?.ttlSeconds)
      orm
        .insert(kv)
        .values({ key, value, expiresAt })
        .onConflictDoUpdate({ target: kv.key, set: { value, expiresAt } })
        .run()
    },
    async delete(key) {
      orm.delete(kv).where(eq(kv.key, key)).run()
    },
    async incr(key, ttlSeconds) {
      // An expired counter starts again at 1 with a fresh TTL.
      orm
        .delete(kv)
        .where(and(eq(kv.key, key), lte(kv.expiresAt, Date.now())))
        .run()
      const row = orm
        .insert(kv)
        .values({ key, value: "1", expiresAt: expiry(ttlSeconds) })
        .onConflictDoUpdate({
          target: kv.key,
          set: { value: sql`cast(${kv.value} as integer) + 1` },
        })
        .returning({ value: kv.value })
        .get()
      return Number(row?.value)
    },
  }
}

/** Drop expired rows; server.ts runs it hourly. */
export function pruneKv(orm: Orm): void {
  orm.delete(kv).where(lte(kv.expiresAt, Date.now())).run()
}
