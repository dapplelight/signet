/**
 * Paddle Billing (not Paddle Classic) over its REST API: bearer API key,
 * `Paddle-Version: 1`, amounts as strings of minor units. Paddle is a merchant
 * of record: checkout creates a Transaction from your catalog prices (pass
 * `extra.items`, e.g. `[{ price_id: "pri_...", quantity: 1 }]`) and returns its
 * checkout URL. Refunds are adjustments, which usually start `pending_approval`.
 *
 * Webhooks: `Paddle-Signature: ts=..;h1=..` (h1 repeats while a secret
 * rotates), HMAC-SHA256 hex of `${ts}:${rawBody}` with the endpoint secret.
 *
 * Partial refunds are per line item: the amount is spread over the
 * transaction's line items in order, each up to its total (tax included).
 *
 * Unsupported: capture, payouts and settlements (no API), idempotency
 * keys (Paddle has none; retries of checkout are not deduplicated by Paddle).
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
  Subscription,
  SubscriptionStatus,
} from "../types.js"

export type PaddleConfig = HttpOptions & { apiKey: string; webhookSecret?: string }

const G = "paddle"

const TXN: Record<string, PaymentStatus> = {
  draft: "created",
  ready: "created",
  billed: "pending",
  paid: "pending",
  completed: "captured",
  canceled: "cancelled",
  past_due: "failed",
}

const SUB: Record<string, SubscriptionStatus> = {
  active: "active",
  canceled: "cancelled",
  past_due: "past_due",
  paused: "paused",
  trialing: "trialing",
}

const total = (t: Json) => Number(t.details?.totals?.total ?? t.totals?.total ?? 0)

const toPayment = (t: Json): Payment => ({
  gateway: G,
  gatewayId: t.id,
  amount: total(t),
  currency: t.currency_code,
  status: TXN[t.status] ?? "pending",
  customerId: t.customer_id ?? undefined,
  createdAt: toDate(t.created_at),
  raw: t,
})

const toSub = (s: Json): Subscription => ({
  gateway: G,
  gatewayId: s.id,
  status: SUB[s.status] ?? "pending",
  customerId: s.customer_id ?? undefined,
  currentPeriodEnd: s.current_billing_period?.ends_at
    ? toDate(s.current_billing_period.ends_at)
    : undefined,
  createdAt: toDate(s.created_at),
  raw: s,
})

const SUB_EVENTS: Record<string, EventType> = {
  "subscription.created": "subscription.created",
  "subscription.activated": "subscription.activated",
  "subscription.updated": "subscription.updated",
  "subscription.trialing": "subscription.updated",
  "subscription.paused": "subscription.paused",
  "subscription.resumed": "subscription.resumed",
  "subscription.past_due": "subscription.past_due",
  "subscription.canceled": "subscription.cancelled",
}

function eventType(type: string, d: Json): EventType {
  if (type === "transaction.completed") return "payment.captured"
  if (type === "transaction.payment_failed") return "payment.failed"
  if (type === "adjustment.created" || type === "adjustment.updated") {
    if (d.action === "refund")
      return d.status === "approved"
        ? "refund.processed"
        : d.status === "rejected"
          ? "refund.failed"
          : "unknown"
    if (d.action === "chargeback") return "dispute.opened"
    if (d.action === "chargeback_reverse") return "dispute.won"
    return "unknown"
  }
  if (type === "payout.paid") return "payout.processed"
  return SUB_EVENTS[type] ?? "unknown"
}

export function paddle(config: PaddleConfig): PaymentGateway {
  const base = () =>
    config.baseUrl ?? (config.sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com")
  const raw = jsonRaw(
    G,
    base,
    () => ({ authorization: `Bearer ${config.apiKey}`, "paddle-version": "1" }),
    config,
  )
  const one = async (path: string) => ((await raw("GET", path)) as Json).data

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
      async createCheckout(i) {
        const items = (i.extra as Json)?.items
        if (!Array.isArray(items))
          throw new PaymentsError(
            "BAD_INPUT",
            'Paddle checkout needs extra.items, e.g. [{ price_id: "pri_...", quantity: 1 }].',
            { gateway: G },
          )
        const { items: _items, ...rest } = i.extra as Json
        const r: Json = await raw("POST", "/transactions", {
          items,
          currency_code: i.currency,
          ...(i.customer?.id ? { customer_id: i.customer.id } : {}),
          custom_data: { ...i.metadata, reference: i.reference ?? i.idempotencyKey },
          ...rest,
        })
        const t = r.data
        return {
          gateway: G,
          gatewayId: t.id,
          amount: total(t) || i.amount,
          currency: t.currency_code,
          url: t.checkout?.url ?? undefined,
          raw: t,
        }
      },
      getPayment: async (id) => toPayment(await one(`/transactions/${encodeURIComponent(id)}`)),
      // Partial: items[{item_id: txnitm_..., type: "partial", amount}] from
      // data.details.line_items[].id; amounts are minor-unit strings.
      // https://developer.paddle.com/build/transactions/create-transaction-adjustments
      // https://developer.paddle.com/api-reference/adjustments/create-adjustment
      // https://github.com/PaddleHQ/paddle-node-sdk (TransactionLineItem.id, CreateAdjustmentRequestBody)
      async refund(transactionId, i) {
        let items: Json[] | undefined
        if (i.amount !== undefined) {
          const t: Json = await raw("GET", `/transactions/${encodeURIComponent(transactionId)}`)
          let left = i.amount
          items = []
          for (const li of t.data?.details?.line_items ?? []) {
            const take = Math.min(left, Number(li.totals?.total ?? 0))
            if (take > 0) items.push({ item_id: li.id, type: "partial", amount: String(take) })
            left -= take
          }
          if (left > 0)
            throw new PaymentsError(
              "BAD_INPUT",
              "Refund amount exceeds the transaction's line items.",
              {
                gateway: G,
              },
            )
        }
        const r: Json = await raw("POST", "/adjustments", {
          action: "refund",
          type: items ? "partial" : "full",
          transaction_id: transactionId,
          reason: i.reason ?? "Refund",
          ...(items ? { items } : {}),
        })
        const a = r.data
        return {
          gateway: G,
          gatewayId: a.id,
          paymentId: transactionId,
          amount: Number(a.totals?.total ?? 0),
          currency: a.currency_code,
          status:
            a.status === "approved"
              ? "processed"
              : a.status === "rejected" || a.status === "reversed"
                ? "failed"
                : "pending",
          createdAt: toDate(a.created_at),
          raw: a,
        }
      },
      async createCustomer(i) {
        if (!i.email)
          throw new PaymentsError("BAD_INPUT", "Paddle customers need an email.", { gateway: G })
        const c: Json = (
          (await raw("POST", "/customers", {
            email: i.email,
            ...(i.name ? { name: i.name } : {}),
          })) as Json
        ).data
        return {
          gateway: G,
          gatewayId: c.id,
          email: c.email,
          name: c.name ?? undefined,
          createdAt: toDate(c.created_at),
          raw: c,
        }
      },
      async listPaymentMethods(customerId) {
        const r: Json = await raw(
          "GET",
          `/customers/${encodeURIComponent(customerId)}/payment-methods`,
        )
        return (r.data ?? []).map((m: Json) => ({
          gateway: G,
          gatewayId: m.id,
          customerId,
          type: m.type,
          label: m.card?.last4 ? `${m.card.type ?? "card"} ${m.card.last4}` : undefined,
          createdAt: toDate(m.saved_at),
          raw: m,
        }))
      },
      getSubscription: async (id) => toSub(await one(`/subscriptions/${encodeURIComponent(id)}`)),
      async cancelSubscription(id, o = {}) {
        const r: Json = await raw("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, {
          effective_from: o.atPeriodEnd ? "next_billing_period" : "immediately",
        })
        return toSub(r.data)
      },
      async verifyWebhook(req, o) {
        if (!config.webhookSecret) throw badSignature(G, "no webhookSecret configured")
        const body = await req.text()
        const parts = (req.headers.get("paddle-signature") ?? "")
          .split(";")
          .map((p) => p.split("="))
        const ts = parts.find(([k]) => k === "ts")?.[1]
        const h1 = parts.filter(([k]) => k === "h1").map(([, v]) => v ?? "")
        if (!ts || !h1.length) throw badSignature(G, "missing ts or h1 in Paddle-Signature")
        const expected = await hmac("SHA-256", config.webhookSecret, `${ts}:${body}`)
        if (!h1.some((s) => safeEqual(expected, s))) throw badSignature(G)
        checkTimestamp(G, Number(ts), o)
        const e: Json = JSON.parse(body)
        const d = e.data ?? {}
        const isTxn = e.event_type.startsWith("transaction.")
        const isAdj = e.event_type.startsWith("adjustment.")
        const out: Event = {
          id: e.event_id,
          gateway: G,
          type: eventType(e.event_type, d),
          gatewayType: e.event_type,
          occurredAt: toDate(e.occurred_at),
          paymentId: isTxn ? d.id : isAdj ? d.transaction_id : undefined,
          reference: isTxn ? d.custom_data?.reference : undefined,
          refundId: isAdj && d.action === "refund" ? d.id : undefined,
          disputeId: isAdj && d.action?.startsWith("chargeback") ? d.id : undefined,
          subscriptionId: e.event_type.startsWith("subscription.")
            ? d.id
            : (d.subscription_id ?? undefined),
          payoutId: e.event_type.startsWith("payout.") ? d.id : undefined,
          amount: isTxn ? total(d) : isAdj ? Number(d.totals?.total ?? 0) : undefined,
          currency: d.currency_code,
          raw: e,
        }
        return out
      },
    },
  )
}
