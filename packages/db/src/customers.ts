/**
 * Customers across the App Store, Google Play and the web, on the tables
 * from `monetisationTables()` and `entitlementTables()`:
 *
 * - **Timeline:** one view per user of purchases, renewals, refunds,
 *   cancellations, billing issues and grace periods, recorded from the
 *   signet-payments events you already feed to `applyBillingEvent`, plus the
 *   user's payments and ledger postings when you pass the payments store.
 * - **Identity merge:** an anonymous app user buys, then signs in; their
 *   subscriptions, grants, payments, timeline and requests move to the
 *   account once, with no copy left to grant twice.
 * - **Customer Center:** the current plan and renewal date, cancel (web
 *   gateways directly, stores by deep link), refund requests and support
 *   messages sent to the team through notify, and a retention offer.
 *
 * ```ts
 * const customers = createCustomers(db, {
 *   tables: { ...entitlementTables(), ...monetisationTables() },
 *   entitlements: ent,
 *   payments: store,                                   // signet-payments store
 *   notify: (n) => notifier.notify(teamId, "customer.request", n),
 *   cancel: (s) => payments.gateway(s.gateway).cancelSubscription(s.subscriptionId, { atPeriodEnd: true }),
 * })
 * const anon = await customers.anonymousId()           // before sign-in
 * await customers.merge({ anonymousId: anon, userId }) // after
 * createPayments({ ..., onEvent: async (e) => { await ent.applyBillingEvent(e); await customers.record(e) } })
 * ```
 */

