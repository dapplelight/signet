/**
 * The database, from signet-db. Added by `signet add db`.
 *
 * Cloudflare D1 by default: add a `d1_databases` entry with binding "DB" to
 * wrangler.jsonc and call `dbFor(c.env.DB)` per request. On Bun use
 * `createDb` from @dapplelight/signet-db/sqlite; on Postgres, from
 * @dapplelight/signet-db/postgres.
 */

import { createDb } from "@dapplelight/signet-db/d1"
import type { AnyD1Database } from "drizzle-orm/d1"
import * as schema from "./schema.ts"

export { schema }

/** Per request: never at import, since Workers have no bindings then. */
export const dbFor = (binding: AnyD1Database) => createDb(binding, { schema, audit: schema.audit })
