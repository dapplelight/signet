/**
 * Column helpers for Postgres tables: `id`, `timestamps`, `softDelete`,
 * `money`, `encrypted`, and the `auditLog`, `outbox`, `idempotencyKeys`,
 * `aiCache`, `webhookTables`, `entitlementTables`, `flagOverrides`, `growthTables`, `orgTables`, `privacyTables`,
 * `analyticsEvents`, `sequences`, `workflowTables`, `monetisationTables` and `collabTables` tables.
 */

import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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

/**
 * The tables for `createWebhooks` from `@dapplelight/signet-db/webhooks`:
 * registered endpoints (per user or org) and the delivery log. Destructure
 * into the schema: `export const { webhookEndpoints, webhookDeliveries } = webhookTables()`.
 */
export const webhookTables = (prefix = "") => ({
  webhookEndpoints: pgTable(
    `${prefix}webhook_endpoints`,
    {
      id: id(),
      /** The user or org id the endpoint belongs to. */
      owner: text("owner").notNull(),
      url: text("url").notNull(),
      /** Event types it receives; `["*"]` is all. */
      events: jsonb("events").$type<string[]>().notNull(),
      description: text("description"),
      /** The `whsec_` signing secret; ciphertext when the db has a cipher. */
      secret: text("secret").notNull(),
      /** Failed attempts since the last success. */
      failures: integer("failures").notNull().default(0),
      disabledAt: tz("disabled_at"),
      disabledReason: text("disabled_reason"),
      ...timestamps(),
    },
    (t) => [index(`${prefix}webhook_endpoints_owner`).on(t.owner)],
  ),
  webhookDeliveries: pgTable(
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
      lastAttemptAt: tz("last_attempt_at"),
      deliveredAt: tz("delivered_at"),
    },
    (t) => [
      index(`${prefix}webhook_deliveries_owner`).on(t.owner, t.id),
      index(`${prefix}webhook_deliveries_endpoint`).on(t.endpointId, t.id),
    ],
  ),
})

