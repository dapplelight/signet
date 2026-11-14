/**
 * Column helpers for SQLite and Cloudflare D1 tables: `id`, `timestamps`,
 * `softDelete`, `money`, `encrypted`, and the `auditLog` table.
 */

import { sql } from "drizzle-orm"
import { customType, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { assertCiphertext } from "../cipher.js"
import { newId } from "../id.js"
import { snake } from "./shared.js"

/** Milliseconds since the epoch, in SQL that every SQLite version and D1 runs. */
const nowMs = sql`(cast((julianday('now') - 2440587.5) * 86400000 as integer))`

/** Text primary key filled with a sortable `newId()`. */
export const id = (name = "id") =>
  text(name)
    .primaryKey()
    .$defaultFn(() => newId())

const stamp = (name: string) => integer(name, { mode: "timestamp_ms" }).notNull().default(nowMs)

/** `createdAt` and `updatedAt` (ms precision); `updatedAt` moves on every Drizzle update. Spread it. */
export const timestamps = () => ({
  createdAt: stamp("created_at"),
  updatedAt: stamp("updated_at").$onUpdate(() => new Date()),
})

/** A nullable `deletedAt`. signet-db hides rows where it is set. Spread it. */
export const softDelete = () => ({ deletedAt: integer("deleted_at", { mode: "timestamp_ms" }) })

const amount = (name: string) => integer(name).notNull()
const currencyCol = (name: string) => text(name).notNull()
const currencyWithDefault = (name: string, currency: string) => currencyCol(name).default(currency)

/**
 * `money("price")` → `price` (integer minor units) and `priceCurrency`
 * (ISO 4217). Spread it into the table. `currency` sets a column default.
 */
export function money<N extends string, O extends { currency?: string } = Record<never, never>>(
  name: N,
  options?: O,
): { [K in N]: ReturnType<typeof amount> } & {
  [K in `${N}Currency`]: O extends { currency: string }
    ? ReturnType<typeof currencyWithDefault>
    : ReturnType<typeof currencyCol>
} {
  const col = snake(name)
  const cur = `${col}_currency`
  return {
    [name]: amount(col),
    [`${name}Currency`]: options?.currency
      ? currencyWithDefault(cur, options.currency)
      : currencyCol(cur),
  } as never
}

const encryptedType = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: assertCiphertext,
})

/** A text column holding AES-GCM ciphertext; signet-db encrypts on write and decrypts on read. */
export const encrypted = (name: string) => encryptedType(name)

/** The audit trail table for `createDb(..., { audit })`. */
export const auditLog = (name = "audit_log") =>
  sqliteTable(name, {
    id: id(),
    at: stamp("at"),
    /** user | agent | system */
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    /** insert | update | delete | delete_user */
    action: text("action").notNull(),
    tableName: text("table_name").notNull(),
    rowId: text("row_id"),
    before: text("before", { mode: "json" }),
    after: text("after", { mode: "json" }),
  })
