/**
 * PhonePe PG, Standard Checkout v2: an OAuth client-credentials token
 * (`/v1/oauth/token`, form body, cached until `expires_at`) sent as
 * `Authorization: O-Bearer <token>`. Amounts are integer paise; INR only.
 * Checkout returns PhonePe's `redirectUrl`; `gatewayId` is your
 * `merchantOrderId`. The old X-VERIFY salt flow is deprecated and not used.
 *
 * Webhooks: the `Authorization` header is hex SHA-256 of `username:password`
 * (the webhook credentials set in the PhonePe dashboard); pass them as
 * `webhookUsername` / `webhookPassword`. PhonePe sends no event id or event
 * time, so the event id is derived and `occurredAt` is the receive time. The
 * header does not sign the body, so `verifyWebhook` re-reads the order or
 * refund status from the API and builds the event from that. The newer checksum-header mode is not
 * supported (its algorithm is not documented).
 *
 * Subscriptions (Autopay v2): get and cancel by `merchantSubscriptionId`.
 * Creating one is a UPI-intent setup order; use `raw` for `/subscriptions/v2/setup`.
 *
 * Unsupported: capture (no auth/capture in Standard Checkout), customers, saved
 * methods, payouts (no PG API), settlements (only per-settlement totals, no
 * per-payment lines).
 */

import { PaymentsError } from "../errors.js"
import {
  badSignature,
  defineGateway,
  type Json,
  request,
  safeEqual,
  sha256Hex,
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
  Refund,
  Subscription,
  SubscriptionStatus,
} from "../types.js"

export type PhonePeConfig = HttpOptions & {
  clientId: string
  clientSecret: string
  clientVersion: string | number
  /** Webhook credentials from the PhonePe dashboard. Both needed for `verifyWebhook`. */
  webhookUsername?: string
  webhookPassword?: string
}

const G = "phonepe"

const STATE: Record<string, PaymentStatus> = {
  PENDING: "pending",
  COMPLETED: "captured",
  FAILED: "failed",
}

// Subscription `state` values, from
// https://developer.phonepe.com/payment-gateway/autopay/api-integration/api-reference/subscription-status
// The *_IN_PROGRESS states keep the current status until PhonePe finishes.
const SUB: Record<string, SubscriptionStatus> = {
  ACTIVATION_IN_PROGRESS: "pending",
  ACTIVE: "active",
  EXPIRED: "expired",
  FAILED: "cancelled",
  CANCEL_IN_PROGRESS: "active",
  CANCELLED: "cancelled",
  REVOKE_IN_PROGRESS: "active",
  REVOKED: "cancelled",
  PAUSE_IN_PROGRESS: "active",
  PAUSED: "paused",
  UNPAUSE_IN_PROGRESS: "paused",
}

// The docs send `event` (checkout.order.completed); the Node SDK model only has
// `type` (CHECKOUT_ORDER_COMPLETED). Both normalise to the same name.
function eventType(name: string, state: string): EventType {
  if (/^(CHECKOUT|PG)_ORDER_COMPLETED$/.test(name))
    return state === "COMPLETED" ? "payment.captured" : "unknown"
  if (/^(CHECKOUT|PG)_ORDER_FAILED$/.test(name)) return "payment.failed"
  if (name === "PG_REFUND_COMPLETED") return state === "COMPLETED" ? "refund.processed" : "unknown"
  if (name === "PG_REFUND_FAILED") return "refund.failed"
  return "unknown"
}

