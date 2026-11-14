/**
 * Column helpers for Postgres tables: `id`, `timestamps`, `softDelete`,
 * `money`, `encrypted`, and the `auditLog` table.
 */

import { bigint, customType, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { assertCiphertext } from "../cipher.js"
import { newId } from "../id.js"
import { snake } from "./shared.js"

/** Text primary key filled with a sortable `newId()`. */
export const id = (name = "id") =>
  text(name)
    .primaryKey()
    .$defaultFn(() => newId())

const stamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull().defaultNow()

/** `createdAt` and `updatedAt`; `updatedAt` moves on every Drizzle update. Spread it. */
export const timestamps = () => ({
  createdAt: stamp("created_at"),
  updatedAt: stamp("updated_at").$onUpdate(() => new Date()),
})

/** A nullable `deletedAt`. signet-db hides rows where it is set. Spread it. */
export const softDelete = () => ({
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
})

const amount = (name: string) => bigint(name, { mode: "number" }).notNull()
const currencyCol = (name: string) => text(name).notNull()
const currencyWithDefault = (name: string, currency: string) => currencyCol(name).default(currency)

/**
 * `money("price")` → `price` (bigint minor units, read as a JS number) and
 * `priceCurrency` (ISO 4217). Spread it into the table. `currency` sets a
 * column default.
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
  pgTable(name, {
    id: id(),
    at: stamp("at"),
    /** user | agent | system */
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    /** insert | update | delete | delete_user */
    action: text("action").notNull(),
    tableName: text("table_name").notNull(),
    rowId: text("row_id"),
    before: jsonb("before"),
    after: jsonb("after"),
  })
