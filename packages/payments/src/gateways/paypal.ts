/**
 * PayPal REST (Orders v2, Payments v2, Subscriptions v1, Payouts v1) with an
 * OAuth client-credentials token, cached until it expires. Amounts are major
 * unit strings ("10.00"); HUF and TWD take no decimals at PayPal, so an amount
 * that is not whole in those currencies is refused before any call. Writes
 * carry `PayPal-Request-Id` (your idempotency key). Checkout creates an Order
 * and returns its approval link; `gatewayId` is the order id, and capture and
 * refund find the authorization or capture inside it.
 *
 * Webhooks are verified with PayPal's own verify-webhook-signature API (one
 * call per event, needs `webhookId`), not the offline certificate check.
 *
 * Saved methods list Vault v3 payment tokens for a PayPal customer id.
 *
 * Unsupported: customers (PayPal has no customer object; vault customer ids are
 * created by vaulting), settlements (Transaction Search reports capture ids and
 * does not document how to map them back to orders).
 */

import { PaymentsError } from "../errors.js"
import {
  badSignature,
  basicAuth,
  checkTimestamp,
  defineGateway,
  type Json,
  minorDigits,
  request,
  toDate,
  toMajor,
  toMinor,
  withQuery,
} from "../http.js"
import type {
  Event,
  EventType,
  HttpOptions,
  Payment,
  PaymentGateway,
  Payout,
  Subscription,
  SubscriptionStatus,
} from "../types.js"

export type PayPalConfig = HttpOptions & {
  clientId: string
  clientSecret: string
  webhookId?: string
}

const G = "paypal"
const WHOLE_ONLY = new Set(["HUF", "TWD", "JPY"])

/** Minor units to PayPal's value string; HUF, JPY and TWD must be whole at PayPal. */
export function paypalValue(amount: number, currency: string): string {
  const d = minorDigits(currency)
  if (WHOLE_ONLY.has(currency) && d > 0) {
    if (amount % 10 ** d !== 0)
      throw new PaymentsError(
        "BAD_INPUT",
        `PayPal takes whole ${currency} only; ${amount} minor units is not whole.`,
        { gateway: G },
      )
    return String(amount / 10 ** d)
  }
  return toMajor(amount, currency)
}

const SUB: Record<string, SubscriptionStatus> = {
  APPROVAL_PENDING: "pending",
  APPROVED: "pending",
  ACTIVE: "active",
  SUSPENDED: "paused",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
}

const PAYOUT: Record<string, Payout["status"]> = {
  DENIED: "failed",
  PENDING: "pending",
  PROCESSING: "processing",
  SUCCESS: "paid",
  CANCELED: "cancelled",
}

const EVENTS: Record<string, EventType> = {
  "PAYMENT.AUTHORIZATION.CREATED": "payment.authorized",
  "PAYMENT.CAPTURE.COMPLETED": "payment.captured",
  "PAYMENT.CAPTURE.DECLINED": "payment.failed",
  "PAYMENT.CAPTURE.REFUNDED": "refund.processed",
  "PAYMENT.REFUND.FAILED": "refund.failed",
  "BILLING.SUBSCRIPTION.CREATED": "subscription.created",
  "BILLING.SUBSCRIPTION.ACTIVATED": "subscription.activated",
  "BILLING.SUBSCRIPTION.UPDATED": "subscription.updated",
  "BILLING.SUBSCRIPTION.SUSPENDED": "subscription.paused",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED": "subscription.past_due",
  "BILLING.SUBSCRIPTION.CANCELLED": "subscription.cancelled",
  "BILLING.SUBSCRIPTION.EXPIRED": "subscription.expired",
  "PAYMENT.PAYOUTSBATCH.SUCCESS": "payout.processed",
  "PAYMENT.PAYOUTSBATCH.DENIED": "payout.failed",
  "CUSTOMER.DISPUTE.CREATED": "dispute.opened",
  "CUSTOMER.DISPUTE.UPDATED": "dispute.updated",
  "CUSTOMER.DISPUTE.RESOLVED": "dispute.closed",
}

function toPayment(o: Json): Payment {
  const pu = o.purchase_units?.[0] ?? {}
  const cap = pu.payments?.captures?.[0]
  const auth = pu.payments?.authorizations?.[0]
  const cur = pu.amount?.currency_code
  const status: Payment["status"] =
    o.status === "VOIDED"
      ? "cancelled"
      : cap
        ? ((
            {
              COMPLETED: "captured",
              PARTIALLY_REFUNDED: "partially_refunded",
              REFUNDED: "refunded",
              DECLINED: "failed",
              FAILED: "failed",
            } as const
          )[cap.status as "COMPLETED"] ?? "pending")
        : auth
          ? auth.status === "CREATED"
            ? "authorized"
            : auth.status === "VOIDED"
              ? "cancelled"
              : auth.status === "DENIED"
                ? "failed"
                : "pending"
          : o.status === "CREATED"
            ? "created"
            : "pending"
  return {
    gateway: G,
    gatewayId: o.id,
    amount: cur ? toMinor(pu.amount.value, cur) : 0,
    currency: cur,
    status,
    createdAt: toDate(o.create_time),
    raw: o,
  }
}

