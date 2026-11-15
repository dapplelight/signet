/**
 * Column helpers for SQLite and Cloudflare D1 tables: `id`, `timestamps`,
 * `softDelete`, `money`, `encrypted`, and the `auditLog`, `outbox`,
 * `idempotencyKeys`, `aiCache`, `webhookTables`, `entitlementTables`, `flagOverrides`, `growthTables`,
 * `privacyTables`, `analyticsEvents` and `sequences` tables.
 */

import { sql } from "drizzle-orm"
import {
  customType,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
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

/** The transactional outbox table for `createDb(..., { outbox })`. */
export const outbox = (name = "outbox") =>
  sqliteTable(name, {
    id: id(),
    topic: text("topic").notNull(),
    payload: text("payload", { mode: "json" }),
    /** pending | sent | dead */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: stamp("next_attempt_at"),
    lastError: text("last_error"),
    createdAt: stamp("created_at"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  })

/**
 * The tables for `createWebhooks` from `@dapplelight/signet-db/webhooks`:
 * registered endpoints (per user or org) and the delivery log. Destructure
 * into the schema: `export const { webhookEndpoints, webhookDeliveries } = webhookTables()`.
 */
export const webhookTables = (prefix = "") => ({
  webhookEndpoints: sqliteTable(
    `${prefix}webhook_endpoints`,
    {
      id: id(),
      /** The user or org id the endpoint belongs to. */
      owner: text("owner").notNull(),
      url: text("url").notNull(),
      /** Event types it receives; `["*"]` is all. */
      events: text("events", { mode: "json" }).$type<string[]>().notNull(),
      description: text("description"),
      /** The `whsec_` signing secret; ciphertext when the db has a cipher. */
      secret: text("secret").notNull(),
      /** Failed attempts since the last success. */
      failures: integer("failures").notNull().default(0),
      disabledAt: ms("disabled_at"),
      disabledReason: text("disabled_reason"),
      ...timestamps(),
    },
    (t) => [index(`${prefix}webhook_endpoints_owner`).on(t.owner)],
  ),
  webhookDeliveries: sqliteTable(
    `${prefix}webhook_deliveries`,
    {
      id: id(),
      endpointId: text("endpoint_id").notNull(),
      owner: text("owner").notNull(),
      /** `webhook-id`: the same on every retry and redelivery of one event. */
      eventId: text("event_id").notNull(),
      type: text("type").notNull(),
      /** The exact JSON body that is signed and sent. */
      body: text("body").notNull(),
      /** pending | retrying | delivered | failed | skipped */
      status: text("status").notNull().default("pending"),
      attempts: integer("attempts").notNull().default(0),
      responseStatus: integer("response_status"),
      /** The first 2 KB of the last response. */
      responseBody: text("response_body"),
      error: text("error"),
      durationMs: integer("duration_ms"),
      createdAt: stamp("created_at"),
      lastAttemptAt: ms("last_attempt_at"),
      deliveredAt: ms("delivered_at"),
    },
    (t) => [
      index(`${prefix}webhook_deliveries_owner`).on(t.owner, t.id),
      index(`${prefix}webhook_deliveries_endpoint`).on(t.endpointId, t.id),
    ],
  ),
})

/** The cache table for `dbCache(db, table)`, behind signet-ai's `createExtractor`. */
export const aiCache = (name = "ai_cache") =>
  sqliteTable(name, {
    /** SHA-256 of model, schema, instructions and input. */
    key: text("key").primaryKey(),
    /** The entry as JSON, or ciphertext when the db has a cipher. */
    entry: text("entry").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  })

/** The idempotency key table for `createDb(..., { idempotency })`. */
export const idempotencyKeys = (name = "idempotency_keys") =>
  sqliteTable(
    name,
    {
      scope: text("scope").notNull(),
      key: text("key").notNull(),
      /** pending | done */
      status: text("status").notNull(),
      result: text("result", { mode: "json" }),
      createdAt: stamp("created_at"),
      expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    },
    (t) => [primaryKey({ columns: [t.scope, t.key] })],
  )

const ms = (name: string) => integer(name, { mode: "timestamp_ms" })

/**
 * The plan, override and usage tables for `createEntitlements` from
 * `@dapplelight/signet-db/entitlements`. Spread or destructure into the schema:
 * `export const { subjectPlans, entitlementOverrides, usageCounters } = entitlementTables()`.
 */
export const entitlementTables = (prefix = "") => ({
  subjectPlans: sqliteTable(
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
      currentPeriodEnd: ms("current_period_end"),
      graceUntil: ms("grace_until"),
      /** When the newest applied change happened; older billing events are ignored. */
      eventAt: ms("event_at").notNull(),
      updatedAt: stamp("updated_at").$onUpdate(() => new Date()),
    },
    (t) => [index(`${prefix}subject_plans_subject`).on(t.subject)],
  ),
  entitlementOverrides: sqliteTable(
    `${prefix}entitlement_overrides`,
    {
      id: id(),
      subject: text("subject").notNull(),
      /** feature | limit */
      kind: text("kind").notNull(),
      key: text("key").notNull(),
      /** feature: 1 grant, 0 revoke. limit: the value; null is unlimited. */
      value: integer("value"),
      expiresAt: ms("expires_at"),
      createdAt: stamp("created_at"),
    },
    (t) => [index(`${prefix}entitlement_overrides_subject`).on(t.subject)],
  ),
  usageCounters: sqliteTable(
    `${prefix}usage_counters`,
    {
      subject: text("subject").notNull(),
      key: text("key").notNull(),
      /** "2026-11" (month), "2026-11-15" (day) or "all". */
      period: text("period").notNull(),
      used: integer("used").notNull().default(0),
    },
    (t) => [primaryKey({ columns: [t.subject, t.key, t.period] })],
  ),
})

/** Stored flag overrides for `createFlags` from `@dapplelight/signet-db/flags`. */
export const flagOverrides = (name = "flag_overrides") =>
  sqliteTable(name, {
    /** `${flag}|${subject}` */
    id: text("id").primaryKey(),
    flag: text("flag").notNull(),
    /** A subject id, or "*" for everyone. */
    subject: text("subject").notNull(),
    value: text("value", { mode: "json" }).notNull(),
    expiresAt: ms("expires_at"),
    updatedAt: stamp("updated_at").$onUpdate(() => new Date()),
  })

/**
 * The tables for `createGrowth` from `@dapplelight/signet-db/growth`:
 * waitlist, invites, referral codes, referrals, per-subject marks (onboarding
 * steps, changelog last seen) and feedback. Destructure into the schema:
 * `export const { waitlist, invites, referralCodes, referrals, marks, feedback } = growthTables()`.
 */
export const growthTables = (prefix = "") => ({
  waitlist: sqliteTable(`${prefix}waitlist`, {
    /** Lower-cased and trimmed. */
    email: text("email").primaryKey(),
    source: text("source"),
    /** The referral code the person arrived with. */
    referralCode: text("referral_code"),
    createdAt: stamp("created_at"),
    invitedAt: ms("invited_at"),
  }),
  invites: sqliteTable(
    `${prefix}invites`,
    {
      id: id(),
      /** SHA-256 of the token, hex. The token itself is never stored. */
      tokenHash: text("token_hash").notNull(),
      /** Only this address may accept, when set. */
      email: text("email"),
      invitedBy: text("invited_by").notNull(),
      /** What the invite is to, e.g. an org id. */
      scope: text("scope"),
      role: text("role"),
      createdAt: stamp("created_at"),
      expiresAt: ms("expires_at").notNull(),
      acceptedAt: ms("accepted_at"),
      acceptedBy: text("accepted_by"),
      revokedAt: ms("revoked_at"),
    },
    (t) => [uniqueIndex(`${prefix}invites_token`).on(t.tokenHash)],
  ),
  referralCodes: sqliteTable(
    `${prefix}referral_codes`,
    {
      subject: text("subject").primaryKey(),
      code: text("code").notNull(),
      createdAt: stamp("created_at"),
    },
    (t) => [uniqueIndex(`${prefix}referral_codes_code`).on(t.code)],
  ),
  referrals: sqliteTable(
    `${prefix}referrals`,
    {
      /** One referrer per person. */
      referee: text("referee").primaryKey(),
      referrer: text("referrer").notNull(),
      code: text("code").notNull(),
      createdAt: stamp("created_at"),
      convertedAt: ms("converted_at"),
      rewardedAt: ms("rewarded_at"),
    },
    (t) => [index(`${prefix}referrals_referrer`).on(t.referrer)],
  ),
  marks: sqliteTable(
    `${prefix}marks`,
    {
      subject: text("subject").notNull(),
      /** e.g. "onboarding:profile", "changelog:seen". */
      key: text("key").notNull(),
      at: stamp("at"),
    },
    (t) => [primaryKey({ columns: [t.subject, t.key] })],
  ),
  feedback: sqliteTable(`${prefix}feedback`, {
    id: id(),
    /** Null for anonymous feedback. */
    subject: text("subject"),
    /** bug | idea | praise | other */
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    /** 1 to 5, optional. */
    rating: integer("rating"),
    /** Where it was sent from, e.g. a path. */
    page: text("page"),
    meta: text("meta", { mode: "json" }),
    /** new | seen | done */
    status: text("status").notNull().default("new"),
    createdAt: stamp("created_at"),
  }),
})

/**
 * DPDP consent records and data-principal requests for `createPrivacy` from
 * `@dapplelight/signet-db/privacy`. Destructure into the schema:
 * `export const { consents, dataRequests } = privacyTables()`.
 */
export const privacyTables = (prefix = "") => ({
  consents: sqliteTable(
    `${prefix}consents`,
    {
      id: id(),
      subject: text("subject").notNull(),
      /** What the data is used for, e.g. "marketing-email". */
      purpose: text("purpose").notNull(),
      /** The notice the person saw when they agreed, e.g. "2026-11-01". */
      noticeVersion: text("notice_version").notNull(),
      /** How it was given, e.g. "signup-form", "settings". */
      source: text("source"),
      givenAt: ms("given_at").notNull(),
      withdrawnAt: ms("withdrawn_at"),
    },
    (t) => [index(`${prefix}consents_subject`).on(t.subject, t.purpose)],
  ),
  dataRequests: sqliteTable(
    `${prefix}data_requests`,
    {
      id: id(),
      subject: text("subject").notNull(),
      /** export | erasure */
      kind: text("kind").notNull(),
      /** pending | completed | rejected */
      status: text("status").notNull().default("pending"),
      requestedAt: ms("requested_at").notNull(),
      dueAt: ms("due_at"),
      closedAt: ms("closed_at"),
      /** Who closed it. */
      closedBy: text("closed_by"),
      /** Why it was rejected, or a note. */
      note: text("note"),
      /** Erasure: row counts per table. Export data is returned, never stored. */
      result: text("result", { mode: "json" }),
    },
    (t) => [index(`${prefix}data_requests_subject`).on(t.subject)],
  ),
})

/**
 * Stored analytics events for `createAnalyticsStore` from
 * `@dapplelight/signet-db/analytics`. `ts` is epoch ms; `props` is JSON.
 * Has `userId`, so it can go in `deleteUser` / privacy `userTables`.
 */
export const analyticsEvents = (name = "analytics_events") =>
  sqliteTable(
    name,
    {
      id: id(),
      name: text("name").notNull(),
      ts: integer("ts").notNull(),
      anonymousId: text("anonymous_id"),
      sessionId: text("session_id"),
      userId: text("user_id"),
      props: text("props", { mode: "json" }),
    },
    (t) => [
      index(`${name}_name_ts`).on(t.name, t.ts),
      index(`${name}_anonymous_id`).on(t.anonymousId),
      index(`${name}_user_id`).on(t.userId),
    ],
  )

/** Named counters for `nextSequence`, e.g. invoice numbers per financial year. */
export const sequences = (name = "sequences") =>
  sqliteTable(name, {
    key: text("key").primaryKey(),
    value: integer("value").notNull(),
  })
