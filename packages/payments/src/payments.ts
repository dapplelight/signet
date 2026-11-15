/**
 * `createPayments`: one entry point over several gateways. It routes each
 * charge (by currency, country, method, or your own `route`), fails over to
 * another gateway only on an outage (never on a decline), runs every charge and
 * refund under an idempotency key, and keeps a webhook inbox: events are
 * verified, deduped on (gateway, event id), applied per payment in occurredAt
 * order without letting an older event undo a newer one, posted to the ledger,
 * and replayable.
 *
 * ```ts
 * const payments = createPayments({
 *   gateways: [razorpay({ keyId, keySecret, webhookSecret }), stripe({ secretKey, webhookSecret })],
 *   route: (i) => (i.currency === "INR" ? "razorpay" : "stripe"),
 *   db: sqlStore(client, { dialect: "sqlite" }),
 *   idempotency: (key, scope, fn) => withIdempotency(db, key, scope, fn), // signet-db
 * })
 * app.post("/webhooks/:gateway", (c) => payments.handleWebhook(c.req.param("gateway"), c.req.raw))
 * ```
 */

import { isPaymentsError, PaymentsError } from "./errors.js"
import { post, postings } from "./ledger.js"
import type { Actor, PaymentRecord, PaymentsStore, StoredEvent } from "./store.js"
import type {
  Checkout,
  CheckoutInput,
  Event,
  Method,
  Payment,
  PaymentGateway,
  PaymentStatus,
  Refund,
  Subscription,
} from "./types.js"

/** One purchase a device holds, for `restorePurchases`. */
export type StorePurchase =
  | { gateway: "appstore" /** A StoreKit `jwsRepresentation`. */; signedTransaction: string }
  | { gateway: "googleplay"; purchaseToken: string; type: "subscription" | "product" }

/** What a router sees about a charge. */
export type Intent = { amount: number; currency: string; country?: string; method?: Method }

/** Structural: signet-db's `withIdempotency(db, key, scope, fn)` fits as `(k, s, fn) => withIdempotency(db, k, s, fn)`. */
export type IdempotencyRunner = <R>(key: string, scope: string, fn: () => Promise<R>) => Promise<R>

export type PaymentsConfig = {
  gateways: readonly PaymentGateway[]
  /** Pick a gateway by name. Default: the first that supports the method and currency. */
  route?: (intent: Intent) => string | undefined
  /**
   * On an outage (network, 429, 5xx) try other gateways: `true` for any other
   * that supports the charge, in `gateways` order, or a list of names. Declines
   * and other 4xx are never failed over. Default off.
   */
  fallback?: boolean | readonly string[]
  /** Inbox, payment records and ledger. Without one, webhooks verify and call onEvent but nothing is stored. */
  db?: PaymentsStore
  /** Runs each charge and refund once per key. Gateways that take a key get it too. */
  idempotency?: IdempotencyRunner
  /** Called once per newly applied event (after the ledger), from inline processing or `processInbox`. */
  onEvent?: (event: Event) => void | Promise<void>
  /** Apply events as they arrive. false: store only, and run `processInbox` from a job. Default true. */
  inline?: boolean
}

const RANK: Record<PaymentStatus, number> = {
  created: 0,
  pending: 1,
  authorized: 2,
  failed: 2,
  cancelled: 2,
  captured: 3,
  partially_refunded: 4,
  refunded: 5,
}

export type Payments = ReturnType<typeof createPayments>

