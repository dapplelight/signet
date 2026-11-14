/**
 * An admin API from the schema: `defineAdmin(schema, { authorize })` gives
 * list (cursor pages, sort, typed filters, text search), get, create, update,
 * delete and bulk delete for every table, a metadata description for an admin
 * UI or an agent to render from, a framework-neutral `handle()` for HTTP, and
 * MCP tools via `adminTools`.
 *
 * Safe by default:
 * - Every operation asks `authorize(ctx, { table, op, row? })`; anything but
 *   `true` is a 403. `roles()` covers admin / staff / readonly.
 * - Encrypted columns and secret-looking ones (password, hash, token, secret,
 *   salt, api key, private key) are hidden: never returned, filtered, sorted
 *   or written. `reveal` opts one back in.
 * - Soft-deleted rows are left out unless a list or get asks for them, and
 *   delete on a soft-delete table sets `deletedAt`.
 * - Sort, filter and search take only allow-listed column keys, and all SQL
 *   is built from Drizzle column objects, never from request strings.
 * - Writes go through `audited(db, { actor: ctx.actor })`, so the db needs an
 *   audit table. An `auditLog()` table itself is list and get only.
 */

import {
  and,
  asc,
  type Column,
  desc,
  eq,
  getTableName,
  gt,
  gte,
  inArray,
  is,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
  Table,
} from "drizzle-orm"
import { z } from "zod"
import { jsonSchema } from "./agent.js"
import { decryptRows } from "./crypt.js"
import { columnsOf, isEncrypted, type SignetDb } from "./db.js"
import { type ColumnInfo, describeSchema } from "./describe.js"
import { SignetDbError } from "./errors.js"
import { type Actor, audited, type Ops } from "./scoped.js"
import { MANAGED_KEYS, toZod } from "./zod.js"

export type AdminOp = "list" | "get" | "create" | "update" | "delete" | "action"
export const ADMIN_OPS: readonly AdminOp[] = ["list", "get", "create", "update", "delete", "action"]

/** Who is asking. `actor` is written to the audit log; `role` is what `roles()` reads. */
export type AdminContext = { actor: Actor; role?: string }

type Rec = Record<string, unknown>

/** What `authorize` is asked. `row` is the stored row (get, update, delete, action, each listed row) or the new one (create). */
export type AdminCheck = {
  /** SQL table name. */
  table: string
  op: AdminOp
  /** The action's name, for `op: "action"`. */
  action?: string
  row?: Rec
  /** The validated changes, for create and update. */
  input?: Rec
}

/** Return exactly `true` to allow. Called once per op without `row`, then again per row. */
export type Authorize<C> = (ctx: C, check: AdminCheck) => boolean | Promise<boolean>

export type AdminAction<C> = {
  description: string
  /** Marks the MCP tool destructive. */
  destructive?: boolean
  /** A `z.object` for the action's input. Default: none. */
  input?: z.ZodType<Rec>
  /**
   * `ops` is `audited(db, { actor })`: write through it so the change is in
   * the audit log. `row` has only visible columns; the return value is sent
   * as-is, so leave out anything private.
   */
  run(args: { row: Rec; input: Rec; ctx: C; db: SignetDb<unknown>; ops: Ops<false> }): unknown
}

export type AdminTableConfig<C, K extends string = string> = {
  /** Columns a list view shows. Default: every visible column. Metadata only. */
  list?: K[]
  /** Columns `q` searches (text, case-insensitive contains). Default: visible text columns. */
  search?: K[]
  /** Columns a list may sort by; must be NOT NULL so cursors stay stable. Default: visible NOT NULL scalar columns. */
  sort?: K[]
  /** Columns a list may filter on. Default: visible scalar columns. */
  filter?: K[]
  /** Shown but never written. */
  readonly?: K[]
  /** Hidden in addition to the defaults (encrypted and secret-looking columns). */
  hidden?: K[]
  /** Default-hidden columns to show anyway. Encrypted ones are decrypted. */
  reveal?: K[]
  /** The ops this table allows at all, before `authorize`. Default: all. */
  ops?: AdminOp[]
  actions?: Record<string, AdminAction<C>>
}

type TablesOf<S> = {
  [K in keyof S as S[K] extends Table ? S[K]["_"]["name"] : never]: S[K]
}
type ColumnKey<T> = T extends Table ? keyof T["_"]["columns"] & string : string

export type AdminOptions<S, C> = {
  /** Required. Return `true` to allow; anything else (or a throw) denies. */
  authorize: Authorize<C>
  /** Per table, by SQL name. `false` leaves a table out. Every other table is included. */
  tables?: {
    [N in keyof TablesOf<S>]?: AdminTableConfig<C, ColumnKey<TablesOf<S>[N]>> | false
  }
  /** Most rows a list returns. Default 100. */
  maxRows?: number
}

export type FilterOp =
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "contains"
  | "startsWith"
  | "isNull"

/** `{ status: { eq: "open" }, price: { gte: 100 } }`. Conditions are ANDed. */
export type AdminFilter = Record<string, Partial<Record<FilterOp, unknown>>>

