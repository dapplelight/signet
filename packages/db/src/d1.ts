/**
 * Cloudflare D1 driver: `createDb(env.DB, config)`. Atomic groups run as one
 * D1 batch, since D1 has no BEGIN.
 */

import { type AnyD1Database, type DrizzleD1Database, drizzle } from "drizzle-orm/d1"
import { type DbConfig, fromDrizzle, type SignetDb } from "./db.js"

export function createDb<TSchema extends Record<string, unknown> = Record<string, never>>(
  binding: AnyD1Database,
  config: DbConfig & { schema?: TSchema } = {},
): SignetDb<DrizzleD1Database<TSchema>> {
  const { schema, ...rest } = config
  return fromDrizzle(drizzle(binding, { schema }), {
    dialect: "sqlite",
    atomicity: "batch",
    ...rest,
  })
}