export function createPayments(config: PaymentsConfig) {
  const byName = new Map(config.gateways.map((g) => [g.name, g]))
  const db = config.db
  const once: IdempotencyRunner = config.idempotency ?? ((_k, _s, fn) => fn())

  const gateway = (name: string): PaymentGateway => {
    const g = byName.get(name)
    if (!g)
      throw new PaymentsError(
        "NO_GATEWAY",
        `No gateway named "${name}". Configured: ${[...byName.keys()].join(", ")}.`,
      )
    return g
  }
  const fits = (g: PaymentGateway, i: Intent) =>
    (!i.method || g.capabilities.methods.includes(i.method)) &&
    (!g.capabilities.currencies || g.capabilities.currencies.includes(i.currency))

  function candidates(i: Intent): PaymentGateway[] {
    const first = config.route?.(i) ?? config.gateways.find((g) => fits(g, i))?.name
    if (!first)
      throw new PaymentsError(
        "NO_GATEWAY",
        `No gateway takes ${i.method ?? "any method"} in ${i.currency}.`,
      )
    const rest =
      config.fallback === true
        ? config.gateways.filter((g) => g.name !== first && fits(g, i))
        : (config.fallback || []).filter((n) => n !== first).map(gateway)
    return [gateway(first), ...rest]
  }

  async function checkout(input: CheckoutInput & { userId?: string }): Promise<Checkout> {
    const { userId, ...i } = input
    if (!i.idempotencyKey)
      throw new PaymentsError("IDEMPOTENCY_KEY_REQUIRED", "checkout needs an idempotencyKey.")
    return once(i.idempotencyKey, "payments:checkout", async () => {
      let lastOutage: PaymentsError | undefined
      for (const g of candidates(i)) {
        try {
          const c = await g.createCheckout(i)
          if (db) {
            const now = new Date()
            await db.savePayment({
              gateway: g.name,
              gatewayId: c.gatewayId,
              status: "created",
              amount: c.amount,
              currency: c.currency,
              amountRefunded: 0,
              orderId: c.gatewayId,
              reference: i.reference ?? i.idempotencyKey,
              ...(userId ? { userId } : {}),
              ...(i.customer?.id ? { customerId: i.customer.id } : {}),
              createdAt: now,
              updatedAt: now,
            })
          }
          return c
        } catch (err) {
          if (isPaymentsError(err, "GATEWAY_UNAVAILABLE")) {
            lastOutage = err
            continue
          }
          throw err
        }
      }
      throw lastOutage as PaymentsError
    })
  }

  async function refund(input: {
    gateway: string
    paymentId: string
    amount?: number
    reason?: string
    idempotencyKey: string
    actor?: Actor
  }): Promise<Refund> {
    const g = gateway(input.gateway)
    if (!input.idempotencyKey)
      throw new PaymentsError("IDEMPOTENCY_KEY_REQUIRED", "refund needs an idempotencyKey.")
    return once(input.idempotencyKey, `payments:refund:${g.name}`, async () => {
      const r = await g.refund(input.paymentId, {
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        idempotencyKey: input.idempotencyKey,
      })
      if (db) {
        await db.addEvent(
          {
            id: `local:refund:${input.idempotencyKey}`,
            gateway: g.name,
            type: "refund.requested",
            gatewayType: "refund.requested",
            occurredAt: new Date(),
            paymentId: input.paymentId,
            refundId: r.gatewayId,
            amount: r.amount,
            currency: r.currency,
            raw: { reason: input.reason ?? null },
          },
          input.actor ? { actor: input.actor } : {},
        )
        await db.setEventStatus(g.name, `local:refund:${input.idempotencyKey}`, "processed")
        if (r.status === "processed")
          await applyRefund(g.name, input.paymentId, r.gatewayId, r.amount, r.currency, new Date())
      }
      return r
    })
  }

  async function capture(input: {
    gateway: string
    paymentId: string
    amount?: number
    idempotencyKey: string
  }): Promise<Payment> {
    const g = gateway(input.gateway)
    return once(input.idempotencyKey, `payments:capture:${g.name}`, () =>
      g.capture(input.paymentId, {
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        idempotencyKey: input.idempotencyKey,
      }),
    )
  }

  /**
   * Record a purchase made outside checkout (App Store, Google Play) as this
   * user's: reads it from the gateway (which verifies it) and stores it. Later
   * renewals and refunds link to it through `orderId` (the original
   * transaction id or purchase token). A purchase is refused when it, or any
   * payment of the subscription it belongs to, is already another user's, so
   * one receipt cannot unlock two accounts. Payments of that subscription that
   * arrived before the claim (webhooks first) become this user's too.
   */
  async function verifyPurchase(input: {
    gateway: string
    /** The store's payment id: a transaction id (App Store) or order id (Google Play). */
    id: string
    userId: string
  }): Promise<Payment> {
    const g = gateway(input.gateway)
    return claim(g, await g.getPayment(input.id), input.userId)
  }

  /** Store a verified store payment as `userId`'s; refused when it or its subscription is another user's. */
  async function claim(g: PaymentGateway, p: Payment, userId: string): Promise<Payment> {
    if (!db) return p
    const existing = await db.getPayment(g.name, p.gatewayId)
    // ponytail: reads up to 500 payments of one subscription; page if a subscription outgrows that.
    const linked = p.orderId
      ? (await db.listPayments({ gateway: g.name, orderId: p.orderId, limit: 500 })).filter(
          (r) => r.orderId === p.orderId,
        )
      : []
    if ([existing, ...linked].some((r) => r?.userId && r.userId !== userId))
      throw new PaymentsError("BAD_INPUT", "This purchase already belongs to another user.", {
        gateway: g.name,
      })
    const now = new Date()
    for (const r of linked)
      if (!r.userId && r.gatewayId !== p.gatewayId)
        await db.savePayment({ ...r, userId: userId, updatedAt: now })
    await db.savePayment({
      ...existing,
      gateway: g.name,
      gatewayId: p.gatewayId,
      status: p.status,
      amount: p.amount,
      currency: p.currency,
      amountRefunded: p.amountRefunded ?? existing?.amountRefunded ?? 0,
      userId: userId,
      ...(p.orderId ? { orderId: p.orderId } : {}),
      ...(p.customerId ? { customerId: p.customerId } : {}),
      createdAt: existing?.createdAt ?? p.createdAt,
      updatedAt: now,
    })
    return p
  }

  /**
   * Restore purchases: re-verify what the device holds and re-attach it to
   * `userId`. App Store: signed transactions (StoreKit `jwsRepresentation`),
   * verified, then read live (Get Transaction Info, and Get All Subscription
   * Statuses for a subscription). Google Play: purchase tokens, read live
   * (subscriptionsv2 and the latest order, or productsv2). Each purchase is
   * claimed as `verifyPurchase` does, so one already another user's is
   * refused. Hand each `subscription` to signet-db's `applySubscription`.
   * An outage throws (retry the whole call); anything else refuses only that
   * purchase.
   */
  async function restorePurchases(input: {
    userId: string
    purchases: readonly StorePurchase[]
  }): Promise<{
    restored: { gateway: string; payment: Payment; subscription?: Subscription }[]
    refused: { gateway: string; index: number; code: string; message: string }[]
  }> {
    if (!input.userId) throw new PaymentsError("BAD_INPUT", "restorePurchases needs a userId.")
    const out: Awaited<ReturnType<typeof restorePurchases>> = { restored: [], refused: [] }
    for (const [index, item] of input.purchases.entries()) {
      try {
        const g = gateway(item.gateway)
        if (item.gateway === "appstore") {
          const decode = (g as { decodeTransaction?: (jws: string) => Promise<Payment> })
            .decodeTransaction
          if (!decode) throw new PaymentsError("BAD_INPUT", "appstore is not an App Store adapter.")
          const signed = await decode(item.signedTransaction)
          const p = await claim(g, await g.getPayment(signed.gatewayId), input.userId)
          const isSub = (signed.raw as { type?: string }).type === "Auto-Renewable Subscription"
          out.restored.push({
            gateway: g.name,
            payment: p,
            ...(isSub && p.orderId ? { subscription: await g.getSubscription(p.orderId) } : {}),
          })
        } else if (item.type === "subscription") {
          const s = await g.getSubscription(item.purchaseToken)
          const order = (s.raw as { lineItems?: { latestSuccessfulOrderId?: string }[] })
            .lineItems?.[0]?.latestSuccessfulOrderId
          if (!order)
            throw new PaymentsError("NOT_FOUND", "This subscription has no paid order yet.", {
              gateway: g.name,
            })
          const p = await claim(g, await g.getPayment(order), input.userId)
          out.restored.push({ gateway: g.name, payment: p, subscription: s })
        } else {
          const read = (g as { getProductPurchase?: (t: string) => Promise<Payment> })
            .getProductPurchase
          if (!read)
            throw new PaymentsError("BAD_INPUT", "googleplay is not a Google Play adapter.")
          const p = await claim(g, await read(item.purchaseToken), input.userId)
          out.restored.push({ gateway: g.name, payment: p })
        }
      } catch (err) {
        if (isPaymentsError(err, "GATEWAY_UNAVAILABLE")) throw err
        out.refused.push({
          gateway: item.gateway,
          index,
          code: isPaymentsError(err) ? err.code : "INTERNAL_ERROR",
          message: isPaymentsError(err) ? err.message : "Could not verify this purchase.",
        })
      }
    }
    return out
  }

  // ------------------------------------------------------------ inbox

  async function applyRefund(
    g: string,
    paymentId: string,
    refundId: string,
    amount: number,
    currency: string,
    at: Date,
    approximate?: boolean,
  ) {
    if (!db) return
    await post(
      db,
      postings.refund({ gateway: g, paymentId, refundId, amount, currency, at, approximate }),
    )
    const rec = await db.getPayment(g, paymentId)
    if (!rec) return
    const refunded = (await db.entries({ ref: paymentId, account: "refunds" })).reduce(
      (s, e) => s + e.amount,
      0,
    )
    await db.savePayment({
      ...rec,
      amountRefunded: refunded,
      status: refunded >= rec.amount ? "refunded" : "partially_refunded",
      updatedAt: new Date(),
    })
  }

  async function record(e: Event): Promise<PaymentRecord | undefined> {
    if (!db || !e.paymentId) return undefined
    let rec = await db.getPayment(e.gateway, e.paymentId)
    let owner: Partial<PaymentRecord> = {}
    if (!rec && (e.orderId || e.reference)) {
      const linked = await db.findLinked(e.gateway, { orderId: e.orderId, reference: e.reference })
      if (linked && linked.status === "created") {
        await db.renamePayment(e.gateway, linked.gatewayId, e.paymentId)
        rec = { ...linked, gatewayId: e.paymentId }
      } else if (linked) {
        // A retry on the same order: the first attempt already took the checkout record,
        // so the new attempt inherits who it belongs to.
        const { userId, customerId, reference, orderId } = linked
        owner = {
          ...(userId ? { userId } : {}),
          ...(customerId ? { customerId } : {}),
          ...(reference ? { reference } : {}),
          ...(orderId ? { orderId } : {}),
        }
      }
    }
    if (!rec && e.amount !== undefined && e.currency) {
      const now = new Date()
      rec = {
        // The event's order (an App Store original transaction id, a Play purchase token)
        // links this payment to its siblings, so a later claim or retry can find it.
        ...(e.orderId ? { orderId: e.orderId } : {}),
        ...owner,
        gateway: e.gateway,
        gatewayId: e.paymentId,
        status: "created",
        amount: e.amount,
        currency: e.currency,
        amountRefunded: 0,
        createdAt: e.occurredAt,
        updatedAt: now,
      }
    }
    return rec
  }

  async function moveTo(rec: PaymentRecord | undefined, status: PaymentStatus, e: Event) {
    if (!db || !rec) return
    // Never let an older or lower event undo a newer state: captured stays captured.
    if (RANK[status] < RANK[rec.status]) return
    if (rec.lastEventAt && e.occurredAt < rec.lastEventAt && RANK[status] === RANK[rec.status])
      return
    // The checks above read a copy; the store re-checks on the row so two webhooks
    // handled at once cannot write a lower status over a higher one.
    const all = Object.keys(RANK) as PaymentStatus[]
    await db.savePayment(
      {
        ...rec,
        status,
        ...(e.paymentId && e.type.startsWith("payment.") && e.amount !== undefined
          ? { amount: e.amount }
          : {}),
        ...(e.fee !== undefined && e.type === "payment.captured" ? { fee: e.fee } : {}),
        lastEventAt: e.occurredAt,
        updatedAt: new Date(),
      },
      {
        lower: all.filter((s) => RANK[s] < RANK[status]),
        same: all.filter((s) => RANK[s] === RANK[status]),
      },
    )
  }

  async function apply(e: Event): Promise<void> {
    if (db && e.paymentId) {
      const rec = await record(e)
      const cur = e.currency ?? rec?.currency
      switch (e.type) {
        case "payment.authorized":
          await moveTo(rec, "authorized", e)
          break
        case "payment.failed":
          await moveTo(rec, "failed", e)
          break
        // App store purchases and renewals arrive only as subscription events that carry the
        // charge (paymentId + amount); treat those as the capture. Postings are keyed, so a
        // gateway that also sends payment.captured for the same payment never double-posts.
        case "subscription.created":
        case "subscription.charged":
        case "payment.captured": {
          if (e.type !== "payment.captured" && e.amount === undefined) break
          await moveTo(rec, "captured", e)
          const amount = e.amount ?? rec?.amount
          if (amount && cur) {
            await post(
              db,
              postings.capture({
                gateway: e.gateway,
                approximate: e.approximate,
                paymentId: e.paymentId,
                amount,
                currency: cur,
                at: e.occurredAt,
              }),
            )
            if (e.fee)
              await post(
                db,
                postings.fee({
                  gateway: e.gateway,
                  approximate: e.approximate,
                  paymentId: e.paymentId,
                  amount: e.fee,
                  currency: cur,
                  at: e.occurredAt,
                }),
              )
          }
          break
        }
        case "refund.processed":
          if (rec && !(await db.getPayment(e.gateway, e.paymentId))) await db.savePayment(rec)
          if (e.refundId && e.amount && cur)
            await applyRefund(
              e.gateway,
              e.paymentId,
              e.refundId,
              e.amount,
              cur,
              e.occurredAt,
              e.approximate,
            )
          break
      }
    }
    if (db && e.payoutId && e.amount && e.currency) {
      const c = {
        gateway: e.gateway,
        payoutId: e.payoutId,
        amount: e.amount,
        currency: e.currency,
        at: e.occurredAt,
      }
      if (e.type === "payout.processed") await post(db, postings.payout(c))
      if (e.type === "payout.reversed") await post(db, postings.payoutReversal(c))
    }
    await config.onEvent?.(e)
  }

  async function processOne(e: StoredEvent): Promise<boolean> {
    if (!db) return false
    try {
      await apply(e)
      await db.setEventStatus(e.gateway, e.id, "processed")
      return true
    } catch (err) {
      await db.setEventStatus(
        e.gateway,
        e.id,
        "failed",
        err instanceof Error ? err.message : String(err),
      )
      return false
    }
  }

  /** Verify, store (deduped) and, with `inline`, apply one webhook. */
  async function receive(
    gatewayName: string,
    request: Request,
  ): Promise<{ event: Event; duplicate: boolean }> {
    const event = await gateway(gatewayName).verifyWebhook(request)
    if (!db) {
      await config.onEvent?.(event)
      return { event, duplicate: false }
    }
    const fresh = await db.addEvent(event)
    if (fresh && config.inline !== false) {
      const stored = await db.getEvent(event.gateway, event.id)
      if (stored) await processOne(stored)
    }
    return { event, duplicate: !fresh }
  }

  /**
   * A webhook route: 200 once the event is stored (or was a duplicate), 400 on
   * a bad signature so nothing unverified is kept, 500 otherwise so the gateway
   * retries.
   */
  async function handleWebhook(gatewayName: string, request: Request): Promise<Response> {
    try {
      const { event, duplicate } = await receive(gatewayName, request)
      return Response.json({ received: true, id: event.id, duplicate })
    } catch (err) {
      if (isPaymentsError(err, "BAD_SIGNATURE"))
        return Response.json({ error: err.message, code: err.code }, { status: 400 })
      if (isPaymentsError(err, "NO_GATEWAY"))
        return Response.json({ error: err.message, code: err.code }, { status: 404 })
      return Response.json(
        { error: "Webhook not processed", code: "INTERNAL_ERROR" },
        { status: 500 },
      )
    }
  }

  /** The inbox job: apply pending events, oldest first. Schedule it (cron, queue, signet outbox drain). */
  async function processInbox(
    options: { limit?: number } = {},
  ): Promise<{ processed: number; failed: number }> {
    if (!db) return { processed: 0, failed: 0 }
    const out = { processed: 0, failed: 0 }
    for (const e of await db.pendingEvents(options.limit ?? 100))
      (await processOne(e)) ? out.processed++ : out.failed++
    return out
  }

  /** Apply a stored event again (after a fix, or a failed one). Ledger postings are keyed, so a replay never double-posts. */
  async function replay(gatewayName: string, eventId: string): Promise<boolean> {
    if (!db) return false
    const e = await db.getEvent(gatewayName, eventId)
    if (!e) throw new PaymentsError("NOT_FOUND", `No stored event ${gatewayName}/${eventId}.`)
    return processOne(e)
  }

  async function timeline(gatewayName: string, paymentId: string): Promise<StoredEvent[]> {
    return db ? db.eventsFor(gatewayName, paymentId) : []
  }

  return {
    gateway,
    gateways: config.gateways,
    db,
    route: (i: Intent) => candidates(i)[0]?.name,
    checkout,
    capture,
    refund,
    verifyPurchase,
    restorePurchases,
    receive,
    handleWebhook,
    processInbox,
    replay,
    timeline,
  }
}