export type ListQuery = {
  limit?: number
  /** `nextCursor` from the previous page, with the same sort and order. */
  cursor?: string
  sort?: string
  order?: "asc" | "desc"
  filter?: AdminFilter
  /** Text search across the table's search columns. */
  q?: string
  withDeleted?: boolean
}

export type ListResult = { rows: Rec[]; nextCursor: string | null }

export type AdminColumn = Omit<ColumnInfo, "owner" | "softDelete" | "encrypted"> & {
  readonly: boolean
  list: boolean
  sortable: boolean
  filterable: boolean
  searchable: boolean
  /** Filter operators this column takes. */
  operators: FilterOp[]
}

export type AdminTableMeta = {
  name: string
  primaryKey: string[]
  softDelete: boolean
  /** The ops this caller may use. */
  ops: AdminOp[]
  actions: { name: string; description: string; destructive: boolean }[]
  columns: AdminColumn[]
  relations: { columns: string[]; references: string; referencedColumns: string[] }[]
  defaultSort: { sort: string; order: "asc" | "desc" }
}

export type AdminMeta = { tables: AdminTableMeta[] }

/** What `handle` takes: the method, the route params, the query string and the parsed JSON body. */
export type AdminRequest = {
  method: string
  table?: string
  id?: string
  action?: string
  query?: Record<string, string | undefined>
  body?: unknown
}

export type AdminResponse = { status: 200 | 201; body: unknown }

/**
 * A deliberate failure with an HTTP status and the Signet envelope's code.
 * `getResponse()` makes it read as an HTTPException by shape, so
 * signet-server's MCP tools keep its code and message instead of masking it.
 */
export class AdminError extends SignetDbError {
  readonly status: 400 | 403 | 404 | 405
  readonly details?: { formErrors: string[]; fieldErrors: Record<string, string[]> }
  constructor(
    status: AdminError["status"],
    code: "VALIDATION_FAILED" | "FORBIDDEN" | "NOT_FOUND" | "METHOD_NOT_ALLOWED",
    message: string,
    details?: AdminError["details"],
  ) {
    super(code, message)
    this.status = status
    if (details) this.details = details
  }
  getResponse(): Response {
    const body = {
      success: false,
      error: this.message,
      code: this.code,
      ...(this.details ? { details: this.details } : {}),
    }
    return Response.json(body, { status: this.status })
  }
}

const SECRET = /password|passwd|secret|token|hash|salt|api_?key|private_?key/i
const SCALAR = new Set(["string", "number", "bigint", "boolean", "date"])
const COMPARABLE = new Set(["string", "number", "bigint", "date"])

type Model<C> = {
  name: string
  table: Table
  cols: Record<string, Column>
  info: AdminTableMeta
  pk: string[]
  id?: string
  visible: string[]
  /** An `auditLog()` table: list and get only, snapshots redacted. */
  audit: boolean
  revealedEncrypted: boolean
  sortable: Set<string>
  filterable: Set<string>
  searchable: string[]
  ops: Set<AdminOp>
  actions: Record<string, AdminAction<C>>
  insert: z.ZodObject
  update: z.ZodObject
  values: Record<string, z.ZodType>
}

const has = (o: object, k: string) => Object.hasOwn(o, k)

function bad(field: string, message: string): AdminError {
  return new AdminError(400, "VALIDATION_FAILED", "Validation failed", {
    formErrors: [],
    fieldErrors: { [field]: [message] },
  })
}

function validate<T>(schema: z.ZodType<T>, input: unknown, prefix = ""): T {
  const r = schema.safeParse(input)
  if (r.success) return r.data
  const formErrors: string[] = []
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of r.error.issues) {
    const path = [prefix, ...issue.path.map(String)].filter(Boolean).join(".")
    if (!path) formErrors.push(issue.message)
    else fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  }
  throw new AdminError(400, "VALIDATION_FAILED", "Validation failed", { formErrors, fieldErrors })
}

function isAuditTable(cols: Record<string, Column>): boolean {
  return ["actorType", "actorId", "action", "tableName", "before", "after"].every((k) => k in cols)
}

