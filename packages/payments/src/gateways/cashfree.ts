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
 * Payouts use Cashfree Payouts v2 (api.cashfree.com/payout, x-api-version
 * 2024-01-01) with the same client id and secret. The optional `x-cf-signature`
 * 2FA header is not sent, so payouts need the server's IP whitelisted in the
 * Cashfree dashboard.
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
  Payout,
  Refund,
  SettlementLine,
  Subscription,
  SubscriptionStatus,
} from "../types.js"

export const CASHFREE_API_VERSION = "2026-01-01"
export const CASHFREE_PAYOUT_API_VERSION = "2024-01-01"

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

// `subscription_status` is a plain string in the OpenAPI; the values come from
// https://www.cashfree.com/docs/payments/subscription/create.md ("Subscription lifecycle").
const SUB: Record<string, SubscriptionStatus> = {
  INITIALIZED: "pending",
  BANK_APPROVAL_PENDING: "pending",
  ACTIVE: "active",
  ON_HOLD: "past_due",
  PAUSED: "paused",
  CUSTOMER_PAUSED: "paused",
  COMPLETED: "expired",
  EXPIRED: "expired",
  LINK_EXPIRED: "expired",
  CARD_EXPIRED: "expired",
  CANCELLED: "cancelled",
  CUSTOMER_CANCELLED: "cancelled",
}

const SUB_EVENT: Partial<Record<SubscriptionStatus, EventType>> = {
  active: "subscription.activated",
  past_due: "subscription.past_due",
  paused: "subscription.paused",
  expired: "subscription.expired",
  cancelled: "subscription.cancelled",
}

