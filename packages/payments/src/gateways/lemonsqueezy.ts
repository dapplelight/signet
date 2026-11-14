/**
 * Lemon Squeezy over its JSON:API (api.lemonsqueezy.com/v1, bearer key; test
 * mode is chosen by the key). Checkout creates a checkout for a variant with a
 * `custom_price` in cents, carrying your reference in `checkout_data.custom` so
 * the `order_created` webhook links back to it. Payments are Orders.
 *
 * Webhooks: `X-Signature` = HMAC-SHA256 hex of the raw body with the signing
 * secret. There is no timestamp and no event id, so the inbox id is built from
 * the event name, resource id and `updated_at`.
 *
 * Refund ids are `<order>:refund:<refunded_amount after it>`, so a refund made
 * here and its `order_refunded` webhook share an id. The webhook only carries
 * the cumulative `refunded_amount`.
 * ponytail: a second partial refund made outside this package (Dashboard)
 * arrives with the cumulative amount and over-counts the ledger; refund through
 * this package, or post a correction, until Lemon Squeezy sends per-refund amounts.
 *
 * Unsupported: capture, saved methods, payouts and settlements (no API).
 */

import { PaymentsError } from "../errors.js"
import {
  badSignature,
  defineGateway,
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
  Subscription,
  SubscriptionStatus,
} from "../types.js"

export type LemonSqueezyConfig = HttpOptions & {
  apiKey: string
  storeId: string
  /** The store's currency; checkouts are priced in it. */
  currency: string
  /** Default variant for checkouts (override with `extra.variantId`). */
  variantId?: string
  webhookSecret?: string
}

const G = "lemonsqueezy"

const ORDER: Record<string, PaymentStatus> = {
  pending: "pending",
  paid: "captured",
  failed: "failed",
  fraudulent: "failed",
  refunded: "refunded",
  partial_refund: "partially_refunded",
}

const SUB: Record<string, SubscriptionStatus> = {
  on_trial: "trialing",
  active: "active",
  paused: "paused",
  past_due: "past_due",
  unpaid: "past_due",
  cancelled: "cancelled",
  expired: "expired",
}

const EVENTS: Record<string, EventType> = {
  order_refunded: "refund.processed",
  subscription_created: "subscription.created",
  subscription_updated: "subscription.updated",
  subscription_cancelled: "subscription.cancelled",
  subscription_resumed: "subscription.resumed",
  subscription_expired: "subscription.expired",
  subscription_paused: "subscription.paused",
  subscription_unpaused: "subscription.resumed",
  subscription_payment_success: "subscription.charged",
  subscription_payment_failed: "subscription.past_due",
}

const toPayment = (d: Json): Payment => ({
  gateway: G,
  gatewayId: String(d.id),
  amount: d.attributes.total,
  currency: d.attributes.currency,
  status: ORDER[d.attributes.status] ?? "pending",
  customerId: d.attributes.customer_id != null ? String(d.attributes.customer_id) : undefined,
  amountRefunded: d.attributes.refunded_amount ?? undefined,
  createdAt: toDate(d.attributes.created_at),
  raw: d,
})

const toSub = (d: Json): Subscription => ({
  gateway: G,
  gatewayId: String(d.id),
  status: SUB[d.attributes.status] ?? "pending",
  customerId: d.attributes.customer_id != null ? String(d.attributes.customer_id) : undefined,
  currentPeriodEnd: d.attributes.renews_at
    ? toDate(d.attributes.renews_at)
    : d.attributes.ends_at
      ? toDate(d.attributes.ends_at)
      : undefined,
  createdAt: toDate(d.attributes.created_at),
  raw: d,
})

