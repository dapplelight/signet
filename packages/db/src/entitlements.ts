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
 * ```
 *
 * A subject is any id: a user, an org. Its plan comes from its stored row
 * (set by billing events or `setPlan`), else `default`. Overrides grant or
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

/** Declare plans in code. The literal keys type `can`, `limit` and `consume`. */
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
  raw: unknown
}

export type BillingConfig<P extends Plans> = {
  /** Gateway plan or price id → plan key, e.g. `{ plan_Nx1: "pro", price_9f: "pro" }`. */
  plans: Readonly<Record<string, PlanKey<P>>>
  /** Read the gateway plan id off an event. Default: Razorpay's and Stripe's payload shapes. */
  planIdOf?: (event: BillingEvent) => string | undefined
  /** Who the subscription belongs to, e.g. from the gateway's notes/metadata. Default: the subject stored for the subscription id. */
  subjectOf?: (event: BillingEvent) => string | undefined | Promise<string | undefined>
  /** How long past_due keeps the paid plan. Default 3 days. */
  graceMs?: number
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

export type Resolved<P extends Plans> = {
  subject: string
  /** The plan in effect now. */
  plan: PlanKey<P>
  /** The stored plan, which differs from `plan` when it lapsed. */
  storedPlan: PlanKey<P> | null
  status: SubscriptionStatus | null
  graceUntil: Date | null
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
  /** Why not applied: not_subscription, no_subject, unknown_plan or stale (an older event). */
  reason?: "not_subscription" | "no_subject" | "unknown_plan" | "stale"
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

/** Razorpay `payload.subscription.entity.plan_id`; Stripe `data.object` items' price or plan id. */
export function defaultPlanIdOf(event: BillingEvent): string | undefined {
  const r = event.raw
  const found =
    dig(r, "payload", "subscription", "entity", "plan_id") ??
    dig(r, "data", "object", "items", "data", 0, "price", "id") ??
    dig(r, "data", "object", "plan", "id")
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

  async function row(subject: string): Promise<Cols | undefined> {
    return (await o.select().from(P).where(eq(pc.subject, subject)).limit(1))[0]
  }

  async function get(subject: string): Promise<Resolved<P>> {
    subjectId(subject)
    const at = now()
    const r = await row(subject)
    const stored = r && plans[r.plan] ? (r.plan as PlanKey<P>) : null
    const live =
      stored &&
      (r?.status === "active" ||
        r?.status === "trialing" ||
        (r?.status === "past_due" && r.graceUntil && r.graceUntil.getTime() > at.getTime()))
    const plan = live ? stored : fallback
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
      status: (r?.status as SubscriptionStatus | undefined) ?? null,
      graceUntil: r?.graceUntil ?? null,
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
   * Write a subject's plan row unless a newer change is stored. The guard is
   * in the UPDATE's WHERE, so it holds under concurrent writes.
   */
  async function upsertPlan(
    subject: string,
    values: Cols,
    at: Date,
    actor: Actor,
  ): Promise<boolean> {
    const w = audited(db, { actor })
    const fresh = and(eq(pc.subject, subject), lte(pc.eventAt, at))
    for (let attempt = 0; attempt < 2; attempt++) {
      if ((await w.update(P, { ...values, eventAt: at } as never, fresh)).length) return true
      if (await row(subject)) return false // a newer change is stored
      if (!values.plan) return false
      try {
        await w.insert(P, { subject, ...values, eventAt: at } as never)
        return true
      } catch (err) {
        if (await row(subject)) continue // lost an insert race: retry the guarded update
        throw err
      }
    }
    return false
  }

  async function setPlan(subject: string, plan: PlanKey<P>, { actor }: WriteOptions) {
    subjectId(subject)
    checkPlan(plan)
    await upsertPlan(subject, { plan, status: "active", graceUntil: null }, now(), actor)
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

  async function applyBillingEvent(
    event: BillingEvent,
    opts: { subject?: string } = {},
  ): Promise<BillingResult> {
    if (!(event.type in STATUS)) return { applied: false, reason: "not_subscription" }
    if (!billing)
      throw new SignetDbError(
        "BAD_VALUE",
        "applyBillingEvent needs createEntitlements(db, { billing: { plans } }).",
      )
    // Not applied for a reason a retry can fix (the subject is linked later, the
    // plan map is fixed): thrown so withIdempotency releases the key, not stored.
    class Retryable extends Error {
      constructor(readonly result: BillingResult) {
        super(result.reason)
      }
    }
    const run = withIdempotency(
      db,
      `${event.gateway}:${event.id}`,
      "signet-entitlements",
      async () => {
        const bySub = event.subscriptionId
          ? (
              await o
                .select()
                .from(P)
                .where(
                  and(eq(pc.gateway, event.gateway), eq(pc.subscriptionId, event.subscriptionId)),
                )
                .limit(1)
            )[0]
          : undefined
        const subject = opts.subject ?? (await billing.subjectOf?.(event)) ?? bySub?.subject
        if (!subject) throw new Retryable({ applied: false, reason: "no_subject" })
        const gatewayPlan = (billing.planIdOf ?? defaultPlanIdOf)(event)
        const plan = gatewayPlan === undefined ? undefined : billing.plans[gatewayPlan]
        if (gatewayPlan !== undefined && !plan)
          throw new Retryable({ applied: false, subject, reason: "unknown_plan" })
        const existing = await row(subject)
        const status = STATUS[event.type] ?? (existing?.status as SubscriptionStatus) ?? "active"
        const values: Cols = {
          status,
          gateway: event.gateway,
          subscriptionId: event.subscriptionId ?? existing?.subscriptionId ?? null,
          graceUntil:
            status === "past_due"
              ? new Date(event.occurredAt.getTime() + (billing.graceMs ?? 3 * 86_400_000))
              : null,
          ...(plan ? { plan } : {}),
        }
        if (!plan && !existing)
          throw new Retryable({ applied: false, subject, reason: "unknown_plan" })
        const actor: Actor = { type: "system", id: `billing:${event.gateway}` }
        const applied = await upsertPlan(subject, values, event.occurredAt, actor)
        if (!applied) return { applied: false, subject, reason: "stale" } as BillingResult
        return { applied: true, subject, plan: plan ?? existing?.plan, status } as BillingResult
      },
    )
    return run.catch((err) => {
      if (err instanceof Retryable) return err.result
      throw err
    })
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
  }
}

export type Entitlements<P extends Plans = Plans> = ReturnType<typeof createEntitlements<P>>
