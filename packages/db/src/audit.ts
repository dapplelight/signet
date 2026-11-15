/**
 * Audit log helpers on top of the `auditLog()` table: `audit()` for events
 * that are not a row write (a login, an export), `queryAudit()` for an admin
 * view, `purgeAudit()` for retention, and the redaction `audited()` also uses.
 */

import { and, count, desc, eq, gte, lt, type SQL } from "drizzle-orm"
import { columnsOf, type SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import type { Actor } from "./scoped.js"

/** Where a request came from. signet-server's `auditContext()` fills it. */
export type AuditRequest = {
  ip?: string | null
  userAgent?: string | null
  requestId?: string | null
}

export type AuditConfig = {
  /** Field names to redact in addition to `DEFAULT_AUDIT_REDACT`, matched the same way. */
  redact?: readonly string[]
  /** How long `purgeAudit(db)` keeps entries. No default: nothing is deleted without it. */
  retentionDays?: number
}

/** Redacted by default; a field matches when its name, lowercased without `_`, `-` and spaces, contains one. */
export const DEFAULT_AUDIT_REDACT: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "privatekey",
]

export const REDACTED = "[redacted]"

const norm = (k: string) => k.toLowerCase().replace(/[_\s-]/g, "")

/** A copy of `value` with every matching field, at any depth, replaced by `"[redacted]"`. */
export function redact(value: unknown, extra: readonly string[] = []): unknown {
  const keys = [...DEFAULT_AUDIT_REDACT, ...extra].map(norm).filter(Boolean)
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v === null || typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype)
      return v // Date and friends stay as they are
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        keys.some((s) => norm(k).includes(s)) ? REDACTED : walk(x),
      ]),
    )
  }
  return walk(value)
}

export type AuditCtx = { db: SignetDb<unknown>; actor: Actor; request?: AuditRequest }

/** What the entry is about: stored as `tableName` and `rowId`. */
export type AuditTarget = { type: string; id?: string }

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any

function auditTable(db: SignetDb<unknown>) {
  if (!db.audit)
    throw new SignetDbError(
      "NO_AUDIT_TABLE",
      "The audit helpers need an audit table. Define auditLog() in the schema and pass createDb(..., { audit }).",
    )
  return db.audit
}

/** @internal The request columns of an audit row. */
export const requestColumns = (r?: AuditRequest) => ({
  ip: r?.ip ?? null,
  userAgent: r?.userAgent ?? null,
  requestId: r?.requestId ?? null,
})

/**
 * Record an event that is not a row write. `meta` is redacted like the
 * snapshots `audited()` writes.
 *
 * ```ts
 * await audit({ db, actor, request: c.get("audit") }, "export", { type: "invoices" }, { rows: 40 })
 * ```
 */
export async function audit(
  ctx: AuditCtx,
  action: string,
  target: AuditTarget,
  meta?: Record<string, unknown>,
): Promise<void> {
  const t = auditTable(ctx.db)
  if (!ctx.actor?.id)
    throw new SignetDbError("NO_ACTOR", "audit() needs ctx.actor, e.g. { type: 'user', id }.")
  await (ctx.db.orm as AnyOrm).insert(t).values({
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    action,
    tableName: target.type,
    rowId: target.id ?? null,
    meta: meta === undefined ? null : redact(meta, ctx.db.auditConfig?.redact),
    ...requestColumns(ctx.request),
  })
}

export type AuditQuery = {
  actorType?: Actor["type"]
  actorId?: string
  action?: string
  /** `id` left out matches every row of the type. */
  target?: AuditTarget
  /** Inclusive. */
  from?: Date
  /** Exclusive. */
  to?: Date
  /** Default 50, at most 200. */
  limit?: number
  offset?: number
}

/** Newest first. `total` counts every match, for page controls. */
export async function queryAudit(
  db: SignetDb<unknown>,
  q: AuditQuery = {},
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const t = auditTable(db)
  const c = columnsOf(t)
  const o = db.orm as AnyOrm
  const conds = [
    q.actorType && eq(c.actorType as never, q.actorType),
    q.actorId && eq(c.actorId as never, q.actorId),
    q.action && eq(c.action as never, q.action),
    q.target && eq(c.tableName as never, q.target.type),
    q.target?.id !== undefined ? eq(c.rowId as never, q.target.id) : undefined,
    q.from && gte(c.at as never, q.from),
    q.to && lt(c.at as never, q.to),
  ].filter(Boolean) as SQL[]
  const where = and(...conds)
  const limit = Math.min(Math.max(Math.trunc(q.limit ?? 50), 1), 200)
  const offset = Math.max(Math.trunc(q.offset ?? 0), 0)
  const rows = await o
    .select()
    .from(t)
    .where(where)
    .orderBy(desc(c.at as never), desc(c.id as never))
    .limit(limit)
    .offset(offset)
  const [n] = await o.select({ n: count() }).from(t).where(where)
  return { rows, total: Number(n?.n ?? 0) }
}

/**
 * Delete entries older than `olderThanDays` (default: the db's
 * `auditConfig.retentionDays`). Run it from a scheduled job. Returns how many went.
 */
export async function purgeAudit(
  db: SignetDb<unknown>,
  options: { olderThanDays?: number; now?: Date } = {},
): Promise<number> {
  const t = auditTable(db)
  const days = options.olderThanDays ?? db.auditConfig?.retentionDays
  if (days === undefined || !Number.isFinite(days) || days < 0)
    throw new SignetDbError(
      "BAD_CONFIG",
      "purgeAudit() needs a retention: pass { olderThanDays } or createDb(..., { auditConfig: { retentionDays } }).",
    )
  const cutoff = new Date((options.now ?? new Date()).getTime() - days * 86_400_000)
  const gone = await (db.orm as AnyOrm)
    .delete(t)
    .where(lt(columnsOf(t).at as never, cutoff))
    .returning({ id: columnsOf(t).id })
  return gone.length
}