import { and, desc, eq, isNull, ne, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { PROMOTIONAL } from "./entitlements.js"
import { SignetDbError } from "./errors.js"
import { newId } from "./id.js"
import {
  type OfferHistory,
  type OfferingProduct,
  offerEligible,
  type ProductOffer,
} from "./offerings.js"
import { type Actor, audited } from "./scoped.js"

export type TimelineKind =
  | "purchase"
  | "trial"
  | "renewal"
  | "refund"
  | "cancellation"
  | "uncancellation"
  | "billing_issue"
  | "grace_period"
  | "expiration"
  | "paused"
  | "dispute"
  /** The customer asked Apple for a refund (CONSUMPTION_REQUEST); answer with `consumptionInfo`. */
  | "refund_request"
  /** A promotional plan granted from admin (`grantPromotional`); it lapses on its own. */
  | "promotional"

/** The part of a signet-payments `Event` the timeline reads. */
export type CustomerEventLike = {
  id: string
  gateway: string
  type: string
  gatewayType?: string
  occurredAt: Date
  subscriptionId?: string
  paymentId?: string
  orderId?: string
  productId?: string
  amount?: number
  currency?: string
  approximate?: boolean
  raw?: unknown
}

export type TimelineEntry = {
  id: string
  kind: TimelineKind
  gateway: string
  eventType: string
  subscriptionId: string | null
  paymentId: string | null
  productId: string | null
  amount: number | null
  currency: string | null
  approximate: boolean
  occurredAt: Date
}

/** Totals per currency from the ledger: what the customer paid and was refunded, in minor units. */
export type TimelineTotal = {
  currency: string
  paid: number
  refunded: number
  /** Some of it is App Store prices, not settled revenue. */
  approximate: boolean
}

/** The part of a signet-payments `PaymentsStore` customers read. */
export type PaymentsStoreLike = {
  listPayments(q: {
    userId?: string
    limit: number
  }): Promise<{ gateway: string; gatewayId: string; userId?: string }[]>
  getPayment(
    gateway: string,
    id: string,
  ): Promise<{ gateway: string; gatewayId: string; userId?: string } | undefined>
  findLinked(gateway: string, link: { orderId?: string }): Promise<{ userId?: string } | undefined>
  eventsFor(gateway: string, paymentId: string): Promise<CustomerEventLike[]>
  entries(q: {
    ref?: string
    gateway?: string
  }): Promise<{ account: string; amount: number; currency: string; kind: string }[]>
  reassignUser?(from: string, to: string): Promise<number>
}

/** The part of signet-db's `Resolved` (from `ent.get`) customers read. */
export type ResolvedLike = {
  plan: string
  status: string | null
  currentPeriodEnd: Date | null
  graceUntil: Date | null
  source: { gateway: string; subscriptionId: string } | null
  /** Every source per plan; offers read which subscriptions are live and when they ended. */
  entitlements?: readonly {
    sources: readonly {
      gateway: string
      subscriptionId: string
      active: boolean
      currentPeriodEnd: Date | null
    }[]
  }[]
}

/** What `consumptionInfo` passes to the app's hooks. */
export type ConsumptionContext = {
  subject: string
  transactionId: string
  /** Apple's `consumptionRequestReason`: UNINTENDED_PURCHASE, FULFILLMENT_ISSUE, UNSATISFIED_WITH_PURCHASE, LEGAL or OTHER. */
  reason: string | null
  /** The customer's timeline, newest first. */
  entries: TimelineEntry[]
  event: CustomerEventLike
}

/** Apple's ConsumptionRequest (signet-payments `ConsumptionRequest`). */
export type ConsumptionInfo = {
  customerConsented: true
  deliveryStatus:
    | "DELIVERED"
    | "UNDELIVERED_QUALITY_ISSUE"
    | "UNDELIVERED_WRONG_ITEM"
    | "UNDELIVERED_SERVER_OUTAGE"
    | "UNDELIVERED_OTHER"
  sampleContentProvided: boolean
  consumptionPercentage?: number
  refundPreference?: "DECLINE" | "GRANT_FULL" | "GRANT_PRORATED"
}

/** A product offer as `withOffers` returns it: eligible for this customer. */
type WithOffers<O> = O & { products: (OfferingProduct & { offers?: ProductOffer[] })[] }

export type SubscriptionSource = { gateway: string; subscriptionId: string; productId?: string }

export type RetentionOffer =
  | { kind: "discount"; percent: number; months: number }
  | { kind: "free_period"; days: number }

export type RequestKind = "refund" | "cancel" | "retention" | "support" | "offer"
export type RequestStatus = "open" | "done" | "declined"

export type CustomerRequest = {
  id: string
  subject: string
  kind: RequestKind
  status: RequestStatus
  gateway: string | null
  reference: string | null
  message: string | null
  data: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

/** What `notify` gets: a refund request or a support message, for the team. */
export type CustomerNotice = {
  kind: "refund_request" | "support"
  subject: string
  request: CustomerRequest
  /** One line for a chat or email: "Refund requested for appstore 2000001 by u1: reason". */
  text: string
}

export type Overview = {
  subject: string
  plan: string
  status: string | null
  /** The renewal (or end) date of the plan in effect. */
  currentPeriodEnd: Date | null
  graceUntil: Date | null
  /** Renews at currentPeriodEnd (active or trialing, not cancelled). */
  renews: boolean
  source: SubscriptionSource | null
  /** Bought in a store: cancel there, through manageUrl. */
  store: boolean
  manageUrl: string | null
  /** A web subscription this server can cancel. */
  canCancel: boolean
  retention: RetentionOffer | null
}

export type MergeResult =
  | {
      merged: true
      /** The anonymous id was already merged into this account; nothing was left to move. */
      already: boolean
      moved: {
        subscriptions: number
        overrides: number
        events: number
        requests: number
        payments: number
      }
    }
  | {
      merged: false
      reason:
        | "not_anonymous"
        | "same_subject"
        | "target_is_anonymous"
        | "already_merged"
        | "other_org"
        | "not_member"
    }

export type CustomerTables = {
  customerIdentities: Table
  customerEvents: Table
  customerRequests: Table
  subjectPlans: Table
  entitlementOverrides: Table
}

export type CustomersOptions = {
  tables: CustomerTables
  /** signet-db's `createEntitlements(...)` (only `get` is read). */
  entitlements: {
    get(subject: string): Promise<ResolvedLike>
    /** signet-db entitlements' own; needed by `grantPromotional`. */
    grantPromotional?(
      subject: string,
      plan: never,
      opts: { actor: Actor; expiresAt: Date },
    ): Promise<{ id: string; expiresAt: Date }>
    endPromotional?(subject: string, id: string, opts: { actor: Actor }): Promise<boolean>
  }
  /** signet-payments' store: payments and ledger on the timeline, payment ownership, and moving payments in a merge. */
  payments?: PaymentsStoreLike
  /** Tell the team about a refund request or support message. Recorded first, so a failed send is retried on the next identical request. */
  notify?: (notice: CustomerNotice) => unknown
  /** Cancel a web subscription at its gateway, e.g. `cancelSubscription(id, { atPeriodEnd: true })`. Without it, web subscriptions are not cancellable here. */
  cancel?: (source: SubscriptionSource) => unknown
  /**
   * Where a store subscription is managed. Default: the App Store's
   * subscriptions page, and Google Play's with the product and `googlePlayPackage`.
   */
  manageUrl?: (source: SubscriptionSource) => string | null | undefined
  googlePlayPackage?: string
  /**
   * A retention offer shown before cancelling. Default eligibility: a live web
   * subscription that never took one (store offers are made in the store).
   * `apply` does it at the gateway (a coupon, a skipped charge).
   */
  retention?: {
    offer: RetentionOffer
    eligible?: (ctx: { subject: string; overview: Omit<Overview, "retention"> }) => unknown
    apply: (ctx: { subject: string; source: SubscriptionSource; offer: RetentionOffer }) => unknown
  }
  /** For merges within an org: is `userId` a member of `orgId`? signet-db orgs: `async (u, o) => !!(await orgs.membership(o, u))`. */
  isMember?: (userId: string, orgId: string) => unknown
  /**
   * Answering Apple's CONSUMPTION_REQUEST (`consumptionInfo`). `consented` is
   * required: a customer who did not agree to share their data with Apple gets
   * no answer at all (Apple's rule). The rest default from the customer's
   * data: DELIVERED when the purchase is on their timeline, the share of the
   * paid period used, and `sampleContentProvided` when they had a free trial.
   */
  consumption?: {
    consented: (subject: string) => unknown
    deliveryStatus?: (ctx: ConsumptionContext) => ConsumptionInfo["deliveryStatus"] | undefined
    consumptionPercentage?: (ctx: ConsumptionContext) => number | undefined
    refundPreference?: (ctx: ConsumptionContext) => ConsumptionInfo["refundPreference"] | undefined
    sampleContentProvided?: (ctx: ConsumptionContext) => boolean | undefined
  }
  now?: () => Date
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: columns are known by name
type Cols = Record<string, any>

const PAID = new Set(["active", "trialing"])
const STORES = new Set(["appstore", "googleplay"])
/** Sources that are not a paid subscription: `setPlan` and `grantPromotional`. */
const UNPAID = new Set(["manual", PROMOTIONAL])
const SUBSCRIBED = new Set(["trial", "purchase", "renewal"])
const COUNTRY = /^[A-Z]{2}$/
const DAY = 86_400_000

/** A purchase that is a free trial: amount 0, or the App Store's FREE_TRIAL offer. */
export function isTrial(e: CustomerEventLike): boolean {
  const t = (e.raw as Cols | undefined)?.transaction
  return e.amount === 0 || t?.offerDiscountType === "FREE_TRIAL"
}

/**
 * The timeline kind of a signet-payments event, or undefined for one that is
 * not on the timeline. Grace periods are told apart from billing issues by the
 * store's own state (App Store status 4, Play IN_GRACE_PERIOD).
 */
export function timelineKind(e: CustomerEventLike): TimelineKind | undefined {
  switch (e.type) {
    case "subscription.created":
    case "subscription.activated":
    case "payment.captured":
      return isTrial(e) ? "trial" : "purchase"
    case "subscription.charged":
      return "renewal"
    case "refund.processed":
      return "refund"
    case "subscription.cancelled":
      return "cancellation"
    case "subscription.resumed":
      return "uncancellation"
    case "subscription.paused":
      return "paused"
    case "subscription.expired":
      return "expiration"
    case "payment.failed":
      return "billing_issue"
    case "subscription.past_due": {
      const r = e.raw as Cols | undefined
      const grace =
        r?.payload?.data?.status === 4 ||
        r?.subscription?.subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
      return grace ? "grace_period" : "billing_issue"
    }
    default:
      if (e.gatewayType === "CONSUMPTION_REQUEST") return "refund_request"
      return e.type.startsWith("dispute.") ? "dispute" : undefined
  }
}

const bad = (m: string) => new SignetDbError("BAD_VALUE", m)
const text = (v: unknown, name: string, max: number) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw bad(`${name} is required, at most ${max} characters.`)
  return v.trim()
}

export function createCustomers(db: SignetDb<unknown>, options: CustomersOptions) {
  const T = options.tables
  const ic = T.customerIdentities as unknown as Cols
  const ec = T.customerEvents as unknown as Cols
  const rc = T.customerRequests as unknown as Cols
  const pc = T.subjectPlans as unknown as Cols
  const xc = T.entitlementOverrides as unknown as Cols
  const o = db.orm as AnyOrm
  const now = options.now ?? (() => new Date())
  const pay = options.payments

  // ------------------------------------------------------------ identity

  async function identity(id: string): Promise<Cols | undefined> {
    return (await o.select().from(T.customerIdentities).where(eq(ic.id, id)).limit(1))[0]
  }

  /**
   * A new anonymous app-user id for a device before sign-in: 122 random bits,
   * so it cannot be guessed (whoever holds it can merge its purchases).
   * Use it as the subject for purchases (App Store `appAccountToken` is a UUID: `id.slice(5)`).
   */
  async function anonymousId(opts: { orgId?: string } = {}): Promise<string> {
    const id = `anon_${crypto.randomUUID()}`
    await o.insert(T.customerIdentities).values({ id, orgId: opts.orgId ?? null, subject: null })
    return id
  }

  /** The account an id was merged into, else the id itself. */
  async function resolve(id: string): Promise<string> {
    return (await identity(id))?.subject ?? id
  }

  /**
   * Move an anonymous user's subscriptions, grants, payments, timeline and
   * requests to the signed-in account. Once only per anonymous id: the claim
   * is one conditional UPDATE, so of two concurrent merges into different
   * accounts exactly one wins, and repeating a merge into the same account
   * finishes any move a crash left half done. Rows are moved, never copied,
   * so nothing is granted twice. Refused (with `reason`) for an id that was
   * not issued by `anonymousId`, a target that is itself anonymous, another
   * org, or a non-member when `isMember` is set.
   */
  async function merge(
    input: { anonymousId: string; userId: string; orgId?: string },
    opts: { actor?: Actor } = {},
  ): Promise<MergeResult> {
    const { anonymousId: from, userId: to } = input
    if (!from || !to) throw bad("merge needs anonymousId and userId.")
    if (from === to) return { merged: false, reason: "same_subject" }
    const row = await identity(from)
    if (!row) return { merged: false, reason: "not_anonymous" }
    if ((row.orgId ?? null) !== (input.orgId ?? null)) return { merged: false, reason: "other_org" }
    if (await identity(to)) return { merged: false, reason: "target_is_anonymous" }
    if (input.orgId && options.isMember && !(await options.isMember(to, input.orgId)))
      return { merged: false, reason: "not_member" }
    const claimed = await o
      .update(T.customerIdentities)
      .set({ subject: to, mergedAt: now() })
      .where(and(eq(ic.id, from), isNull(ic.subject)))
      .returning()
    if (!claimed.length && (await identity(from))?.subject !== to)
      return { merged: false, reason: "already_merged" }
    const actor = opts.actor ?? { type: "system" as const, id: "identity-merge" }
    const w = audited(db, { actor })
    const subscriptions = (
      await w.update(
        T.subjectPlans,
        { subject: to } as never,
        and(eq(pc.subject, from), ne(pc.gateway, "manual")),
      )
    ).length
    const overrides = (
      await w.update(T.entitlementOverrides, { subject: to } as never, eq(xc.subject, from))
    ).length
    const events = (
      await o.update(T.customerEvents).set({ subject: to }).where(eq(ec.subject, from)).returning()
    ).length
    const requests = (
      await o
        .update(T.customerRequests)
        .set({ subject: to })
        .where(eq(rc.subject, from))
        .returning()
    ).length
    const payments = (await pay?.reassignUser?.(from, to)) ?? 0
    return {
      merged: true,
      already: !claimed.length,
      moved: { subscriptions, overrides, events, requests, payments },
    }
  }

  // ------------------------------------------------------------ timeline

  async function subjectOf(e: CustomerEventLike): Promise<string | undefined> {
    if (e.subscriptionId) {
      const [src] = await o
        .select()
        .from(T.subjectPlans)
        .where(eq(pc.id, `${e.gateway}|${e.subscriptionId}`))
        .limit(1)
      if (src) return src.subject
    }
    if (!pay) return undefined
    if (e.paymentId) {
      const p = await pay.getPayment(e.gateway, e.paymentId)
      if (p?.userId) return p.userId
    }
    const link = e.orderId ?? e.subscriptionId
    return link ? (await pay.findLinked(e.gateway, { orderId: link }))?.userId : undefined
  }

  const country = (c: string | undefined) => {
    if (c === undefined) return null
    const up = typeof c === "string" ? c.toUpperCase() : ""
    if (!COUNTRY.test(up)) throw bad("country is an ISO 3166-1 alpha-2 code, e.g. IN.")
    return up
  }

  const entryOf = (e: CustomerEventLike, kind: TimelineKind) => ({
    id: `${e.gateway}|${e.id}`,
    kind,
    gateway: e.gateway,
    eventType: e.gatewayType ?? e.type,
    subscriptionId: e.subscriptionId ?? null,
    paymentId: e.paymentId ?? null,
    productId: e.productId ?? null,
    amount: e.amount ?? null,
    currency: e.currency ?? null,
    approximate: !!e.approximate,
    occurredAt: e.occurredAt,
  })

  /**
   * Put a signet-payments event on its customer's timeline, once per (gateway,
   * event id). The customer is `opts.subject`, else the owner of the event's
   * subscription (entitlements) or payment (payments store), resolved through
   * merges. Call it from `onEvent` after `applyBillingEvent`.
   */
  async function record(
    event: CustomerEventLike,
    opts: { subject?: string; country?: string } = {},
  ): Promise<{ recorded: boolean; kind?: TimelineKind; subject?: string; reason?: string }> {
    const kind = timelineKind(event)
    if (!kind) return { recorded: false, reason: "not_on_timeline" }
    const found = opts.subject ?? (await subjectOf(event))
    if (!found) return { recorded: false, kind, reason: "no_subject" }
    const subject = await resolve(found)
    const done = await o
      .insert(T.customerEvents)
      .values({ ...entryOf(event, kind), subject, country: country(opts.country) })
      .onConflictDoNothing()
      .returning()
    return done.length
      ? { recorded: true, kind, subject }
      : { recorded: false, kind, subject, reason: "duplicate" }
  }

  const viewEntry = (r: Cols): TimelineEntry => ({
    id: r.id,
    kind: r.kind,
    gateway: r.gateway,
    eventType: r.eventType,
    subscriptionId: r.subscriptionId ?? null,
    paymentId: r.paymentId ?? null,
    productId: r.productId ?? null,
    amount: r.amount == null ? null : Number(r.amount),
    currency: r.currency ?? null,
    approximate: !!r.approximate,
    occurredAt: r.occurredAt,
  })

  /**
   * One customer's history, newest first: recorded events, plus (with the
   * payments store) every event of their payments, and totals per currency
   * from the ledger.
   */
  async function timeline(
    subject: string,
    opts: { limit?: number } = {},
  ): Promise<{ subject: string; entries: TimelineEntry[]; totals: TimelineTotal[] }> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000)
    const byId = new Map<string, TimelineEntry>()
    for (const r of await o
      .select()
      .from(T.customerEvents)
      .where(and(eq(ec.subject, subject), ne(ec.kind, "impression")))
      .orderBy(desc(ec.occurredAt))
      .limit(limit))
      byId.set(r.id, viewEntry(r))
    // A promotional grant lapses at its expiry with nothing recorded: show it once that has passed.
    const at = now()
    for (const p of await o
      .select()
      .from(T.subjectPlans)
      .where(and(eq(pc.subject, subject), eq(pc.gateway, PROMOTIONAL)))) {
      const end = p.currentPeriodEnd as Date | null
      const id = `${PROMOTIONAL}|${p.subscriptionId}|end`
      if (end && end <= at && !byId.has(id))
        byId.set(id, {
          id,
          kind: "expiration",
          gateway: PROMOTIONAL,
          eventType: "promotional.expired",
          subscriptionId: p.subscriptionId,
          paymentId: null,
          productId: p.plan,
          amount: null,
          currency: null,
          approximate: false,
          occurredAt: end,
        })
    }
    const totals = new Map<string, TimelineTotal>()
    if (pay) {
      for (const p of await pay.listPayments({ userId: subject, limit })) {
        for (const e of await pay.eventsFor(p.gateway, p.gatewayId)) {
          const kind = timelineKind(e)
          const id = `${e.gateway}|${e.id}`
          if (kind && !byId.has(id)) byId.set(id, entryOf(e, kind))
        }
        for (const l of await pay.entries({ ref: p.gatewayId, gateway: p.gateway })) {
          const t = totals.get(l.currency) ?? {
            currency: l.currency,
            paid: 0,
            refunded: 0,
            approximate: false,
          }
          if (l.account === "revenue") t.paid -= l.amount
          else if (l.account === "refunds") t.refunded += l.amount
          else continue
          if (l.kind.endsWith(":approximate")) t.approximate = true
          totals.set(l.currency, t)
        }
      }
    }
    const entries = [...byId.values()]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, limit)
    return { subject, entries, totals: [...totals.values()] }
  }

  // ------------------------------------------------------ customer center

  function manageUrl(source: SubscriptionSource): string | null {
    const custom = options.manageUrl?.(source)
    if (custom !== undefined) return custom
    if (source.gateway === "appstore") return "https://apps.apple.com/account/subscriptions"
    if (source.gateway === "googleplay") {
      const base = "https://play.google.com/store/account/subscriptions"
      return source.productId && options.googlePlayPackage
        ? `${base}?sku=${encodeURIComponent(source.productId)}&package=${encodeURIComponent(options.googlePlayPackage)}`
        : base
    }
    return null
  }

  async function productOf(s: { gateway: string; subscriptionId: string }) {
    const [r] = await o
      .select()
      .from(T.customerEvents)
      .where(and(eq(ec.gateway, s.gateway), eq(ec.subscriptionId, s.subscriptionId)))
      .orderBy(desc(ec.occurredAt))
      .limit(1)
    return (r?.productId as string | null | undefined) ?? undefined
  }

  async function base(subject: string): Promise<Omit<Overview, "retention">> {
    if (!subject) throw bad("A subject id is required.")
    const r = await options.entitlements.get(subject)
    const paid = r.source && !UNPAID.has(r.source.gateway) ? r.source : null
    const productId = paid ? await productOf(paid) : undefined
    const source = paid ? { ...paid, ...(productId ? { productId } : {}) } : null
    const store = !!source && STORES.has(source.gateway)
    // A web gateway cancelled at period end still reports active: the cancel we recorded says otherwise.
    // ponytail: a renewal turned back on at the gateway after that is not seen; delete the request row then.
    const cancelled =
      !!source && !store && !!(await request(`cancel|${source.gateway}|${source.subscriptionId}`))
    const renews = !!source && PAID.has(r.status ?? "") && !cancelled
    return {
      subject,
      plan: r.plan,
      status: r.status,
      currentPeriodEnd: r.currentPeriodEnd,
      graceUntil: r.graceUntil,
      renews,
      source,
      store,
      manageUrl: source && store ? manageUrl(source) : null,
      canCancel: renews && !store && !!options.cancel,
    }
  }

  async function request(id: string): Promise<CustomerRequest | null> {
    const [r] = await o.select().from(T.customerRequests).where(eq(rc.id, id)).limit(1)
    return r ? viewRequest(r) : null
  }
  const viewRequest = (r: Cols): CustomerRequest => ({
    id: r.id,
    subject: r.subject,
    kind: r.kind,
    status: r.status,
    gateway: r.gateway ?? null,
    reference: r.reference ?? null,
    message: r.message ?? null,
    data: r.data ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })

  async function offerFor(ov: Omit<Overview, "retention">): Promise<RetentionOffer | null> {
    const cfg = options.retention
    if (!cfg || !ov.source || !ov.renews) return null
    const used = await o
      .select()
      .from(T.customerRequests)
      .where(and(eq(rc.subject, ov.subject), eq(rc.kind, "retention")))
      .limit(1)
    if (used.length) return null
    const ok = cfg.eligible ? await cfg.eligible({ subject: ov.subject, overview: ov }) : !ov.store
    return ok ? cfg.offer : null
  }

  /** What the Customer Center shows: plan, status, renewal date, where it was bought, how to cancel, and any retention offer. */
  async function overview(subject: string): Promise<Overview> {
    const ov = await base(subject)
    return { ...ov, retention: await offerFor(ov) }
  }

  /**
   * Cancel. A web subscription is cancelled through `cancel` (renewal off; the
   * gateway's webhook updates the entitlement) and recorded. A store
   * subscription cannot be cancelled by a server: the result carries the
   * store's manage link instead.
   */
  async function cancel(
    subject: string,
    opts: { reason?: string } = {},
  ): Promise<
    | { cancelled: true; source: SubscriptionSource }
    | {
        cancelled: false
        reason: "no_subscription" | "store" | "not_cancellable"
        manageUrl?: string | null
      }
  > {
    const ov = await base(subject)
    if (!ov.source || !ov.renews) return { cancelled: false, reason: "no_subscription" }
    if (ov.store) return { cancelled: false, reason: "store", manageUrl: ov.manageUrl }
    if (!options.cancel) return { cancelled: false, reason: "not_cancellable" }
    await options.cancel(ov.source)
    await o
      .insert(T.customerRequests)
      .values({
        id: `cancel|${ov.source.gateway}|${ov.source.subscriptionId}`,
        subject,
        kind: "cancel",
        status: "done",
        gateway: ov.source.gateway,
        reference: ov.source.subscriptionId,
        message: opts.reason ? text(opts.reason, "reason", 2000) : null,
        data: null,
      })
      .onConflictDoNothing()
    return { cancelled: true, source: ov.source }
  }

  /** Accept the retention offer: once per customer, recorded, then applied through `retention.apply`. */
  async function acceptRetention(
    subject: string,
  ): Promise<
    | { accepted: true; offer: RetentionOffer }
    | { accepted: false; reason: "not_eligible" | "already_used" }
  > {
    const ov = await base(subject)
    const offer = await offerFor(ov)
    if (!offer || !ov.source || !options.retention)
      return { accepted: false, reason: "not_eligible" }
    const id = `retention|${subject}`
    const mine = await o
      .insert(T.customerRequests)
      .values({
        id,
        subject,
        kind: "retention",
        status: "open",
        gateway: ov.source.gateway,
        reference: ov.source.subscriptionId,
        message: null,
        data: { offer },
      })
      .onConflictDoNothing()
      .returning()
    if (!mine.length) return { accepted: false, reason: "already_used" }
    try {
      await options.retention.apply({ subject, source: ov.source, offer })
    } catch (err) {
      await o.delete(T.customerRequests).where(eq(rc.id, id)) // not applied: free the offer for a retry
      throw err
    }
    await o.update(T.customerRequests).set({ status: "done" }).where(eq(rc.id, id))
    return { accepted: true, offer }
  }

  async function send(kind: CustomerNotice["kind"], req: CustomerRequest, line: string) {
    if (!options.notify || req.data?.notified) return
    await options.notify({ kind, subject: req.subject, request: req, text: line })
    await o
      .update(T.customerRequests)
      .set({ data: { ...req.data, notified: true } })
      .where(eq(rc.id, req.id))
  }

  /**
   * Ask for a refund of one of the customer's payments. Once per payment: a
   * repeat returns the same request (`created: false`). The payment must be
   * theirs (payments store, else their timeline). App Store refunds are
   * Apple's to grant, so those carry `storeUrl` for the customer too.
   */
  async function requestRefund(
    subject: string,
    input: { gateway: string; paymentId: string; reason: string },
  ): Promise<{ request: CustomerRequest; created: boolean; storeUrl?: string }> {
    const gateway = text(input.gateway, "gateway", 40)
    const paymentId = text(input.paymentId, "paymentId", 200)
    const reason = text(input.reason, "reason", 2000)
    const owned = pay
      ? (await pay.getPayment(gateway, paymentId))?.userId === subject
      : (
          await o
            .select()
            .from(T.customerEvents)
            .where(
              and(eq(ec.subject, subject), eq(ec.gateway, gateway), eq(ec.paymentId, paymentId)),
            )
            .limit(1)
        ).length > 0
    if (!owned) throw new SignetDbError("NOT_FOUND", "No such payment for this customer.")
    const id = `refund|${gateway}|${paymentId}`
    const created = await o
      .insert(T.customerRequests)
      .values({
        id,
        subject,
        kind: "refund",
        status: "open",
        gateway,
        reference: paymentId,
        message: reason,
        data: {},
      })
      .onConflictDoNothing()
      .returning()
    const req = (await request(id)) as CustomerRequest
    await send(
      "refund_request",
      req,
      `Refund requested for ${gateway} ${paymentId} by ${subject}: ${reason}`,
    )
    return {
      request: (await request(id)) as CustomerRequest,
      created: created.length > 0,
      ...(gateway === "appstore" ? { storeUrl: "https://reportaproblem.apple.com" } : {}),
    }
  }

  /** A message to support, recorded and sent to the team. */
  async function contactSupport(
    subject: string,
    input: { message: string; email?: string; topic?: string },
  ): Promise<CustomerRequest> {
    if (!subject) throw bad("A subject id is required.")
    const message = text(input.message, "message", 5000)
    const data: Record<string, unknown> = {}
    if (input.email !== undefined) data.email = text(input.email, "email", 320)
    if (input.topic !== undefined) data.topic = text(input.topic, "topic", 100)
    const id = newId(now().getTime())
    await o.insert(T.customerRequests).values({
      id,
      subject,
      kind: "support",
      status: "open",
      gateway: null,
      reference: null,
      message,
      data,
    })
    const req = (await request(id)) as CustomerRequest
    await send(
      "support",
      req,
      `Support message from ${subject}${data.topic ? ` (${data.topic})` : ""}: ${message}`,
    )
    return (await request(id)) as CustomerRequest
  }

  /** Requests for the admin screen, newest first. */
  async function requests(
    filter: { subject?: string; kind?: RequestKind; status?: RequestStatus; limit?: number } = {},
  ): Promise<CustomerRequest[]> {
    const conds = [
      filter.subject ? eq(rc.subject, filter.subject) : undefined,
      filter.kind ? eq(rc.kind, filter.kind) : undefined,
      filter.status ? eq(rc.status, filter.status) : undefined,
    ].filter(Boolean)
    const rows = await o
      .select()
      .from(T.customerRequests)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(rc.createdAt), desc(rc.id))
      .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500))
    return rows.map(viewRequest)
  }

  /** Close a request (done or declined), audited. */
  async function setRequestStatus(
    id: string,
    status: RequestStatus,
    { actor }: { actor: Actor },
  ): Promise<CustomerRequest | null> {
    if (!["open", "done", "declined"].includes(status))
      throw bad("status is open, done or declined.")
    await audited(db, { actor }).update(T.customerRequests, { status } as never, eq(rc.id, id))
    return request(id)
  }

  // ------------------------------------------------------ paywall impressions

  /**
   * Log that `subject` saw an offering's paywall, for paywall conversion in
   * `createCharts`. At most one row per subject, offering and UTC day, so
   * re-renders and repeats cost nothing.
   */
  async function logImpression(
    subject: string,
    input: { offering: string; version?: number; placement?: string; country?: string },
  ): Promise<{ logged: boolean }> {
    if (!subject) throw bad("A subject id is required.")
    const offering = text(input.offering, "offering", 64)
    const at = now()
    const day = at.toISOString().slice(0, 10)
    const who = await resolve(subject)
    const done = await o
      .insert(T.customerEvents)
      .values({
        id: `impression|${who}|${offering}|${day}`,
        subject: who,
        kind: "impression",
        gateway: "paywall",
        eventType: input.placement ? `impression:${input.placement}` : "impression",
        subscriptionId: null,
        paymentId: null,
        productId: input.version === undefined ? null : `${offering}@${input.version}`,
        amount: null,
        currency: null,
        approximate: false,
        occurredAt: at,
        country: country(input.country),
        offering,
      })
      .onConflictDoNothing()
      .returning()
    return { logged: done.length > 0 }
  }

  // ------------------------------------------------- promotional entitlements

  /**
   * Grant `plan` until `expiresAt` (or for `days`), from admin. It shows on the
   * customer's timeline as `promotional`, and as `expiration` once it lapses,
   * which it does on its own at that time.
   */
  async function grantPromotional(
    subject: string,
    input: { plan: string; expiresAt?: Date; days?: number; note?: string },
    { actor }: { actor: Actor },
  ): Promise<{ id: string; plan: string; expiresAt: Date }> {
    const grant = options.entitlements.grantPromotional
    if (!grant)
      throw new SignetDbError(
        "FORBIDDEN",
        "Pass createEntitlements(...) to grant promotional plans.",
      )
    if (!subject) throw bad("A subject id is required.")
    const expiresAt =
      input.expiresAt ??
      (Number.isSafeInteger(input.days) &&
      (input.days as number) > 0 &&
      (input.days as number) <= 3660
        ? new Date(now().getTime() + (input.days as number) * DAY)
        : undefined)
    if (!expiresAt) throw bad("Give expiresAt, or days from 1 to 3660.")
    const note = input.note === undefined ? null : text(input.note, "note", 500)
    const r = await grant.call(options.entitlements, subject, input.plan as never, {
      actor,
      expiresAt,
    })
    await o
      .insert(T.customerEvents)
      .values({
        id: `${PROMOTIONAL}|${r.id}`,
        subject,
        kind: "promotional",
        gateway: PROMOTIONAL,
        eventType: note ? `promotional.granted: ${note}` : "promotional.granted",
        subscriptionId: r.id,
        paymentId: null,
        productId: input.plan,
        amount: null,
        currency: null,
        approximate: false,
        occurredAt: now(),
      })
      .onConflictDoNothing()
    return { id: r.id, plan: input.plan, expiresAt: r.expiresAt }
  }

  /** End a promotional grant early. Returns whether it was live. */
  async function endPromotional(
    subject: string,
    id: string,
    { actor }: { actor: Actor },
  ): Promise<boolean> {
    const end = options.entitlements.endPromotional
    if (!end) throw new SignetDbError("FORBIDDEN", "Pass createEntitlements(...) to end grants.")
    if (!(await end.call(options.entitlements, subject, id, { actor }))) return false
    await o
      .insert(T.customerEvents)
      .values({
        id: `${PROMOTIONAL}|${id}|end`,
        subject,
        kind: "expiration",
        gateway: PROMOTIONAL,
        eventType: "promotional.ended",
        subscriptionId: id,
        paymentId: null,
        productId: null,
        amount: null,
        currency: null,
        approximate: false,
        occurredAt: now(),
      })
      .onConflictDoNothing()
    return true
  }

  // ------------------------------------------------------------------ offers

  /** What offer eligibility reads: subscriptions, trials, when the last one ended, offers redeemed. */
  async function offerHistory(subject: string): Promise<OfferHistory> {
    const r = await options.entitlements.get(subject)
    const subs = (r.entitlements ?? [])
      .flatMap((e) => e.sources)
      .filter((x) => !UNPAID.has(x.gateway))
    const events = await o
      .select()
      .from(T.customerEvents)
      .where(eq(ec.subject, subject))
      .orderBy(desc(ec.occurredAt))
    const ends = subs.flatMap((x) => (x.currentPeriodEnd ? [x.currentPeriodEnd.getTime()] : []))
    const lastEnd = events.find(
      (e: Cols) => e.kind === "expiration" && e.gateway !== PROMOTIONAL,
    )?.occurredAt
    const lapsed = ends.length ? Math.max(...ends) : lastEnd ? lastEnd.getTime() : null
    const redeemed = await o
      .select()
      .from(T.customerRequests)
      .where(and(eq(rc.subject, subject), eq(rc.kind, "offer")))
    return {
      subscribed: subs.length > 0 || events.some((e: Cols) => SUBSCRIBED.has(e.kind)),
      active: subs.some((x) => x.active),
      lapsedAt: lapsed === null ? null : new Date(lapsed),
      trialed: events.some((e: Cols) => e.kind === "trial"),
      redeemed: new Set(redeemed.map((x: Cols) => (x.data as Cols | null)?.offer as string)),
    }
  }

  const NEW_CUSTOMER: OfferHistory = {
    subscribed: false,
    active: false,
    lapsedAt: null,
    trialed: false,
    redeemed: new Set(),
  }

  /**
   * The offering with each product's offers cut to the ones this customer may
   * see now (`offerEligible`). No subject is a new visitor: trials and intro
   * offers show, win-backs do not. Stores still decide their own eligibility at
   * purchase; this is what the paywall shows.
   */
  async function withOffers<O extends { products: readonly OfferingProduct[] }>(
    subject: string | null | undefined,
    offering: O,
  ): Promise<WithOffers<O>> {
    const h = subject ? await offerHistory(await resolve(subject)) : NEW_CUSTOMER
    const at = now()
    return {
      ...offering,
      products: offering.products.map((p) => {
        if (!p.offers) return { ...p }
        const offers = p.offers.filter((x) => offerEligible(x, h, at))
        const { offers: _all, ...rest } = p
        return offers.length ? { ...rest, offers } : rest
      }),
    }
  }

  /**
   * Claim an offer before applying it (a web coupon, a trial at checkout):
   * once per customer and offer, and only while eligible. A repeat or a
   * concurrent second claim is `already_used`.
   */
  async function redeemOffer(
    subject: string,
    offering: { key: string; products: readonly OfferingProduct[] },
    offerId: string,
  ): Promise<
    | { redeemed: true; offer: ProductOffer; product: OfferingProduct }
    | { redeemed: false; reason: "no_such_offer" | "not_eligible" | "already_used" }
  > {
    const who = await resolve(subject)
    const product = offering.products.find((p) => p.offers?.some((x) => x.id === offerId))
    const offer = product?.offers?.find((x) => x.id === offerId)
    if (!product || !offer) return { redeemed: false, reason: "no_such_offer" }
    const h = await offerHistory(who)
    if (h.redeemed.has(offerId) && (offer.eligibility?.once ?? true))
      return { redeemed: false, reason: "already_used" }
    if (!offerEligible(offer, h, now())) return { redeemed: false, reason: "not_eligible" }
    const once = offer.eligibility?.once ?? true
    const mine = await o
      .insert(T.customerRequests)
      .values({
        id: once ? `offer|${who}|${offerId}` : newId(now().getTime()),
        subject: who,
        kind: "offer",
        status: "done",
        gateway: product.store,
        reference: product.id,
        message: null,
        data: { offer: offerId, type: offer.type, offering: offering.key },
      })
      .onConflictDoNothing()
      .returning()
    if (!mine.length) return { redeemed: false, reason: "already_used" }
    return { redeemed: true, offer, product }
  }

  // --------------------------------------------------- Apple refund requests

  /**
   * The answer to an App Store CONSUMPTION_REQUEST notification, built from
   * the customer's data, or why there is none. Send it with signet-payments'
   * `appstore(...).sendConsumptionInfo(transactionId, body)` within 12 hours.
   * No consent (`consumption.consented`) means no answer, as Apple requires.
   */
  async function consumptionInfo(
    event: CustomerEventLike,
    opts: { subject?: string } = {},
  ): Promise<
    | { respond: true; subject: string; transactionId: string; body: ConsumptionInfo }
    | {
        respond: false
        reason: "not_consumption_request" | "no_subject" | "no_consent" | "not_configured"
      }
  > {
    if (
      event.gateway !== "appstore" ||
      event.gatewayType !== "CONSUMPTION_REQUEST" ||
      !event.paymentId
    )
      return { respond: false, reason: "not_consumption_request" }
    const cfg = options.consumption
    if (!cfg) return { respond: false, reason: "not_configured" }
    const found = opts.subject ?? (await subjectOf(event))
    if (!found) return { respond: false, reason: "no_subject" }
    const subject = await resolve(found)
    if ((await cfg.consented(subject)) !== true) return { respond: false, reason: "no_consent" }
    const transactionId = event.paymentId
    const { entries } = await timeline(subject, { limit: 1000 })
    const reason = (event.raw as Cols | undefined)?.payload?.data?.consumptionRequestReason ?? null
    const ctx: ConsumptionContext = { subject, transactionId, reason, entries, event }
    const bought = entries.find(
      (e) =>
        e.gateway === "appstore" &&
        (e.paymentId === transactionId ||
          (!!event.subscriptionId && e.subscriptionId === event.subscriptionId)) &&
        (SUBSCRIBED.has(e.kind) || e.kind === "purchase"),
    )
    const deliveryStatus = cfg.deliveryStatus?.(ctx) ?? (bought ? "DELIVERED" : "UNDELIVERED_OTHER")
    const refundPreference = cfg.refundPreference?.(ctx)
    let pct = cfg.consumptionPercentage?.(ctx)
    if (pct === undefined && deliveryStatus === "DELIVERED" && event.subscriptionId) {
      // The share of the paid period used: from the charge to the period end entitlements hold.
      const r = await options.entitlements.get(subject)
      const end = (r.entitlements ?? [])
        .flatMap((e) => e.sources)
        .find(
          (x) => x.gateway === "appstore" && x.subscriptionId === event.subscriptionId,
        )?.currentPeriodEnd
      const start = entries.find(
        (e) => e.subscriptionId === event.subscriptionId && SUBSCRIBED.has(e.kind),
      )?.occurredAt
      if (start && end && end > start) {
        const used = (now().getTime() - start.getTime()) / (end.getTime() - start.getTime())
        pct = Math.round(Math.min(Math.max(used, 0), 1) * 100000)
      }
    }
    if (deliveryStatus !== "DELIVERED") pct = 0
    if (refundPreference === "GRANT_PRORATED") pct = undefined
    const body: ConsumptionInfo = {
      customerConsented: true,
      deliveryStatus,
      sampleContentProvided:
        cfg.sampleContentProvided?.(ctx) ?? entries.some((e) => e.kind === "trial"),
      ...(pct !== undefined ? { consumptionPercentage: pct } : {}),
      ...(refundPreference ? { refundPreference } : {}),
    }
    return { respond: true, subject, transactionId, body }
  }

  return {
    anonymousId,
    resolve,
    merge,
    record,
    timeline,
    overview,
    cancel,
    acceptRetention,
    requestRefund,
    contactSupport,
    requests,
    setRequestStatus,
    logImpression,
    grantPromotional,
    endPromotional,
    withOffers,
    redeemOffer,
    consumptionInfo,
  }
}

export type Customers = ReturnType<typeof createCustomers>
