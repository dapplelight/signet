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
} from "./types.js"

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

  // ------------------------------------------------------------ inbox

  async function applyRefund(
    g: string,
    paymentId: string,
    refundId: string,
    amount: number,
    currency: string,
    at: Date,
  ) {
    if (!db) return
    await post(db, postings.refund({ gateway: g, paymentId, refundId, amount, currency, at }))
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
    if (!rec && (e.orderId || e.reference)) {
      const linked = await db.findLinked(e.gateway, { orderId: e.orderId, reference: e.reference })
      if (linked && linked.status === "created") {
        await db.renamePayment(e.gateway, linked.gatewayId, e.paymentId)
        rec = { ...linked, gatewayId: e.paymentId }
      }
    }
    if (!rec && e.amount !== undefined && e.currency) {
      const now = new Date()
      rec = {
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
    await db.savePayment({
      ...rec,
      status,
      ...(e.paymentId && e.type.startsWith("payment.") && e.amount !== undefined
        ? { amount: e.amount }
        : {}),
      ...(e.fee !== undefined && e.type === "payment.captured" ? { fee: e.fee } : {}),
      lastEventAt: e.occurredAt,
      updatedAt: new Date(),
    })
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
        case "payment.captured": {
          await moveTo(rec, "captured", e)
          const amount = e.amount ?? rec?.amount
          if (amount && cur) {
            await post(
              db,
              postings.capture({
                gateway: e.gateway,
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
            await applyRefund(e.gateway, e.paymentId, e.refundId, e.amount, cur, e.occurredAt)
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
    receive,
    handleWebhook,
    processInbox,
    replay,
    timeline,
  }
}
