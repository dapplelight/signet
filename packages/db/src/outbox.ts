/**
 * Transactional outbox: record a message in the same atomic write as the data
 * change, then deliver it to a queue afterwards, at least once.
 *
 * ```ts
 * await db.batch([
 *   (tx) => tx.insert(orders).values(order),
 *   enqueue(db, "order.created", { orderId: order.id }),
 * ])
 * await drainOutbox(db, queue) // from a cron or after the response
 * ```
 *
 * In an interactive transaction: `await enqueue(db, topic, payload)(tx)`.
 * The queue is anything with `send(message)`, such as signet-server's `Queue`.
 * Messages carry the outbox row id; consumers should dedupe on it.
 */

import { and, asc, eq, getTableColumns, inArray, lt, lte, sql, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"

export type OutboxMessage<P = unknown> = { id: string; topic: string; payload: P }

export type OutboxQueue<P = unknown> = {
  send(message: OutboxMessage<P>): Promise<void> | void
}

export type DrainOptions = {
  /** Rows claimed per call. Default 50. */
  batch?: number
  /** Attempts before a row is marked dead. Default 10. */
  maxAttempts?: number
  /** Delay before retry number `attempt` (1-based). Default 2^attempt seconds, capped at one hour. */
  backoff?: (attempt: number) => number
  /** How long a claimed row stays invisible to other drainers. Default 60 s. */
  leaseMs?: number
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: outbox columns are known by name
type Cols = Record<string, any>

function table(db: SignetDb<unknown>): Table {
  if (!db.outbox) {
    throw new SignetDbError(
      "NO_OUTBOX_TABLE",
      "No outbox table. Define outbox() in the schema, migrate it, and pass createDb(..., { outbox }).",
    )
  }
  return db.outbox
}

/** A statement that inserts one outbox row; run it inside `db.batch` or a transaction. */
export function enqueue<TOrm>(
  db: SignetDb<TOrm>,
  topic: string,
  payload: unknown,
): (tx: TOrm) => unknown {
  const t = table(db)
  return (tx) => (tx as AnyOrm).insert(t).values({ topic, payload })
}

const defaultBackoff = (attempt: number) => Math.min(2 ** attempt * 1000, 3_600_000)

/**
 * Deliver due messages. Each row is claimed with a lease (so concurrent
 * drainers do not double-send), sent, then marked sent; a failed send is
 * retried with backoff until `maxAttempts`, then marked dead. A crash between
 * send and mark resends after the lease: delivery is at least once.
 */
export async function drainOutbox(
  db: SignetDb<unknown>,
  queue: OutboxQueue,
  options: DrainOptions = {},
): Promise<{ sent: number; failed: number; dead: number }> {
  const { batch = 50, maxAttempts = 10, backoff = defaultBackoff, leaseMs = 60_000 } = options
  const t = table(db)
  const c = getTableColumns(t) as Cols
  const o = db.orm as AnyOrm
  const now = new Date()

  const due = and(eq(c.status, "pending"), lte(c.nextAttemptAt, now))
  const ids: string[] = (
    await o.select({ id: c.id }).from(t).where(due).orderBy(asc(c.id)).limit(batch)
  ).map((r: { id: string }) => r.id)
  if (ids.length === 0) return { sent: 0, failed: 0, dead: 0 }

  // The claim re-checks `due`, so a row another drainer took in between is skipped.
  const claimed: Cols[] = await o
    .update(t)
    .set({ nextAttemptAt: new Date(now.getTime() + leaseMs), attempts: sql`${c.attempts} + 1` })
    .where(and(inArray(c.id, ids), due))
    .returning()

  const out = { sent: 0, failed: 0, dead: 0 }
  for (const row of claimed.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    try {
      await queue.send({ id: row.id, topic: row.topic, payload: row.payload })
      await o.update(t).set({ status: "sent", sentAt: new Date() }).where(eq(c.id, row.id))
      out.sent++
    } catch (err) {
      const dead = row.attempts >= maxAttempts
      await o
        .update(t)
        .set({
          status: dead ? "dead" : "pending",
          lastError: String(err instanceof Error ? err.message : err).slice(0, 1000),
          nextAttemptAt: new Date(Date.now() + backoff(row.attempts)),
        })
        .where(eq(c.id, row.id))
      dead ? out.dead++ : out.failed++
    }
  }
  return out
}

/** Delete sent rows older than `olderThanMs` (default 7 days). Returns how many. */
export async function pruneOutbox(db: SignetDb<unknown>, olderThanMs = 7 * 86_400_000) {
  const t = table(db)
  const c = getTableColumns(t) as Cols
  const rows = await (db.orm as AnyOrm)
    .delete(t)
    .where(and(eq(c.status, "sent"), lt(c.sentAt, new Date(Date.now() - olderThanMs))))
    .returning({ id: c.id })
  return rows.length as number
}
