/**
 * Cashfree Payments PG over its REST API (x-api-version 2026-01-01, headers
 * x-client-id / x-client-secret). Amounts on the wire are rupee numbers
 * (`order_amount: 10.15`); this adapter converts to and from minor units by
 * string, never by float arithmetic. Checkout creates an Order and returns its
 * `payment_session_id` as `clientSecret` for Cashfree's JS SDK; `gatewayId` is
 * your `order_id`. Idempotency keys go in `x-idempotency-key` (Cashfree expects
 * a UUID).
 *
 * Webhooks: `x-webhook-signature` = Base64 HMAC-SHA256 of
 * `x-webhook-timestamp + rawBody` (no separator) with the client secret.
 *
 * Not implemented, because the docs did not pin them down: subscriptions
 * (status values and the manage body), settlements (only batch totals are
 * documented clearly; per-payment recon fields were not), payouts (a separate
 * product with its own signing).
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
  toMajor,
  toMinor,
} from "../http.js"
import type {
  Event,
  EventType,
  HttpOptions,
  Payment,
  PaymentGateway,
  PaymentStatus,
  Refund,
} from "../types.js"

export const CASHFREE_API_VERSION = "2026-01-01"

export type CashfreeConfig = HttpOptions & {
  clientId: string
  clientSecret: string
  apiVersion?: string
}

const G = "cashfree"

const ORDER: Record<string, PaymentStatus> = {
  ACTIVE: "pending",
  PAID: "captured",
  EXPIRED: "cancelled",
  TERMINATED: "cancelled",
  TERMINATION_REQUESTED: "cancelled",
}

const major = (amount: number, currency: string) => Number(toMajor(amount, currency))

const toPayment = (o: Json): Payment => ({
  gateway: G,
  gatewayId: o.order_id,
  amount: toMinor(o.order_amount, o.order_currency),
  currency: o.order_currency,
  status: ORDER[o.order_status] ?? "pending",
  customerId: o.customer_details?.customer_id ?? undefined,
  orderId: o.order_id,
  createdAt: toDate(o.created_at),
  raw: o,
})

const toRefund = (r: Json): Refund => ({
  gateway: G,
  gatewayId: r.refund_id,
  paymentId: r.order_id,
  amount: toMinor(r.refund_amount, r.refund_currency ?? "INR"),
  currency: r.refund_currency ?? "INR",
  status:
    r.refund_status === "SUCCESS"
      ? "processed"
      : r.refund_status === "CANCELLED" || r.refund_status === "REJECTED"
        ? "failed"
        : "pending",
  createdAt: toDate(r.created_at),
  raw: r,
})

function eventType(type: string, d: Json): EventType {
  const t = type.replace(/_WEBHOOK$/, "")
  if (t === "PAYMENT_SUCCESS") return "payment.captured"
  if (t === "PAYMENT_FAILED") return "payment.failed"
  if (t === "REFUND_STATUS")
    return d.refund?.refund_status === "SUCCESS"
      ? "refund.processed"
      : ["CANCELLED", "REJECTED"].includes(d.refund?.refund_status)
        ? "refund.failed"
        : "unknown"
  if (t === "DISPUTE_CREATED") return "dispute.opened"
  if (t === "DISPUTE_UPDATED") return "dispute.updated"
  if (t === "DISPUTE_CLOSED") return "dispute.closed"
  return "unknown"
}

export function cashfree(config: CashfreeConfig): PaymentGateway {
  const base = () =>
    config.baseUrl ??
    (config.sandbox ? "https://sandbox.cashfree.com/pg" : "https://api.cashfree.com/pg")
  const raw = jsonRaw(
    G,
    base,
    (o) => ({
      "x-api-version": config.apiVersion ?? CASHFREE_API_VERSION,
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
      ...(o.idempotencyKey ? { "x-idempotency-key": o.idempotencyKey } : {}),
    }),
    config,
  )
  const order = async (id: string) =>
    toPayment(await raw("GET", `/orders/${encodeURIComponent(id)}`))

  return defineGateway(
    G,
    {
      methods: ["upi", "card", "netbanking", "wallet", "emi"],
      features: ["capture", "refunds", "partialRefunds", "customers", "savedMethods", "webhooks"],
    },
    {
      raw,
      async createCheckout(i) {
        if (!i.customer?.id || !i.customer.phone)
          throw new PaymentsError(
            "BAD_INPUT",
            "Cashfree orders need customer.id and customer.phone.",
            { gateway: G },
          )
        const o: Json = await raw(
          "POST",
          "/orders",
          {
            order_id: i.reference ?? i.idempotencyKey,
            order_amount: major(i.amount, i.currency),
            order_currency: i.currency,
            customer_details: {
              customer_id: i.customer.id,
              customer_phone: i.customer.phone,
              ...(i.customer.email ? { customer_email: i.customer.email } : {}),
              ...(i.customer.name ? { customer_name: i.customer.name } : {}),
            },
            ...(i.returnUrl ? { order_meta: { return_url: i.returnUrl } } : {}),
            ...(i.description ? { order_note: i.description } : {}),
            ...(i.metadata ? { order_tags: i.metadata } : {}),
            ...i.extra,
          },
          { idempotencyKey: i.idempotencyKey },
        )
        return {
          gateway: G,
          gatewayId: o.order_id,
          amount: i.amount,
          currency: o.order_currency,
          clientSecret: o.payment_session_id,
          raw: o,
        }
      },
      getPayment: order,
      async capture(id, i) {
        const o = await order(id)
        const amount = i.amount ?? o.amount
        const cur = o.currency
        await raw(
          "POST",
          `/orders/${encodeURIComponent(id)}/authorization`,
          { action: "CAPTURE", amount: major(amount, cur) },
          { idempotencyKey: i.idempotencyKey },
        )
        return order(id)
      },
      async refund(orderId, i) {
        const o = await order(orderId)
        return toRefund(
          await raw(
            "POST",
            `/orders/${encodeURIComponent(orderId)}/refunds`,
            {
              refund_amount: major(i.amount ?? o.amount, o.currency),
              refund_id: i.idempotencyKey,
              ...(i.reason ? { refund_note: i.reason } : {}),
            },
            { idempotencyKey: i.idempotencyKey },
          ),
        )
      },
      async createCustomer(i) {
        if (!i.phone)
          throw new PaymentsError("BAD_INPUT", "Cashfree customers need a phone.", { gateway: G })
        const c: Json = await raw("POST", "/customers", {
          customer_phone: i.phone,
          ...(i.email ? { customer_email: i.email } : {}),
          ...(i.name ? { customer_name: i.name } : {}),
        })
        return {
          gateway: G,
          gatewayId: c.customer_uid,
          email: c.customer_email ?? undefined,
          name: c.customer_name ?? undefined,
          phone: c.customer_phone ?? undefined,
          createdAt: new Date(),
          raw: c,
        }
      },
      async listPaymentMethods(customerId) {
        const r: Json = await raw(
          "GET",
          `/customers/${encodeURIComponent(customerId)}/instruments`,
          undefined,
          { query: { instrument_type: "card" } },
        )
        return (Array.isArray(r) ? r : []).map((t: Json) => ({
          gateway: G,
          gatewayId: t.instrument_id,
          customerId,
          type: "card",
          label: t.instrument_display ?? undefined,
          createdAt: toDate(t.created_at),
          raw: t,
        }))
      },
      async verifyWebhook(req, o) {
        const body = await req.text()
        const ts = req.headers.get("x-webhook-timestamp") ?? ""
        const sig = req.headers.get("x-webhook-signature") ?? ""
        if (!ts || !safeEqual(await hmac("SHA-256", config.clientSecret, ts + body, "base64"), sig))
          throw badSignature(G)
        checkTimestamp(G, Number(ts) / 1000, o)
        const e: Json = JSON.parse(body)
        const d = e.data ?? {}
        const cur =
          d.refund?.refund_currency ?? d.payment?.payment_currency ?? d.order?.order_currency
        const amt =
          d.refund?.refund_amount ?? d.dispute?.dispute_amount ?? d.payment?.payment_amount
        const out: Event = {
          id: `${e.type}:${d.refund?.cf_refund_id ?? d.dispute?.dispute_id ?? d.payment?.cf_payment_id ?? d.order?.order_id}:${e.event_time}`,
          gateway: G,
          type: eventType(String(e.type), d),
          gatewayType: e.type,
          occurredAt: toDate(e.event_time),
          paymentId: d.order?.order_id ?? d.refund?.order_id,
          orderId: d.order?.order_id ?? d.refund?.order_id,
          refundId: d.refund?.refund_id,
          disputeId: d.dispute?.dispute_id !== undefined ? String(d.dispute.dispute_id) : undefined,
          amount: amt !== undefined && cur ? toMinor(amt, cur) : undefined,
          currency: cur,
          raw: e,
        }
        return out
      },
    },
  )
}
