/**
 * Web-to-app funnels, on the tables from `funnelTables()` plus
 * `customerEvents` from `monetisationTables()`.
 *
 * A funnel is a hosted web checkout: optional questions, a plan picker from an
 * offering's web products, then the gateway's checkout. The purchase belongs
 * to a fresh anonymous customer until the buyer opens the app and redeems it,
 * which merges it into their account through `customers.merge`.
 *
 * ```ts
 * const funnels = createFunnels(db, {
 *   tables: { ...funnelTables(), customerEvents },
 *   funnels: [{ key: "spring", placement: "web", questions: [...] }],
 *   discounts: [{ code: "SPRING20", percentOff: 20, expiresAt: "2027-04-01", maxRedemptions: 500 }],
 *   offerings, customers, entitlements,
 *   checkout: (input) => payments.checkout(input),
 *   track: (e) => sink.write([e]),
 * })
 * createPayments({ ..., onEvent: async (e) => { ...; await funnels.applyEvent(e) } })
 * ```
 *
 * Nothing is granted until the gateway's verified webhook says the payment
 * was captured, for the amount this server priced. Discounts are validated
 * here (expiry, plan scope, uses left) and charged as a price override, so a
 * client never names a price. A redemption claims the session once: one
 * account gets the purchase, and repeating it for that account is a no-op.
 */

