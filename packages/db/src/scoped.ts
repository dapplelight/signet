/**
 * Per-user reads and writes, soft delete, and an opt-in audit trail.
 *
 * `scoped(db, { userId })` returns table operations that add
 * `where user_id = ?` to every read, update and delete, and set `userId` on
 * every insert, for tables with a `userId` column. Rows with a `deletedAt`
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

type Row<T extends Table> = InferSelectModel<T>
type HasUser<T extends Table> = "userId" extends keyof InferInsertModel<T> ? true : false

/** What an insert takes: the table's insert type, minus `userId` when scoped. */
export type NewRow<T extends Table, S extends boolean = true> = S extends true
  ? HasUser<T> extends true
    ? Omit<InferInsertModel<T>, "userId">
    : InferInsertModel<T>
  : InferInsertModel<T>

export type ReadOptions = { withDeleted?: boolean }
export type SelectOptions = ReadOptions & {
  orderBy?: Column | SQL | ReadonlyArray<Column | SQL>
  limit?: number
  offset?: number
}
export type DeleteOptions = ReadOptions & { hard?: boolean }

export type Ops<S extends boolean = true> = {
  /** The user this scope is bound to; undefined for unscoped `audited(db)`. */
  readonly userId: S extends true ? string : undefined
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

type State = { db: SignetDb<unknown>; userId?: string; actor?: Actor }
const states = new WeakMap<object, State>()

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
type Rec = Record<string, unknown>

/** Operations on `db` restricted to one user's rows. */
export function scoped<TOrm>(db: SignetDb<TOrm>, { userId }: { userId: string }): Ops<true> {
  if (!userId)
    throw new SignetDbError(
      "NO_USER_ID",
      "scoped() got an empty userId. Pass the signed-in user's id from the session.",
    )
  return make({ db, userId }) as Ops<true>
}

/**
 * Wrap scoped operations, or a whole db (unscoped, for admin jobs), so every
 * insert, update and delete also writes an audit entry. `actor` defaults to
 * `{ type: "user", id: userId }` of the scope.
 */
export function audited<S extends boolean>(target: Ops<S>, options?: { actor?: Actor }): Ops<S>
export function audited<TOrm>(target: SignetDb<TOrm>, options: { actor: Actor }): Ops<false>
export function audited(
  target: Ops<boolean> | SignetDb<unknown>,
  options: { actor?: Actor } = {},
): Ops<boolean> {
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

function primaryKey(table: Table): string | undefined {
  const cols = columnsOf(table)
  return Object.keys(cols).find((k) => cols[k]?.primary) ?? ("id" in cols ? "id" : undefined)
}

function make(state: State): Ops<boolean> {
  const { db, userId, actor } = state
  const o = db.orm as AnyOrm

  const where = (table: Table, extra?: SQL, options: ReadOptions = {}) => {
    const cols = columnsOf(table)
    const conds: SQL[] = []
    if (userId !== undefined && cols.userId) conds.push(eq(cols.userId, userId))
    if (cols.deletedAt && !options.withDeleted) conds.push(isNull(cols.deletedAt))
    if (extra) conds.push(extra)
    return and(...conds)
  }

  const audit = async (table: Table, action: string, before: Rec[], after: Rec[]) => {
    if (actor === undefined || !db.audit) return
    const pk = primaryKey(table)
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
    const cond = where(table, extra, options)
    if (userId === undefined && !extra) {
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
    return decryptRows(db, table, raw)
  }

  const ops: Ops<boolean> = {
    userId,
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
      const owned = userId !== undefined && columnsOf(table).userId !== undefined
      const prepared = await Promise.all(
        list.map((v) => {
          if (owned && v.userId !== undefined && v.userId !== userId) {
            throw new SignetDbError(
              "CROSS_USER_WRITE",
              "A scoped insert got a userId that is not the scope's. Leave userId out; scoped() sets it.",
            )
          }
          return encryptValues(db, table, owned ? { ...v, userId } : v)
        }),
      )
      const raw: Rec[] = await o.insert(table).values(prepared).returning()
      await audit(table, "insert", [], raw)
      return decryptRows(db, table, raw)
    },

    update: (table, set, extra, options = {}) =>
      update(table, set as Rec, extra, options, "update"),

    async delete(table, extra, options = {}) {
      if (columnsOf(table).deletedAt && !options.hard) {
        return update(table, { deletedAt: new Date() }, extra, options, "delete")
      }
      if (userId === undefined && !extra) {
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
      return decryptRows(db, table, raw)
    },
  } as Ops<boolean>
  states.set(ops, state)
  return ops
}
