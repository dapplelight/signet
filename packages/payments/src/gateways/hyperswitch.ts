/**
 * Hyperswitch (open-source payments orchestrator) over its REST API, header
 * `api-key`. Amounts are integer minor units. Checkout creates a Payment and
 * returns its `client_secret` for the Hyperswitch SDK. Which methods work
 * depends on the connectors enabled in your Hyperswitch account.
 *
 * Webhooks: `X-Webhook-Signature-512` = HMAC-SHA512 hex of the raw body with
 * the business profile's `payment_response_hash_key`; dedupe on `event_id`.
 *
 * Refunds send `refund_id` = "ref_" + 26 hex chars of SHA-256(idempotency
 * key), so a retried refund is rejected as a duplicate instead of repeated.
 * Payouts take a saved payout method id as `destination` and are sent once,
 * never retried (Hyperswitch has no payout idempotency key). Subscriptions need
 * `profileId` (sent as `X-Profile-Id`).
 *
 * Unsupported: settlements (no public API), gateway-side idempotency for
 * checkout (Hyperswitch has no general header).
 */

import {
  badSignature,
  defineGateway,
  hmac,
  type Json,
  jsonRaw,
  safeEqual,
  sha256Hex,
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
  Subscription,
  SubscriptionStatus,
} from "../types.js"

export type HyperswitchConfig = HttpOptions & {
  apiKey: string
  paymentResponseHashKey?: string
  /** Business profile id; needed for subscriptions (`X-Profile-Id`). */
  profileId?: string
}

const SUB: Record<string, SubscriptionStatus> = {
  created: "pending",
  pending: "pending",
  trial: "trialing",
  active: "active",
  onetime: "active",
  paused: "paused",
  unpaid: "past_due",
  in_active: "expired",
  cancelled: "cancelled",
  failed: "cancelled",
}

const PAYOUT: Record<string, Payout["status"]> = {
  success: "paid",
  failed: "failed",
  cancelled: "cancelled",
  expired: "failed",
  reversed: "reversed",
  ineligible: "failed",
  not_permitted: "failed",
}

const G = "hyperswitch"

function status(s: string): PaymentStatus {
  if (s === "succeeded" || s.startsWith("partially_captured")) return "captured"
  if (s === "requires_capture" || s === "partially_authorized_and_requires_capture")
    return "authorized"
  if (s === "failed" || s === "expired") return "failed"
  if (s === "cancelled" || s === "cancelled_post_capture") return "cancelled"
  if (s === "requires_payment_method") return "created"
  return "pending"
}

const EVENTS: Record<string, EventType> = {
  payment_authorized: "payment.authorized",
  payment_succeeded: "payment.captured",
  payment_captured: "payment.captured",
  payment_failed: "payment.failed",
  refund_succeeded: "refund.processed",
  refund_failed: "refund.failed",
  dispute_opened: "dispute.opened",
  dispute_challenged: "dispute.updated",
  dispute_won: "dispute.won",
  dispute_lost: "dispute.lost",
  dispute_expired: "dispute.closed",
  dispute_accepted: "dispute.closed",
  dispute_cancelled: "dispute.closed",
  payout_success: "payout.processed",
  payout_failed: "payout.failed",
  payout_reversed: "payout.reversed",
}

const toPayment = (p: Json): Payment => ({
  gateway: G,
  gatewayId: p.payment_id,
  amount: p.amount,
  currency: p.currency,
  status: status(String(p.status)),
  method: p.payment_method ?? undefined,
  customerId: p.customer_id ?? undefined,
  createdAt: toDate(p.created),
  raw: p,
})

