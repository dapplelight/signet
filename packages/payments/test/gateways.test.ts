// Per-gateway features beyond the shared conformance cases. Payload shapes follow
// the docs and SDK examples cited in each adapter; signatures are computed here
// with node:crypto, independent of the adapter's Web Crypto code.
import { describe, expect, test } from "bun:test"
import { createHash, createHmac } from "node:crypto"
import { cashfree } from "../src/gateways/cashfree"
import { phonepe } from "../src/gateways/phonepe"
import { razorpay } from "../src/gateways/razorpay"
import { fakeFetch } from "./fake"

const SECRET = "whsec_test_made_up_secret"
const http = { retryDelayMs: 0, sandbox: true }

describe("razorpay", () => {
  const order = ({ json }: any) => ({
    id: "order_T9",
    amount: json.amount,
    currency: json.currency,
  })

  test("manual capture sets payment.capture on the order", async () => {
    const f = fakeFetch({ "POST /v1/orders": order })
    const g = razorpay({ keyId: "k", keySecret: "s", fetch: f.fetch, ...http })
    await g.createCheckout({
      amount: 100,
      currency: "INR",
      idempotencyKey: "k-1",
      capture: "manual",
    })
    await g.createCheckout({ amount: 100, currency: "INR", idempotencyKey: "k-2" })
    expect(JSON.parse(f.calls[0].body!).payment).toEqual({ capture: "manual" })
    expect(JSON.parse(f.calls[1].body!).payment).toBeUndefined()
  })
})

describe("cashfree", () => {
  const sub = (status: string) => ({
    cf_subscription_id: "1001",
    subscription_id: "sub-made-up",
    subscription_status: status,
    plan_details: { plan_id: "plan-1" },
  })
  const make = (routes: Record<string, unknown>) => {
    const f = fakeFetch(routes)
    return {
      f,
      g: cashfree({ clientId: "TEST_APP_ID", clientSecret: SECRET, fetch: f.fetch, ...http }),
    }
  }

  test("subscriptions: get and cancel", async () => {
    const { f, g } = make({
      "GET /pg/subscriptions/sub-made-up": sub("ON_HOLD"),
      "POST /pg/subscriptions/sub-made-up/manage": sub("CANCELLED"),
    })
    expect((await g.getSubscription("sub-made-up")).status).toBe("past_due")
    const c = await g.cancelSubscription("sub-made-up")
    expect(c.status).toBe("cancelled")
    expect(JSON.parse(f.calls[1].body!)).toEqual({
      subscription_id: "sub-made-up",
      action: "CANCEL",
    })
    await expect(g.cancelSubscription("sub-made-up", { atPeriodEnd: true })).rejects.toThrow()
  })

  test("payouts go to the payout host with its own API version", async () => {
    const { f, g } = make({
      "POST /payout/transfers": ({ json }: any) => ({
        transfer_id: json.transfer_id,
        cf_transfer_id: "CF1",
        status: "RECEIVED",
        transfer_amount: json.transfer_amount,
        added_on: "2026-01-01T10:00:00",
      }),
    })
    const p = await g.createPayout({
      amount: 12345,
      currency: "INR",
      idempotencyKey: "payout_1",
      destination: "bene_1",
    })
    expect(p).toMatchObject({ gatewayId: "payout_1", amount: 12345, status: "pending" })
    expect(f.calls[0].url).toBe("https://sandbox.cashfree.com/payout/transfers")
    expect(f.calls[0].headers["x-api-version"]).toBe("2024-01-01")
    expect(JSON.parse(f.calls[0].body!)).toMatchObject({
      transfer_id: "payout_1",
      transfer_amount: 123.45,
      beneficiary_details: { beneficiary_id: "bene_1" },
    })
    await expect(
      g.createPayout({ amount: 1, currency: "INR", idempotencyKey: "has-dash", destination: "b" }),
    ).rejects.toThrow(/transfer_id/)
  })

  test("settlements page through /settlement/recon", async () => {
    const line = (id: string, type: string, amount: number) => ({
      event_details: {
        event_id: id,
        event_type: type,
        event_amount: amount,
        event_currency: "INR",
        event_service_charge: 1,
        event_service_tax: 0.18,
        event_time: "2026-01-01T10:00:00+05:30",
      },
      order_details: { order_id: "ord_T1" },
      settlement_details: { cf_settlement_id: 77 },
    })
    const pages = [
      {
        cursor: "c2",
        limit: 1000,
        data: Array.from({ length: 1000 }, (_, n) => line(`p${n}`, "PAYMENT", 50)),
      },
      { cursor: null, limit: 1000, data: [line("r1", "REFUND", 20.15)] },
    ]
    let n = 0
    const { f, g } = make({ "POST /pg/settlement/recon": () => pages[n++] })
    const [s] = await g.listSettlements({ date: "2026-01-01" })
    expect(s.lines).toHaveLength(1001)
    expect(s.lines[0]).toMatchObject({
      kind: "payment",
      paymentId: "ord_T1",
      amount: 5000,
      fee: 118,
      settlementId: "77",
    })
    expect(s.lines[1000]).toMatchObject({ kind: "refund", amount: 2015 })
    expect(JSON.parse(f.calls[1].body!).pagination.cursor).toBe("c2")
    expect(JSON.parse(f.calls[0].body!).filters.start_date_processed_on).toBe(
      "2026-01-01T00:00:00Z",
    )
  })

  const signed = (body: string, ts: string) =>
    new Request("https://example.test/hook", {
      method: "POST",
      body,
      headers: {
        "x-webhook-timestamp": ts,
        "x-webhook-signature": createHmac("sha256", SECRET)
          .update(ts + body)
          .digest("base64"),
      },
    })

  test("payout and subscription webhooks", async () => {
    const { g } = make({})
    const transfer = JSON.stringify({
      type: "TRANSFER_SUCCESS",
      event_time: "2026-01-01T10:05:00",
      data: {
        transfer_id: "payout_1",
        cf_transfer_id: "CF1",
        status: "SUCCESS",
        transfer_amount: 123.45,
      },
    })
    // Seconds here; PG webhooks use ms. Both are accepted.
    const e = await g.verifyWebhook(signed(transfer, String(Math.floor(Date.now() / 1000))))
    expect(e).toMatchObject({ type: "payout.processed", payoutId: "payout_1", amount: 12345 })

    const status = JSON.stringify({
      type: "SUBSCRIPTION_STATUS_CHANGED",
      event_time: "2026-01-01T10:05:00+05:30",
      data: {
        subscription_details: {
          subscription_id: "sub-made-up",
          subscription_status: "CUSTOMER_CANCELLED",
        },
      },
    })
    const s = await g.verifyWebhook(signed(status, String(Date.now())))
    expect(s).toMatchObject({ type: "subscription.cancelled", subscriptionId: "sub-made-up" })
  })
})