function model<C>(table: Table, config: AdminTableConfig<C>): Model<C> {
  const name = getTableName(table)
  const cols = columnsOf(table)
  const keys = Object.keys(cols)
  const fail = (m: string) => new SignetDbError("BAD_CONFIG", `defineAdmin: ${name}: ${m}`)
  const known = (list: string[] | undefined, what: string) => {
    for (const k of list ?? []) if (!has(cols, k)) throw fail(`${what} names unknown column ${k}.`)
    return list
  }
  const col = (k: string) => cols[k] as Column
  const reveal = new Set(known(config.reveal, "reveal"))
  const hidden = new Set([
    ...keys.filter(
      (k) => !reveal.has(k) && (isEncrypted(col(k)) || SECRET.test(k) || SECRET.test(col(k).name)),
    ),
    ...(known(config.hidden, "hidden") ?? []),
  ])
  const visible = keys.filter((k) => !hidden.has(k))
  const scalar = (k: string) => SCALAR.has(col(k).dataType) && !isEncrypted(col(k))
  const pick = (
    list: string[] | undefined,
    what: string,
    ok: (k: string) => boolean,
    def: string[],
  ) => {
    for (const k of known(list, what) ?? []) {
      if (hidden.has(k)) throw fail(`${what} names hidden column ${k}.`)
      if (!ok(k)) throw fail(`${what} cannot use column ${k} (see the option's doc).`)
    }
    return list ?? def
  }
  const sortOk = (k: string) => scalar(k) && col(k).notNull
  const filterOk = scalar
  const searchOk = (k: string) => col(k).dataType === "string" && !isEncrypted(col(k))
  const sortable = new Set(pick(config.sort, "sort", sortOk, visible.filter(sortOk)))
  const filterable = new Set(pick(config.filter, "filter", filterOk, visible.filter(filterOk)))
  const searchable = pick(config.search, "search", searchOk, visible.filter(searchOk))
  const listCols = new Set(pick(config.list, "list", () => true, visible))
  const readonly = new Set(known(config.readonly, "readonly"))

  const described = describeSchema([table], { format: "json" }).tables[0]
  if (!described) throw fail("not a table.")
  const pk = described.primaryKey.map((n) => keys.find((k) => col(k).name === n) as string)
  const id = pk.length === 1 ? pk[0] : undefined
  const audit = isAuditTable(cols)
  const ops = new Set<AdminOp>(
    (config.ops ?? ADMIN_OPS).filter(
      (op) =>
        (id || op === "list") &&
        (!audit || op === "list" || op === "get") &&
        (op !== "action" || Object.keys(config.actions ?? {}).length > 0),
    ),
  )

  const writable = (s: z.ZodType) =>
    z
      .object(
        Object.fromEntries(
          Object.entries((s as z.ZodObject).shape).filter(
            ([k]) => !hidden.has(k) && !readonly.has(k),
          ),
        ),
      )
      .strict()
  const operators = (k: string): FilterOp[] => {
    if (!filterable.has(k)) return []
    const t = col(k).dataType
    return [
      "eq",
      "ne",
      "in",
      "isNull",
      ...(COMPARABLE.has(t) ? (["lt", "lte", "gt", "gte"] as const) : []),
      ...(t === "string" ? (["contains", "startsWith"] as const) : []),
    ]
  }
  const byName = new Map(keys.map((k) => [col(k).name, k]))
  const info: AdminTableMeta = {
    name,
    primaryKey: pk,
    softDelete: "deletedAt" in cols,
    ops: [],
    actions: [],
    columns: described.columns
      .filter((c) => !hidden.has(c.key))
      .map(({ owner: _o, softDelete: _s, encrypted: _e, ...c }) => ({
        ...c,
        readonly: readonly.has(c.key) || (MANAGED_KEYS as readonly string[]).includes(c.key),
        list: listCols.has(c.key),
        sortable: sortable.has(c.key),
        filterable: filterable.has(c.key),
        searchable: searchable.includes(c.key),
        operators: operators(c.key),
      })),
    relations: described.relations
      .map((r) => ({ ...r, columns: r.columns.map((n) => byName.get(n) ?? n) }))
      .filter((r) => r.columns.every((k) => !hidden.has(k))),
    defaultSort: { sort: id && !hidden.has(id) ? id : (pk[0] ?? keys[0] ?? ""), order: "desc" },
  }

  return {
    name,
    table,
    cols,
    info,
    pk,
    ...(id ? { id } : {}),
    visible,
    audit,
    revealedEncrypted: visible.some((k) => isEncrypted(col(k))),
    sortable,
    filterable,
    searchable,
    ops,
    actions: config.actions ?? {},
    insert: writable(toZod(table, { mode: "insert", keep: ["userId"] })),
    update: writable(toZod(table, { mode: "update" })),
    values: (toZod(table, { mode: "update", keep: MANAGED_KEYS }) as unknown as z.ZodObject)
      .shape as Record<string, z.ZodType>,
  }
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any

/** Held back by an approval gate: `value` is what the gate returned. */
class Held {
  constructor(readonly value: unknown) {}
}
type Gate = (summary: string, details: Rec) => Promise<unknown>

const encodeCursor = (c: { s: string; o: string; k: unknown[] }) => {
  const bytes = new TextEncoder().encode(JSON.stringify(c))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}
const decodeCursor = (s: string): { s: string; o: string; k: unknown[] } | undefined => {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"))
    const v = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
    return v && typeof v.s === "string" && typeof v.o === "string" && Array.isArray(v.k)
      ? v
      : undefined
  } catch {
    return undefined
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

export type Admin<C extends AdminContext> = ReturnType<typeof build<C>>

/**
 * Define the admin API for a schema module (`import * as schema`) or a list
 * of tables. Pure: no db yet; each call takes the request's db and context.
 */
export function defineAdmin<
  S extends Record<string, unknown> | readonly unknown[],
  C extends AdminContext,
>(schema: S, options: AdminOptions<S, C>) {
  return build<C>(schema, options as AdminOptions<unknown, C>)
}

function build<C extends AdminContext>(
  schema: Record<string, unknown> | readonly unknown[],
  options: AdminOptions<unknown, C>,
) {
  const maxRows = options.maxRows ?? 100
  const configs = (options.tables ?? {}) as Record<string, AdminTableConfig<C> | false>
  const models = new Map<string, Model<C>>()
  for (const t of Object.values(schema)) {
    if (!is(t, Table)) continue
    const name = getTableName(t)
    const config = has(configs, name) ? configs[name] : {}
    if (config === false || config === undefined) continue
    models.set(name, model(t, config))
  }
  for (const name of Object.keys(configs)) {
    if (!models.has(name) && configs[name] !== false)
      throw new SignetDbError(
        "BAD_CONFIG",
        `defineAdmin: tables names ${name}, which is not in the schema.`,
      )
  }

  const allowed = async (ctx: C, check: AdminCheck) => {
    try {
      return (await options.authorize?.(ctx, check)) === true
    } catch {
      return false
    }
  }

  const find = (table: string | undefined): Model<C> => {
    const m = table === undefined ? undefined : models.get(table)
    if (!m) throw new AdminError(404, "NOT_FOUND", `No admin table ${String(table)}.`)
    return m
  }

  const gate = async (ctx: C, m: Model<C>, op: AdminOp, extra: Partial<AdminCheck> = {}) => {
    if (!m.ops.has(op))
      throw new AdminError(405, "METHOD_NOT_ALLOWED", `${op} is not enabled on ${m.name}.`)
    if (!(await allowed(ctx, { table: m.name, op, ...extra })))
      throw new AdminError(403, "FORBIDDEN", `Not allowed to ${op} ${m.name}.`)
  }

  const pickVisible = (m: Model<C>, row: Rec): Rec =>
    Object.fromEntries(m.visible.filter((k) => has(row, k)).map((k) => [k, row[k]]))
  // Audit snapshots hold whole rows, hidden columns included: show only what
  // the audited table's own admin view shows, and nothing for a table left out.
  const snapshot = (table: unknown, v: unknown) => {
    if (v === null || typeof v !== "object" || table === "*") return v // "*": deleteUser's counts
    const target = typeof table === "string" ? models.get(table) : undefined
    return target ? pickVisible(target, v as Rec) : null
  }
  const strip = (m: Model<C>, row: Rec): Rec => {
    const out = pickVisible(m, row)
    if (!m.audit) return out
    if (has(out, "before")) out.before = snapshot(row.tableName, row.before)
    if (has(out, "after")) out.after = snapshot(row.tableName, row.after)
    return out
  }

  const read = async (
    db: SignetDb<unknown>,
    m: Model<C>,
    where: SQL | undefined,
    extra: { orderBy?: SQL[]; limit?: number } = {},
  ) => {
    const o = db.orm as AnyOrm
    const fields = Object.fromEntries(
      [...new Set([...m.visible, ...m.pk])].map((k) => [k, m.cols[k] as Column]),
    )
    let q = o.select(fields).from(m.table).where(where)
    if (extra.orderBy) q = q.orderBy(...extra.orderBy)
    if (extra.limit !== undefined) q = q.limit(extra.limit)
    const rows: Rec[] = await q
    return m.revealedEncrypted ? decryptRows(db, m.table, rows) : rows
  }

  const live = (m: Model<C>, withDeleted?: boolean) =>
    m.cols.deletedAt && !withDeleted ? isNull(m.cols.deletedAt) : undefined

  const idValue = (m: Model<C>, raw: unknown): unknown => {
    const c = m.cols[m.id as string] as Column
    if (c.dataType === "number") {
      const n = typeof raw === "number" ? raw : Number(raw)
      if (raw === "" || !Number.isSafeInteger(n)) throw bad("id", "Expected an integer id.")
      return n
    }
    if (typeof raw !== "string" || raw === "") throw bad("id", "Expected an id.")
    return raw
  }

  const byId = (m: Model<C>, id: unknown) => eq(m.cols[m.id as string] as Column, idValue(m, id))

  const one = async (db: SignetDb<unknown>, m: Model<C>, id: unknown, withDeleted?: boolean) => {
    const [row] = await read(db, m, and(byId(m, id), live(m, withDeleted)), { limit: 1 })
    if (!row) throw new AdminError(404, "NOT_FOUND", `No ${m.name} row with ${m.id} ${String(id)}.`)
    return row
  }

  const writer = (db: SignetDb<unknown>, ctx: C) => audited(db, { actor: ctx.actor })

  const filterCond = (m: Model<C>, filter: unknown, dialect: string): SQL[] => {
    if (filter === undefined) return []
    if (typeof filter !== "object" || filter === null || Array.isArray(filter))
      throw bad("filter", "Expected an object of { column: { operator: value } }.")
    const conds: SQL[] = []
    for (const [k, spec] of Object.entries(filter)) {
      if (!m.filterable.has(k)) throw bad(`filter.${k}`, `Cannot filter ${m.name} on ${k}.`)
      if (typeof spec !== "object" || spec === null || Array.isArray(spec))
        throw bad(`filter.${k}`, "Expected { operator: value }.")
      const col = m.cols[k] as Column
      const allowedOps = m.info.columns.find((c) => c.key === k)?.operators ?? []
      const value = m.values[k] as z.ZodType
      for (const [op, raw] of Object.entries(spec as Rec)) {
        const path = `filter.${k}.${op}`
        if (!(allowedOps as string[]).includes(op))
          throw bad(
            path,
            `Operator ${op} does not apply to ${k}; use one of ${allowedOps.join(", ")}.`,
          )
        const v = (s: z.ZodType) => {
          if (raw === undefined || raw === null)
            throw bad(path, "Expected a value; use isNull for nulls.")
          return validate(s, raw, path)
        }
        const like = (pattern: string) =>
          sql`${col} ${sql.raw(dialect === "pg" ? "ilike" : "like")} ${pattern} escape '\\'`
        switch (op as FilterOp) {
          case "eq":
            conds.push(eq(col, v(value)))
            break
          case "ne":
            conds.push(ne(col, v(value)))
            break
          case "lt":
            conds.push(lt(col, v(value)))
            break
          case "lte":
            conds.push(lte(col, v(value)))
            break
          case "gt":
            conds.push(gt(col, v(value)))
            break
          case "gte":
            conds.push(gte(col, v(value)))
            break
          case "in": {
            const list = v(z.array(value).min(1).max(maxRows)) as unknown[]
            conds.push(inArray(col, list))
            break
          }
          case "contains":
            conds.push(like(`%${escapeLike(v(z.string()) as string)}%`))
            break
          case "startsWith":
            conds.push(like(`${escapeLike(v(z.string()) as string)}%`))
            break
          case "isNull":
            conds.push(v(z.boolean()) ? isNull(col) : isNotNull(col))
            break
        }
      }
    }
    return conds
  }
  const listShape = (m: Model<C>) => ({
    limit: z.number().int().min(1).max(maxRows).optional(),
    cursor: z.string().max(2000).optional(),
    sort: (m.sortable.size
      ? z.enum([...m.sortable] as [string, ...string[]])
      : z.never()
    ).optional(),
    order: z.enum(["asc", "desc"]).optional(),
    filter: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    q: z.string().max(200).optional(),
    withDeleted: z.boolean().optional(),
  })

  async function list(
    db: SignetDb<unknown>,
    ctx: C,
    table: string,
    query: ListQuery = {},
  ): Promise<ListResult> {
    const m = find(table)
    await gate(ctx, m, "list")
    const qv = validate(z.object(listShape(m)).strict(), query)
    const sort = qv.sort ?? m.info.defaultSort.sort
    const order = qv.order ?? "desc"
    const limit = qv.limit ?? Math.min(50, maxRows)
    const conds: (SQL | undefined)[] = [
      live(m, qv.withDeleted),
      ...filterCond(m, qv.filter, db.dialect),
    ]
    if (qv.q && m.searchable.length) {
      const pattern = `%${escapeLike(qv.q)}%`
      const op = sql.raw(db.dialect === "pg" ? "ilike" : "like")
      conds.push(
        or(...m.searchable.map((k) => sql`${m.cols[k] as Column} ${op} ${pattern} escape '\\'`)),
      )
    }
    const keys = [sort, ...m.pk.filter((k) => k !== sort)]
    if (qv.cursor !== undefined) {
      const c = decodeCursor(qv.cursor)
      if (!c || c.s !== sort || c.o !== order || c.k.length !== m.pk.length)
        throw bad(
          "cursor",
          "This cursor is for a different sort, or is not a cursor. Start from the first page.",
        )
      const anchorWhere = and(...m.pk.map((k, i) => eq(m.cols[k] as Column, c.k[i])))
      const o = db.orm as AnyOrm
      const [anchor] = await o.select({ x: sql`1` }).from(m.table).where(anchorWhere).limit(1)
      if (!anchor)
        throw bad("cursor", "The row this cursor points at is gone. Start from the first page.")
      // Compare against the anchor row in SQL, not a value round-tripped
      // through JSON: Postgres timestamps carry microseconds that a JS Date drops.
      const at = (k: string) =>
        sql`(select ${m.cols[k] as Column} from ${m.table} where ${anchorWhere})`
      const cmp = order === "desc" ? lt : gt
      const after = (i: number): SQL => {
        const col = m.cols[keys[i] as string] as Column
        const key = keys[i] as string
        if (i === keys.length - 1) return cmp(col, at(key))
        return or(cmp(col, at(key)), and(eq(col, at(key)), after(i + 1))) as SQL
      }
      conds.push(after(0))
    }
    const dir = order === "desc" ? desc : asc
    const rows = await read(db, m, and(...conds), {
      orderBy: keys.map((k) => dir(m.cols[k] as Column)),
      limit: limit + 1,
    })
    const more = rows.length > limit
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    const out: Rec[] = []
    for (const r of page) {
      const row = strip(m, r)
      if (await allowed(ctx, { table: m.name, op: "list", row })) out.push(row)
    }
    return {
      rows: out,
      nextCursor:
        more && last ? encodeCursor({ s: sort, o: order, k: m.pk.map((k) => last[k]) }) : null,
    }
  }

  async function get(
    db: SignetDb<unknown>,
    ctx: C,
    table: string,
    id: unknown,
    options: { withDeleted?: boolean } = {},
  ) {
    const m = find(table)
    await gate(ctx, m, "get")
    const row = strip(m, await one(db, m, id, options.withDeleted))
    await gate(ctx, m, "get", { row })
    return row
  }

  const hold = async (g: Gate | undefined, summary: string, details: Rec) => {
    if (!g) return
    const v = await g(summary, details)
    if (v !== undefined) throw new Held(v)
  }

  async function create(db: SignetDb<unknown>, ctx: C, table: string, body: unknown, g?: Gate) {
    const m = find(table)
    await gate(ctx, m, "create")
    const input = validate(m.insert, body) as Rec
    await gate(ctx, m, "create", { row: input, input })
    await hold(g, `Create a ${m.name} row`, input)
    const [row] = await writer(db, ctx).insert(m.table, input as never)
    return strip(m, row as Rec)
  }

  async function update(
    db: SignetDb<unknown>,
    ctx: C,
    table: string,
    id: unknown,
    body: unknown,
    g?: Gate,
  ) {
    const m = find(table)
    await gate(ctx, m, "update")
    const input = validate(m.update, body) as Rec
    if (Object.keys(input).length === 0) throw bad("(body)", "Nothing to change.")
    const before = strip(m, await one(db, m, id))
    await gate(ctx, m, "update", { row: before, input })
    await hold(g, `Update ${m.name} ${String(id)}`, { before, changes: input })
    const [row] = await writer(db, ctx).update(m.table, input as never, byId(m, id))
    if (!row) throw new AdminError(404, "NOT_FOUND", `No ${m.name} row with ${m.id} ${String(id)}.`)
    return strip(m, row as Rec)
  }

  async function remove(db: SignetDb<unknown>, ctx: C, table: string, id: unknown, g?: Gate) {
    const m = find(table)
    await gate(ctx, m, "delete")
    const row = strip(m, await one(db, m, id))
    await gate(ctx, m, "delete", { row })
    const soft = m.info.softDelete
    await hold(g, `${soft ? "Delete" : "Permanently delete"} ${m.name} ${String(id)}`, { row })
    await writer(db, ctx).delete(m.table, byId(m, id))
    return { id: row[m.id as string] ?? id, soft }
  }

  async function bulkDelete(db: SignetDb<unknown>, ctx: C, table: string, ids: unknown) {
    const m = find(table)
    await gate(ctx, m, "delete")
    const list = validate(
      z
        .array(z.union([z.string(), z.number()]))
        .min(1)
        .max(maxRows),
      ids,
      "ids",
    )
    const values = list.map((v) => idValue(m, v))
    const pk = m.cols[m.id as string] as Column
    const rows = await read(db, m, and(inArray(pk, values), live(m)))
    const found = rows.map((r) => r[m.id as string])
    for (const [i, row] of rows.map((r) => strip(m, r)).entries()) {
      if (!(await allowed(ctx, { table: m.name, op: "delete", row })))
        throw new AdminError(
          403,
          "FORBIDDEN",
          `Not allowed to delete ${m.name} ${String(found[i])}; nothing was deleted.`,
        )
    }
    if (found.length) await writer(db, ctx).delete(m.table, inArray(pk, found))
    return { ids: found, soft: m.info.softDelete }
  }

  async function action(
    db: SignetDb<unknown>,
    ctx: C,
    table: string,
    id: unknown,
    name: string,
    body: unknown,
    g?: Gate,
  ) {
    const m = find(table)
    const def = has(m.actions, name) ? m.actions[name] : undefined
    if (!def) throw new AdminError(404, "NOT_FOUND", `No action ${name} on ${m.name}.`)
    await gate(ctx, m, "action", { action: name })
    const input = def.input ? (validate(def.input, body ?? {}) as Rec) : {}
    const row = strip(m, await one(db, m, id))
    await gate(ctx, m, "action", { action: name, row, input })
    await hold(g, `${name} on ${m.name} ${String(id)}`, { row, input })
    return (await def.run({ row, input, ctx, db, ops: writer(db, ctx) })) ?? null
  }

  async function meta(ctx: C): Promise<AdminMeta> {
    const tables: AdminTableMeta[] = []
    for (const m of models.values()) {
      const ops: AdminOp[] = []
      for (const op of m.ops)
        if (op !== "action" && (await allowed(ctx, { table: m.name, op }))) ops.push(op)
      const actions: AdminTableMeta["actions"] = []
      for (const [name, a] of Object.entries(m.actions))
        if (
          m.ops.has("action") &&
          (await allowed(ctx, { table: m.name, op: "action", action: name }))
        )
          actions.push({ name, description: a.description, destructive: a.destructive ?? false })
      if (actions.length) ops.push("action")
      if (ops.length) tables.push({ ...m.info, ops, actions })
    }
    return { tables }
  }

  /**
   * One HTTP request, framework-neutral. Routes, relative to the mount point:
   *
   *   GET    /                        meta
   *   GET    /:table                  list (?limit&cursor&sort&order&q&withDeleted&filter=<json>)
   *   POST   /:table                  create (201)
   *   GET    /:table/:id              get (?withDeleted)
   *   PATCH  /:table/:id              update
   *   DELETE /:table/:id              delete
   *   POST   /:table/bulk-delete      bulk delete, body { ids }
   *   POST   /:table/:id/:action      run an action
   *
   * Throws `AdminError` for a deliberate failure; signet-server's
   * `adminRoutes` turns it into the error envelope.
   */
  async function handle(db: SignetDb<unknown>, ctx: C, req: AdminRequest): Promise<AdminResponse> {
    const method = req.method.toUpperCase()
    const q = req.query ?? {}
    const flag = (v: string | undefined) => v === "true" || v === "1"
    const ok = (body: unknown, status: 200 | 201 = 200): AdminResponse => ({ status, body })
    const nope = () =>
      new AdminError(405, "METHOD_NOT_ALLOWED", `${method} is not an admin route here.`)
    if (req.table === undefined) {
      if (method === "GET") return ok(await meta(ctx))
      throw nope()
    }
    if (req.id === undefined) {
      if (method === "POST") return ok(await create(db, ctx, req.table, req.body), 201)
      if (method !== "GET") throw nope()
      let filter: unknown
      if (q.filter !== undefined) {
        try {
          filter = JSON.parse(q.filter)
        } catch {
          throw bad("filter", 'Expected JSON, e.g. {"status":{"eq":"open"}}.')
        }
      }
      const limit = q.limit === undefined ? undefined : Number(q.limit)
      return ok(
        await list(db, ctx, req.table, {
          ...(limit !== undefined ? { limit } : {}),
          ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
          ...(q.sort !== undefined ? { sort: q.sort } : {}),
          ...(q.order !== undefined ? { order: q.order as "asc" } : {}),
          ...(q.q !== undefined ? { q: q.q } : {}),
          ...(filter !== undefined ? { filter: filter as AdminFilter } : {}),
          ...(flag(q.withDeleted) ? { withDeleted: true } : {}),
        }),
      )
    }
    if (req.action !== undefined) {
      if (method !== "POST") throw nope()
      return ok(await action(db, ctx, req.table, req.id, req.action, req.body))
    }
    if (method === "POST" && req.id === "bulk-delete") {
      const ids = (req.body as { ids?: unknown } | undefined)?.ids
      return ok(await bulkDelete(db, ctx, req.table, ids))
    }
    if (method === "GET")
      return ok(await get(db, ctx, req.table, req.id, { withDeleted: flag(q.withDeleted) }))
    if (method === "PATCH") return ok(await update(db, ctx, req.table, req.id, req.body))
    if (method === "DELETE") return ok(await remove(db, ctx, req.table, req.id))
    throw nope()
  }

  /** @internal Used by `adminTools`: run a write behind an approval gate. */
  const gated = async (fn: (g: Gate) => Promise<unknown>, g: Gate) => {
    try {
      return await fn(g)
    } catch (e) {
      if (e instanceof Held) return e.value
      throw e
    }
  }

  return {
    tables: [...models.keys()],
    meta,
    list,
    get,
    create: (db: SignetDb<unknown>, ctx: C, table: string, body: unknown) =>
      create(db, ctx, table, body),
    update: (db: SignetDb<unknown>, ctx: C, table: string, id: unknown, body: unknown) =>
      update(db, ctx, table, id, body),
    delete: (db: SignetDb<unknown>, ctx: C, table: string, id: unknown) =>
      remove(db, ctx, table, id),
    bulkDelete,
    action: (
      db: SignetDb<unknown>,
      ctx: C,
      table: string,
      id: unknown,
      name: string,
      body?: unknown,
    ) => action(db, ctx, table, id, name, body),
    handle,
    /** @internal */
    _tools: { find, listShape, create, update, remove, action, gated, maxRows },
  }
}

/** Role presets for `roles()`: admin does everything, staff all but delete, readonly reads. */
export const DEFAULT_ROLES: Record<string, readonly AdminOp[] | "*"> = {
  admin: "*",
  staff: ["list", "get", "create", "update", "action"],
  readonly: ["list", "get"],
}

/**
 * An `authorize` from roles: `ctx.role` picks the ops it may use on every
 * table. Unknown or missing roles are denied.
 *
 * ```ts
 * defineAdmin(schema, { authorize: roles() })                         // DEFAULT_ROLES
 * defineAdmin(schema, { authorize: roles({ ...DEFAULT_ROLES, support: ["list", "get", "update"] }) })
 * ```
 */
export function roles(
  map: Record<string, readonly AdminOp[] | "*"> = DEFAULT_ROLES,
): Authorize<AdminContext> {
  return (ctx, { op }) => {
    const role = ctx.role
    if (!role || !has(map, role)) return false
    const ops = map[role]
    return ops === "*" || (ops?.includes(op) ?? false)
  }
}

export type AdminTool = {
  readonly name: string
  readonly description: string
  readonly annotations: { readOnlyHint: boolean; destructiveHint: boolean }
  readonly input: z.ZodType<Rec>
  readonly inputSchema: Record<string, unknown>
  /** `toolCtx` is signet-server's `ToolContext`, passed to `approve`. */
  run(input: unknown, toolCtx?: unknown): Promise<unknown>
  handler(input: unknown, toolCtx?: unknown): Promise<unknown>
}

/**
 * Same contract as signet-server's `requireApproval`: undefined to go ahead,
 * anything else is returned from the tool as-is and nothing is written.
 */
export type Approve = (
  toolCtx: never,
  request: { summary: string; details?: Rec; args?: unknown },
) => Promise<unknown>

export type AdminToolsOptions<C> = {
  db: SignetDb<unknown>
  /** The caller, as for `handle`. */
  ctx: C
  /**
   * Gate for create, update, delete and actions; pass signet-server's
   * `requireApproval`. Without it no write tools are made.
   */
  approve?: Approve
  /** Recorded in the audit log for writes. Default `{ type: "agent", id: ctx.actor.id }`. */
  actor?: Actor
}

/**
 * MCP tools from an admin definition, for one caller: `admin_schema`, and per
 * table `admin_<table>_list`, `_search`, `_get`, plus `_create`, `_update`,
 * `_delete` and one per action when `approve` is given. Only ops `authorize`
 * allows this caller are listed, and each call is authorized again.
 *
 * ```ts
 * import { requireApproval } from "@dapplelight/signet-server/mcp"
 * tools: async ({ c }) => adminTools(admin, { db: dbFor(c), ctx: await adminCtx(c), approve: requireApproval })
 * ```
 */
export async function adminTools<C extends AdminContext>(
  admin: Admin<C>,
  options: AdminToolsOptions<C>,
): Promise<AdminTool[]> {
  const { db, approve } = options
  const ctx = {
    ...options.ctx,
    actor: options.actor ?? { type: "agent", id: options.ctx.actor.id },
  } as C
  const t = admin._tools
  const meta = await admin.meta(ctx)
  const tools: AdminTool[] = []
  const add = (
    name: string,
    description: string,
    shape: Record<string, z.ZodType>,
    kind: "read" | "write" | "destroy",
    fn: (input: Rec, toolCtx: unknown) => Promise<unknown>,
  ) => {
    const input = z.object(shape).strict()
    const run = async (raw: unknown, toolCtx?: unknown) =>
      fn(validate(input, raw ?? {}) as Rec, toolCtx)
    tools.push({
      name,
      description,
      annotations: { readOnlyHint: kind === "read", destructiveHint: kind === "destroy" },
      input,
      inputSchema: jsonSchema(input),
      run,
      handler: run,
    })
  }
  const gateFor =
    (toolCtx: unknown, args: Rec): Gate =>
    (summary, details) =>
      (approve as Approve)(toolCtx as never, { summary, details, args })
  const idSchema = z.union([z.string(), z.number()])

  add(
    "admin_schema",
    "Describe the admin tables you may use: columns, types, relations, allowed ops, filter operators and actions.",
    {},
    "read",
    async () => meta,
  )

  for (const tm of meta.tables) {
    const m = t.find(tm.name)
    const can = new Set(tm.ops)
    const n = `admin_${tm.name}`
    if (can.has("list")) {
      add(
        `${n}_list`,
        `List ${tm.name} rows. Page with nextCursor (same sort and order). filter is { column: { operator: value } }; see admin_schema for columns and operators. At most ${t.maxRows} per call.`,
        t.listShape(m),
        "read",
        (i) => admin.list(db, ctx, tm.name, i as ListQuery),
      )
      if (m.searchable.length)
        add(
          `${n}_search`,
          `Find ${tm.name} rows whose ${m.searchable.join(", ")} contain the text (case-insensitive).`,
          {
            q: z.string().min(1).max(200),
            limit: z.number().int().min(1).max(t.maxRows).optional(),
          },
          "read",
          (i) => admin.list(db, ctx, tm.name, i as ListQuery),
        )
    }
    if (can.has("get"))
      add(`${n}_get`, `Get one ${tm.name} row by ${m.id}.`, { id: idSchema }, "read", (i) =>
        admin.get(db, ctx, tm.name, i.id),
      )
    if (!approve) continue
    if (can.has("create"))
      add(
        `${n}_create`,
        `Create a ${tm.name} row. Asks the person to approve first; nothing is written without it.`,
        { values: m.insert },
        "write",
        (i, tc) => t.gated((g) => t.create(db, ctx, tm.name, i.values, g), gateFor(tc, i)),
      )
    if (can.has("update"))
      add(
        `${n}_update`,
        `Change fields of one ${tm.name} row. Asks the person to approve first.`,
        { id: idSchema, set: m.update.partial() },
        "write",
        (i, tc) => t.gated((g) => t.update(db, ctx, tm.name, i.id, i.set, g), gateFor(tc, i)),
      )
    if (can.has("delete"))
      add(
        `${n}_delete`,
        `${tm.softDelete ? "Soft-delete" : "Permanently delete"} one ${tm.name} row. Asks the person to approve first.`,
        { id: idSchema },
        "destroy",
        (i, tc) => t.gated((g) => t.remove(db, ctx, tm.name, i.id, g), gateFor(tc, i)),
      )
    for (const a of tm.actions) {
      const def = m.actions[a.name] as AdminAction<C>
      add(
        `${n}_${a.name}`,
        `${a.description} Runs on one ${tm.name} row. Asks the person to approve first.`,
        { id: idSchema, ...(def.input ? { input: def.input } : {}) },
        a.destructive ? "destroy" : "write",
        (i, tc) =>
          t.gated((g) => t.action(db, ctx, tm.name, i.id, a.name, i.input, g), gateFor(tc, i)),
      )
    }
  }
  return tools
}
