/**
 * PhonePe PG, Standard Checkout v2: an OAuth client-credentials token
 * (`/v1/oauth/token`, form body, cached until `expires_at`) sent as
 * `Authorization: O-Bearer <token>`. Amounts are integer paise; INR only.
 * Checkout returns PhonePe's `redirectUrl`; `gatewayId` is your
 * `merchantOrderId`. The old X-VERIFY salt flow is deprecated and not used.
 *
 * Webhooks are UNSUPPORTED here: PhonePe documents the headers but not the
 * algorithm or encoding behind them, so this adapter will not pretend to
 * verify them. PhonePe requires polling order status anyway; use `getPayment`.
 * Also unsupported: capture (no auth/capture in Standard Checkout), customers,
 * saved methods, settlements and payouts (no PG API), subscriptions (Autopay
 * paths only partly documented).
 */

import { PaymentsError } from "../errors.js"
import { defineGateway, type Json, request, toDate, withQuery } from "../http.js"
import type { HttpOptions, Payment, PaymentGateway, PaymentStatus, Refund } from "../types.js"

export type PhonePeConfig = HttpOptions & {
  clientId: string
  clientSecret: string
  clientVersion: string | number
}

const G = "phonepe"

const STATE: Record<string, PaymentStatus> = {
  PENDING: "pending",
  COMPLETED: "captured",
  FAILED: "failed",
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

  return defineGateway(
    G,
    {
      methods: ["upi", "card", "netbanking"],
      features: ["refunds", "partialRefunds"],
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
    },
  )
}
