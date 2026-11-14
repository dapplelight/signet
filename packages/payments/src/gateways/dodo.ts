/**
 * Dodo Payments (merchant of record) over its REST API: `Authorization: Bearer
 * <key>`, test.dodopayments.com or live.dodopayments.com (the key's mode must
 * match). Amounts are integer minor units. Checkout creates a Checkout Session
 * and returns its hosted `checkout_url`; `gatewayId` is the `session_id`, and
 * payments that come out of it are `pay_...` ids. Pass catalog products as
 * `extra.product_cart`, or set `productId` to a pay-what-you-want product and
 * the input amount is sent as its price. The session is priced in the
 * product's currency (Dodo converts only with adaptive pricing).
 * https://docs.dodopayments.com/api-reference/introduction.md
 *
 * Webhooks follow Standard Webhooks: `webhook-signature` holds space-separated
 * `v1,<base64>` HMAC-SHA256 signatures of `${webhook-id}.${webhook-timestamp}.${body}`,
 * keyed with the base64-decoded secret after its `whsec_` prefix; dedupe on
 * `webhook-id`. https://docs.dodopayments.com/developer-resources/webhooks.md
 *
 * Unsupported: capture (no capture endpoint), payouts (Dodo pays you; there is
 * no outbound payout API), settlements (the balance ledger is in the
 * settlement currency and net of the tax Dodo collects as merchant of record,
 * so it cannot be matched to payment amounts), idempotency keys (Dodo has none
 * for checkouts or refunds, so refunds are not retried).
 */

import { PaymentsError } from "../errors.js"
import {
  badSignature,
  checkTimestamp,
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
  Refund,
  Subscription,
  SubscriptionStatus,
} from "../types.js"

export type DodoConfig = HttpOptions & {
  apiKey: string
  /** The webhook's signing secret (`whsec_...`). */
  webhookSecret?: string
  /** A pay-what-you-want product to price checkouts with the input amount. */
  productId?: string
}

const G = "dodo"

// IntentStatus, https://docs.dodopayments.com/api-reference/payments/get-payments-1.md
const STATUS: Record<string, PaymentStatus> = {
  succeeded: "captured",
  partially_captured: "captured",
  partially_captured_and_capturable: "captured",
  requires_capture: "authorized",
  failed: "failed",
  cancelled: "cancelled",
}

// SubscriptionStatus, https://docs.dodopayments.com/api-reference/subscriptions/get-subscriptions.md
const SUB: Record<string, SubscriptionStatus> = {
  pending: "pending",
  active: "active",
  on_hold: "past_due",
  past_due: "past_due",
  paused: "paused",
  cancelled: "cancelled",
  failed: "cancelled",
  expired: "expired",
}

// https://docs.dodopayments.com/developer-resources/webhooks/intents/webhook-events-guide.md
const EVENTS: Record<string, EventType> = {
  "payment.succeeded": "payment.captured",
  "payment.failed": "payment.failed",
  "refund.succeeded": "refund.processed",
  "refund.failed": "refund.failed",
  "subscription.active": "subscription.activated",
  "subscription.renewed": "subscription.charged",
  "subscription.on_hold": "subscription.past_due",
  "subscription.past_due": "subscription.past_due",
  "subscription.paused": "subscription.paused",
  "subscription.unpaused": "subscription.resumed",
  "subscription.updated": "subscription.updated",
  "subscription.plan_changed": "subscription.updated",
  "subscription.cancelled": "subscription.cancelled",
  "subscription.expired": "subscription.expired",
  "dispute.opened": "dispute.opened",
  "dispute.challenged": "dispute.updated",
  "dispute.accepted": "dispute.updated",
  "dispute.won": "dispute.won",
  "dispute.lost": "dispute.lost",
  "dispute.expired": "dispute.closed",
  "dispute.cancelled": "dispute.closed",
}

const toPayment = (p: Json): Payment => ({
  gateway: G,
  gatewayId: p.payment_id,
  amount: p.total_amount,
  currency: p.currency,
  status:
    p.refund_status === "full"
      ? "refunded"
      : p.refund_status === "partial"
        ? "partially_refunded"
        : (STATUS[p.status] ?? "pending"),
  method: p.payment_method ?? undefined,
  customerId: p.customer?.customer_id ?? undefined,
  orderId: p.checkout_session_id ?? undefined,
  createdAt: toDate(p.created_at),
  raw: p,
})