describe("phonepe", () => {
  const token = () => ({
    access_token: "made-up-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  })
  const status = (state: string) => ({
    merchantSubscriptionId: "msub-1",
    subscriptionId: "OMS1",
    state,
    authWorkflowType: "TRANSACTION",
    amountType: "FIXED",
    maxAmount: 20000,
    frequency: "MONTHLY",
    expireAt: 1893456000000,
  })

  test("subscriptions: get, and cancel (204) then re-read", async () => {
    let state = "ACTIVE"
    const f = fakeFetch({
      "POST /apis/pg-sandbox/v1/oauth/token": token,
      "GET /apis/pg-sandbox/subscriptions/v2/msub-1/status": () => status(state),
      "POST /apis/pg-sandbox/subscriptions/v2/msub-1/cancel": () => {
        state = "CANCEL_IN_PROGRESS"
        return undefined
      },
    })
    const g = phonepe({
      clientId: "c",
      clientSecret: "s",
      clientVersion: 1,
      fetch: f.fetch,
      ...http,
    })
    expect((await g.getSubscription("msub-1")).status).toBe("active")
    const c = await g.cancelSubscription("msub-1")
    expect(c.raw).toMatchObject({ state: "CANCEL_IN_PROGRESS" })
    expect(f.calls.find((x) => x.path.endsWith("/cancel"))?.body).toBeUndefined()
  })

  test("refund webhook reads the refund status, not the body", async () => {
    const f = fakeFetch({
      "POST /apis/pg-sandbox/v1/oauth/token": token,
      "GET /apis/pg-sandbox/payments/v2/refund/rf-1/status": {
        merchantId: "M",
        merchantRefundId: "rf-1",
        originalMerchantOrderId: "ref-1",
        amount: 2000,
        state: "COMPLETED",
      },
    })
    const g = phonepe({
      clientId: "c",
      clientSecret: "s",
      clientVersion: 1,
      webhookUsername: "u",
      webhookPassword: "p",
      fetch: f.fetch,
      ...http,
    })
    const body = JSON.stringify({
      event: "pg.refund.completed",
      payload: {
        merchantRefundId: "rf-1",
        originalMerchantOrderId: "ref-1",
        amount: 999999,
        state: "COMPLETED",
      },
    })
    const auth = createHash("sha256").update("u:p").digest("hex")
    const e = await g.verifyWebhook(
      new Request("https://x.test", { method: "POST", body, headers: { authorization: auth } }),
    )
    expect(e).toMatchObject({
      type: "refund.processed",
      paymentId: "ref-1",
      refundId: "rf-1",
      amount: 2000,
    })
  })
})
