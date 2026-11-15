/**
 * Column helpers for SQLite and Cloudflare D1 tables: `id`, `timestamps`,
 * `softDelete`, `money`, `encrypted`, and the `auditLog`, `outbox`,
 * `idempotencyKeys`, `aiCache`, `webhookTables`, `entitlementTables`, `flagOverrides`, `growthTables`,
 * `orgTables`, `privacyTables`, `analyticsEvents`, `sequences`, `workflowTables`, `monetisationTables` and `collabTables` tables.
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

/**
 * Organisations, memberships, invitations and per-org custom roles for
 * `createOrgs` from `@dapplelight/signet-db/orgs`. Destructure into the schema:
 * `export const { organizations, memberships, invitations, orgRoles } = orgTables()`.
 * Give an app's own tenant tables an `orgId: text("org_id").notNull()` column
 * and `scoped(db, { orgId })` keeps each org to its own rows.
 */
export const orgTables = (prefix = "") => ({
  organizations: sqliteTable(
    `${prefix}organizations`,
    {
      id: id(),
      name: text("name").notNull(),
      /** Lower-case letters, digits and dashes; the subdomain or path segment. */
      slug: text("slug").notNull(),
      /** A custom domain, lower-cased, e.g. "app.example.com". */
      domain: text("domain"),
      /** A shipped theme name, e.g. "editorial". */
      theme: text("theme"),
      /** A brand colour as #rrggbb, for signet-tokens' `buildTheme`. */
      brandColor: text("brand_color"),
      /** True for the org made at sign-up for one person. */
      personal: integer("personal", { mode: "boolean" }).notNull().default(false),
      ...timestamps(),
    },
    (t) => [
      uniqueIndex(`${prefix}organizations_slug`).on(t.slug),
      uniqueIndex(`${prefix}organizations_domain`).on(t.domain),
    ],
  ),
  memberships: sqliteTable(
    `${prefix}memberships`,
    {
      orgId: text("org_id").notNull(),
      userId: text("user_id").notNull(),
      role: text("role").notNull(),
      createdAt: stamp("created_at"),
    },
    (t) => [
      primaryKey({ columns: [t.orgId, t.userId] }),
      index(`${prefix}memberships_user`).on(t.userId),
    ],
  ),
  invitations: sqliteTable(
    `${prefix}invitations`,
    {
      id: id(),
      orgId: text("org_id").notNull(),
      /** SHA-256 of the token, hex. The token itself is never stored. */
      tokenHash: text("token_hash").notNull(),
      /** Only this address may accept, when set. */
      email: text("email"),
      role: text("role").notNull(),
      invitedBy: text("invited_by").notNull(),
      createdAt: stamp("created_at"),
      expiresAt: ms("expires_at").notNull(),
      acceptedAt: ms("accepted_at"),
      acceptedBy: text("accepted_by"),
      revokedAt: ms("revoked_at"),
    },
    (t) => [
      uniqueIndex(`${prefix}invitations_token`).on(t.tokenHash),
      index(`${prefix}invitations_org`).on(t.orgId),
    ],
  ),
  orgRoles: sqliteTable(
    `${prefix}org_roles`,
    {
      orgId: text("org_id").notNull(),
      name: text("name").notNull(),
      /** The permission strings this custom role grants. */
      permissions: text("permissions", { mode: "json" }).notNull(),
      updatedAt: stamp("updated_at").$onUpdate(() => new Date()),
    },
    (t) => [primaryKey({ columns: [t.orgId, t.name] })],
  ),
})

/**
 * Runs, steps and events for `createWorkflows` from
 * `@dapplelight/signet-db/workflows`. Destructure into the schema:
 * `export const { workflowRuns, workflowSteps, workflowEvents } = workflowTables()`.
 */
