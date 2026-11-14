/**
 * Stripe over its REST API (api.stripe.com/v1, form-encoded bodies, bearer
 * secret key, `Stripe-Version` pinned). Test and live share the host; the key
 * decides. Checkout creates a PaymentIntent and returns its client secret for
 * Stripe Elements. Webhooks: `Stripe-Signature: t=..,v1=..`, HMAC-SHA256 hex of
 * `${t}.${rawBody}` with the endpoint secret; only `v1` is trusted, and the
 * timestamp must be within the tolerance (default 300 s).
 */

import {
  badSignature,
  checkTimestamp,
  defineGateway,
  formEncode,
  hmac,
  type Json,
  request,
  safeEqual,
  toDate,
  withQuery,
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

export const STRIPE_API_VERSION = "2026-10-28.endive"

export type StripeConfig = HttpOptions & {
  secretKey: string
  webhookSecret?: string
  /** Default `STRIPE_API_VERSION`, the version this adapter was checked against. */
  apiVersion?: string
}

const G = "stripe"

const PI: Record<string, PaymentStatus> = {
  requires_payment_method: "created",
  requires_confirmation: "pending",
  requires_action: "pending",
  processing: "pending",
  requires_capture: "authorized",
  succeeded: "captured",
  canceled: "cancelled",
}

const SUB: Record<string, SubscriptionStatus> = {
  incomplete: "pending",
  incomplete_expired: "expired",
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  paused: "paused",
  canceled: "cancelled",
}

const PAYOUT: Record<string, Payout["status"]> = {
  pending: "pending",
  in_transit: "processing",
  paid: "paid",
  failed: "failed",
  canceled: "cancelled",
}

const up = (c: string) => String(c).toUpperCase()

const toPayment = (pi: Json): Payment => {
  const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : undefined
  const refunded: number = charge?.amount_refunded ?? 0
  const base = PI[pi.status] ?? "pending"
  return {
    gateway: G,
    gatewayId: pi.id,
    amount: pi.amount,
    currency: up(pi.currency),
    status:
      base === "captured" && refunded > 0
        ? refunded >= pi.amount_received
          ? "refunded"
          : "partially_refunded"
        : base,
    method: charge?.payment_method_details?.type ?? pi.payment_method_types?.[0],
    customerId: typeof pi.customer === "string" ? pi.customer : (pi.customer?.id ?? undefined),
    fee:
      typeof charge?.balance_transaction === "object" ? charge.balance_transaction.fee : undefined,
    amountRefunded: charge ? refunded : undefined,
    createdAt: toDate(pi.created),
    raw: pi,
  }
}

const toRefund = (r: Json): Refund => ({
  gateway: G,
  gatewayId: r.id,
  paymentId: typeof r.payment_intent === "string" ? r.payment_intent : r.payment_intent?.id,
  amount: r.amount,
  currency: up(r.currency),
  status:
    r.status === "succeeded"
      ? "processed"
      : r.status === "failed" || r.status === "canceled"
        ? "failed"
        : "pending",
  createdAt: toDate(r.created),
  raw: r,
})

const toSub = (s: Json): Subscription => {
  const end = s.items?.data?.[0]?.current_period_end ?? s.current_period_end
  return {
    gateway: G,
    gatewayId: s.id,
    status: SUB[s.status] ?? "pending",
    customerId: typeof s.customer === "string" ? s.customer : s.customer?.id,
    currentPeriodEnd: end ? toDate(end) : undefined,
    createdAt: toDate(s.created),
    raw: s,
  }
}

function eventType(type: string, o: Json): EventType {
  switch (type) {
    case "payment_intent.amount_capturable_updated":
      return "payment.authorized"
    case "payment_intent.succeeded":
      return "payment.captured"
    case "payment_intent.payment_failed":
      return "payment.failed"
    case "refund.created":
    case "refund.updated":
      return o.status === "succeeded"
        ? "refund.processed"
        : o.status === "failed"
          ? "refund.failed"
          : "unknown"
    case "refund.failed":
      return "refund.failed"
    case "customer.subscription.created":
      return "subscription.created"
    case "customer.subscription.updated":
      return o.status === "past_due" ? "subscription.past_due" : "subscription.updated"
    case "customer.subscription.paused":
      return "subscription.paused"
    case "customer.subscription.resumed":
      return "subscription.resumed"
    case "customer.subscription.deleted":
      return "subscription.cancelled"
    case "payout.paid":
      return "payout.processed"
    case "payout.failed":
      return "payout.failed"
    case "charge.dispute.created":
      return "dispute.opened"
    case "charge.dispute.updated":
      return "dispute.updated"
    case "charge.dispute.closed":
      return o.status === "won"
        ? "dispute.won"
        : o.status === "lost"
          ? "dispute.lost"
          : "dispute.closed"
    default:
      return "unknown"
  }
}

export function stripe(config: StripeConfig): PaymentGateway {
  const base = () => config.baseUrl ?? "https://api.stripe.com/v1"
  const raw: PaymentGateway["raw"] = async (method, path, body, o = {}) => {
    const m = method.toUpperCase()
    const isGet = m === "GET" || m === "DELETE"
    const params = body as Record<string, unknown> | undefined
    return request(
      {
        gateway: G,
        method: m,
        url: withQuery(
          `${base()}${path}${isGet && params ? `?${formEncode(params)}` : ""}`,
          o.query,
        ),
        headers: {
          authorization: `Bearer ${config.secretKey}`,
          "stripe-version": config.apiVersion ?? STRIPE_API_VERSION,
          ...(!isGet && params ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          ...(o.idempotencyKey ? { "idempotency-key": o.idempotencyKey } : {}),
          ...o.headers,
        },
        body: !isGet && params ? formEncode(params) : undefined,
        retryable: m === "GET" || !!o.idempotencyKey,
      },
      config,
    )
  }
  const pi = async (id: string) =>
    toPayment(
      await raw("GET", `/payment_intents/${encodeURIComponent(id)}`, {
        expand: ["latest_charge.balance_transaction"],
      }),
    )

  return defineGateway(
    G,
    {
      methods: ["card", "wallet"],
      features: [
        "capture",
        "refunds",
        "partialRefunds",
        "customers",
        "savedMethods",
        "subscriptions",
        "payouts",
        "settlements",
        "webhooks",
      ],
    },
    {
      raw,
      async createCheckout(i) {
        const p: Json = await raw(
          "POST",
          "/payment_intents",
          {
            amount: i.amount,
            currency: i.currency.toLowerCase(),
            capture_method: i.capture === "manual" ? "manual" : "automatic",
            automatic_payment_methods: { enabled: true },
            ...(i.customer?.id ? { customer: i.customer.id } : {}),
            ...(i.description ? { description: i.description } : {}),
            metadata: { ...i.metadata, ...(i.reference ? { reference: i.reference } : {}) },
            ...i.extra,
          },
          { idempotencyKey: i.idempotencyKey },
        )
        return {
          gateway: G,
          gatewayId: p.id,
          amount: p.amount,
          currency: up(p.currency),
          clientSecret: p.client_secret,
          raw: p,
        }
      },
      getPayment: pi,
      async capture(id, i) {
        await raw(
          "POST",
          `/payment_intents/${encodeURIComponent(id)}/capture`,
          i.amount !== undefined ? { amount_to_capture: i.amount } : {},
          { idempotencyKey: i.idempotencyKey },
        )
        return pi(id)
      },
      async refund(paymentId, i) {
        return toRefund(
          await raw(
            "POST",
            "/refunds",
            {
              payment_intent: paymentId,
              ...(i.amount !== undefined ? { amount: i.amount } : {}),
              ...(i.reason ? { metadata: { reason: i.reason } } : {}),
            },
            { idempotencyKey: i.idempotencyKey },
          ),
        )
      },
      async createCustomer(i) {
        const c: Json = await raw("POST", "/customers", { ...i })
        return {
          gateway: G,
          gatewayId: c.id,
          email: c.email ?? undefined,
          name: c.name ?? undefined,
          phone: c.phone ?? undefined,
          createdAt: toDate(c.created),
          raw: c,
        }
      },
      async listPaymentMethods(customerId) {
        const r: Json = await raw(
          "GET",
          `/customers/${encodeURIComponent(customerId)}/payment_methods`,
          { limit: 100 },
        )
        return (r.data ?? []).map((m: Json) => ({
          gateway: G,
          gatewayId: m.id,
          customerId,
          type: m.type,
          label: m.card ? `${m.card.brand} ${m.card.last4}` : undefined,
          createdAt: toDate(m.created),
          raw: m,
        }))
      },
      async getSubscription(id) {
        return toSub(await raw("GET", `/subscriptions/${encodeURIComponent(id)}`))
      },
      async cancelSubscription(id, o = {}) {
        const path = `/subscriptions/${encodeURIComponent(id)}`
        return toSub(
          o.atPeriodEnd
            ? await raw("POST", path, { cancel_at_period_end: true })
            : await raw("DELETE", path),
        )
      },
      async createPayout(i) {
        const p: Json = await raw(
          "POST",
          "/payouts",
          {
            amount: i.amount,
            currency: i.currency.toLowerCase(),
            destination: i.destination,
            ...(i.reference ? { metadata: { reference: i.reference } } : {}),
            ...i.extra,
          },
          { idempotencyKey: i.idempotencyKey },
        )
        return {
          gateway: G,
          gatewayId: p.id,
          amount: p.amount,
          currency: up(p.currency),
          status: PAYOUT[p.status] ?? "pending",
          createdAt: toDate(p.created),
          raw: p,
        }
      },
      async listSettlements({ date }) {
        // Balance transactions created on that UTC day, with their source expanded
        // so charges and refunds map back to the PaymentIntent.
        const from = Date.parse(`${date}T00:00:00Z`) / 1000
        const all: Json[] = []
        let after: string | undefined
        for (;;) {
          const r: Json = await raw("GET", "/balance_transactions", {
            created: { gte: from, lt: from + 86_400 },
            limit: 100,
            expand: ["data.source"],
            ...(after ? { starting_after: after } : {}),
          })
          all.push(...r.data)
          if (!r.has_more || !r.data.length) break
          after = r.data[r.data.length - 1].id
        }
        const lines: SettlementLine[] = all.map((t) => {
          const src = typeof t.source === "object" ? t.source : undefined
          const kind =
            t.type === "charge" || t.type === "payment"
              ? "payment"
              : t.type === "refund" || t.type === "payment_refund"
                ? "refund"
                : t.type === "payout"
                  ? "payout"
                  : t.type === "adjustment"
                    ? "adjustment"
                    : "other"
          const piId = src?.payment_intent
          return {
            kind,
            gatewayId: src?.id ?? t.source ?? t.id,
            paymentId: typeof piId === "string" ? piId : piId?.id,
            amount: Math.abs(t.amount),
            currency: up(t.currency),
            fee: t.fee,
            createdAt: toDate(t.created),
            raw: t,
          }
        })
        return [{ gateway: G, date, lines, raw: all }]
      },
      async verifyWebhook(req, o) {
        if (!config.webhookSecret) throw badSignature(G, "no webhookSecret configured")
        const body = await req.text()
        const parts = (req.headers.get("stripe-signature") ?? "")
          .split(",")
          .map((p) => p.split("="))
        const t = parts.find(([k]) => k === "t")?.[1]
        const v1 = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "")
        if (!t || !v1.length) throw badSignature(G, "missing t or v1 in Stripe-Signature")
        const expected = await hmac("SHA-256", config.webhookSecret, `${t}.${body}`)
        if (!v1.some((s) => safeEqual(expected, s))) throw badSignature(G)
        checkTimestamp(G, Number(t), o)
        const e: Json = JSON.parse(body)
        const obj = e.data?.object ?? {}
        const kind = obj.object as string
        const pid = (v: Json) => (typeof v === "string" ? v : v?.id)
        const out: Event = {
          id: e.id,
          gateway: G,
          type: eventType(e.type, obj),
          gatewayType: e.type,
          occurredAt: toDate(e.created),
          paymentId: kind === "payment_intent" ? obj.id : pid(obj.payment_intent),
          refundId: kind === "refund" ? obj.id : undefined,
          subscriptionId: kind === "subscription" ? obj.id : undefined,
          payoutId: kind === "payout" ? obj.id : undefined,
          disputeId: kind === "dispute" ? obj.id : undefined,
          amount: kind === "payment_intent" ? obj.amount_received || obj.amount : obj.amount,
          currency: obj.currency ? up(obj.currency) : undefined,
          raw: e,
        }
        return out
      },
    },
  )
}