const toRefund = (r: Json): Refund => ({
  gateway: G,
  gatewayId: r.refund_id,
  paymentId: r.payment_id,
  amount: r.amount ?? 0,
  currency: r.currency,
  status: r.status === "succeeded" ? "processed" : r.status === "failed" ? "failed" : "pending",
  createdAt: toDate(r.created_at),
  raw: r,
})

const toSubscription = (s: Json): Subscription => ({
  gateway: G,
  gatewayId: s.subscription_id,
  status: SUB[s.status] ?? "pending",
  customerId: s.customer?.customer_id ?? undefined,
  // "Timestamp of the next scheduled billing. Indicates the end of current billing period."
  currentPeriodEnd: s.next_billing_date ? toDate(s.next_billing_date) : undefined,
  createdAt: toDate(s.created_at),
  raw: s,
})

const b64bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export function dodo(config: DodoConfig): PaymentGateway {
  const base = () =>
    config.baseUrl ??
    (config.sandbox ? "https://test.dodopayments.com" : "https://live.dodopayments.com")
  const raw = jsonRaw(G, base, () => ({ authorization: `Bearer ${config.apiKey}` }), config)
  const payment = async (id: string) =>
    toPayment(await raw("GET", `/payments/${encodeURIComponent(id)}`))

  return defineGateway(
    G,
    {
      methods: ["card", "wallet"],
      features: [
        "refunds",
        "partialRefunds",
        "customers",
        "savedMethods",
        "subscriptions",
        "webhooks",
      ],
    },
    {
      raw,
      // POST /checkouts -> {session_id, checkout_url}.
      // https://docs.dodopayments.com/api-reference/checkout-sessions/create.md
      async createCheckout(i) {
        const cart =
          i.extra?.product_cart ??
          (config.productId
            ? [{ product_id: config.productId, quantity: 1, amount: i.amount }]
            : undefined)
        if (!cart)
          throw new PaymentsError(
            "BAD_INPUT",
            "Dodo checkouts need extra.product_cart or a pay-what-you-want productId.",
            { gateway: G },
          )
        const c = i.customer
        const s: Json = await raw("POST", "/checkouts", {
          product_cart: cart,
          ...(c?.id
            ? { customer: { customer_id: c.id } }
            : c?.email
              ? {
                  customer: {
                    email: c.email,
                    ...(c.name ? { name: c.name } : {}),
                    ...(c.phone ? { phone_number: c.phone } : {}),
                  },
                }
              : {}),
          ...(i.returnUrl ? { return_url: i.returnUrl } : {}),
          metadata: { ...i.metadata, ...(i.reference ? { reference: i.reference } : {}) },
          ...i.extra,
        })
        return {
          gateway: G,
          gatewayId: s.session_id,
          amount: i.amount,
          currency: i.currency,
          url: s.checkout_url ?? undefined,
          raw: s,
        }
      },
      // https://docs.dodopayments.com/api-reference/payments/get-payments-1.md
      getPayment: payment,
      // Partial refunds are per item: spread the amount over the payment's line
      // items (their refundable_amount, in the paid currency), tax inclusive.
      // https://docs.dodopayments.com/api-reference/refunds/post-refunds.md
      // https://docs.dodopayments.com/api-reference/payments/retrieve-line-items.md
      async refund(paymentId, i) {
        let partial: Json = {}
        if (i.amount !== undefined) {
          const p = await payment(paymentId)
          const li: Json = await raw(
            "GET",
            `/payments/${encodeURIComponent(paymentId)}/line-items`,
            undefined,
            { query: { currency: p.currency } },
          )
          if (li.partial_refund_allowed === false)
            throw new PaymentsError(
              "BAD_INPUT",
              "This payment's method allows no partial refund.",
              {
                gateway: G,
              },
            )
          let left = i.amount
          const items: Json[] = []
          for (const it of li.items ?? []) {
            const take = Math.min(left, Number(it.refundable_amount ?? 0))
            if (take > 0) items.push({ item_id: it.items_id, amount: take })
            left -= take
          }
          if (left > 0)
            throw new PaymentsError("BAD_INPUT", "Refund amount exceeds what is refundable.", {
              gateway: G,
            })
          partial = { items, currency: p.currency }
        }
        // No idempotency key exists for refunds, so this call is never retried.
        return toRefund(
          await raw("POST", "/refunds", {
            payment_id: paymentId,
            ...partial,
            ...(i.reason ? { reason: i.reason } : {}),
          }),
        )
      },
      // https://docs.dodopayments.com/api-reference/customers/create-customer.md
      async createCustomer(i) {
        if (!i.email || !i.name)
          throw new PaymentsError("BAD_INPUT", "Dodo customers need a name and an email.", {
            gateway: G,
          })
        const c: Json = await raw("POST", "/customers", {
          email: i.email,
          name: i.name,
          ...(i.phone ? { phone_number: i.phone } : {}),
        })
        return {
          gateway: G,
          gatewayId: c.customer_id,
          email: c.email,
          name: c.name,
          phone: c.phone_number ?? undefined,
          createdAt: toDate(c.created_at),
          raw: c,
        }
      },
      // https://docs.dodopayments.com/api-reference/customers/get-customer-payment-methods.md
      async listPaymentMethods(customerId) {
        const r: Json = await raw(
          "GET",
          `/customers/${encodeURIComponent(customerId)}/payment-methods`,
        )
        return (r.items ?? []).map((m: Json) => ({
          gateway: G,
          gatewayId: m.payment_method_id,
          customerId,
          type: m.payment_method,
          label: m.card
            ? [m.card.card_network, m.card.last4_digits].filter(Boolean).join(" ")
            : (m.payment_method_type ?? undefined),
          createdAt: toDate(m.last_used_at),
          raw: m,
        }))
      },
      // https://docs.dodopayments.com/api-reference/subscriptions/get-subscriptions.md
      async getSubscription(id) {
        return toSubscription(await raw("GET", `/subscriptions/${encodeURIComponent(id)}`))
      },
      // PATCH {status: "cancelled"} now, or {cancel_at_next_billing_date: true}.
      // https://docs.dodopayments.com/api-reference/subscriptions/patch-subscriptions.md
      async cancelSubscription(id, o) {
        return toSubscription(
          await raw(
            "PATCH",
            `/subscriptions/${encodeURIComponent(id)}`,
            o?.atPeriodEnd ? { cancel_at_next_billing_date: true } : { status: "cancelled" },
          ),
        )
      },
      async verifyWebhook(req, o) {
        if (!config.webhookSecret) throw badSignature(G, "no webhookSecret configured")
        const body = await req.text()
        const id = req.headers.get("webhook-id") ?? ""
        const ts = req.headers.get("webhook-timestamp") ?? ""
        const key = b64bytes(config.webhookSecret.replace(/^whsec_/, ""))
        const want = await hmac("SHA-256", key, `${id}.${ts}.${body}`, "base64")
        const sigs = (req.headers.get("webhook-signature") ?? "").split(" ")
        if (!id || !ts || !sigs.some((s) => s.startsWith("v1,") && safeEqual(s.slice(3), want)))
          throw badSignature(G)
        checkTimestamp(G, Number(ts), o)
        const e: Json = JSON.parse(body)
        const d = e.data ?? {}
        const t = String(e.type)
        const isRefund = t.startsWith("refund.")
        const isPayment = t.startsWith("payment.")
        const out: Event = {
          id,
          gateway: G,
          type: EVENTS[t] ?? "unknown",
          gatewayType: t,
          occurredAt: toDate(e.timestamp),
          paymentId: d.payment_id ?? undefined,
          orderId: isPayment ? (d.checkout_session_id ?? undefined) : undefined,
          reference: d.metadata?.reference ?? undefined,
          refundId: isRefund ? d.refund_id : undefined,
          subscriptionId: d.subscription_id ?? undefined,
          disputeId: t.startsWith("dispute.") ? d.dispute_id : undefined,
          amount: isPayment ? d.total_amount : isRefund ? (d.amount ?? undefined) : undefined,
          currency: isPayment || isRefund ? (d.currency ?? undefined) : undefined,
          raw: e,
        }
        return out
      },
    },
  )
}
