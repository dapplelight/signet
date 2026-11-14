/**
 * `describeSchema(tables)`: a short plain-text description of tables and
 * columns, for putting in an agent's or a reviewer's context.
 */

import { getTableName, is, Table } from "drizzle-orm"
import { columnsOf, isEncrypted } from "./db.js"

/** Takes a list of tables or a schema module (`import * as schema`); non-tables are skipped. */
export function describeSchema(tables: readonly Table[] | Record<string, unknown>): string {
  const list = (Array.isArray(tables) ? tables : Object.values(tables)).filter((t): t is Table =>
    is(t, Table),
  )
  return list
    .map((table) => {
      const cols = columnsOf(table)
      const lines = Object.entries(cols).map(([key, c]) => {
        const parts = [`  ${c.name} ${c.getSQLType()}`]
        if (c.primary) parts.push("primary key")
        if (c.notNull && !c.primary) parts.push("not null")
        if (c.isUnique) parts.push("unique")
        if (c.hasDefault) parts.push("has default")
        if (c.enumValues?.length) parts.push(`one of ${c.enumValues.join("|")}`)
        const notes: string[] = []
        if (key !== c.name) notes.push(`js: ${key}`)
        if (isEncrypted(c)) notes.push("encrypted at rest, not filterable")
        if (key === "userId") notes.push("owner; rows are per user")
        if (key === "deletedAt") notes.push("soft delete; null = live")
        if (key.endsWith("Currency") && key.slice(0, -8) in cols)
          notes.push(`currency of ${key.slice(0, -8)}, which is in minor units`)
        return parts.join(" ") + (notes.length ? `  -- ${notes.join("; ")}` : "")
      })
      return [`table ${getTableName(table)}`, ...lines].join("\n")
    })
    .join("\n\n")
}