import { and, eq, isNull, lt, or, sql, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"

export type FunnelQuestion = {
  /** Letters, digits, "_" or "-"; at most 24. */
  id: string
  title: string
  options: readonly { value: string; label: string }[]
  /** Several answers allowed. */
  multiple?: boolean
}

export type FunnelDefinition = {
  /** Letters, digits, "_" or "-"; at most 32. It is the funnel's URL. */
  key: string
  /** The offering placement whose web products the plan picker sells. */
  placement: string
  title?: string
  subtitle?: string
  /** Up to 6, asked in order before the plan picker. */
  questions?: readonly FunnelQuestion[]
}

export type DiscountDefinition = {
  /** Matched case-insensitively. */
  code: string
  /** 1 to 100. Exactly one of percentOff and amountOff. */
  percentOff?: number
  /** Minor units, in the product's currency only. */
  amountOff?: { amount: number; currency: string }
  expiresAt?: Date | string
  /** Uses across every buyer. A checkout takes one when it starts. */
  maxRedemptions?: number
  /** Plan keys it applies to. Default: every plan. */
  plans?: readonly string[]
}

export type DiscountQuote =
  | { valid: true; code: string; off: number; amount: number; currency: string }
  | {
      valid: false
      code: string
      reason: "unknown" | "expired" | "not_for_plan" | "used_up" | "currency" | "free"
    }

export type FunnelProduct = {
  id: string
  store: string
  plan: string
  interval?: "month" | "year" | "once"
  price?: { amount: number; currency: string }
}

export type FunnelSession = {
  id: string
  funnel: string
  subject: string
  productId: string
  plan: string
  interval: "month" | "year" | "once"
  amount: number
  currency: string
  discountCode: string | null
  discountOff: number | null
  answers: Record<string, string | string[]>
  gateway: string | null
  checkoutId: string | null
  paymentId: string | null
  status: "open" | "paid" | "redeemed" | "failed" | "refunded"
  redeemedBy: string | null
  createdAt: Date
  paidAt: Date | null
  redeemedAt: Date | null
}

/** signet-payments' `Checkout`, as `checkout` returns it. */
export type CheckoutLike = {
  gateway: string
  gatewayId: string
  url?: string
  clientSecret?: string
  form?: { action: string; fields: Record<string, string> }
}

/** The part of signet-payments' `CheckoutInput` a funnel sends. */
export type FunnelCheckoutInput = {
  amount: number
  currency: string
  idempotencyKey: string
  reference: string
  userId: string
  description?: string
  customer?: { email?: string }
  returnUrl?: string
  metadata: Record<string, string>
}

/** The part of a signet-payments `Event` a funnel reads. */
export type FunnelEventLike = {
  id: string
  gateway: string
  type: string
  occurredAt: Date
  paymentId?: string
  orderId?: string
  reference?: string
  amount?: number
  currency?: string
}

/** signet-server's `TrackedEvent`: `track: (e) => sink.write([e])`. */
export type FunnelTrackedEvent = {
  name: string
  props: Record<string, string | number | boolean>
  ts: number
  anonymousId?: string
  userId?: string
}

export type RedeemResult =
  | { redeemed: true; already: boolean; session: FunnelSession }
  | {
      redeemed: false
      reason:
        | "not_found"
        | "not_paid"
        | "already_redeemed"
        | "refunded"
        | "not_anonymous"
        | "same_subject"
        | "target_is_anonymous"
        | "already_merged"
        | "other_org"
        | "not_member"
    }

export type FunnelTables = { funnelSessions: Table; discountUses: Table; customerEvents: Table }

export type FunnelsOptions = {
  tables: FunnelTables
  funnels: readonly FunnelDefinition[]
  discounts?: readonly DiscountDefinition[]
  /** signet-db's `createOfferings(...)`. */
  offerings: {
    current(
      placement: string,
      audience?: { country?: string; platform?: string },
    ): Promise<{
      key: string
      version: number
      products: readonly FunnelProduct[]
      paywall: unknown
    } | null>
  }
  /** signet-db's `createCustomers(...)`. */
  customers: {
    anonymousId(opts?: { orgId?: string }): Promise<string>
    resolve(id: string): Promise<string>
    merge(
      input: { anonymousId: string; userId: string; orgId?: string },
      opts?: { actor?: { type: "user" | "agent" | "system"; id: string } },
    ): Promise<{ merged: boolean; already?: boolean; reason?: string }>
  }
  /** signet-payments' `payments.checkout`. Runs under the session id as idempotency key. */
  checkout: (input: FunnelCheckoutInput) => Promise<CheckoutLike>
  /**
   * signet-db's `createEntitlements(...)`, with `billing.plans` from
   * `plansFromProducts`. The default grant: the plan for one interval from
   * the capture (lifetime for "once"), as a source keyed by the payment.
   */
  entitlements?: {
    applySubscription(
      sub: {
        gateway: string
        gatewayId: string
        status: "active" | "cancelled"
        currentPeriodEnd?: Date
        productId?: string
      },
      opts: { subject: string },
    ): Promise<unknown>
  }
  /**
   * Replace the default grant, e.g. to start a gateway subscription that
   * renews. Called once per verified capture, before the session is marked paid.
   */
  grant?: (ctx: { session: FunnelSession; event: FunnelEventLike }) => unknown
  /** After a session is paid: email the redemption link (signet-server's `redemptionLink`). */
  onPaid?: (session: FunnelSession & { email: string | null }) => unknown
  /** Analytics: step views, plan picked, checkout started, purchased, redeemed. */
  track?: (event: FunnelTrackedEvent) => unknown
  now?: () => Date
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: columns are known by name
type Cols = Record<string, any>

const FUNNEL_KEY = /^[A-Za-z0-9_-]{1,32}$/
const STEP_ID = /^[A-Za-z0-9_-]{1,24}$/
const bad = (m: string) => new SignetDbError("BAD_VALUE", m)

/** The steps after the questions, in order. */
export const FUNNEL_TAIL_STEPS = ["plans", "checkout", "purchased", "redeemed"] as const

/** The analytics event name of one funnel step: `funnel:<key>:<step>`. */
export const funnelEventName = (key: string, step: string) => `funnel:${key}:${step}`

/**
 * Every step's event name, in order: one per question, then plans, checkout,
 * purchased, redeemed. Hand it to signet-db analytics for drop-off:
 * `store.funnel({ steps: funnelSteps(def) })`.
 */
export function funnelSteps(def: FunnelDefinition): string[] {
  return [...(def.questions ?? []).map((q) => q.id), ...FUNNEL_TAIL_STEPS].map((s) =>
    funnelEventName(def.key, s),
  )
}

function checkFunnel(f: FunnelDefinition): FunnelDefinition {
  if (!f || !FUNNEL_KEY.test(f.key ?? ""))
    throw bad(`Funnel key "${f?.key}" must be 1-32 letters, digits, "_" or "-".`)
  if (typeof f.placement !== "string" || !f.placement)
    throw bad(`Funnel "${f.key}" needs a placement.`)
  const qs = f.questions ?? []
  if (qs.length > 6) throw bad(`Funnel "${f.key}" has more than 6 questions.`)
  const ids = new Set<string>()
  for (const q of qs) {
    if (!STEP_ID.test(q.id ?? "") || (FUNNEL_TAIL_STEPS as readonly string[]).includes(q.id))
      throw bad(
        `Funnel "${f.key}": question id "${q.id}" must be 1-24 letters, digits, "_" or "-", and not a built-in step.`,
      )
    if (ids.has(q.id)) throw bad(`Funnel "${f.key}": question "${q.id}" is listed twice.`)
    ids.add(q.id)
    if (!Array.isArray(q.options) || q.options.length < 1 || q.options.length > 20)
      throw bad(`Funnel "${f.key}": question "${q.id}" needs 1 to 20 options.`)
  }
  return f
}

function checkDiscount(d: DiscountDefinition): DiscountDefinition & { code: string } {
  const code = typeof d?.code === "string" ? d.code.trim().toUpperCase() : ""
  if (!/^[A-Z0-9_-]{2,40}$/.test(code))
    throw bad(`Discount code "${d?.code}" must be 2-40 letters, digits, "_" or "-".`)
  const pct = d.percentOff !== undefined
  if (pct === (d.amountOff !== undefined))
    throw bad(`Discount ${code} needs exactly one of percentOff and amountOff.`)
  if (
    pct &&
    !(
      Number.isInteger(d.percentOff) &&
      (d.percentOff as number) >= 1 &&
      (d.percentOff as number) <= 100
    )
  )
    throw bad(`Discount ${code}: percentOff is an integer from 1 to 100.`)
  if (
    d.amountOff &&
    !(
      Number.isSafeInteger(d.amountOff.amount) &&
      d.amountOff.amount > 0 &&
      /^[A-Z]{3}$/.test(d.amountOff.currency)
    )
  )
    throw bad(`Discount ${code}: amountOff is { amount: minor units, currency: "USD" }.`)
  if (
    d.maxRedemptions !== undefined &&
    !(Number.isSafeInteger(d.maxRedemptions) && d.maxRedemptions > 0)
  )
    throw bad(`Discount ${code}: maxRedemptions is a positive integer.`)
  if (d.expiresAt !== undefined && Number.isNaN(new Date(d.expiresAt).getTime()))
    throw bad(`Discount ${code}: expiresAt is not a date.`)
  return { ...d, code }
}

/** One interval after `from`, in UTC; undefined for "once" (lifetime). */
export function periodEnd(from: Date, interval: "month" | "year" | "once"): Date | undefined {
  if (interval === "once") return undefined
  const d = new Date(from)
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return d
}

export function createFunnels(db: SignetDb<unknown>, options: FunnelsOptions) {
  const S = options.tables.funnelSessions
  const U = options.tables.discountUses
  const E = options.tables.customerEvents
  const sc = S as unknown as Cols
  const uc = U as unknown as Cols
  const o = db.orm as AnyOrm
  const now = options.now ?? (() => new Date())
  const defs = new Map<string, FunnelDefinition>()
  for (const f of options.funnels) {
    if (defs.has(checkFunnel(f).key)) throw bad(`Funnel "${f.key}" is defined twice.`)
    defs.set(f.key, f)
  }
  const discounts = new Map<string, ReturnType<typeof checkDiscount>>()
  for (const d of options.discounts ?? []) {
    const c = checkDiscount(d)
    if (discounts.has(c.code)) throw bad(`Discount ${c.code} is defined twice.`)
    discounts.set(c.code, c)
  }

  const track = async (
    key: string,
    step: string,
    ids: { anonymousId?: string | null; userId?: string },
    props: Record<string, string | number | boolean> = {},
  ) => {
    if (!options.track) return
    try {
      await options.track({
        name: funnelEventName(key, step),
        props: { funnel: key, step, ...props },
        ts: now().getTime(),
        ...(ids.anonymousId ? { anonymousId: ids.anonymousId } : {}),
        ...(ids.userId ? { userId: ids.userId } : {}),
      })
    } catch {
      // Analytics never fails a purchase.
    }
  }

  const view = (r: Cols): FunnelSession => ({
    id: r.id,
    funnel: r.funnel,
    subject: r.subject,
    productId: r.productId,
    plan: r.plan,
    interval: r.interval,
    amount: Number(r.amount),
    currency: r.currency,
    discountCode: r.discountCode ?? null,
    discountOff: r.discountOff == null ? null : Number(r.discountOff),
    answers: (r.answers as FunnelSession["answers"]) ?? {},
    gateway: r.gateway ?? null,
    checkoutId: r.checkoutId ?? null,
    paymentId: r.paymentId ?? null,
    status: r.status,
    redeemedBy: r.redeemedBy ?? null,
    createdAt: r.createdAt,
    paidAt: r.paidAt ?? null,
    redeemedAt: r.redeemedAt ?? null,
  })

  async function row(id: string): Promise<Cols | undefined> {
    if (typeof id !== "string" || !id) return undefined
    return (await o.select().from(S).where(eq(sc.id, id)).limit(1))[0]
  }

  async function used(code: string): Promise<number> {
    const [r] = await o.select().from(U).where(eq(uc.code, code)).limit(1)
    return r ? Number(r.used) : 0
  }

  /**
   * Price a discount code against one product, server side: it must exist,
   * be unexpired, cover the product's plan and currency, have uses left and
   * leave something to charge.
   */
  async function quote(codeIn: string, product: FunnelProduct): Promise<DiscountQuote> {
    const code = String(codeIn ?? "")
      .trim()
      .toUpperCase()
    const d = discounts.get(code)
    if (!d) return { valid: false, code, reason: "unknown" }
    if (d.expiresAt !== undefined && new Date(d.expiresAt).getTime() <= now().getTime())
      return { valid: false, code, reason: "expired" }
    if (d.plans && !d.plans.includes(product.plan))
      return { valid: false, code, reason: "not_for_plan" }
    const price = product.price as { amount: number; currency: string }
    if (d.amountOff && d.amountOff.currency !== price.currency)
      return { valid: false, code, reason: "currency" }
    if (d.maxRedemptions !== undefined && (await used(code)) >= d.maxRedemptions)
      return { valid: false, code, reason: "used_up" }
    const off = d.amountOff
      ? d.amountOff.amount
      : Math.round((price.amount * (d.percentOff as number)) / 100)
    if (off >= price.amount) return { valid: false, code, reason: "free" }
    return { valid: true, code, off, amount: price.amount - off, currency: price.currency }
  }

  /**
   * Take one use of a code, atomically: the increment's WHERE holds the
   * limit, so concurrent checkouts never pass `maxRedemptions`.
   */
  async function reserve(code: string): Promise<boolean> {
    const max = discounts.get(code)?.maxRedemptions
    await o.insert(U).values({ code, used: 0 }).onConflictDoNothing()
    const done = await o
      .update(U)
      .set({ used: sql`${uc.used} + 1` })
      .where(max === undefined ? eq(uc.code, code) : and(eq(uc.code, code), lt(uc.used, max)))
      .returning()
    return done.length > 0
  }
  const release = (code: string) =>
    o
      .update(U)
      .set({ used: sql`${uc.used} - 1` })
      .where(and(eq(uc.code, code), sql`${uc.used} > 0`))

  function funnel(key: string): FunnelDefinition {
    const f = defs.get(key)
    if (!f) throw new SignetDbError("NOT_FOUND", `No funnel "${key}".`)
    return f
  }

  async function webProducts(f: FunnelDefinition, audience?: { country?: string }) {
    const offering = await options.offerings.current(f.placement, {
      ...(audience?.country ? { country: audience.country } : {}),
      platform: "web",
    })
    if (!offering)
      throw new SignetDbError("NOT_FOUND", `Placement "${f.placement}" has no offering.`)
    return {
      offering,
      products: offering.products.filter((p) => p.store === "web" && p.price),
    }
  }

  /**
   * What the hosted page shows: the funnel, its offering's priced web
   * products, and the URL's discount code priced against each of them.
   */
  async function page(key: string, opts: { code?: string; audience?: { country?: string } } = {}) {
    const f = funnel(key)
    const { offering, products } = await webProducts(f, opts.audience)
    const code = opts.code?.trim()
    const discounts: Record<string, DiscountQuote> = {}
    if (code) for (const p of products) discounts[p.id] = await quote(code, p)
    return {
      funnel: f,
      offering: {
        key: offering.key,
        version: offering.version,
        paywall: offering.paywall,
        products,
      },
      discounts,
    }
  }

  /** Record a step view from the page. Only this funnel's pre-purchase steps count. */
  async function step(key: string, stepName: string, ids: { anonymousId?: string } = {}) {
    const f = funnel(key)
    const allowed = [...(f.questions ?? []).map((q) => q.id), "plans", "checkout"]
    if (!allowed.includes(stepName)) throw bad(`"${stepName}" is not a step of funnel "${key}".`)
    await track(key, stepName, ids)
  }

  function checkAnswers(f: FunnelDefinition, answers: unknown): Record<string, string | string[]> {
    if (answers === undefined || answers === null) return {}
    if (typeof answers !== "object" || Array.isArray(answers)) throw bad("answers is an object.")
    const out: Record<string, string | string[]> = {}
    for (const [id, v] of Object.entries(answers as Record<string, unknown>)) {
      const q = f.questions?.find((x) => x.id === id)
      if (!q) throw bad(`"${id}" is not a question of funnel "${f.key}".`)
      const values = Array.isArray(v) ? v : [v]
      if (
        values.length === 0 ||
        (!q.multiple && values.length > 1) ||
        !values.every((x) => typeof x === "string" && q.options.some((op) => op.value === x))
      )
        throw bad(`Answer to "${id}" must be ${q.multiple ? "options" : "one option"} it offers.`)
      out[id] = q.multiple ? (values as string[]) : (values[0] as string)
    }
    return out
  }

  /**
   * Start a checkout: the product must be a priced web product of the
   * funnel's offering, the answers must fit its questions, and a discount
   * code is priced and one use taken here. The purchase is for a new
   * anonymous customer. The gateway is asked for exactly the amount priced
   * here, under the session id as idempotency key and reference.
   */
  async function start(
    key: string,
    input: {
      productId: string
      answers?: unknown
      code?: string
      email?: string
      visitor?: string
      orgId?: string
      returnUrl?: (sessionId: string) => string
      audience?: { country?: string }
    },
  ): Promise<{ session: FunnelSession; checkout: CheckoutLike }> {
    const f = funnel(key)
    const answers = checkAnswers(f, input.answers)
    if (
      input.email !== undefined &&
      (typeof input.email !== "string" ||
        !/^[^\s@]+@[^\s@]+$/.test(input.email) ||
        input.email.length > 320)
    )
      throw bad("email is not an email address.")
    const { products } = await webProducts(f, input.audience)
    const product = products.find((p) => p.id === input.productId)
    if (!product) throw bad(`"${input.productId}" is not a product of funnel "${key}".`)
    const price = product.price as { amount: number; currency: string }
    let amount = price.amount
    let discount: { code: string; off: number } | undefined
    if (input.code?.trim()) {
      const q = await quote(input.code, product)
      if (!q.valid) throw bad(`Discount ${q.code} cannot be used: ${q.reason.replace("_", " ")}.`)
      // ponytail: an abandoned checkout keeps its use; release stale open sessions from a job if codes are scarce.
      if (!(await reserve(q.code))) throw bad(`Discount ${q.code} cannot be used: used up.`)
      discount = { code: q.code, off: q.off }
      amount = q.amount
    }
    const orgId = input.orgId
    const subject = await options.customers.anonymousId(orgId ? { orgId } : {})
    const id = `fs_${crypto.randomUUID()}`
    const visitor =
      typeof input.visitor === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(input.visitor)
        ? input.visitor
        : null
    await o.insert(S).values({
      id,
      funnel: key,
      subject,
      orgId: orgId ?? null,
      visitor,
      productId: product.id,
      plan: product.plan,
      interval: product.interval ?? "month",
      amount,
      currency: price.currency,
      discountCode: discount?.code ?? null,
      discountOff: discount?.off ?? null,
      answers,
      email: input.email ?? null,
      status: "open",
    })
    let checkout: CheckoutLike
    try {
      checkout = await options.checkout({
        amount,
        currency: price.currency,
        idempotencyKey: id,
        reference: id,
        userId: subject,
        description: f.title ?? `${product.plan} (${key})`,
        ...(input.email ? { customer: { email: input.email } } : {}),
        ...(input.returnUrl ? { returnUrl: input.returnUrl(id) } : {}),
        metadata: { funnel: key, funnelSession: id, userId: subject },
      })
    } catch (err) {
      await o.update(S).set({ status: "failed" }).where(eq(sc.id, id))
      if (discount) await release(discount.code)
      throw err
    }
    await o
      .update(S)
      .set({ gateway: checkout.gateway, checkoutId: checkout.gatewayId })
      .where(eq(sc.id, id))
    await track(key, "checkout", { anonymousId: visitor }, { plan: product.plan, started: true })
    return { session: view((await row(id)) as Cols), checkout }
  }

  /** A session as the buyer's browser may see it, or null. */
  async function get(id: string): Promise<FunnelSession | null> {
    const r = await row(id)
    return r ? view(r) : null
  }

  async function sessionOf(e: FunnelEventLike): Promise<Cols | undefined> {
    const ids = [e.paymentId, e.orderId].filter((x): x is string => !!x)
    const conds = [
      ...(ids.length ? ids.map((x) => and(eq(sc.gateway, e.gateway), eq(sc.checkoutId, x))) : []),
      ...(e.paymentId ? [and(eq(sc.gateway, e.gateway), eq(sc.paymentId, e.paymentId))] : []),
      ...(e.reference?.startsWith("fs_")
        ? [and(eq(sc.gateway, e.gateway), eq(sc.id, e.reference))]
        : []),
    ]
    if (!conds.length) return undefined
    return (
      await o
        .select()
        .from(S)
        .where(or(...conds))
        .limit(1)
    )[0]
  }

  /**
   * Feed every verified signet-payments event here, from `onEvent`.
   * `payment.captured` for a funnel's checkout, for the amount and currency
   * priced, grants the plan to the session's anonymous customer, puts any
   * discount on its timeline and marks the session paid (once: a repeat or a
   * replay after the session moved on is a no-op). `refund.processed` of a
   * funnel payment ends the access it granted, wherever it was merged to.
   */
  async function applyEvent(
    e: FunnelEventLike,
  ): Promise<{ applied: boolean; reason?: string; session?: FunnelSession }> {
    if (e.type !== "payment.captured" && e.type !== "refund.processed")
      return { applied: false, reason: "not_funnel" }
    const r = await sessionOf(e)
    if (!r) return { applied: false, reason: "not_funnel" }
    const s = view(r)
    if (e.type === "refund.processed") {
      if (s.status !== "paid" && s.status !== "redeemed")
        return { applied: false, reason: "not_paid", session: s }
      if (options.entitlements && s.paymentId)
        await options.entitlements.applySubscription(
          {
            gateway: e.gateway,
            gatewayId: s.paymentId,
            status: "cancelled",
            productId: s.productId,
          },
          { subject: await options.customers.resolve(s.redeemedBy ?? s.subject) },
        )
      await o.update(S).set({ status: "refunded" }).where(eq(sc.id, s.id))
      return { applied: true, session: (await get(s.id)) as FunnelSession }
    }
    if (s.status !== "open") return { applied: false, reason: "duplicate", session: s }
    if (
      (e.amount !== undefined && e.amount !== s.amount) ||
      (e.currency !== undefined && e.currency.toUpperCase() !== s.currency)
    )
      return { applied: false, reason: "amount_mismatch", session: s }
    const paymentId = e.paymentId ?? s.checkoutId ?? s.id
    const paid = { ...s, paymentId, paidAt: e.occurredAt }
    // Grant and timeline are idempotent, so they run before the claim: a crash
    // between them leaves the session open, and the replayed webhook finishes it.
    if (options.grant) await options.grant({ session: paid, event: e })
    else if (options.entitlements) {
      const end = periodEnd(e.occurredAt, s.interval)
      await options.entitlements.applySubscription(
        {
          gateway: e.gateway,
          gatewayId: paymentId,
          status: "active",
          productId: s.productId,
          ...(end ? { currentPeriodEnd: end } : {}),
        },
        { subject: s.subject },
      )
    }
    if (s.discountCode)
      await o
        .insert(E)
        .values({
          id: `funnel|${s.id}|discount`,
          subject: s.subject,
          kind: "discount",
          gateway: e.gateway,
          eventType: `funnel.discount:${s.discountCode}`,
          subscriptionId: null,
          paymentId,
          productId: s.productId,
          amount: s.discountOff,
          currency: s.currency,
          approximate: false,
          occurredAt: e.occurredAt,
        })
        .onConflictDoNothing()
    const claimed = await o
      .update(S)
      .set({ status: "paid", paymentId, paidAt: e.occurredAt })
      .where(and(eq(sc.id, s.id), eq(sc.status, "open")))
      .returning()
    const session = (await get(s.id)) as FunnelSession
    if (!claimed.length) return { applied: false, reason: "duplicate", session }
    await track(
      s.funnel,
      "purchased",
      { anonymousId: r.visitor },
      { plan: s.plan, amount: s.amount, currency: s.currency },
    )
    await options.onPaid?.({ ...session, email: r.email ?? null })
    return { applied: true, session }
  }

  /**
   * Redeem a paid session into the signed-in `userId`: claim it (one
   * conditional UPDATE, so of two accounts racing exactly one wins), then
   * `customers.merge` the anonymous buyer into the account. Repeating it for
   * the same account finishes a merge a crash left half done and reports
   * `already`. A refused merge (another org, a non-member) frees the claim.
   * Check the redemption token before calling this (signet-server's funnel
   * routes do).
   */
  async function redeem(
    sessionId: string,
    userId: string,
    opts: { orgId?: string } = {},
  ): Promise<RedeemResult> {
    if (!userId) throw bad("redeem needs a userId.")
    const r = await row(sessionId)
    if (!r) return { redeemed: false, reason: "not_found" }
    if (r.status === "refunded") return { redeemed: false, reason: "refunded" }
    if (r.status !== "paid" && r.status !== "redeemed")
      return { redeemed: false, reason: "not_paid" }
    const claimed = await o
      .update(S)
      .set({ status: "redeemed", redeemedBy: userId, redeemedAt: now() })
      .where(and(eq(sc.id, sessionId), eq(sc.status, "paid"), isNull(sc.redeemedBy)))
      .returning()
    if (!claimed.length && (await row(sessionId))?.redeemedBy !== userId)
      return { redeemed: false, reason: "already_redeemed" }
    const orgId = opts.orgId ?? r.orgId ?? undefined
    const m = await options.customers.merge(
      { anonymousId: r.subject, userId, ...(orgId ? { orgId } : {}) },
      { actor: { type: "user", id: userId } },
    )
    if (!m.merged) {
      if (claimed.length)
        await o
          .update(S)
          .set({ status: "paid", redeemedBy: null, redeemedAt: null })
          .where(and(eq(sc.id, sessionId), eq(sc.redeemedBy, userId)))
      return { redeemed: false, reason: (m.reason ?? "already_merged") as never }
    }
    if (claimed.length)
      await track(r.funnel, "redeemed", { anonymousId: r.visitor, userId }, { plan: r.plan })
    return {
      redeemed: true,
      already: !claimed.length,
      session: (await get(sessionId)) as FunnelSession,
    }
  }

  return {
    funnels: [...defs.values()],
    funnel: (key: string) => defs.get(key) ?? null,
    page,
    quote,
    step,
    start,
    get,
    applyEvent,
    redeem,
  }
}

export type Funnels = ReturnType<typeof createFunnels>
