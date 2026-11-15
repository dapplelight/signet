/**
 * Plans, entitlements and usage limits, on the tables from
 * `entitlementTables()`.
 *
 * ```ts
 * const plans = definePlans({
 *   free: { features: ["export"], limits: { seats: 1, aiCredits: 20 } },
 *   pro: { features: ["export", "sso"], limits: { seats: 10, aiCredits: 1000 } },
 * })
 * const ent = createEntitlements(db, { plans, default: "free", tables: entitlementTables() })
 * await ent.can(orgId, "sso")                 // only declared features type-check
 * await ent.consume(orgId, "aiCredits", 5)    // { ok, used, limit, remaining }
 * await ent.applyBillingEvent(event)          // a signet-payments subscription.* event
 * await ent.applySubscription(sub, { subject }) // restore: a store subscription read live
 * ```
 *
 * A subject is any id: a user, an org. It has one row per source: each
 * subscription (App Store, Google Play, Stripe, ...) and `manual` (`setPlan`).
 * Sources roll up into one entitlement per plan, active while any of its
 * sources is; the plan in effect is the last declared plan with an active
 * entitlement, else `default`. Overrides grant or
 * revoke a feature, or set a limit, optionally until `expiresAt`; the newest
 * unexpired override per key wins. Every write goes through `audited`, so the
 * db needs an audit table; usage counters are not audited.
 */

