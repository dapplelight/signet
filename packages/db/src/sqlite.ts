/**
 * SQLite driver on bun:sqlite (Bun runtime, e.g. a Docker or self-hosted
 * box): `createDb("data.db", config)`, or pass a `Database`. Omit the path
 * for an in-memory database. For better-sqlite3 on Node, use
 * `fromDrizzle(drizzle(client), { dialect: "sqlite", atomicity: "sync-transaction" })`.
 */

import { Database } from "bun:sqlite"
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite"
import { type DbConfig, fromDrizzle, type SignetDb } from "./db.js"

export function createDb<TSchema extends Record<string, unknown> = Record<string, never>>(
  file: string | Database = ":memory:",
  config: DbConfig & { schema?: TSchema } = {},
): SignetDb<BunSQLiteDatabase<TSchema>> {
  const { schema, ...rest } = config
  const client = typeof file === "string" ? new Database(file) : file
  return fromDrizzle(drizzle(client, { schema }), {
    dialect: "sqlite",
    atomicity: "sync-transaction",
    ...rest,
  })
}
