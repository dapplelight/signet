/**
 * Column helpers for Postgres tables: `id`, `timestamps`, `softDelete`,
 * `money`, `encrypted`, and the `auditLog`, `outbox`, `idempotencyKeys`,
 * `entitlementTables` and `flagOverrides` tables.
 */

import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
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

/** The transactional outbox table for `createDb(..., { outbox })`. */
export const outbox = (name = "outbox") =>
  pgTable(name, {
    id: id(),
    topic: text("topic").notNull(),
    payload: jsonb("payload"),
    /** pending | sent | dead */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: stamp("next_attempt_at"),
    lastError: text("last_error"),
    createdAt: stamp("created_at"),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
  })

/** The idempotency key table for `createDb(..., { idempotency })`. */
export const idempotencyKeys = (name = "idempotency_keys") =>
  pgTable(
    name,
    {
      scope: text("scope").notNull(),
      key: text("key").notNull(),
      /** pending | done */
      status: text("status").notNull(),
      result: jsonb("result"),
      createdAt: stamp("created_at"),
      expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    },
    (t) => [primaryKey({ columns: [t.scope, t.key] })],
  )

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" })

/**
 * The plan, override and usage tables for `createEntitlements` from
 * `@dapplelight/signet-db/entitlements`. Spread or destructure into the schema:
 * `export const { subjectPlans, entitlementOverrides, usageCounters } = entitlementTables()`.
 */
export const entitlementTables = (prefix = "") => ({
  subjectPlans: pgTable(
    `${prefix}subject_plans`,
    {
      /** `${gateway}|${subscriptionId}`: a subscription belongs to one subject. */
      id: text("id").primaryKey(),
      /** A user or org id. A subject has one row per source (subscription, or `manual`). */
      subject: text("subject").notNull(),
      plan: text("plan").notNull(),
      /** pending | trialing | active | past_due | paused | cancelled | expired */
      status: text("status").notNull(),
      /** The gateway (appstore, googleplay, stripe, ...), or `manual` for setPlan. */
      gateway: text("gateway").notNull(),
      /** The gateway's subscription id; the subject for `manual`. */
      subscriptionId: text("subscription_id").notNull(),
      /** When the paid period ends, if the gateway says. */
      currentPeriodEnd: tz("current_period_end"),
      graceUntil: tz("grace_until"),
      /** When the newest applied change happened; older billing events are ignored. */
      eventAt: tz("event_at").notNull(),
      updatedAt: stamp("updated_at").$onUpdate(() => new Date()),
    },
    (t) => [index(`${prefix}subject_plans_subject`).on(t.subject)],
  ),
  entitlementOverrides: pgTable(
    `${prefix}entitlement_overrides`,
    {
      id: id(),
      subject: text("subject").notNull(),
      /** feature | limit */
      kind: text("kind").notNull(),
      key: text("key").notNull(),
      /** feature: 1 grant, 0 revoke. limit: the value; null is unlimited. */
      value: bigint("value", { mode: "number" }),
      expiresAt: tz("expires_at"),
      createdAt: stamp("created_at"),
    },
    (t) => [index(`${prefix}entitlement_overrides_subject`).on(t.subject)],
  ),
  usageCounters: pgTable(
    `${prefix}usage_counters`,
    {
      subject: text("subject").notNull(),
      key: text("key").notNull(),
      /** "2026-11" (month), "2026-11-15" (day) or "all". */
      period: text("period").notNull(),
      used: bigint("used", { mode: "number" }).notNull().default(0),
    },
    (t) => [primaryKey({ columns: [t.subject, t.key, t.period] })],
  ),
})

/** Stored flag overrides for `createFlags` from `@dapplelight/signet-db/flags`. */
export const flagOverrides = (name = "flag_overrides") =>
  pgTable(name, {
    /** `${flag}|${subject}` */
    id: text("id").primaryKey(),
    flag: text("flag").notNull(),
    /** A subject id, or "*" for everyone. */
    subject: text("subject").notNull(),
    value: jsonb("value").notNull(),
    expiresAt: tz("expires_at"),
    updatedAt: stamp("updated_at").$onUpdate(() => new Date()),
  })
