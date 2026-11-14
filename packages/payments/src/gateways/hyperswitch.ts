/**
 * Hyperswitch (open-source payments orchestrator) over its REST API, header
 * `api-key`. Amounts are integer minor units. Checkout creates a Payment and
 * returns its `client_secret` for the Hyperswitch SDK. Which methods work
 * depends on the connectors enabled in your Hyperswitch account.
 *
 * Webhooks: `X-Webhook-Signature-512` = HMAC-SHA512 hex of the raw body with
 * the business profile's `payment_response_hash_key`; dedupe on `event_id`.
 *
 * Unsupported: saved methods and payouts (response and destination fields not
 * verified), subscriptions (request bodies not verified), settlements (no
 * public API), gateway-side idempotency (Hyperswitch has no general header).
 */

import {
  badSignature,
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
} from "../types.js"

export type HyperswitchConfig = HttpOptions & { apiKey: string; paymentResponseHashKey?: string }

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

  return defineGateway(
    G,
    {
      methods: ["card", "upi", "netbanking", "wallet"],
      features: ["capture", "refunds", "partialRefunds", "customers", "webhooks"],
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
      async refund(paymentId, i) {
        const r: Json = await raw("POST", "/refunds", {
          payment_id: paymentId,
          ...(i.amount !== undefined ? { amount: i.amount } : {}),
          ...(i.reason ? { reason: i.reason } : {}),
        })
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
