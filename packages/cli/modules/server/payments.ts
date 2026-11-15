/**
 * Payments from signet-payments: Razorpay for INR, Stripe for the rest, a
 * webhook inbox that dedupes and applies events in order, and a ledger.
 * Added by `signet add payments`.
 *
 * Gateways post to /webhooks/razorpay and /webhooks/stripe. Charge with
 * `paymentsFor(c).checkout({ amount, currency, idempotencyKey, reference, userId })`.
 * Records live in D1 (binding "DB"); create the tables from
 * `paymentsSchema("sqlite")`.
 */

import { createPayments, sqlStore } from "@dapplelight/signet-payments"
import { razorpay } from "@dapplelight/signet-payments/razorpay"
import { stripe } from "@dapplelight/signet-payments/stripe"
import { type Context, Hono } from "hono"
import { env } from "../env.ts"

type D1 = {
  prepare(sql: string): { bind(...params: unknown[]): { all(): Promise<{ results: unknown[] }> } }
}

/** Per request: configs never read env at import. */
export const paymentsFor = (c: Context) =>
  createPayments({
    gateways: [
      razorpay({
        keyId: env.RAZORPAY_KEY_ID,
        keySecret: env.RAZORPAY_KEY_SECRET,
        webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
      }),
      stripe({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET }),
    ],
    route: (i) => (i.currency === "INR" ? "razorpay" : "stripe"),
    fallback: true, // on an outage only, never on a decline
    db: sqlStore(
      {
        query: async (sql, params) =>
          (
            await (c.env.DB as D1)
              .prepare(sql)
              .bind(...params)
              .all()
          ).results as never,
      },
      { dialect: "sqlite" },
    ),
  })

/** Outside /api, so the CSRF guard and rate limit there do not refuse gateways. */
export const paymentsRoutes = () =>
  new Hono().post("/:gateway", (c) =>
    paymentsFor(c).handleWebhook(c.req.param("gateway"), c.req.raw),
  )