export function phonepe(config: PhonePeConfig): PaymentGateway {
  const base = () =>
    config.baseUrl ??
    (config.sandbox
      ? "https://api-preprod.phonepe.com/apis/pg-sandbox"
      : "https://api.phonepe.com/apis/pg")
  const tokenUrl = config.sandbox
    ? "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token"
    : "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
  let token: { value: string; expiresAt: number } | undefined

  async function auth(): Promise<string> {
    if (token && token.expiresAt - 60 > Date.now() / 1000) return token.value
    const r: Json = await request(
      {
        gateway: G,
        method: "POST",
        url: tokenUrl,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_version: String(config.clientVersion),
          client_secret: config.clientSecret,
          grant_type: "client_credentials",
        }).toString(),
        retryable: true,
      },
      config,
    )
    token = { value: r.access_token, expiresAt: Number(r.expires_at) || Date.now() / 1000 + 600 }
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
          authorization: `O-Bearer ${await auth()}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...o.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        retryable: m === "GET" || !!o.idempotencyKey,
      },
      config,
    )
  }

  const status = async (id: string): Promise<Payment> => {
    const r: Json = await raw(
      "GET",
      `/checkout/v2/order/${encodeURIComponent(id)}/status`,
      undefined,
      { query: { details: "true" } },
    )
    const last = r.paymentDetails?.[r.paymentDetails.length - 1]
    return {
      gateway: G,
      gatewayId: id,
      orderId: r.orderId,
      amount: Number(r.amount),
      currency: "INR",
      status: STATE[r.state] ?? "pending",
      method: last?.paymentMode,
      createdAt: toDate(r.paymentDetails?.[0]?.timestamp),
      raw: r,
    }
  }

  // SubscriptionStatusResponseV2 has no created time or period end.
  const subscription = async (id: string): Promise<Subscription> => {
    const r: Json = await raw("GET", `/subscriptions/v2/${encodeURIComponent(id)}/status`)
    return {
      gateway: G,
      gatewayId: r.merchantSubscriptionId ?? id,
      status: SUB[r.state] ?? "pending",
      createdAt: toDate(undefined),
      raw: r,
    }
  }

  return defineGateway(
    G,
    {
      methods: ["upi", "card", "netbanking"],
      features: ["refunds", "partialRefunds", "subscriptions", "webhooks"],
      currencies: ["INR"],
    },
    {
      raw,
      async createCheckout(i) {
        if (!i.returnUrl)
          throw new PaymentsError("BAD_INPUT", "PhonePe checkout needs returnUrl.", { gateway: G })
        const merchantOrderId = i.reference ?? i.idempotencyKey
        // merchantOrderId is unique per order: PhonePe rejects a second create, so a retry cannot charge twice.
        const r: Json = await raw(
          "POST",
          "/checkout/v2/pay",
          {
            merchantOrderId,
            amount: i.amount,
            paymentFlow: {
              type: "PG_CHECKOUT",
              ...(i.description ? { message: i.description } : {}),
              merchantUrls: { redirectUrl: i.returnUrl },
            },
            ...i.extra,
          },
          { idempotencyKey: i.idempotencyKey },
        )
        return {
          gateway: G,
          gatewayId: merchantOrderId,
          amount: i.amount,
          currency: "INR",
          url: r.redirectUrl,
          raw: r,
        }
      },
      getPayment: status,
      async refund(orderId, i) {
        const amount = i.amount ?? (await status(orderId)).amount
        const r: Json = await raw(
          "POST",
          "/payments/v2/refund",
          { merchantRefundId: i.idempotencyKey, originalMerchantOrderId: orderId, amount },
          { idempotencyKey: i.idempotencyKey },
        )
        const out: Refund = {
          gateway: G,
          gatewayId: i.idempotencyKey,
          paymentId: orderId,
          amount: Number(r.amount ?? amount),
          currency: "INR",
          status:
            r.state === "COMPLETED" ? "processed" : r.state === "FAILED" ? "failed" : "pending",
          createdAt: new Date(),
          raw: r,
        }
        return out
      },
      // https://developer.phonepe.com/payment-gateway/autopay/api-integration/api-reference/subscription-status
      // https://github.com/PhonePe/phonepe-pg-sdk-java (subscription/v2/SubscriptionConstants.java, SubscriptionStatusResponseV2)
      getSubscription: subscription,
      // POST .../cancel has no body and answers 204; the status follows.
      // https://developer.phonepe.com/payment-gateway/autopay/api-integration/api-reference/subscription-cancel
      // https://github.com/PhonePe/phonepe-pg-sdk-java (SubscriptionClient.cancelSubscription)
      async cancelSubscription(id, o) {
        if (o?.atPeriodEnd)
          throw new PaymentsError("BAD_INPUT", "PhonePe cancels subscriptions immediately.", {
            gateway: G,
          })
        await raw("POST", `/subscriptions/v2/${encodeURIComponent(id)}/cancel`)
        return subscription(id)
      },
      // Authorization = hex SHA-256 of "username:password", compared whole.
      // https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook
      // https://github.com/PhonePe/phonepe-pg-sdk-python (phonepe/sdk/pg/common/utils/hash_utils.py)
      // https://github.com/PhonePe/phonepe-pg-sdk-node (CommonUtils.isCallbackValid)
      async verifyWebhook(req) {
        if (!config.webhookUsername || !config.webhookPassword)
          throw badSignature(G, "no webhookUsername/webhookPassword configured")
        const body = await req.text()
        const expected = await sha256Hex(`${config.webhookUsername}:${config.webhookPassword}`)
        if (!safeEqual(expected, req.headers.get("authorization") ?? "")) throw badSignature(G)
        // The header is a static credential, not a signature over the body, so
        // the body is not trusted: amounts and states come from a status call.
        const e: Json = JSON.parse(body)
        const p = e.payload ?? {}
        const name = String(e.event ?? e.type ?? "")
          .toUpperCase()
          .replace(/\./g, "_")
        const base = {
          gateway: G,
          gatewayType: String(e.event ?? e.type),
          occurredAt: new Date(),
          currency: "INR",
          raw: e,
        }
        let out: Event
        if (name.includes("REFUND")) {
          // Refund status: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/refund
          // and REFUND_STATUS_API in https://github.com/PhonePe/phonepe-pg-sdk-node (payments/v2/standardcheckout/Constants.ts)
          if (!p.merchantRefundId)
            return { ...base, id: `${name}:${p.refundId}:${p.state}`, type: "unknown" }
          const r: Json = await raw(
            "GET",
            `/payments/v2/refund/${encodeURIComponent(p.merchantRefundId)}/status`,
          )
          out = {
            ...base,
            id: `${name}:${p.merchantRefundId}:${r.state}`,
            type: eventType(name, r.state),
            paymentId: r.originalMerchantOrderId,
            refundId: r.merchantRefundId ?? p.merchantRefundId,
            amount: Number(r.amount),
          }
        } else if (p.merchantOrderId) {
          const pay = await status(p.merchantOrderId)
          const r = pay.raw as Json
          out = {
            ...base,
            id: `${name}:${p.merchantOrderId}:${r.state}`,
            type: eventType(name, r.state),
            paymentId: pay.gatewayId,
            orderId: pay.orderId,
            amount: pay.amount,
          }
        } else {
          out = { ...base, id: `${name}:${p.orderId}:${p.state}`, type: "unknown" }
        }
        return out
      },
    },
  )
}