export function hyperswitch(config: HyperswitchConfig): PaymentGateway {
  const base = () =>
    config.baseUrl ??
    (config.sandbox ? "https://sandbox.hyperswitch.io" : "https://api.hyperswitch.io")
  const raw = jsonRaw(G, base, () => ({ "api-key": config.apiKey }), config)
  const profile = () => ({ headers: { "X-Profile-Id": config.profileId ?? "" } })
  // SubscriptionResponse has no created time or period end.
  const toSubscription = (s: Json): Subscription => ({
    gateway: G,
    gatewayId: String(s.id),
    status: SUB[s.status] ?? "pending",
    customerId: s.customer_id ?? undefined,
    createdAt: toDate(undefined),
    raw: s,
  })

  return defineGateway(
    G,
    {
      methods: ["card", "upi", "netbanking", "wallet"],
      features: [
        "capture",
        "refunds",
        "partialRefunds",
        "customers",
        "savedMethods",
        "payouts",
        ...(config.profileId ? (["subscriptions"] as const) : []),
        "webhooks",
      ],
    },
    {
      raw,
      async createCheckout(i) {
        const p: Json = await raw("POST", "/payments", {
          amount: i.amount,
          currency: i.currency,
          capture_method: i.capture === "manual" ? "manual" : "automatic",
          ...(i.customer?.id ? { customer_id: i.customer.id } : {}),
          ...(i.returnUrl ? { return_url: i.returnUrl } : {}),
          ...(i.description ? { description: i.description } : {}),
          metadata: { ...i.metadata, reference: i.reference ?? i.idempotencyKey },
          ...i.extra,
        })
        return {
          gateway: G,
          gatewayId: p.payment_id,
          amount: p.amount,
          currency: p.currency,
          clientSecret: p.client_secret,
          raw: p,
        }
      },
      getPayment: async (id) => toPayment(await raw("GET", `/payments/${encodeURIComponent(id)}`)),
      capture: async (id, i) =>
        toPayment(
          await raw(
            "POST",
            `/payments/${encodeURIComponent(id)}/capture`,
            i.amount !== undefined ? { amount_to_capture: i.amount } : {},
          ),
        ),
      // refund_id: 30 chars per RefundRequest in
      // https://raw.githubusercontent.com/juspay/hyperswitch/main/api-reference/v1/openapi_spec_v1.json
      // https://api-reference.hyperswitch.io/v1/refunds/refunds--create
      async refund(paymentId, i) {
        const refundId = `ref_${(await sha256Hex(i.idempotencyKey)).slice(0, 26)}`
        const r: Json = await raw(
          "POST",
          "/refunds",
          {
            payment_id: paymentId,
            refund_id: refundId,
            ...(i.amount !== undefined ? { amount: i.amount } : {}),
            ...(i.reason ? { reason: i.reason } : {}),
          },
          { idempotencyKey: i.idempotencyKey },
        )
        return {
          gateway: G,
          gatewayId: r.refund_id,
          paymentId: r.payment_id,
          amount: r.amount,
          currency: r.currency,
          status:
            r.status === "succeeded" ? "processed" : r.status === "failed" ? "failed" : "pending",
          createdAt: toDate(r.created_at),
          raw: r,
        }
      },
      // GET /customers/{id}/payment_methods -> customer_payment_methods[].
      // https://api-reference.hyperswitch.io/v1/payment-methods/list-payment-methods-for-a-customer
      // openapi_spec_v1.json: CustomerPaymentMethodsListResponse, CustomerPaymentMethod
      async listPaymentMethods(customerId) {
        const r: Json = await raw(
          "GET",
          `/customers/${encodeURIComponent(customerId)}/payment_methods`,
        )
        return (r.customer_payment_methods ?? []).map((m: Json) => ({
          gateway: G,
          gatewayId: m.payment_method_id,
          customerId: m.customer_id ?? customerId,
          type: m.payment_method,
          label: m.card
            ? [m.card.card_network ?? m.card.scheme, m.card.last4_digits].filter(Boolean).join(" ")
            : (m.payment_method_type ?? undefined),
          createdAt: toDate(m.created),
          raw: m,
        }))
      },
      // POST /payouts/create, confirmed and fulfilled in one call. Not retried:
      // merchant_order_reference_id is for reconciliation, not deduplication.
      // https://api-reference.hyperswitch.io/v1/payouts/payouts--create
      // openapi_spec_v1.json: PayoutsCreateRequest (payout_method_id, confirm, auto_fulfill)
      async createPayout(i) {
        const p: Json = await raw("POST", "/payouts/create", {
          amount: i.amount,
          currency: i.currency,
          payout_method_id: i.destination,
          confirm: true,
          auto_fulfill: true,
          merchant_order_reference_id: i.reference ?? i.idempotencyKey,
          ...i.extra,
        })
        return {
          gateway: G,
          gatewayId: p.payout_id,
          amount: p.amount,
          currency: p.currency,
          status: PAYOUT[p.status] ?? "pending",
          createdAt: toDate(p.created),
          raw: p,
        }
      },
      // GET /subscriptions/{id} and POST /subscriptions/{id}/cancel, both with X-Profile-Id.
      // https://api-reference.hyperswitch.io/v1/subscriptions/get.md
      // https://api-reference.hyperswitch.io/v1/subscriptions/cancel.md
      // openapi_spec_v1.json: SubscriptionResponse, CancelSubscriptionRequest
      async getSubscription(id) {
        return toSubscription(
          await raw("GET", `/subscriptions/${encodeURIComponent(id)}`, undefined, profile()),
        )
      },
      async cancelSubscription(id, o) {
        const r: Json = await raw(
          "POST",
          `/subscriptions/${encodeURIComponent(id)}/cancel`,
          { cancel_option: o?.atPeriodEnd ? "end_of_term" : "immediately" },
          profile(),
        )
        return toSubscription(r)
      },
      async createCustomer(i) {
        const c: Json = await raw("POST", "/customers", { ...i })
        return {
          gateway: G,
          gatewayId: c.customer_id,
          email: c.email ?? undefined,
          name: c.name ?? undefined,
          phone: c.phone ?? undefined,
          createdAt: toDate(c.created_at),
          raw: c,
        }
      },
      async verifyWebhook(req) {
        if (!config.paymentResponseHashKey)
          throw badSignature(G, "no paymentResponseHashKey configured")
        const body = await req.text()
        const sig = (req.headers.get("x-webhook-signature-512") ?? "").toLowerCase()
        if (!safeEqual(await hmac("SHA-512", config.paymentResponseHashKey, body), sig))
          throw badSignature(G)
        const e: Json = JSON.parse(body)
        const o = e.content?.object ?? {}
        const kind = e.content?.type
        const out: Event = {
          id: e.event_id,
          gateway: G,
          type: EVENTS[e.event_type] ?? "unknown",
          gatewayType: e.event_type,
          occurredAt: toDate(e.timestamp ?? o.updated ?? o.updated_at ?? o.created),
          paymentId: o.payment_id,
          reference: o.metadata?.reference,
          refundId: kind === "refund_details" ? o.refund_id : undefined,
          disputeId: kind === "dispute_details" ? o.dispute_id : undefined,
          payoutId: kind === "payout_details" ? o.payout_id : undefined,
          amount: typeof o.amount === "number" ? o.amount : undefined,
          currency: o.currency,
          raw: e,
        }
        return out
      },
    },
  )
}
