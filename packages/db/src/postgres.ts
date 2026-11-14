/**
 * Postgres driver on postgres-js (Supabase, Neon, RDS, a local server):
 * `createDb(databaseUrl, config)`, or pass a `postgres()` client. For
 * Supabase's transaction pooler, pass `postgres(url, { prepare: false })`.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres, { type Sql } from "postgres"
import { type DbConfig, fromDrizzle, type SignetDb } from "./db.js"

export function createDb<TSchema extends Record<string, unknown> = Record<string, never>>(
  client: string | Sql,
  config: DbConfig & { schema?: TSchema } = {},
): SignetDb<PostgresJsDatabase<TSchema>> {
  const { schema, ...rest } = config
  const sql = typeof client === "string" ? postgres(client) : client
  return fromDrizzle(drizzle(sql, { schema }), { dialect: "pg", atomicity: "transaction", ...rest })
}