export const workflowTables = (prefix = "") => ({
  workflowRuns: sqliteTable(
    `${prefix}workflow_runs`,
    {
      id: id(),
      workflow: text("workflow").notNull(),
      input: text("input", { mode: "json" }),
      /** queued | running | sleeping | waiting | completed | failed | cancelled */
      status: text("status").notNull(),
      output: text("output", { mode: "json" }),
      error: text("error"),
      createdBy: text("created_by"),
      /** When a runner should next pick the run up; null once it has finished. */
      wakeAt: ms("wake_at"),
      leaseOwner: text("lease_owner"),
      leaseUntil: ms("lease_until"),
      /** What a sleeping or waiting run is blocked on, for screens. */
      waitingOn: text("waiting_on", { mode: "json" }),
      createdAt: ms("created_at").notNull(),
      updatedAt: ms("updated_at").notNull(),
      finishedAt: ms("finished_at"),
    },
    (t) => [index(`${prefix}workflow_runs_due`).on(t.status, t.wakeAt)],
  ),
  workflowSteps: sqliteTable(
    `${prefix}workflow_steps`,
    {
      runId: text("run_id").notNull(),
      stepId: text("step_id").notNull(),
      /** The order the run first reached the step. */
      seq: integer("seq").notNull(),
      /** run | sleep | event | approval */
      kind: text("kind").notNull(),
      /** running | retrying | sleeping | waiting | completed | failed */
      status: text("status").notNull(),
      output: text("output", { mode: "json" }),
      error: text("error"),
      attempts: integer("attempts").notNull().default(0),
      /** Retry, sleep end, or wait timeout. */
      wakeAt: ms("wake_at"),
      event: text("event"),
      eventId: text("event_id"),
      approvers: text("approvers", { mode: "json" }),
      summary: text("summary"),
      decidedBy: text("decided_by"),
      startedAt: ms("started_at").notNull(),
      finishedAt: ms("finished_at"),
    },
    (t) => [primaryKey({ columns: [t.runId, t.stepId] })],
  ),
  workflowEvents: sqliteTable(
    `${prefix}workflow_events`,
    {
      id: id(),
      name: text("name").notNull(),
      /** Null: every run waiting on `name`. */
      runId: text("run_id"),
      payload: text("payload", { mode: "json" }),
      createdAt: ms("created_at").notNull(),
    },
    (t) => [index(`${prefix}workflow_events_name`).on(t.name, t.id)],
  ),
})

/**
 * Comments on any record and its version history, for `createCollab` from
 * `@dapplelight/signet-db/collab`. Destructure into the schema:
 * `export const { comments, recordVersions } = collabTables()`, and pass
 * `versions: { table: recordVersions, track: [tasks] }` to `createDb`.
 */
export const collabTables = (prefix = "") => ({
  comments: sqliteTable(
    `${prefix}comments`,
    {
      id: id(),
      orgId: text("org_id").notNull(),
      /** The commented record: its SQL table name and primary key. */
      tableName: text("table_name").notNull(),
      rowId: text("row_id").notNull(),
      /** The thread's first comment; null for a thread's first comment itself. */
      parentId: text("parent_id"),
      authorId: text("author_id").notNull(),
      /** Text with mentions as `@[Name](user:<id>)`. Blanked on delete. */
      body: text("body").notNull(),
      /** Everyone ever notified for this comment, so an edit never notifies twice. */
      notified: text("notified", { mode: "json" }),
      createdAt: ms("created_at").notNull(),
      editedAt: ms("edited_at"),
      deletedAt: ms("deleted_at"),
    },
    (t) => [index(`${prefix}comments_record`).on(t.orgId, t.tableName, t.rowId, t.createdAt)],
  ),
  recordVersions: sqliteTable(
    `${prefix}record_versions`,
    {
      id: id(),
      orgId: text("org_id"),
      tableName: text("table_name").notNull(),
      rowId: text("row_id").notNull(),
      /** 1, 2, 3… per record. */
      version: integer("version").notNull(),
      /** insert | update | delete | restore | undo */
      action: text("action").notNull(),
      /** The whole row after the write, as stored (encrypted fields stay ciphertext). */
      data: text("data", { mode: "json" }).notNull(),
      actorType: text("actor_type").notNull(),
      actorId: text("actor_id").notNull(),
      at: ms("at").notNull(),
    },
    (t) => [uniqueIndex(`${prefix}record_versions_row`).on(t.tableName, t.rowId, t.version)],
  ),
})