/** The cache table for `dbCache(db, table)`, behind signet-ai's `createExtractor`. */
export const aiCache = (name = "ai_cache") =>
  pgTable(name, {
    /** SHA-256 of model, schema, instructions and input. */
    key: text("key").primaryKey(),
    /** The entry as JSON, or ciphertext when the db has a cipher. */
    entry: text("entry").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
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

/**
 * The tables for `createGrowth` from `@dapplelight/signet-db/growth`:
 * waitlist, invites, referral codes, referrals, per-subject marks (onboarding
 * steps, changelog last seen) and feedback. Destructure into the schema:
 * `export const { waitlist, invites, referralCodes, referrals, marks, feedback } = growthTables()`.
 */
export const growthTables = (prefix = "") => ({
  waitlist: pgTable(`${prefix}waitlist`, {
    /** Lower-cased and trimmed. */
    email: text("email").primaryKey(),
    source: text("source"),
    /** The referral code the person arrived with. */
    referralCode: text("referral_code"),
    createdAt: stamp("created_at"),
    invitedAt: tz("invited_at"),
  }),
  invites: pgTable(
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
      expiresAt: tz("expires_at").notNull(),
      acceptedAt: tz("accepted_at"),
      acceptedBy: text("accepted_by"),
      revokedAt: tz("revoked_at"),
    },
    (t) => [uniqueIndex(`${prefix}invites_token`).on(t.tokenHash)],
  ),
  referralCodes: pgTable(
    `${prefix}referral_codes`,
    {
      subject: text("subject").primaryKey(),
      code: text("code").notNull(),
      createdAt: stamp("created_at"),
    },
    (t) => [uniqueIndex(`${prefix}referral_codes_code`).on(t.code)],
  ),
  referrals: pgTable(
    `${prefix}referrals`,
    {
      /** One referrer per person. */
      referee: text("referee").primaryKey(),
      referrer: text("referrer").notNull(),
      code: text("code").notNull(),
      createdAt: stamp("created_at"),
      convertedAt: tz("converted_at"),
      rewardedAt: tz("rewarded_at"),
    },
    (t) => [index(`${prefix}referrals_referrer`).on(t.referrer)],
  ),
  marks: pgTable(
    `${prefix}marks`,
    {
      subject: text("subject").notNull(),
      /** e.g. "onboarding:profile", "changelog:seen". */
      key: text("key").notNull(),
      at: stamp("at"),
    },
    (t) => [primaryKey({ columns: [t.subject, t.key] })],
  ),
  feedback: pgTable(`${prefix}feedback`, {
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
    meta: jsonb("meta"),
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
  consents: pgTable(
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
      givenAt: tz("given_at").notNull(),
      withdrawnAt: tz("withdrawn_at"),
    },
    (t) => [index(`${prefix}consents_subject`).on(t.subject, t.purpose)],
  ),
  dataRequests: pgTable(
    `${prefix}data_requests`,
    {
      id: id(),
      subject: text("subject").notNull(),
      /** export | erasure */
      kind: text("kind").notNull(),
      /** pending | completed | rejected */
      status: text("status").notNull().default("pending"),
      requestedAt: tz("requested_at").notNull(),
      dueAt: tz("due_at"),
      closedAt: tz("closed_at"),
      /** Who closed it. */
      closedBy: text("closed_by"),
      /** Why it was rejected, or a note. */
      note: text("note"),
      /** Erasure: row counts per table. Export data is returned, never stored. */
      result: jsonb("result"),
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
  pgTable(
    name,
    {
      id: id(),
      name: text("name").notNull(),
      ts: bigint("ts", { mode: "number" }).notNull(),
      anonymousId: text("anonymous_id"),
      sessionId: text("session_id"),
      userId: text("user_id"),
      props: jsonb("props"),
    },
    (t) => [
      index(`${name}_name_ts`).on(t.name, t.ts),
      index(`${name}_anonymous_id`).on(t.anonymousId),
      index(`${name}_user_id`).on(t.userId),
    ],
  )

/** Named counters for `nextSequence`, e.g. invoice numbers per financial year. */
export const sequences = (name = "sequences") =>
  pgTable(name, {
    key: text("key").primaryKey(),
    value: bigint("value", { mode: "number" }).notNull(),
  })

/**
 * Organisations, memberships, invitations and per-org custom roles for
 * `createOrgs` from `@dapplelight/signet-db/orgs`. Destructure into the schema:
 * `export const { organizations, memberships, invitations, orgRoles } = orgTables()`.
 * Give an app's own tenant tables an `orgId: text("org_id").notNull()` column
 * and `scoped(db, { orgId })` keeps each org to its own rows.
 */
export const orgTables = (prefix = "") => ({
  organizations: pgTable(
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
      personal: boolean("personal").notNull().default(false),
      ...timestamps(),
    },
    (t) => [
      uniqueIndex(`${prefix}organizations_slug`).on(t.slug),
      uniqueIndex(`${prefix}organizations_domain`).on(t.domain),
    ],
  ),
  memberships: pgTable(
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
  invitations: pgTable(
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
      expiresAt: tz("expires_at").notNull(),
      acceptedAt: tz("accepted_at"),
      acceptedBy: text("accepted_by"),
      revokedAt: tz("revoked_at"),
    },
    (t) => [
      uniqueIndex(`${prefix}invitations_token`).on(t.tokenHash),
      index(`${prefix}invitations_org`).on(t.orgId),
    ],
  ),
  orgRoles: pgTable(
    `${prefix}org_roles`,
    {
      orgId: text("org_id").notNull(),
      name: text("name").notNull(),
      /** The permission strings this custom role grants. */
      permissions: jsonb("permissions").notNull(),
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
  workflowRuns: pgTable(
    `${prefix}workflow_runs`,
    {
      id: id(),
      workflow: text("workflow").notNull(),
      input: jsonb("input"),
      /** queued | running | sleeping | waiting | completed | failed | cancelled */
      status: text("status").notNull(),
      output: jsonb("output"),
      error: text("error"),
      createdBy: text("created_by"),
      /** When a runner should next pick the run up; null once it has finished. */
      wakeAt: tz("wake_at"),
      leaseOwner: text("lease_owner"),
      leaseUntil: tz("lease_until"),
      /** What a sleeping or waiting run is blocked on, for screens. */
      waitingOn: jsonb("waiting_on"),
      createdAt: tz("created_at").notNull(),
      updatedAt: tz("updated_at").notNull(),
      finishedAt: tz("finished_at"),
    },
    (t) => [index(`${prefix}workflow_runs_due`).on(t.status, t.wakeAt)],
  ),
  workflowSteps: pgTable(
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
      output: jsonb("output"),
      error: text("error"),
      attempts: integer("attempts").notNull().default(0),
      /** Retry, sleep end, or wait timeout. */
      wakeAt: tz("wake_at"),
      event: text("event"),
      eventId: text("event_id"),
      approvers: jsonb("approvers"),
      summary: text("summary"),
      decidedBy: text("decided_by"),
      startedAt: tz("started_at").notNull(),
      finishedAt: tz("finished_at"),
    },
    (t) => [primaryKey({ columns: [t.runId, t.stepId] })],
  ),
  workflowEvents: pgTable(
    `${prefix}workflow_events`,
    {
      id: id(),
      name: text("name").notNull(),
      /** Null: every run waiting on `name`. */
      runId: text("run_id"),
      payload: jsonb("payload"),
      createdAt: tz("created_at").notNull(),
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
  comments: pgTable(
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
      notified: jsonb("notified"),
      createdAt: tz("created_at").notNull(),
      editedAt: tz("edited_at"),
      deletedAt: tz("deleted_at"),
    },
    (t) => [index(`${prefix}comments_record`).on(t.orgId, t.tableName, t.rowId, t.createdAt)],
  ),
  recordVersions: pgTable(
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
      data: jsonb("data").notNull(),
      actorType: text("actor_type").notNull(),
      actorId: text("actor_id").notNull(),
      at: tz("at").notNull(),
    },
    (t) => [uniqueIndex(`${prefix}record_versions_row`).on(t.tableName, t.rowId, t.version)],
  ),
})

/**
 * The tables for `createOfferings` (`@dapplelight/signet-db/offerings`) and
 * `createCustomers` (`@dapplelight/signet-db/customers`): offering versions,
 * placements, anonymous identities, the customer timeline and Customer Center
 * requests. Destructure into the schema:
 * `export const { offerings, placements, customerIdentities, customerEvents, customerRequests } = monetisationTables()`.
 */
export const monetisationTables = (prefix = "") => ({
  offerings: pgTable(`${prefix}offerings`, {
    /** `${key}@${version}`: a published version never changes. */
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    /** [{ id, store, plan, interval?, price? }]: store and web products mapped to plans. */
    products: jsonb("products").notNull(),
    /** The remote paywall: copy, plans shown, highlighted plan, trial text. */
    paywall: jsonb("paywall"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: stamp("created_at"),
  }),
  placements: pgTable(`${prefix}placements`, {
    /** Where the app shows an offering: "onboarding", "settings-upgrade". */
    placement: text("placement").primaryKey(),
    /** The current offering's key. */
    offering: text("offering").notNull(),
    /** A pinned version; null serves the latest. */
    version: integer("version"),
    /** [{ when: { country?, platform?, attributes? }, offering, version? }], first match wins. */
    overrides: jsonb("overrides").notNull(),
    updatedBy: text("updated_by"),
    updatedAt: stamp("updated_at").$onUpdate(() => new Date()),
  }),
  customerIdentities: pgTable(`${prefix}customer_identities`, {
    /** An anonymous app-user id from `customers.anonymousId()`. */
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    /** The account it was merged into; null until then. */
    subject: text("subject"),
    createdAt: stamp("created_at"),
    mergedAt: tz("merged_at"),
  }),
  customerEvents: pgTable(
    `${prefix}customer_events`,
    {
      /** `${gateway}|${eventId}`: a notification is on the timeline once. */
      id: text("id").primaryKey(),
      subject: text("subject").notNull(),
      /** purchase | renewal | refund | cancellation | uncancellation | billing_issue | grace_period | expiration | paused | dispute */
      kind: text("kind").notNull(),
      gateway: text("gateway").notNull(),
      eventType: text("event_type").notNull(),
      subscriptionId: text("subscription_id"),
      paymentId: text("payment_id"),
      productId: text("product_id"),
      amount: bigint("amount", { mode: "number" }),
      currency: text("currency"),
      /** App Store prices: indicative, not settled revenue. */
      approximate: boolean("approximate").notNull().default(false),
      occurredAt: tz("occurred_at").notNull(),
    },
    (t) => [index(`${prefix}customer_events_subject`).on(t.subject, t.occurredAt)],
  ),
  customerRequests: pgTable(
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
      data: jsonb("data"),
      createdAt: stamp("created_at"),
      updatedAt: stamp("updated_at").$onUpdate(() => new Date()),
    },
    (t) => [index(`${prefix}customer_requests_subject`).on(t.subject, t.kind)],
  ),
})
