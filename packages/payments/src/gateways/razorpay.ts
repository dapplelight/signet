/**
 * Razorpay over its REST API (api.razorpay.com/v1, HTTP Basic key_id:key_secret).
 * Test and live share the host; the key decides. Payouts are RazorpayX and need
 * `accountNumber`. Webhooks: `X-Razorpay-Signature` = HMAC-SHA256 hex of the raw
 * body with the webhook secret; the event id is the `x-razorpay-event-id` header.
 *
 * Checkout creates an Order; pass `order_id` to Razorpay Checkout in the browser.
 * `capture: "manual"` sets the order's `payment.capture`, overriding the Dashboard
 * auto-capture setting; leave it out to keep the Dashboard setting.
 */

import { PaymentsError } from "../errors.js"
import {
  badSignature,
  basicAuth,
  defineGateway,
  hmac,
  type Json,
  jsonRaw,
  safeEqual,
  toDate,
} from "../http.js"
import type {
  Event,
  EventType,
  HttpOptions,
  Payment,
  PaymentGateway,
  PaymentStatus,
  Payout,
  Refund,
  SettlementLine,
  Subscription,
  SubscriptionStatus,
} from "../types.js"

export type RazorpayConfig = HttpOptions & {
  keyId: string
  keySecret: string
  webhookSecret?: string
  /** RazorpayX account number, for payouts. */
  accountNumber?: string
}

const G = "razorpay"

const PAYMENT: Record<string, PaymentStatus> = {
  created: "created",
  authorized: "authorized",
  captured: "captured",
  refunded: "refunded",
  failed: "failed",
}

const SUB: Record<string, SubscriptionStatus> = {
  created: "pending",
  authenticated: "pending",
  active: "active",
  pending: "past_due",
  halted: "past_due",
  paused: "paused",
  cancelled: "cancelled",
  completed: "expired",
  expired: "expired",
}

const PAYOUT: Record<string, Payout["status"]> = {
  queued: "pending",
  pending: "pending",
  processing: "processing",
  processed: "paid",
  rejected: "failed",
  failed: "failed",
  cancelled: "cancelled",
  reversed: "reversed",
}

const EVENTS: Record<string, EventType> = {
  "payment.authorized": "payment.authorized",
  "payment.captured": "payment.captured",
  "payment.failed": "payment.failed",
  "refund.processed": "refund.processed",
  "refund.failed": "refund.failed",
  "subscription.authenticated": "subscription.created",
  "subscription.activated": "subscription.activated",
  "subscription.charged": "subscription.charged",
  "subscription.updated": "subscription.updated",
  "subscription.paused": "subscription.paused",
  "subscription.resumed": "subscription.resumed",
  "subscription.pending": "subscription.past_due",
  "subscription.halted": "subscription.past_due",
  "subscription.cancelled": "subscription.cancelled",
  "subscription.completed": "subscription.expired",
  "payout.processed": "payout.processed",
  "payout.failed": "payout.failed",
  "payout.rejected": "payout.failed",
  "payout.reversed": "payout.reversed",
  "payment.dispute.created": "dispute.opened",
  "payment.dispute.under_review": "dispute.updated",
  "payment.dispute.action_required": "dispute.updated",
  "payment.dispute.won": "dispute.won",
  "payment.dispute.lost": "dispute.lost",
  "payment.dispute.closed": "dispute.closed",
}

export const toPayment = (p: Json): Payment => ({
  gateway: G,
  gatewayId: p.id,
  amount: p.amount,
  currency: p.currency,
  status:
    p.status === "captured" && p.amount_refunded > 0
      ? p.amount_refunded >= p.amount
        ? "refunded"
        : "partially_refunded"
      : (PAYMENT[p.status] ?? "pending"),
  method: p.method ?? undefined,
  customerId: p.customer_id ?? undefined,
  orderId: p.order_id ?? undefined,
  fee: p.fee ?? undefined,
  amountRefunded: p.amount_refunded ?? undefined,
  createdAt: toDate(p.created_at),
  raw: p,
})