const toSub = (s: Json): Subscription => ({
  gateway: G,
  gatewayId: s.id,
  status: SUB[s.status] ?? "pending",
  createdAt: toDate(s.create_time),
  raw: s,
})

export function paypal(config: PayPalConfig): PaymentGateway {
  const base = () =>
    config.baseUrl ??
    (config.sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com")
  let token: { value: string; expiresAt: number } | undefined

  async function auth(): Promise<string> {
    if (token && token.expiresAt - 60_000 > Date.now()) return token.value
    const r: Json = await request(
      {
        gateway: G,
        method: "POST",
        url: `${base()}/v1/oauth2/token`,
        headers: {
          authorization: basicAuth(config.clientId, config.clientSecret),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        retryable: true,
      },
      config,
    )
    token = { value: r.access_token, expiresAt: Date.now() + Number(r.expires_in) * 1000 }
    return token.value
  }

  const raw: PaymentGateway["raw"] = async (method, path, body, o = {}) => {
    const m = method.toUpperCase()
    return request(
      {
        gateway: G,
        method: m,
        url: withQuery(`${base()}${path}`, o.query),
        headers: {
          authorization: `Bearer ${await auth()}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(o.idempotencyKey ? { "paypal-request-id": o.idempotencyKey } : {}),
          ...o.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        retryable: m === "GET" || !!o.idempotencyKey,
      },
      config,
    )
  }
  const order = async (id: string) =>
    toPayment(await raw("GET", `/v2/checkout/orders/${encodeURIComponent(id)}`))

  return defineGateway(
    G,
    {
      methods: ["wallet", "card"],
      features: [
        "capture",
        "refunds",
        "partialRefunds",
        "savedMethods",
        "subscriptions",
        "payouts",
        "webhooks",
      ],
    },
    {
      raw,
      async createCheckout(i) {
        const o: Json = await raw(
          "POST",
          "/v2/checkout/orders",
          {
            intent: i.capture === "manual" ? "AUTHORIZE" : "CAPTURE",
            purchase_units: [
              {
                amount: { currency_code: i.currency, value: paypalValue(i.amount, i.currency) },
                custom_id: i.reference ?? i.idempotencyKey,
                ...(i.description ? { description: i.description } : {}),
              },
            ],
            ...i.extra,
          },
          { idempotencyKey: i.idempotencyKey },
        )
        const link = (o.links ?? []).find(
          (l: Json) => l.rel === "approve" || l.rel === "payer-action",
        )
        return {
          gateway: G,
          gatewayId: o.id,
          amount: i.amount,
          currency: i.currency,
          url: link?.href,
          raw: o,
        }
      },
      getPayment: order,
      async capture(id, i) {
        const p = await order(id)
        const auth = (p.raw as Json).purchase_units?.[0]?.payments?.authorizations?.[0]
        if (auth)
          await raw(
            "POST",
            `/v2/payments/authorizations/${encodeURIComponent(auth.id)}/capture`,
            {
              ...(i.amount !== undefined
                ? {
                    amount: { currency_code: p.currency, value: paypalValue(i.amount, p.currency) },
                  }
                : {}),
              final_capture: true,
            },
            { idempotencyKey: i.idempotencyKey },
          )
        else
          await raw(
            "POST",
            `/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
            {},
            { idempotencyKey: i.idempotencyKey },
          )
        return order(id)
      },
      async refund(orderId, i) {
        const p = await order(orderId)
        const cap = (p.raw as Json).purchase_units?.[0]?.payments?.captures?.[0]
        if (!cap)
          throw new PaymentsError(
            "BAD_INPUT",
            `paypal: order ${orderId} has no capture to refund.`,
            { gateway: G },
          )
        const r: Json = await raw(
          "POST",
          `/v2/payments/captures/${encodeURIComponent(cap.id)}/refund`,
          i.amount !== undefined
            ? { amount: { currency_code: p.currency, value: paypalValue(i.amount, p.currency) } }
            : {},
          { idempotencyKey: i.idempotencyKey, headers: { prefer: "return=representation" } },
        )
        return {
          gateway: G,
          gatewayId: r.id,
          paymentId: orderId,
          amount: r.amount
            ? toMinor(r.amount.value, r.amount.currency_code)
            : (i.amount ?? p.amount),
          currency: p.currency,
          status:
            r.status === "COMPLETED"
              ? "processed"
              : r.status === "FAILED" || r.status === "CANCELLED"
                ? "failed"
                : "pending",
          createdAt: toDate(r.create_time),
          raw: r,
        }
      },
      getSubscription: async (id) =>
        toSub(await raw("GET", `/v1/billing/subscriptions/${encodeURIComponent(id)}`)),
      async cancelSubscription(id) {
        // PayPal cancels immediately; the reason is required.
        await raw("POST", `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, {
          reason: "Cancelled by merchant",
        })
        return toSub(await raw("GET", `/v1/billing/subscriptions/${encodeURIComponent(id)}`))
      },
      async createPayout(i) {
        const r: Json = await raw(
          "POST",
          "/v1/payments/payouts",
          {
            sender_batch_header: { sender_batch_id: i.idempotencyKey },
            items: [
              {
                recipient_type: "EMAIL",
                receiver: i.destination,
                amount: { currency: i.currency, value: paypalValue(i.amount, i.currency) },
                ...(i.reference ? { sender_item_id: i.reference } : {}),
              },
            ],
            ...i.extra,
          },
          { idempotencyKey: i.idempotencyKey },
        )
        const h = r.batch_header ?? {}
        return {
          gateway: G,
          gatewayId: h.payout_batch_id,
          amount: i.amount,
          currency: i.currency,
          status: PAYOUT[h.batch_status] ?? "pending",
          createdAt: toDate(h.time_created),
          raw: r,
        }
      },
      // GET /v3/vault/payment-tokens?customer_id=...: payment_tokens[] with
      // payment_source.card{brand,last_digits} or .paypal{email_address}; no create time.
      // https://developer.paypal.com/docs/api/payment-tokens/v3/#customer_payment-tokens_get
      // https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/vault_payment_tokens_v3.json
      async listPaymentMethods(customerId) {
        const r: Json = await raw("GET", "/v3/vault/payment-tokens", undefined, {
          query: { customer_id: customerId },
        })
        return (r.payment_tokens ?? []).map((t: Json) => {
          const card = t.payment_source?.card
          const pp = t.payment_source?.paypal
          return {
            gateway: G,
            gatewayId: t.id,
            customerId: t.customer?.id ?? customerId,
            type: card
              ? "card"
              : pp
                ? "paypal"
                : (Object.keys(t.payment_source ?? {})[0] ?? "unknown"),
            label: card
              ? [card.brand, card.last_digits].filter(Boolean).join(" ")
              : (pp?.email_address ?? undefined),
            createdAt: toDate(undefined),
            raw: t,
          }
        })
      },
      async verifyWebhook(req, o) {
        if (!config.webhookId) throw badSignature(G, "no webhookId configured")
        const body = await req.text()
        const h = (n: string) => req.headers.get(n) ?? ""
        const event: Json = JSON.parse(body)
        const time = h("paypal-transmission-time")
        if (!time || !h("paypal-transmission-sig"))
          throw badSignature(G, "missing PayPal transmission headers")
        checkTimestamp(G, Date.parse(time) / 1000, o)
        const r: Json = await raw("POST", "/v1/notifications/verify-webhook-signature", {
          auth_algo: h("paypal-auth-algo"),
          cert_url: h("paypal-cert-url"),
          transmission_id: h("paypal-transmission-id"),
          transmission_sig: h("paypal-transmission-sig"),
          transmission_time: time,
          webhook_id: config.webhookId,
          webhook_event: event,
        })
        if (r?.verification_status !== "SUCCESS") throw badSignature(G)
        const res = event.resource ?? {}
        const t: string = event.event_type
        const money =
          res.amount?.value !== undefined
            ? {
                amount: toMinor(res.amount.value, res.amount.currency_code),
                currency: res.amount.currency_code,
              }
            : {}
        // Captures carry their order in supplementary_data.related_ids.order_id;
        // if a payload lacks it, read the capture.
        // https://developer.paypal.com/docs/api/payments/v2/#captures_get
        let orderId: string | undefined = res.supplementary_data?.related_ids?.order_id
        if (!orderId && t.startsWith("PAYMENT.CAPTURE.") && res.id && !t.endsWith("REFUNDED")) {
          const c: Json = await raw("GET", `/v2/payments/captures/${encodeURIComponent(res.id)}`)
          orderId = c?.supplementary_data?.related_ids?.order_id
        }
        const out: Event = {
          id: event.id,
          gateway: G,
          type: EVENTS[t] ?? "unknown",
          gatewayType: t,
          occurredAt: toDate(event.create_time),
          paymentId: orderId,
          orderId,
          reference: res.custom_id,
          refundId:
            t.startsWith("PAYMENT.CAPTURE.REFUNDED") || t.startsWith("PAYMENT.REFUND.")
              ? res.id
              : undefined,
          subscriptionId: t.startsWith("BILLING.SUBSCRIPTION.") ? res.id : undefined,
          payoutId: t.startsWith("PAYMENT.PAYOUTSBATCH.")
            ? res.batch_header?.payout_batch_id
            : undefined,
          disputeId: t.startsWith("CUSTOMER.DISPUTE.") ? res.dispute_id : undefined,
          ...money,
          raw: event,
        }
        return out
      },
    },
  )
}
