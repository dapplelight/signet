// auth:begin
// payments|growth|orgs|privacy|ai|paywalls|workflows:begin
import {
  aiSpendCaps, // @ai
  auditLog,
  entitlementTables, // @payments|ai
  growthTables, // @growth
  id,
  idempotencyKeys,
  monetisationTables, // @paywalls
  orgTables, // @orgs
  privacyTables, // @privacy
  timestamps,
  workflowTables, // @workflows
} from "@dapplelight/signet-db/columns/sqlite"
// payments|growth|orgs|privacy|ai|paywalls|workflows:end
import { auditLog, id, idempotencyKeys, timestamps } from "@dapplelight/signet-db/columns/sqlite" // @!payments|growth|orgs|privacy|ai|paywalls|workflows
// auth:end
// !auth:begin
import { auditLog, growthTables, idempotencyKeys } from "@dapplelight/signet-db/columns/sqlite" // @growth
import { auditLog, idempotencyKeys } from "@dapplelight/signet-db/columns/sqlite" // @!growth
// !auth:end
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

// The whole database. Change a table here, then `db:generate` writes the
// migration into drizzle/ and the API applies it on its next start.

// auth:begin
export const ROLES = ["user", "readonly", "staff", "admin"] as const

export const users = sqliteTable("users", {
  id: id(),
  phone: text("phone").notNull().unique(),
  name: text("name"),
  email: text("email"),
  /** readonly, staff and admin can open /admin (signet-db's DEFAULT_ROLES). */
  role: text("role", { enum: ROLES }).notNull().default("user"),
  ...timestamps(),
})

// auth:end
/**
 * Sessions, one-time codes, API keys, the notification inbox and prefs, and
 * rate-limit counters: signet-server keeps each in a key-value store, and this
 * table is that store (api/db/kv.ts). Rows past expires_at are ignored, then
 * pruned hourly.
 */
export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  /** Epoch ms; null never expires. */
  expiresAt: integer("expires_at"),
})

/** Every admin, plan and privacy write, with before and after. */
export const audit = auditLog()
/** Billing events apply once. */
export const idempotency = idempotencyKeys()

export const { subjectPlans, entitlementOverrides, usageCounters } = entitlementTables() // @payments
// ai:begin
export const { usageCounters } = entitlementTables() // @!payments
/** AI spend caps set at runtime; usage_counters holds the spend. */
export const spendCaps = aiSpendCaps()
// ai:end
/** Versioned offerings and the placements that serve them: the remote paywalls. */ // @paywalls
export const { offerings, placements } = monetisationTables() // @paywalls
/** Durable workflow runs, their steps, and the events they wait on. */ // @workflows
export const { workflowRuns, workflowSteps, workflowEvents } = workflowTables() // @workflows
export const { waitlist, invites, referralCodes, referrals, marks, feedback } = growthTables() // @growth
export const { consents, dataRequests } = privacyTables() // @privacy
// orgs:begin
/**
 * Organisations: every user gets a personal one at sign-up and can make more,
 * invite people and give them roles (api/services.ts, routes under /api/orgs).
 * Give your own tables an `orgId: text("org_id").notNull()` column and read
 * them through `scoped(s.db, { orgId })`, so each org only sees its own rows.
 */
export const { organizations, memberships, invitations, orgRoles } = orgTables()
// orgs:end
// auth:begin

export type User = typeof users.$inferSelect
// auth:end
