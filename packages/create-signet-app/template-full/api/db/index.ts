import type { SignetDb } from "@dapplelight/signet-db"
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"
import type * as schema from "./schema.ts"

/**
 * The Drizzle handle, typed without naming bun:sqlite, so the web app can
 * import the API's types (src/lib/api.ts) without pulling in Bun's.
 */
export type Orm = BaseSQLiteDatabase<"sync", unknown, typeof schema>
export type Db = SignetDb<Orm>