export function lemonsqueezy(config: LemonSqueezyConfig): PaymentGateway {
  const base = () => config.baseUrl ?? "https://api.lemonsqueezy.com/v1"
  const store = { store: { data: { type: "stores", id: config.storeId } } }
  const raw: PaymentGateway["raw"] = async (method, path, body, o = {}) => {
    const m = method.toUpperCase()
    return request(
      {
        gateway: G,
        method: m,
        url: withQuery(`${base()}${path}`, o.query),
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          accept: "application/vnd.api+json",
          ...(body !== undefined ? { "content-type": "application/vnd.api+json" } : {}),
          ...o.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        retryable: m === "GET" || !!o.idempotencyKey,
      },
      config,
    )
  }
  const one = async (path: string) => ((await raw("GET", path)) as Json).data

  return defineGateway(
    G,
    {
      methods: ["card", "wallet"],
      features: ["refunds", "partialRefunds", "customers", "subscriptions", "webhooks"],
      currencies: [config.currency],
    },
    {
      raw,
      async createCheckout(i) {
        const variant = (i.extra?.variantId as string | undefined) ?? config.variantId
        if (!variant)
          throw new PaymentsError(
            "BAD_INPUT",
            "Lemon Squeezy checkout needs a variant: config.variantId or extra.variantId.",
            { gateway: G },
          )
        const r: Json = await raw("POST", "/checkouts", {
          data: {
            type: "checkouts",
            attributes: {
              custom_price: i.amount,
              checkout_data: {
                ...(i.customer?.email ? { email: i.customer.email } : {}),
                ...(i.customer?.name ? { name: i.customer.name } : {}),
                custom: { ...i.metadata, reference: i.reference ?? i.idempotencyKey },
              },
            },
            relationships: { ...store, variant: { data: { type: "variants", id: variant } } },
          },
        })
        return {
          gateway: G,
          gatewayId: String(r.data.id),
          amount: i.amount,
          currency: config.currency,
          url: r.data.attributes.url,
          raw: r.data,
        }
      },
      getPayment: async (id) => toPayment(await one(`/orders/${encodeURIComponent(id)}`)),
      // Partial refund: attributes.amount in cents (minor units); omitted = full.
      // https://docs.lemonsqueezy.com/api/orders/issue-refund
      // https://github.com/lmsqueezy/lemonsqueezy.js/blob/main/src/orders/index.ts (issueOrderRefund: "The amount in cents")
      async refund(orderId, i) {
        const r: Json = await raw("POST", `/orders/${encodeURIComponent(orderId)}/refund`, {
          data: {
            type: "orders",
            id: orderId,
            attributes: i.amount !== undefined ? { amount: i.amount } : {},
          },
        })
        const p = toPayment(r.data)
        return {
          gateway: G,
          gatewayId: `${orderId}:refund:${p.amountRefunded ?? p.amount}`,
          paymentId: orderId,
          amount: i.amount ?? p.amountRefunded ?? p.amount,
          currency: p.currency,
          status:
            p.status === "refunded" || p.status === "partially_refunded" ? "processed" : "pending",
          createdAt: toDate(r.data.attributes.refunded_at ?? r.data.attributes.updated_at),
          raw: r.data,
        }
      },
      async createCustomer(i) {
        if (!i.email || !i.name)
          throw new PaymentsError(
            "BAD_INPUT",
            "Lemon Squeezy customers need a name and an email.",
            { gateway: G },
          )
        const r: Json = await raw("POST", "/customers", {
          data: {
            type: "customers",
            attributes: { name: i.name, email: i.email },
            relationships: store,
          },
        })
        return {
          gateway: G,
          gatewayId: String(r.data.id),
          email: r.data.attributes.email,
          name: r.data.attributes.name,
          createdAt: toDate(r.data.attributes.created_at),
          raw: r.data,
        }
      },
      getSubscription: async (id) => toSub(await one(`/subscriptions/${encodeURIComponent(id)}`)),
      // Lemon Squeezy cancels at the end of the period (status cancelled until ends_at).
      cancelSubscription: async (id) =>
        toSub(((await raw("DELETE", `/subscriptions/${encodeURIComponent(id)}`)) as Json).data),
      async verifyWebhook(req) {
        if (!config.webhookSecret) throw badSignature(G, "no webhookSecret configured")
        const body = await req.text()
        if (
          !safeEqual(
            await hmac("SHA-256", config.webhookSecret, body),
            req.headers.get("x-signature") ?? "",
          )
        )
          throw badSignature(G)
        const e: Json = JSON.parse(body)
        const name: string = e.meta?.event_name ?? req.headers.get("x-event-name") ?? ""
        const d = e.data ?? {}
        const a = d.attributes ?? {}
        const isOrder = d.type === "orders"
        const type: EventType =
          name === "order_created"
            ? a.status === "paid"
              ? "payment.captured"
              : a.status === "failed"
                ? "payment.failed"
                : "unknown"
            : (EVENTS[name] ?? "unknown")
        const out: Event = {
          id: `${name}:${d.id}:${a.updated_at ?? ""}`,
          gateway: G,
          type,
          gatewayType: name,
          occurredAt: toDate(a.updated_at ?? a.created_at),
          paymentId: isOrder ? String(d.id) : a.order_id != null ? String(a.order_id) : undefined,
          reference: e.meta?.custom_data?.reference,
          refundId: name === "order_refunded" ? `${d.id}:refund:${a.refunded_amount}` : undefined,
          subscriptionId:
            d.type === "subscriptions"
              ? String(d.id)
              : a.subscription_id != null
                ? String(a.subscription_id)
                : undefined,
          amount: name === "order_refunded" ? a.refunded_amount : isOrder ? a.total : undefined,
          currency: a.currency,
          raw: e,
        }
        return out
      },
    },
  )
}
