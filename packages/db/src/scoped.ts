/**
 * Per-user and per-org reads and writes, soft delete, and an opt-in audit trail.
 *
 * `scoped(db, { userId })` returns table operations that add
 * `where user_id = ?` to every read, update and delete, and set `userId` on
 * every insert, for tables with a `userId` column.
 *
 * `scoped(db, { orgId })` does the same with `org_id` for tables with an
 * `orgId` column, and `scoped(db, { userId, orgId })` with both. An org scope
 * is deny-by-default: a table it cannot filter (no `orgId` column, and no
 * `userId` column the scope also fixes) throws `NOT_TENANT_TABLE` instead of
 * reading or writing every org's rows. Rows with a `deletedAt`
 * are hidden unless a call passes `{ withDeleted: true }`, and `delete` on
 * such a table sets `deletedAt` unless it passes `{ hard: true }`.
 *
 * `audited(ops | db, { actor })` returns the same operations, also writing
 * who/what/when/before/after to the `auditLog()` table for each changed row.
 * Encrypted fields are stored in the audit log as ciphertext.
 */

import {
  and,
  type Column,
  eq,
  getTableName,
  type InferInsertModel,
  type InferSelectModel,
  isNull,
  type SQL,
  type Table,
} from "drizzle-orm"
import { decryptRows, encryptValues } from "./crypt.js"
import { columnsOf, type SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import { primaryKeyOf, snapshot } from "./versions.js"

type Row<T extends Table> = InferSelectModel<T>
/**
 * What a scope fixes: `true` the user, `"org"` the org, `"member"` both (a
 * user inside an org), `false` nothing (`audited(db)`).
 */
export type Scope = boolean | "org" | "member"
type ScopedKeys<S extends Scope> = S extends true
  ? "userId"
  : S extends "org"
    ? "orgId"
    : S extends "member"
      ? "userId" | "orgId"
      : never

/** What an insert takes: the table's insert type, minus the keys the scope sets. */
export type NewRow<T extends Table, S extends Scope = true> = Omit<
  InferInsertModel<T>,
  ScopedKeys<S> & keyof InferInsertModel<T>
>

export type ReadOptions = { withDeleted?: boolean }
export type SelectOptions = ReadOptions & {
  orderBy?: Column | SQL | ReadonlyArray<Column | SQL>
  limit?: number
  offset?: number
}
export type DeleteOptions = ReadOptions & { hard?: boolean }

export type Ops<S extends Scope = true> = {
  /** The user this scope is bound to; undefined for unscoped `audited(db)`. */
  readonly userId: S extends true | "member" ? string : undefined
  /** The org this scope is bound to, if any. */
  readonly orgId: S extends "org" | "member" ? string : undefined
  /** The scope's filter for `table`, combined with `where`, for hand-built queries on `db.orm`. */
  where(table: Table, where?: SQL, options?: ReadOptions): SQL | undefined
  select<T extends Table>(table: T, where?: SQL, options?: SelectOptions): Promise<Row<T>[]>
  insert<T extends Table>(table: T, values: NewRow<T, S> | NewRow<T, S>[]): Promise<Row<T>[]>
  update<T extends Table>(
    table: T,
    set: Partial<NewRow<T, S>>,
    where?: SQL,
    options?: ReadOptions,
  ): Promise<Row<T>[]>
  delete<T extends Table>(table: T, where?: SQL, options?: DeleteOptions): Promise<Row<T>[]>
}

/** Who made a change. Agent writes are recorded as `{ type: "agent", id }`. */
export type Actor = { type: "user" | "agent" | "system"; id: string }

type State = { db: SignetDb<unknown>; userId?: string; orgId?: string; actor?: Actor }
const states = new WeakMap<object, State>()

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
type Rec = Record<string, unknown>

/** Operations on `db` restricted to one user's rows, one org's rows, or one user's rows in one org. */
export function scoped<TOrm>(
  db: SignetDb<TOrm>,
  scope: { userId: string; orgId?: undefined },
): Ops<true>
export function scoped<TOrm>(
  db: SignetDb<TOrm>,
  scope: { orgId: string; userId?: undefined },
): Ops<"org">
export function scoped<TOrm>(
  db: SignetDb<TOrm>,
  scope: { userId: string; orgId: string },
): Ops<"member">
export function scoped<TOrm>(
  db: SignetDb<TOrm>,
  { userId, orgId }: { userId?: string; orgId?: string },
): Ops<Scope> {
  if (orgId !== undefined && !orgId)
    throw new SignetDbError(
      "NO_ORG_ID",
      "scoped() got an empty orgId. Pass the request's org id from the tenant middleware.",
    )
  if (orgId === undefined || userId !== undefined) {
    if (!userId)
      throw new SignetDbError(
        "NO_USER_ID",
        "scoped() got an empty userId. Pass the signed-in user's id from the session.",
      )
  }
  return make({ db, userId, orgId })
}

/**
 * Wrap scoped operations, or a whole db (unscoped, for admin jobs), so every
 * insert, update and delete also writes an audit entry. `actor` defaults to
 * `{ type: "user", id: userId }` of the scope.
 */
export function audited<S extends Scope>(target: Ops<S>, options?: { actor?: Actor }): Ops<S>
export function audited<TOrm>(target: SignetDb<TOrm>, options: { actor: Actor }): Ops<false>
export function audited(
  target: Ops<Scope> | SignetDb<unknown>,
  options: { actor?: Actor } = {},
): Ops<Scope> {
  const base = states.get(target) ?? { db: target as SignetDb<unknown> }
  if (!base.db.audit)
    throw new SignetDbError(
      "NO_AUDIT_TABLE",
      "audited() needs an audit table. Define auditLog() in the schema and pass createDb(..., { audit }).",
    )
  const actor =
    options.actor ?? (base.userId ? { type: "user" as const, id: base.userId } : undefined)
  if (!actor?.id)
    throw new SignetDbError(
      "NO_ACTOR",
      'audited(db) is unscoped, so it cannot default the actor. Pass { actor: { type: "system", id: "<job name>" } }.',
    )
  return make({ ...base, actor })
}

function make(state: State): Ops<Scope> {
  const { db, userId, orgId, actor } = state
  const o = db.orm as AnyOrm

  const where = (table: Table, extra?: SQL, options: ReadOptions = {}) => {
    const cols = columnsOf(table)
    const conds: SQL[] = []
    if (orgId !== undefined) {
      if (!cols.orgId && !(userId !== undefined && cols.userId))
        throw new SignetDbError(
          "NOT_TENANT_TABLE",
          `An org scope cannot filter ${getTableName(table)}: it has no orgId column. Add one, or read it through an unscoped db on purpose.`,
        )
      if (cols.orgId) conds.push(eq(cols.orgId, orgId))
    }
    if (userId !== undefined && cols.userId) conds.push(eq(cols.userId, userId))
    if (cols.deletedAt && !options.withDeleted) conds.push(isNull(cols.deletedAt))
    if (extra) conds.push(extra)
    return and(...conds)
  }

  const audit = async (table: Table, action: string, before: Rec[], after: Rec[]) => {
    if (actor === undefined || !db.audit) return
    const pk = primaryKeyOf(table)
    const idOf = (r: Rec | undefined) => (pk && r?.[pk] != null ? String(r[pk]) : null)
    const beforeById = new Map(before.map((r) => [idOf(r), r]))
    const rows = after.length ? after : before
    if (rows.length === 0) return
    const tableName = getTableName(table)
    await o.insert(db.audit).values(
      rows.map((r) => ({
        actorType: actor.type,
        actorId: actor.id,
        action,
        tableName,
        rowId: idOf(r),
        before: action === "insert" ? null : (beforeById.get(idOf(r)) ?? null),
        after: after.length ? r : null,
      })),
    )
  }

  /** A version of each written row, when the table is tracked (`DbConfig.versions`). */
  const version = (table: Table, action: string, rows: Rec[]) =>
    snapshot(
      db,
      table,
      action,
      rows,
      actor ?? { type: userId ? "user" : "system", id: userId ?? "signet-db" },
    )

  const update = async (
    table: Table,
    set: Rec,
    extra: SQL | undefined,
    options: ReadOptions,
    action: string,
  ) => {
    if (userId !== undefined && "userId" in set) {
      throw new SignetDbError(
        "CROSS_USER_WRITE",
        "A scoped update cannot change userId. Remove userId from the values; moving rows between users needs an unscoped audited(db).",
      )
    }
    if (orgId !== undefined && "orgId" in set) {
      throw new SignetDbError(
        "CROSS_ORG_WRITE",
        "An org-scoped update cannot change orgId. Remove orgId from the values; moving rows between orgs needs an unscoped audited(db).",
      )
    }
    const cond = where(table, extra, options)
    if (userId === undefined && orgId === undefined && !extra) {
      throw new SignetDbError(
        "UNSCOPED_WRITE",
        "An unscoped update or delete needs a where clause, or it would touch every row. Pass one, or use scoped(db, { userId }).",
      )
    }
    const values = await encryptValues(db, table, set)
    // ponytail: the snapshot, the change and the audit row are separate
    // statements, not one transaction (D1 has none); use DB triggers if the
    // trail must be exact under concurrent writes.
    const before: Rec[] = actor !== undefined ? await o.select().from(table).where(cond) : []
    const raw: Rec[] = await o.update(table).set(values).where(cond).returning()
    await audit(table, action, before, raw)
    await version(table, action, raw)
    return decryptRows(db, table, raw)
  }

  const ops: Ops<Scope> = {
    userId,
    orgId,
    where,

    async select(table, extra, options = {}) {
      let q = o
        .select()
        .from(table)
        .where(where(table, extra, options))
      if (options.orderBy) {
        q = q.orderBy(...(Array.isArray(options.orderBy) ? options.orderBy : [options.orderBy]))
      }
      if (options.limit !== undefined) q = q.limit(options.limit)
      if (options.offset !== undefined) q = q.offset(options.offset)
      return decryptRows(db, table, await q)
    },

    async insert(table, values) {
      const list = (Array.isArray(values) ? values : [values]) as Rec[]
      if (list.length === 0) return []
      where(table) // throws for a table an org scope cannot filter
      const owned = userId !== undefined && columnsOf(table).userId !== undefined
      const tenant = orgId !== undefined && columnsOf(table).orgId !== undefined
      const prepared = await Promise.all(
        list.map((v) => {
          if (owned && v.userId !== undefined && v.userId !== userId) {
            throw new SignetDbError(
              "CROSS_USER_WRITE",
              "A scoped insert got a userId that is not the scope's. Leave userId out; scoped() sets it.",
            )
          }
          if (tenant && v.orgId !== undefined && v.orgId !== orgId) {
            throw new SignetDbError(
              "CROSS_ORG_WRITE",
              "An org-scoped insert got an orgId that is not the scope's. Leave orgId out; scoped() sets it.",
            )
          }
          return encryptValues(db, table, {
            ...v,
            ...(owned ? { userId } : {}),
            ...(tenant ? { orgId } : {}),
          })
        }),
      )
      const raw: Rec[] = await o.insert(table).values(prepared).returning()
      await audit(table, "insert", [], raw)
      await version(table, "insert", raw)
      return decryptRows(db, table, raw)
    },

    update: (table, set, extra, options = {}) =>
      update(table, set as Rec, extra, options, "update"),

    async delete(table, extra, options = {}) {
      if (columnsOf(table).deletedAt && !options.hard) {
        return update(table, { deletedAt: new Date() }, extra, options, "delete")
      }
      if (userId === undefined && orgId === undefined && !extra) {
        throw new SignetDbError(
          "UNSCOPED_WRITE",
          "An unscoped update or delete needs a where clause, or it would touch every row. Pass one, or use scoped(db, { userId }).",
        )
      }
      const raw: Rec[] = await o
        .delete(table)
        .where(where(table, extra, options))
        .returning()
      await audit(table, "delete", raw, [])
      await version(table, "delete", raw)
      return decryptRows(db, table, raw)
    },
  } as Ops<Scope>
  states.set(ops, state)
  return ops
}