/**
 * The tables for `createOfferings` (`@dapplelight/signet-db/offerings`) and
 * `createCustomers` (`@dapplelight/signet-db/customers`): offering versions,
 * placements, anonymous identities, the customer timeline and Customer Center
 * requests. Destructure into the schema:
 * `export const { offerings, placements, customerIdentities, customerEvents, customerRequests, chartAudiences } = monetisationTables()`.
 */
export const monetisationTables = (prefix = "") => ({
  offerings: sqliteTable(`${prefix}offerings`, {
    /** `${key}@${version}`: a published version never changes. */
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    /** [{ id, store, plan, interval?, price?, offers? }]: store and web products mapped to plans. */
    products: text("products", { mode: "json" }).notNull(),
    /** The remote paywall: copy, plans shown, highlighted plan, trial text. */
    paywall: text("paywall", { mode: "json" }),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: stamp("created_at"),
  }),
  placements: sqliteTable(`${prefix}placements`, {
    /** Where the app shows an offering: "onboarding", "settings-upgrade". */
    placement: text("placement").primaryKey(),
    /** The current offering's key. */
    offering: text("offering").notNull(),
    /** A pinned version; null serves the latest. */
    version: integer("version"),
    /** [{ when: { country?, platform?, attributes? }, offering, version? }], first match wins. */
    overrides: text("overrides", { mode: "json" }).notNull(),
    updatedBy: text("updated_by"),
    updatedAt: stamp("updated_at").$onUpdate(() => new Date()),
  }),
  customerIdentities: sqliteTable(`${prefix}customer_identities`, {
    /** An anonymous app-user id from `customers.anonymousId()`. */
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    /** The account it was merged into; null until then. */
    subject: text("subject"),
    createdAt: stamp("created_at"),
    mergedAt: ms("merged_at"),
  }),
  customerEvents: sqliteTable(
    `${prefix}customer_events`,
    {
      /** `${gateway}|${eventId}`: a notification is on the timeline once. */
      id: text("id").primaryKey(),
      subject: text("subject").notNull(),
      /** purchase | trial | renewal | refund | refund_request | cancellation | uncancellation | billing_issue | grace_period | expiration | paused | dispute | promotional | impression */
      kind: text("kind").notNull(),
      gateway: text("gateway").notNull(),
      eventType: text("event_type").notNull(),
      subscriptionId: text("subscription_id"),
      paymentId: text("payment_id"),
      productId: text("product_id"),
      amount: integer("amount"),
      currency: text("currency"),
      /** App Store prices: indicative, not settled revenue. */
      approximate: integer("approximate", { mode: "boolean" }).notNull().default(false),
      occurredAt: ms("occurred_at").notNull(),
      /** ISO 3166-1 alpha-2, when known: `record(e, { country })`, or the paywall impression's. */
      country: text("country"),
      /** The offering key, on paywall impressions. */
      offering: text("offering"),
    },
    (t) => [
      index(`${prefix}customer_events_subject`).on(t.subject, t.occurredAt),
      index(`${prefix}customer_events_occurred`).on(t.occurredAt),
    ],
  ),
  customerRequests: sqliteTable(
    `${prefix}customer_requests`,
    {
      /** `refund|${gateway}|${paymentId}` and `retention|${subject}` are once-only; others are new ids. */
      id: text("id").primaryKey(),
      subject: text("subject").notNull(),
      /** refund | cancel | retention | support */
      kind: text("kind").notNull(),
      /** open | done | declined */
      status: text("status").notNull(),
      gateway: text("gateway"),
      /** The payment or subscription the request is about. */
      reference: text("reference"),
      message: text("message"),
      data: text("data", { mode: "json" }),
      createdAt: stamp("created_at"),
      updatedAt: stamp("updated_at").$onUpdate(() => new Date()),
    },
    (t) => [index(`${prefix}customer_requests_subject`).on(t.subject, t.kind)],
  ),
  /** Saved chart filters ("audiences") for `createCharts`. */
  chartAudiences: sqliteTable(`${prefix}chart_audiences`, {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** { store?, plan?, country?, offering? } */
    filter: text("filter", { mode: "json" }).notNull(),
    createdBy: text("created_by"),
    createdAt: stamp("created_at"),
  }),
})
