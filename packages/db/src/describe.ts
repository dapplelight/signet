/**
 * `describeSchema(tables)`: what an agent or reviewer needs to know about the
 * tables, as plain text, or as JSON with `{ format: "json" }`: columns and
 * types, primary keys, foreign keys, and which columns are money, encrypted,
 * the per-user owner or the soft-delete marker.
 */

import { type Column, getTableName, is, Table } from "drizzle-orm"
import { getTableConfig as pgConfig } from "drizzle-orm/pg-core"
import { SQLiteTable, getTableConfig as sqliteConfig } from "drizzle-orm/sqlite-core"
import { columnsOf, isEncrypted } from "./db.js"

export type ColumnInfo = {
  /** SQL name. */
  name: string
  /** JS property name, the one signet-db and Drizzle take. */
  key: string
  type: string
  notNull: boolean
  primaryKey: boolean
  unique: boolean
  hasDefault: boolean
  enum?: string[]
  /** AES-GCM ciphertext at rest; cannot be filtered on. */
  encrypted: boolean
  /** For a money amount: the JS key of its currency column. */
  moneyCurrency?: string
  /** The `userId` owner column: rows are per user. */
  owner: boolean
  /** The `deletedAt` soft-delete marker: null means live. */
  softDelete: boolean
}

export type TableInfo = {
  name: string
  columns: ColumnInfo[]
  primaryKey: string[]
  /** Has a `userId` column, so `scoped()` restricts it per user. */
  scoped: boolean
  softDelete: boolean
  relations: { columns: string[]; references: string; referencedColumns: string[] }[]
}

export type SchemaInfo = { tables: TableInfo[] }

type Tables = readonly Table[] | Record<string, unknown>

function info(table: Table): TableInfo {
  const cols = columnsOf(table)
  const config = is(table, SQLiteTable) ? sqliteConfig(table) : pgConfig(table as never)
  const columns: ColumnInfo[] = Object.entries(cols).map(([key, c]: [string, Column]) => ({
    name: c.name,
    key,
    type: c.getSQLType(),
    notNull: c.notNull,
    primaryKey: c.primary,
    unique: c.isUnique,
    hasDefault: c.hasDefault,
    ...(c.enumValues?.length ? { enum: [...c.enumValues] } : {}),
    encrypted: isEncrypted(c),
    ...(`${key}Currency` in cols ? { moneyCurrency: `${key}Currency` } : {}),
    owner: key === "userId",
    softDelete: key === "deletedAt",
  }))
  const composite = config.primaryKeys[0]?.columns.map((c) => c.name)
  return {
    name: getTableName(table),
    columns,
    primaryKey: composite ?? columns.filter((c) => c.primaryKey).map((c) => c.name),
    scoped: "userId" in cols,
    softDelete: "deletedAt" in cols,
    relations: config.foreignKeys.map((fk) => {
      const r = fk.reference()
      return {
        columns: r.columns.map((c) => c.name),
        references: getTableName(r.foreignTable),
        referencedColumns: r.foreignColumns.map((c) => c.name),
      }
    }),
  }
}

function text(t: TableInfo): string {
  const lines = t.columns.map((c) => {
    const parts = [`  ${c.name} ${c.type}`]
    if (c.primaryKey) parts.push("primary key")
    if (c.notNull && !c.primaryKey) parts.push("not null")
    if (c.unique) parts.push("unique")
    if (c.hasDefault) parts.push("has default")
    if (c.enum) parts.push(`one of ${c.enum.join("|")}`)
    const notes: string[] = []
    if (c.key !== c.name) notes.push(`js: ${c.key}`)
    if (c.encrypted) notes.push("encrypted at rest, not filterable")
    if (c.owner) notes.push("owner; rows are per user")
    if (c.softDelete) notes.push("soft delete; null = live")
    if (c.moneyCurrency) notes.push(`money in minor units; currency in ${c.moneyCurrency}`)
    for (const r of t.relations) {
      if (r.columns.length === 1 && r.columns[0] === c.name) {
        notes.push(`references ${r.references}.${r.referencedColumns.join(",")}`)
      }
    }
    return parts.join(" ") + (notes.length ? `  -- ${notes.join("; ")}` : "")
  })
  if (t.primaryKey.length > 1) lines.push(`  primary key (${t.primaryKey.join(", ")})`)
  return [`table ${t.name}`, ...lines].join("\n")
}

/** Takes a list of tables or a schema module (`import * as schema`); non-tables are skipped. */
export function describeSchema(tables: Tables): string
export function describeSchema(tables: Tables, options: { format: "json" }): SchemaInfo
export function describeSchema(tables: Tables, options?: { format: "json" }): string | SchemaInfo {
  const list = (Array.isArray(tables) ? tables : Object.values(tables)).filter((t): t is Table =>
    is(t, Table),
  )
  const infos = list.map(info)
  return options?.format === "json" ? { tables: infos } : infos.map(text).join("\n\n")
}
