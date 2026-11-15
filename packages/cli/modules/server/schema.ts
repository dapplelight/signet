/**
 * Your tables. drizzle-kit generates the CREATE TABLE statements from this
 * file. Added by `signet add db`; replace `notes` with your own.
 */

import { auditLog, id, softDelete, timestamps } from "@dapplelight/signet-db/columns/sqlite"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"

export const notes = sqliteTable("notes", {
  id: id(),
  userId: text("user_id").notNull(),
  body: text("body").notNull(),
  ...timestamps(),
  ...softDelete(),
})

/** The audit trail `audited()` and the admin API write to. */
export const audit = auditLog()