import { and, desc, eq, gt, isNull, lte, or, sql, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import { withIdempotency } from "./idempotency.js"
import { type Actor, audited } from "./scoped.js"

export {
  type EntitlementTool,
  type EntitlementToolsOptions,
  entitlementTools,
} from "./entitlement-tools.js"

export type PlanDef = {
  readonly features?: readonly string[]
  /** A number, or `Infinity` for unlimited. A limit a plan leaves out is 0. */
  readonly limits?: Readonly<Record<string, number>>
}
export type Plans = Readonly<Record<string, PlanDef>>

type Keys<T> = T extends object ? keyof T : never
type Items<T> = T extends readonly (infer I)[] ? I : never
/** Every feature any plan declares. */
export type FeatureOf<P extends Plans> = { [K in keyof P]: Items<P[K]["features"]> }[keyof P] &
  string
/** Every limit key any plan declares. */
export type LimitOf<P extends Plans> = { [K in keyof P]: Keys<P[K]["limits"]> }[keyof P] & string
export type PlanKey<P extends Plans> = keyof P & string

/**
 * Declare plans in code, lowest first: when several are active at once, the
 * last declared wins. The literal keys type `can`, `limit` and `consume`.
 */
export const definePlans = <const P extends Plans>(plans: P): P => plans

/** Usage windows: calendar month or day (UTC), or never resets. */
export type Period = "month" | "day" | "total"

export type SubscriptionStatus =
  | "pending"
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "cancelled"
  | "expired"

/**
 * The part of a signet-payments `Event` billing reads. Declared here so
 * signet-db does not depend on signet-payments; its events fit as they are.
 */
export type BillingEvent = {
  id: string
  gateway: string
  type: string
  occurredAt: Date
  subscriptionId?: string
  /** App store events: the store's product id. */
  productId?: string
  raw: unknown
}

export type BillingConfig<P extends Plans> = {
  /**
   * Gateway plan, price or store product id → plan key. Prefix a key with the
   * gateway when two stores use the same id: `{ price_9f: "pro",
   * "appstore:pro.monthly": "pro", "googleplay:pro": "pro" }`. The prefixed
   * key is tried first.
   */
  plans: Readonly<Record<string, PlanKey<P>>>
  /**
   * Read the gateway plan id off an event. Default: Razorpay's and Stripe's
   * payload shapes, then the event's `productId` (App Store, Google Play).
   */
  planIdOf?: (event: BillingEvent) => string | undefined
  /**
   * The subscription's status as the gateway reports it, for
   * `subscription.created` and `subscription.updated` (whose type alone does
   * not say). Default: Stripe's `data.object.status`, Paddle's `data.status`,
   * Razorpay's `payload.subscription.entity.status`.
   */
  statusOf?: (event: BillingEvent) => SubscriptionStatus | undefined
  /**
   * When the paid period ends. Default: Stripe `current_period_end`, Razorpay
   * `current_end`, Paddle `current_billing_period.ends_at`, read on every
   * event but `subscription.cancelled`. App Store and Google Play events
   * carry their own (expiresDate, lineItems expiryTime).
   */
  periodEndOf?: (event: BillingEvent) => Date | undefined
  /**
   * Who the subscription belongs to, e.g. from the gateway's notes/metadata.
   * Default: the subject stored for the subscription id, or for Google Play the
   * subject of the `linkedPurchaseToken` (an upgrade or resubscribe).
   */
  subjectOf?: (event: BillingEvent) => string | undefined | Promise<string | undefined>
  /**
   * How long past_due keeps the paid plan when the gateway gives no grace end,
   * and how long an active source outlives a `currentPeriodEnd` that passed
   * with no event. Default 3 days.
   */
  graceMs?: number
}

/** The part of a signet-payments `Subscription` restore reads. */
export type SubscriptionLike = {
  gateway: string
  gatewayId: string
  status: SubscriptionStatus
  currentPeriodEnd?: Date
  productId?: string
  raw?: unknown
}

export type EntitlementTables = {
  subjectPlans: Table
  entitlementOverrides: Table
  usageCounters: Table
}

export type EntitlementsOptions<P extends Plans> = {
  plans: P
  /** The plan of a subject with no row, or whose subscription lapsed. */
  default: PlanKey<P>
  tables: EntitlementTables
  /** Usage window per limit key for `consume`. Default "month". */
  periods?: Partial<Record<LimitOf<P>, Period>>
  billing?: BillingConfig<P>
  /** Clock, for tests. */
  now?: () => Date
}

export type Override = {
  id: string
  kind: "feature" | "limit"
  key: string
  value: number | null
  expiresAt: Date | null
  createdAt: Date
}

/** One stored source of a plan: a subscription, or `manual`. */
export type Source = {
  gateway: string
  subscriptionId: string
  status: SubscriptionStatus
  currentPeriodEnd: Date | null
  graceUntil: Date | null
  active: boolean
}

/** One plan's entitlement: active while any of its sources is. */
export type Entitlement<K extends string = string> = {
  plan: K
  active: boolean
  /** The latest period end among its active sources (null: none known). */
  currentPeriodEnd: Date | null
  sources: Source[]
}

export type Resolved<P extends Plans> = {
  subject: string
  /** The plan in effect now. */
  plan: PlanKey<P>
  /** The newest stored source's plan, which differs from `plan` when it lapsed. */
  storedPlan: PlanKey<P> | null
  /** The status of the source behind `plan` (else of the newest source). */
  status: SubscriptionStatus | null
  graceUntil: Date | null
  /** When `plan` is paid until: its entitlement's currentPeriodEnd. */
  currentPeriodEnd: Date | null
  /** The source behind `plan`, or null on the default plan. */
  source: { gateway: string; subscriptionId: string } | null
  /** One per plan the subject has any source for, active or not. */
  entitlements: Entitlement<PlanKey<P>>[]
  features: FeatureOf<P>[]
  limits: Record<LimitOf<P>, number>
  overrides: Override[]
}

export type Usage<K extends string = string> = {
  key: K
  period: string
  used: number
  limit: number
  remaining: number
}

export type BillingResult = {
  applied: boolean
  subject?: string
  plan?: string
  status?: SubscriptionStatus
  /**
   * Why not applied: not_subscription, no_subject, unknown_plan, stale (an
   * older event), or other_subject (the subscription belongs to another
   * subject, so it cannot be claimed).
   */
  reason?: "not_subscription" | "no_subject" | "unknown_plan" | "stale" | "other_subject"
}

/** What a source looks like after an event: status, period end and grace end. */
export type SourceState = {
  status: SubscriptionStatus
  /** null: no end (access ended or never ends); undefined: unknown, keep the stored one. */
  currentPeriodEnd?: Date | null
  /** For past_due: until when access stays. null: no access (billing retry, account hold). */
  graceUntil?: Date | null
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: entitlement columns are known by name
type Cols = Record<string, any>
type WriteOptions = { actor: Actor }

const STATUS: Record<string, SubscriptionStatus | null> = {
  "subscription.created": "pending",
  "subscription.activated": "active",
  "subscription.charged": "active",
  "subscription.resumed": "active",
  "subscription.updated": null, // keeps the stored status
  "subscription.paused": "paused",
  "subscription.past_due": "past_due",
  "subscription.cancelled": "cancelled",
  "subscription.expired": "expired",
}

// biome-ignore lint/suspicious/noExplicitAny: walking an unknown gateway payload
const dig = (o: any, ...path: (string | number)[]): unknown => path.reduce((v, k) => v?.[k], o)

const GATEWAY_STATUS: Record<string, SubscriptionStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  unpaid: "past_due",
  halted: "past_due",
  paused: "paused",
  canceled: "cancelled",
  cancelled: "cancelled",
  incomplete: "pending",
  created: "pending",
  authenticated: "pending",
  pending: "past_due", // Razorpay: a charge failed and is being retried
  incomplete_expired: "expired",
  expired: "expired",
  completed: "expired",
}

/** Stripe `data.object.status`, Paddle `data.status`, Razorpay `payload.subscription.entity.status`. */
export function defaultStatusOf(event: BillingEvent): SubscriptionStatus | undefined {
  const r = event.raw
  const found =
    dig(r, "data", "object", "status") ??
    dig(r, "data", "status") ??
    dig(r, "payload", "subscription", "entity", "status")
  return typeof found === "string" ? GATEWAY_STATUS[found] : undefined
}

const msDate = (v: unknown) => (typeof v === "number" ? new Date(v) : undefined)
const secDate = (v: unknown) => (typeof v === "number" ? new Date(v * 1000) : undefined)
const isoDate = (v: unknown) => {
  const n = typeof v === "string" ? Date.parse(v) : Number.NaN
  return Number.isNaN(n) ? undefined : new Date(n)
}

// App Store data.status / Get All Subscription Statuses `status`.
// https://developer.apple.com/documentation/appstoreservernotifications/status
const APPLE: Record<number, SubscriptionStatus> = {
  1: "active",
  2: "expired",
  3: "past_due", // billing retry: no access
  4: "past_due", // Billing Grace Period: access until gracePeriodExpiresDate
  5: "expired", // refunded or revoked from Family Sharing
}

// subscriptionsv2 subscriptionState.
// https://developer.android.com/google/play/billing/lifecycle/subscriptions
const GOOGLE: Record<string, SubscriptionStatus> = {
  SUBSCRIPTION_STATE_PENDING: "pending",
  SUBSCRIPTION_STATE_ACTIVE: "active",
  // "the user retains access to the content until the end of the current billing period"
  SUBSCRIPTION_STATE_CANCELED: "active",
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "past_due", // access; expiryTime is extended through it
  SUBSCRIPTION_STATE_ON_HOLD: "past_due", // account hold: block access
  SUBSCRIPTION_STATE_PAUSED: "paused",
  SUBSCRIPTION_STATE_EXPIRED: "expired",
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: "expired",
}

/**
 * The store's own view of a subscription, from a signet-payments App Store or
 * Google Play event (or a `Subscription` read with `getSubscription`):
 * App Store `data.status` with the transaction's `expiresDate` and the renewal
 * info's `gracePeriodExpiresDate`; Google Play's `subscriptionState` and line
 * items' `expiryTime`. Undefined for anything else.
 */
export function storeStateOf(gateway: string, raw: unknown): SourceState | undefined {
  if (gateway === "appstore") {
    const code = dig(raw, "payload", "data", "status") ?? dig(raw, "status")
    const status = typeof code === "number" ? APPLE[code] : undefined
    if (!status) return undefined
    return {
      status,
      currentPeriodEnd: msDate(dig(raw, "transaction", "expiresDate")),
      graceUntil:
        code === 4 ? (msDate(dig(raw, "renewalInfo", "gracePeriodExpiresDate")) ?? null) : null,
    }
  }
  if (gateway === "googleplay") {
    // biome-ignore lint/suspicious/noExplicitAny: a subscriptionsv2 resource
    const s: any = dig(raw, "subscription") ?? raw
    const status =
      typeof s?.subscriptionState === "string" ? GOOGLE[s.subscriptionState] : undefined
    if (!status) return undefined
    const ends = ((s.lineItems ?? []) as { expiryTime?: string }[])
      .map((i) => isoDate(i.expiryTime)?.getTime())
      .filter((n): n is number => n !== undefined)
    const end = ends.length ? new Date(Math.max(...ends)) : undefined
    return {
      status,
      currentPeriodEnd: end,
      graceUntil:
        s.subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" ? (end ?? null) : null,
    }
  }
  return undefined
}

/** Web gateways whose `cancelled` means renewal is off and access lasts until the period end. */
const CANCELLED_UNTIL_PERIOD_END = new Set(["lemonsqueezy"])

/**
 * Stripe `current_period_end` (object or first item), Razorpay `current_end`,
 * Paddle `current_billing_period.ends_at`, Lemon Squeezy `data.attributes`
 * `ends_at` (set once cancelled) else `renews_at`.
 */
export function defaultPeriodEndOf(event: BillingEvent): Date | undefined {
  const r = event.raw
  return (
    secDate(dig(r, "data", "object", "current_period_end")) ??
    secDate(dig(r, "data", "object", "items", "data", 0, "current_period_end")) ??
    secDate(dig(r, "payload", "subscription", "entity", "current_end")) ??
    isoDate(dig(r, "data", "current_billing_period", "ends_at")) ??
    isoDate(dig(r, "data", "attributes", "ends_at")) ??
    isoDate(dig(r, "data", "attributes", "renews_at"))
  )
}

/** Razorpay `payload.subscription.entity.plan_id`; Stripe `data.object` items' price or plan id. */
export function defaultPlanIdOf(event: BillingEvent): string | undefined {
  const r = event.raw
  const found =
    dig(r, "payload", "subscription", "entity", "plan_id") ??
    dig(r, "data", "object", "items", "data", 0, "price", "id") ??
    dig(r, "data", "object", "plan", "id") ??
    event.productId
  return typeof found === "string" ? found : undefined
}

/** "2026-11", "2026-11-15" or "all", in UTC. */
export const periodOf = (period: Period, at: Date): string =>
  period === "total" ? "all" : at.toISOString().slice(0, period === "day" ? 10 : 7)

const isInt = (n: unknown): n is number => Number.isSafeInteger(n)

export function createEntitlements<P extends Plans>(
  db: SignetDb<unknown>,
  options: EntitlementsOptions<P>,
) {
  const { plans, tables, billing } = options
  const fallback = options.default
  const now = options.now ?? (() => new Date())
  if (!plans[fallback])
    throw new SignetDbError("BAD_VALUE", `default plan "${fallback}" is not in plans.`)
  const o = db.orm as AnyOrm
  const T = tables
  const P = T.subjectPlans
  const pc = T.subjectPlans as unknown as Cols
  const oc = T.entitlementOverrides as unknown as Cols
  const uc = T.usageCounters as unknown as Cols
  const allFeatures = new Set(Object.values(plans).flatMap((p) => p.features ?? []))
  const allLimits = new Set(Object.values(plans).flatMap((p) => Object.keys(p.limits ?? {})))

  const checkPlan = (plan: string): PlanKey<P> => {
    if (!plans[plan])
      throw new SignetDbError(
        "BAD_VALUE",
        `Unknown plan "${plan}". Plans: ${Object.keys(plans).join(", ")}.`,
      )
    return plan as PlanKey<P>
  }
  const checkKey = (set: Set<string>, kind: string, key: string) => {
    if (!set.has(key))
      throw new SignetDbError(
        "BAD_VALUE",
        `Unknown ${kind} "${key}". Declared: ${[...set].join(", ") || "none"}.`,
      )
  }
  const subjectId = (subject: string) => {
    if (!subject) throw new SignetDbError("BAD_VALUE", "A subject id is required.")
    return subject
  }

  const graceMs = billing?.graceMs ?? 3 * 86_400_000
  const order = Object.keys(plans)
  const sourceId = (gateway: string, subscriptionId: string) => `${gateway}|${subscriptionId}`

  async function rows(subject: string): Promise<Cols[]> {
    return o.select().from(P).where(eq(pc.subject, subject))
  }
  async function source(gateway: string, subscriptionId: string): Promise<Cols | undefined> {
    return (
      await o
        .select()
        .from(P)
        .where(eq(pc.id, sourceId(gateway, subscriptionId)))
        .limit(1)
    )[0]
  }

  /** active/trialing until currentPeriodEnd (+ graceMs if no event came); cancelled until currentPeriodEnd; past_due until graceUntil. */
  const isLive = (r: Cols, at: number): boolean => {
    if (!plans[r.plan]) return false
    const end = r.currentPeriodEnd ? r.currentPeriodEnd.getTime() : undefined
    switch (r.status) {
      case "active":
      case "trialing":
        return end === undefined || end + graceMs > at
      case "cancelled":
        return end !== undefined && end > at
      case "past_due":
        return !!r.graceUntil && r.graceUntil.getTime() > at
      default:
        return false
    }
  }

  async function get(subject: string): Promise<Resolved<P>> {
    subjectId(subject)
    const at = now()
    const all = (await rows(subject)).sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime())
    const view = (r: Cols): Source => ({
      gateway: r.gateway,
      subscriptionId: r.subscriptionId,
      status: r.status,
      currentPeriodEnd: r.currentPeriodEnd ?? null,
      graceUntil: r.graceUntil ?? null,
      active: isLive(r, at.getTime()),
    })
    const entitlements: Entitlement<PlanKey<P>>[] = order
      .map((plan) => {
        const sources = all.filter((r) => r.plan === plan).map(view)
        const ends = sources
          .filter((x) => x.active && x.currentPeriodEnd)
          .map((x) => (x.currentPeriodEnd as Date).getTime())
        return {
          plan: plan as PlanKey<P>,
          active: sources.some((x) => x.active),
          currentPeriodEnd: ends.length ? new Date(Math.max(...ends)) : null,
          sources,
        }
      })
      .filter((e) => e.sources.length)
    const best = entitlements.filter((e) => e.active).at(-1)
    // The newest active source of the winning plan; else the newest source.
    const top = best ? best.sources.find((x) => x.active) : undefined
    const newest = all[0]
    const stored = newest && plans[newest.plan] ? (newest.plan as PlanKey<P>) : null
    const plan = best ? best.plan : fallback
    const def = plans[plan] as PlanDef
    const overrides: Override[] = (
      await o
        .select()
        .from(T.entitlementOverrides)
        .where(and(eq(oc.subject, subject), or(isNull(oc.expiresAt), gt(oc.expiresAt, at))))
        .orderBy(desc(oc.id))
    ).map((x: Cols) => ({
      id: x.id,
      kind: x.kind,
      key: x.key,
      value: x.value,
      expiresAt: x.expiresAt,
      createdAt: x.createdAt,
    }))
    const features = new Set<string>(def.features ?? [])
    const limits: Record<string, number> = {}
    for (const k of allLimits) limits[k] = def.limits?.[k] ?? 0
    const seen = new Set<string>()
    for (const x of overrides) {
      // Newest first (ids sort by creation): the first per key wins.
      if (seen.has(`${x.kind}:${x.key}`)) continue
      seen.add(`${x.kind}:${x.key}`)
      if (x.kind === "feature") x.value ? features.add(x.key) : features.delete(x.key)
      else limits[x.key] = x.value ?? Number.POSITIVE_INFINITY
    }
    return {
      subject,
      plan,
      storedPlan: stored,
      status: top?.status ?? (newest?.status as SubscriptionStatus | undefined) ?? null,
      graceUntil: top ? top.graceUntil : (newest?.graceUntil ?? null),
      currentPeriodEnd: best?.currentPeriodEnd ?? null,
      source: top ? { gateway: top.gateway, subscriptionId: top.subscriptionId } : null,
      entitlements,
      features: [...features] as FeatureOf<P>[],
      limits: limits as Record<LimitOf<P>, number>,
      overrides,
    }
  }

  async function usage(subject: string, key?: LimitOf<P>): Promise<Usage<LimitOf<P>>[]> {
    const r = await get(subject)
    const keys = (key ? [key] : [...allLimits]) as unknown as LimitOf<P>[]
    const at = now()
    return Promise.all(
      keys.map(async (k) => {
        const period = periodOf(options.periods?.[k] ?? "month", at)
        const [u] = await o
          .select()
          .from(T.usageCounters)
          .where(and(eq(uc.subject, subject), eq(uc.key, k), eq(uc.period, period)))
        const used = Number(u?.used ?? 0)
        const limit = r.limits[k]
        return { key: k, period, used, limit, remaining: Math.max(0, limit - used) }
      }),
    )
  }

  /**
   * Add `n` to this period's counter if it stays within the limit. The check
   * and the increment are one UPDATE, so concurrent calls cannot overspend.
   */
  async function consume(
    subject: string,
    key: LimitOf<P>,
    n = 1,
  ): Promise<Usage<LimitOf<P>> & { ok: boolean }> {
    checkKey(allLimits, "limit", key)
    if (!isInt(n) || n <= 0)
      throw new SignetDbError("BAD_VALUE", "consume needs a positive integer amount.")
    const limit = (await get(subject)).limits[key]
    const period = periodOf(options.periods?.[key] ?? "month", now())
    const mine = and(eq(uc.subject, subject), eq(uc.key, key), eq(uc.period, period))
    await o.insert(T.usageCounters).values({ subject, key, period, used: 0 }).onConflictDoNothing()
    const cond = Number.isFinite(limit) ? and(mine, sql`${uc.used} + ${n} <= ${limit}`) : mine
    const [hit] = await o
      .update(T.usageCounters)
      .set({ used: sql`${uc.used} + ${n}` })
      .where(cond)
      .returning()
    const used = Number(
      hit?.used ?? (await o.select().from(T.usageCounters).where(mine))[0]?.used ?? 0,
    )
    return { ok: !!hit, key, period, used, limit, remaining: Math.max(0, limit - used) }
  }

  /**
   * Write one source row unless a newer change is stored, or it belongs to
   * another subject. Both guards are in the UPDATE's WHERE, and the row id is
   * `${gateway}|${subscriptionId}`, so they hold under concurrent writes.
   */
  async function upsertSource(
    subject: string,
    gateway: string,
    subscriptionId: string,
    values: Cols,
    at: Date,
    actor: Actor,
  ): Promise<"applied" | "stale" | "other_subject"> {
    const w = audited(db, { actor })
    const id = sourceId(gateway, subscriptionId)
    const fresh = and(eq(pc.id, id), eq(pc.subject, subject), lte(pc.eventAt, at))
    for (let attempt = 0; attempt < 2; attempt++) {
      if ((await w.update(P, { ...values, eventAt: at } as never, fresh)).length) return "applied"
      const cur = await source(gateway, subscriptionId)
      if (cur) return cur.subject === subject ? "stale" : "other_subject"
      try {
        await w.insert(P, {
          id,
          subject,
          gateway,
          subscriptionId,
          ...values,
          eventAt: at,
        } as never)
        return "applied"
      } catch (err) {
        if (await source(gateway, subscriptionId)) continue // lost an insert race: re-check
        throw err
      }
    }
    return "stale"
  }

  /** Set the `manual` source. A live subscription on a later-declared plan still wins. */
  async function setPlan(subject: string, plan: PlanKey<P>, { actor }: WriteOptions) {
    subjectId(subject)
    checkPlan(plan)
    await upsertSource(
      subject,
      "manual",
      subject,
      { plan, status: "active", currentPeriodEnd: null, graceUntil: null },
      now(),
      actor,
    )
    return get(subject)
  }

  async function addOverride(
    subject: string,
    kind: "feature" | "limit",
    key: string,
    value: number | null,
    { actor, expiresAt }: WriteOptions & { expiresAt?: Date },
  ) {
    subjectId(subject)
    const [x] = await audited(db, { actor }).insert(T.entitlementOverrides, {
      subject,
      kind,
      key,
      value,
      expiresAt: expiresAt ?? null,
    } as never)
    return x as unknown as Override
  }

  const planOf = (gateway: string, id: string | undefined) =>
    id === undefined ? undefined : (billing?.plans[`${gateway}:${id}`] ?? billing?.plans[id])

  // Not applied for a reason a retry can fix (the subject is linked later, the
  // plan map is fixed): thrown so withIdempotency releases the key, not stored.
  class Retryable extends Error {
    constructor(readonly result: BillingResult) {
      super(result.reason)
    }
  }
  const settle = (p: Promise<BillingResult>) =>
    p.catch((err) => {
      if (err instanceof Retryable) return err.result
      throw err
    })

  /** One event (or a live read) onto its source row. `state` is the store's own view, if any. */
  async function applySource(
    event: BillingEvent & { subscriptionId: string },
    opts: { subject?: string },
    state: Partial<SourceState> | undefined,
  ): Promise<BillingResult> {
    const cfg = billing as BillingConfig<P>
    const src = await source(event.gateway, event.subscriptionId)
    // A Google Play upgrade or resubscribe is a new token linked to the old one.
    const linked =
      event.gateway === "googleplay"
        ? (dig(event.raw, "subscription", "linkedPurchaseToken") ??
          dig(event.raw, "linkedPurchaseToken"))
        : undefined
    const subject =
      opts.subject ??
      (await cfg.subjectOf?.(event)) ??
      src?.subject ??
      (typeof linked === "string" ? (await source("googleplay", linked))?.subject : undefined)
    if (!subject) throw new Retryable({ applied: false, reason: "no_subject" })
    // One subscription, one subject: a receipt cannot unlock a second account.
    if (src && src.subject !== subject) return { applied: false, subject, reason: "other_subject" }
    const gatewayPlan = (cfg.planIdOf ?? defaultPlanIdOf)(event)
    const mapped = planOf(event.gateway, gatewayPlan)
    if (gatewayPlan !== undefined && !mapped)
      throw new Retryable({ applied: false, subject, reason: "unknown_plan" })
    // No plan on the event: keep the source's, else the subject's newest (a manual plan, say).
    const plan =
      mapped ??
      src?.plan ??
      (await rows(subject)).sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime())[0]?.plan
    if (!plan) throw new Retryable({ applied: false, subject, reason: "unknown_plan" })
    const reported =
      event.type === "subscription.created" || event.type === "subscription.updated"
        ? (cfg.statusOf ?? defaultStatusOf)(event)
        : undefined
    const status: SubscriptionStatus =
      state?.status ??
      reported ??
      STATUS[event.type] ??
      (src?.status as SubscriptionStatus | undefined) ??
      "active"
    // A refund of an earlier renewal leaves the subscription active: its
    // expiresDate is in the past, so never move the end backwards.
    const keepEnd =
      event.type === "refund.processed" && state && (status === "active" || status === "trialing")
    const end = state
      ? keepEnd &&
        src?.currentPeriodEnd &&
        src.currentPeriodEnd.getTime() > (state.currentPeriodEnd?.getTime() ?? 0)
        ? src.currentPeriodEnd
        : state.currentPeriodEnd
      : cfg.periodEndOf
        ? cfg.periodEndOf(event)
        : status === "cancelled" && !CANCELLED_UNTIL_PERIOD_END.has(event.gateway)
          ? null // a web gateway's cancellation ends access now (Lemon Squeezy's lasts until ends_at)
          : defaultPeriodEndOf(event)
    const values: Cols = {
      plan,
      status,
      currentPeriodEnd: end === undefined ? (src?.currentPeriodEnd ?? null) : end,
      graceUntil:
        status !== "past_due"
          ? null
          : state?.graceUntil !== undefined
            ? state.graceUntil
            : src?.status === "past_due" && src.graceUntil
              ? src.graceUntil // still the same lapse: the grace clock keeps running
              : new Date(event.occurredAt.getTime() + graceMs),
    }
    const actor: Actor = { type: "system", id: `billing:${event.gateway}` }
    const done = await upsertSource(
      subject,
      event.gateway,
      event.subscriptionId,
      values,
      event.occurredAt,
      actor,
    )
    return done === "applied"
      ? { applied: true, subject, plan, status }
      : { applied: false, subject, reason: done }
  }

  const needBilling = (what: string) => {
    if (!billing)
      throw new SignetDbError(
        "BAD_VALUE",
        `${what} needs createEntitlements(db, { billing: { plans } }).`,
      )
  }

  /**
   * Apply a signet-payments event to the source it names (`gateway` +
   * `subscriptionId`): `subscription.*` events, and App Store refunds of a
   * subscription. Deduped on the event id; an event older than the source's
   * newest is ignored. App Store and Google Play events are read with
   * `storeStateOf` (renewal, expiry, refund or revoke, grace period, billing
   * retry, account hold).
   */
  async function applyBillingEvent(
    event: BillingEvent,
    opts: { subject?: string } = {},
  ): Promise<BillingResult> {
    const state = storeStateOf(event.gateway, event.raw)
    if (!(event.type in STATUS) && !(state && event.type === "refund.processed"))
      return { applied: false, reason: "not_subscription" }
    needBilling("applyBillingEvent")
    const subscriptionId = event.subscriptionId
    if (!subscriptionId) return { applied: false, reason: "not_subscription" }
    return settle(
      withIdempotency(db, `${event.gateway}:${event.id}`, "signet-entitlements", () =>
        applySource({ ...event, subscriptionId }, opts, state),
      ),
    )
  }

  /**
   * Apply a subscription read live from its gateway (signet-payments
   * `getSubscription`, or `restorePurchases`) to a subject: the restore path.
   * Refused with `other_subject` when the subscription is already another
   * subject's. Store subscriptions are read with `storeStateOf`; others by
   * `status` and `currentPeriodEnd` (`cancelled` ends access now).
   */
  async function applySubscription(
    sub: SubscriptionLike,
    opts: { subject: string },
  ): Promise<BillingResult> {
    needBilling("applySubscription")
    subjectId(opts.subject)
    const event = {
      id: `sync:${sub.gateway}:${sub.gatewayId}`,
      gateway: sub.gateway,
      type: "subscription.updated",
      occurredAt: now(),
      subscriptionId: sub.gatewayId,
      ...(sub.productId ? { productId: sub.productId } : {}),
      raw: sub.raw,
    }
    // Most web gateways report cancelled once access has ended (a cancel at period end stays
    // active), so the period end is cleared. Lemon Squeezy's cancelled lasts until ends_at.
    const endsNow = sub.status === "cancelled" && !CANCELLED_UNTIL_PERIOD_END.has(sub.gateway)
    const state = storeStateOf(sub.gateway, sub.raw) ?? {
      status: sub.status,
      currentPeriodEnd: endsNow ? null : sub.currentPeriodEnd,
    }
    return settle(applySource(event, opts, state))
  }

  return {
    plans,
    default: fallback,
    features: [...allFeatures] as FeatureOf<P>[],
    limitKeys: [...allLimits] as unknown as LimitOf<P>[],
    /** The plan, features, limits and overrides in effect for a subject now. */
    get,
    async can(subject: string, feature: FeatureOf<P>): Promise<boolean> {
      checkKey(allFeatures, "feature", feature)
      return (await get(subject)).features.includes(feature)
    },
    async limit(subject: string, key: LimitOf<P>): Promise<number> {
      checkKey(allLimits, "limit", key)
      return (await get(subject)).limits[key]
    },
    consume,
    usage,
    /** Set a plan by hand (admin, comp, migration). A later billing event replaces it. */
    setPlan,
    grant(subject: string, feature: FeatureOf<P>, o: WriteOptions & { expiresAt?: Date }) {
      checkKey(allFeatures, "feature", feature)
      return addOverride(subject, "feature", feature, 1, o)
    },
    revoke(subject: string, feature: FeatureOf<P>, o: WriteOptions & { expiresAt?: Date }) {
      checkKey(allFeatures, "feature", feature)
      return addOverride(subject, "feature", feature, 0, o)
    },
    /** Override a limit; `null` is unlimited. */
    setLimit(
      subject: string,
      key: LimitOf<P>,
      value: number | null,
      o: WriteOptions & { expiresAt?: Date },
    ) {
      checkKey(allLimits, "limit", key)
      if (value !== null && (!isInt(value) || value < 0))
        throw new SignetDbError("BAD_VALUE", "A limit is a non-negative integer, or null.")
      return addOverride(subject, "limit", key, value, o)
    },
    /** Delete one override by id. Returns whether it existed. */
    async removeOverride(subject: string, id: string, { actor }: WriteOptions) {
      const gone = await audited(db, { actor }).delete(
        T.entitlementOverrides,
        and(eq(oc.subject, subject), eq(oc.id, id)),
      )
      return gone.length > 0
    },
    applyBillingEvent,
    applySubscription,
  }
}

export type Entitlements<P extends Plans = Plans> = ReturnType<typeof createEntitlements<P>>