// Transfer `status` is a plain string; values from
// https://www.cashfree.com/docs/api-reference/payouts/v2/transfers-v2/get-transfer-status-v2.md
const PAYOUT: Record<string, Payout["status"]> = {
  SUCCESS: "paid",
  FAILED: "failed",
  REJECTED: "failed",
  MANUALLY_REJECTED: "failed",
  REVERSED: "reversed",
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

// SubscriptionEntity has no created time, so `createdAt` is the epoch.
const toSubscription = (s: Json): Subscription => ({
  gateway: G,
  gatewayId: s.subscription_id,
  status: SUB[s.subscription_status] ?? "pending",
  createdAt: toDate(undefined),
  raw: s,
})

const toPayout = (t: Json): Payout => ({
  gateway: G,
  gatewayId: t.transfer_id,
  amount: toMinor(t.transfer_amount, t.transfer_currency ?? "INR"),
  currency: t.transfer_currency ?? "INR",
  status: PAYOUT[t.status] ?? "pending",
  createdAt: toDate(t.added_on),
  raw: t,
})

function eventType(type: string, d: Json): EventType {
  const t = type.replace(/_WEBHOOK$/, "")
  if (t === "SUBSCRIPTION_STATUS_CHANGED")
    return (
      SUB_EVENT[SUB[d.subscription_details?.subscription_status] ?? "pending"] ??
      "subscription.updated"
    )
  if (t === "TRANSFER_SUCCESS") return "payout.processed"
  if (t === "TRANSFER_FAILED" || t === "TRANSFER_REJECTED") return "payout.failed"
  if (t === "TRANSFER_REVERSED") return "payout.reversed"
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
  const payoutRaw = jsonRaw(
    G,
    () =>
      config.sandbox ? "https://sandbox.cashfree.com/payout" : "https://api.cashfree.com/payout",
    () => ({
      "x-api-version": CASHFREE_PAYOUT_API_VERSION,
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
    }),
    config,
  )
  const order = async (id: string) =>
    toPayment(await raw("GET", `/orders/${encodeURIComponent(id)}`))

  return defineGateway(
    G,
    {
      methods: ["upi", "card", "netbanking", "wallet", "emi"],
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
      // https://www.cashfree.com/docs/openapi/payments/v2026-01-01.yaml (GET /subscriptions/{subscription_id})
      // https://github.com/cashfree/cashfree-pg-sdk-nodejs/blob/main/api.ts (SubsFetchSubscription)
      async getSubscription(id) {
        return toSubscription(await raw("GET", `/subscriptions/${encodeURIComponent(id)}`))
      },
      // POST /subscriptions/{id}/manage with action CANCEL; the response is the SubscriptionEntity.
      // https://www.cashfree.com/docs/openapi/payments/v2026-01-01.yaml (ManageSubscriptionRequest)
      // https://github.com/cashfree/cashfree-pg-sdk-nodejs/blob/main/api.ts (SubsManageSubscription)
      async cancelSubscription(id, o) {
        if (o?.atPeriodEnd)
          throw new PaymentsError("BAD_INPUT", "Cashfree cancels subscriptions immediately.", {
            gateway: G,
          })
        return toSubscription(
          await raw("POST", `/subscriptions/${encodeURIComponent(id)}/manage`, {
            subscription_id: id,
            action: "CANCEL",
          }),
        )
      },
      // POST /transfers; `destination` is a beneficiary_id, amounts are rupee numbers.
      // https://www.cashfree.com/docs/openapi/payouts/payoutsv2extra.yaml (CreateTransferRequest)
      // https://github.com/cashfree/cashfree-payout-sdk-nodejs (PayoutInitiateTransfer)
      async createPayout(i) {
        const transferId = i.reference ?? i.idempotencyKey
        if (!/^\w{1,40}$/.test(transferId))
          throw new PaymentsError(
            "BAD_INPUT",
            "Cashfree transfer_id (reference or idempotencyKey) must be 1-40 letters, digits or underscores.",
            { gateway: G },
          )
        return toPayout(
          await payoutRaw(
            "POST",
            "/transfers",
            {
              transfer_id: transferId,
              transfer_amount: major(i.amount, i.currency),
              transfer_currency: i.currency,
              beneficiary_details: { beneficiary_id: i.destination },
              ...i.extra,
            },
            { idempotencyKey: i.idempotencyKey },
          ),
        )
      },
      // POST /settlement/recon, cursor-paged, filtered by settlement processed date (UTC day).
      // https://www.cashfree.com/docs/openapi/payments/v2026-01-01.yaml (SettlementFetchReconRequest, SettlementReconEntity)
      // https://github.com/cashfree/cashfree-pg-sdk-nodejs/blob/main/api.ts (PGSettlementFetchRecon)
      async listSettlements({ date }) {
        const items: Json[] = []
        for (let cursor: string | null = null; ; ) {
          const r: Json = await raw("POST", "/settlement/recon", {
            pagination: { limit: 1000, cursor },
            filters: {
              start_date_processed_on: `${date}T00:00:00Z`,
              end_date_processed_on: `${date}T23:59:59Z`,
            },
          })
          const data: Json[] = r.data ?? []
          items.push(...data)
          if (!r.cursor || data.length < 1000) break
          cursor = r.cursor
        }
        const lines: SettlementLine[] = items.map((it) => {
          const e = it.event_details ?? {}
          const cur = e.event_currency ?? "INR"
          const fee = (e.event_service_charge ?? 0) + (e.event_service_tax ?? 0)
          return {
            kind:
              e.event_type === "PAYMENT"
                ? "payment"
                : e.event_type === "REFUND"
                  ? "refund"
                  : "adjustment",
            gatewayId: String(e.event_id),
            paymentId: it.order_details?.order_id ?? undefined,
            amount: toMinor(Math.abs(e.event_amount ?? 0), cur),
            currency: cur,
            fee: fee ? toMinor(fee, cur) : undefined,
            settlementId:
              it.settlement_details?.cf_settlement_id !== undefined
                ? String(it.settlement_details.cf_settlement_id)
                : undefined,
            createdAt: toDate(e.event_time),
            raw: it,
          }
        })
        return [{ gateway: G, date, lines, raw: items }]
      },
      async verifyWebhook(req, o) {
        const body = await req.text()
        const ts = req.headers.get("x-webhook-timestamp") ?? ""
        const sig = req.headers.get("x-webhook-signature") ?? ""
        if (!ts || !safeEqual(await hmac("SHA-256", config.clientSecret, ts + body, "base64"), sig))
          throw badSignature(G)
        // Same scheme for PG, subscription and payout webhooks: no separator, Base64.
        // https://github.com/cashfree/cashfree-pg-sdk-nodejs/blob/main/api.ts (PGVerifyWebhookSignature)
        // https://www.cashfree.com/docs/payments/subscription/webhook-signature.md
        // PG timestamps are in ms; the payout docs do not say, so accept seconds too.
        checkTimestamp(G, Number(ts) > 1e12 ? Number(ts) / 1000 : Number(ts), o)
        const e: Json = JSON.parse(body)
        const d = e.data ?? {}
        // Payout v2 webhooks put the transfer fields directly under `data`.
        // https://www.cashfree.com/docs/api-reference/payouts/v2/webhooks/webhooks-v2.md
        const transfer = String(e.type).startsWith("TRANSFER_") ? d : undefined
        const sub = d.subscription_details
        const cur =
          d.refund?.refund_currency ??
          d.payment?.payment_currency ??
          d.order?.order_currency ??
          (transfer ? (transfer.transfer_currency ?? "INR") : undefined)
        const amt =
          d.refund?.refund_amount ??
          d.dispute?.dispute_amount ??
          d.payment?.payment_amount ??
          transfer?.transfer_amount
        const out: Event = {
          id: `${e.type}:${d.refund?.cf_refund_id ?? d.dispute?.dispute_id ?? d.payment?.cf_payment_id ?? d.order?.order_id ?? transfer?.transfer_id ?? sub?.subscription_id}:${e.event_time}`,
          gateway: G,
          type: eventType(String(e.type), d),
          gatewayType: e.type,
          occurredAt: toDate(e.event_time),
          paymentId: d.order?.order_id ?? d.refund?.order_id,
          orderId: d.order?.order_id ?? d.refund?.order_id,
          refundId: d.refund?.refund_id,
          subscriptionId: sub?.subscription_id,
          payoutId: transfer?.transfer_id,
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