const toRefund = (r: Json): Refund => ({
  gateway: G,
  gatewayId: r.id,
  paymentId: r.payment_id,
  amount: r.amount,
  currency: r.currency,
  status: r.status === "processed" ? "processed" : r.status === "failed" ? "failed" : "pending",
  createdAt: toDate(r.created_at),
  raw: r,
})

const toSub = (s: Json): Subscription => ({
  gateway: G,
  gatewayId: s.id,
  status: SUB[s.status] ?? "pending",
  customerId: s.customer_id ?? undefined,
  currentPeriodEnd: s.current_end ? toDate(s.current_end) : undefined,
  createdAt: toDate(s.created_at),
  raw: s,
})

export function razorpay(config: RazorpayConfig): PaymentGateway {
  const base = () => config.baseUrl ?? "https://api.razorpay.com/v1"
  const raw = jsonRaw(
    G,
    base,
    () => ({ authorization: basicAuth(config.keyId, config.keySecret) }),
    config,
  )

  return defineGateway(
    G,
    {
      methods: ["upi", "card", "netbanking", "wallet", "emi"],
      features: [
        "capture",
        "refunds",
        "partialRefunds",
        "customers",
        "savedMethods",
        "subscriptions",
        "settlements",
        "webhooks",
        ...(config.accountNumber ? (["payouts"] as const) : []),
      ],
    },
    {
      raw,
      async createCheckout(i) {
        const o: Json = await raw("POST", "/orders", {
          amount: i.amount,
          currency: i.currency,
          // `receipt` is unique per account and at most 40 characters.
          receipt: (i.reference ?? i.idempotencyKey).slice(0, 40),
          ...(i.metadata ? { notes: i.metadata } : {}),
          // Per-order capture setting; `capture_options` is optional for manual.
          // https://razorpay.com/docs/payments/payments/capture-settings/api.md
          // https://github.com/razorpay/razorpay-node/blob/master/lib/types/orders.d.ts (RazorpayCapturePayment)
          ...(i.capture === "manual" ? { payment: { capture: "manual" } } : {}),
          ...i.extra,
        })
        return { gateway: G, gatewayId: o.id, amount: o.amount, currency: o.currency, raw: o }
      },
      async getPayment(id) {
        return toPayment(await raw("GET", `/payments/${encodeURIComponent(id)}`))
      },
      async capture(id, i) {
        // Razorpay's capture needs the amount and currency; read them off the payment.
        const p = toPayment(await raw("GET", `/payments/${encodeURIComponent(id)}`))
        const body = { amount: i.amount ?? p.amount, currency: p.currency }
        return toPayment(await raw("POST", `/payments/${encodeURIComponent(id)}/capture`, body))
      },
      async refund(paymentId, i) {
        if (!/^[\w-]{10,}$/.test(i.idempotencyKey))
          throw new PaymentsError(
            "BAD_INPUT",
            "Razorpay refund idempotency keys are at least 10 characters of letters, digits, - and _.",
            { gateway: G },
          )
        const r = await raw(
          "POST",
          `/payments/${encodeURIComponent(paymentId)}/refund`,
          {
            ...(i.amount !== undefined ? { amount: i.amount } : {}),
            ...(i.reason ? { notes: { reason: i.reason } } : {}),
          },
          {
            idempotencyKey: i.idempotencyKey,
            headers: { "X-Refund-Idempotency": i.idempotencyKey },
          },
        )
        return toRefund(r)
      },
      async createCustomer(i) {
        const c: Json = await raw("POST", "/customers", {
          ...(i.name ? { name: i.name } : {}),
          ...(i.email ? { email: i.email } : {}),
          ...(i.phone ? { contact: i.phone } : {}),
        })
        return {
          gateway: G,
          gatewayId: c.id,
          email: c.email ?? undefined,
          name: c.name ?? undefined,
          phone: c.contact ?? undefined,
          createdAt: toDate(c.created_at),
          raw: c,
        }
      },
      async listPaymentMethods(customerId) {
        const r: Json = await raw("GET", `/customers/${encodeURIComponent(customerId)}/tokens`)
        return (r.items ?? []).map((t: Json) => ({
          gateway: G,
          gatewayId: t.id,
          customerId,
          type: t.method,
          label: t.card?.last4
            ? `${t.card.network ?? "card"} ${t.card.last4}`
            : (t.vpa?.username ?? undefined),
          createdAt: toDate(t.created_at),
          raw: t,
        }))
      },
      async getSubscription(id) {
        return toSub(await raw("GET", `/subscriptions/${encodeURIComponent(id)}`))
      },
      async cancelSubscription(id, o = {}) {
        return toSub(
          await raw("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, {
            cancel_at_cycle_end: !!o.atPeriodEnd,
          }),
        )
      },
      async createPayout(i) {
        const p: Json = await raw(
          "POST",
          "/payouts",
          {
            account_number: config.accountNumber,
            fund_account_id: i.destination,
            amount: i.amount,
            currency: i.currency,
            mode: "IMPS",
            purpose: "payout",
            ...(i.reference ? { reference_id: i.reference } : {}),
            ...i.extra,
          },
          {
            idempotencyKey: i.idempotencyKey,
            headers: { "X-Payout-Idempotency": i.idempotencyKey },
          },
        )
        return {
          gateway: G,
          gatewayId: p.id,
          amount: p.amount,
          currency: p.currency,
          status: PAYOUT[p.status] ?? "pending",
          createdAt: toDate(p.created_at),
          raw: p,
        }
      },
      async listSettlements({ date }) {
        const [year, month, day] = date.split("-")
        const lines: SettlementLine[] = []
        const items: Json[] = []
        for (let skip = 0; ; skip += 1000) {
          const r: Json = await raw("GET", "/settlements/recon/combined", undefined, {
            query: { year, month, day, count: 1000, skip },
          })
          items.push(...(r.items ?? []))
          if ((r.items ?? []).length < 1000) break
        }
        for (const it of items) {
          lines.push({
            kind:
              it.type === "payment" || it.type === "refund" || it.type === "adjustment"
                ? it.type
                : "other",
            gatewayId: it.entity_id,
            paymentId: it.type === "payment" ? it.entity_id : (it.payment_id ?? undefined),
            amount: it.amount,
            currency: it.currency,
            fee: it.fee ?? undefined,
            settlementId: it.settlement_id ?? undefined,
            createdAt: toDate(it.created_at),
            raw: it,
          })
        }
        return [{ gateway: G, date, lines, raw: items }]
      },
      async verifyWebhook(req) {
        if (!config.webhookSecret) throw badSignature(G, "no webhookSecret configured")
        const body = await req.text()
        const sig = req.headers.get("x-razorpay-signature") ?? ""
        if (!safeEqual(await hmac("SHA-256", config.webhookSecret, body), sig))
          throw badSignature(G)
        const e: Json = JSON.parse(body)
        const pay = e.payload?.payment?.entity
        const refund = e.payload?.refund?.entity
        const sub = e.payload?.subscription?.entity
        const payout = e.payload?.payout?.entity
        const dispute = e.payload?.dispute?.entity
        const subject = refund ?? payout ?? dispute ?? pay ?? sub
        const out: Event = {
          id: req.headers.get("x-razorpay-event-id") ?? `${e.event}:${subject?.id}:${e.created_at}`,
          gateway: G,
          type: EVENTS[e.event] ?? "unknown",
          gatewayType: e.event,
          occurredAt: toDate(e.created_at),
          paymentId: refund?.payment_id ?? dispute?.payment_id ?? pay?.id,
          orderId: pay?.order_id ?? undefined,
          refundId: refund?.id,
          subscriptionId: sub?.id,
          payoutId: payout?.id,
          disputeId: dispute?.id,
          amount: subject?.amount,
          currency: subject?.currency,
          fee: refund || dispute ? undefined : (pay?.fee ?? undefined),
          raw: e,
        }
        return out
      },
    },
  )
}
