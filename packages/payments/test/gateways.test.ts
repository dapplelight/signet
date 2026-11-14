// Per-gateway features beyond the shared conformance cases. Payload shapes follow
// the docs and SDK examples cited in each adapter; signatures are computed here
// with node:crypto, independent of the adapter's Web Crypto code.
import { describe, expect, test } from "bun:test"
import { constants, createHash, createHmac, generateKeyPairSync, privateDecrypt } from "node:crypto"
import { cashfree } from "../src/gateways/cashfree"
import { lemonsqueezy } from "../src/gateways/lemonsqueezy"
import { paddle } from "../src/gateways/paddle"
import { paypal } from "../src/gateways/paypal"
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

  test("payouts carry x-cf-signature when a 2FA public key is set", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString()
    const f = fakeFetch({
      "POST /payout/transfers": ({ json }: any) => ({
        transfer_id: json.transfer_id,
        status: "RECEIVED",
      }),
    })
    const g = cashfree({
      clientId: "TEST_APP_ID",
      clientSecret: SECRET,
      payoutPublicKey: pem,
      fetch: f.fetch,
      ...http,
    })
    await g.createPayout({
      amount: 100,
      currency: "INR",
      idempotencyKey: "payout_2",
      destination: "b",
    })
    const plain = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
      Buffer.from(f.calls[0].headers["x-cf-signature"], "base64"),
    ).toString()
    const [id, ts] = plain.split(".")
    expect(id).toBe("TEST_APP_ID")
    expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(5)
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

describe("paddle", () => {
  test("partial refund spreads the amount over line items", async () => {
    const f = fakeFetch({
      "GET /transactions/txn_01": {
        data: {
          id: "txn_01",
          currency_code: "USD",
          details: {
            line_items: [
              { id: "txnitm_a", totals: { total: "3000" } },
              { id: "txnitm_b", totals: { total: "2000" } },
            ],
          },
        },
      },
      "POST /adjustments": ({ json }: any) => ({
        data: {
          id: "adj_01",
          status: "pending_approval",
          currency_code: "USD",
          totals: { total: "3500" },
          ...json,
        },
      }),
    })
    const g = paddle({ apiKey: "pdl_sdbx_apikey_made_up", fetch: f.fetch, ...http })
    const r = await g.refund("txn_01", { amount: 3500, idempotencyKey: "rf-1" })
    expect(r.amount).toBe(3500)
    expect(JSON.parse(f.calls[1].body!)).toMatchObject({
      action: "refund",
      type: "partial",
      transaction_id: "txn_01",
      items: [
        { item_id: "txnitm_a", type: "partial", amount: "3000" },
        { item_id: "txnitm_b", type: "partial", amount: "500" },
      ],
    })
    await expect(g.refund("txn_01", { amount: 9000, idempotencyKey: "rf-2" })).rejects.toThrow(
      /exceeds/,
    )
  })
})

describe("lemonsqueezy", () => {
  test("partial refund sends the amount in cents and keys the refund id by the running total", async () => {
    const f = fakeFetch({
      "POST /v1/orders/1/refund": ({ json }: any) => ({
        data: {
          type: "orders",
          id: "1",
          attributes: {
            status: "partial_refund",
            total: 5000,
            currency: "USD",
            refunded_amount: json.data.attributes.amount,
            updated_at: "2026-01-02T10:00:00.000000Z",
          },
        },
      }),
    })
    const g = lemonsqueezy({
      apiKey: "k",
      storeId: "1",
      currency: "USD",
      variantId: "7",
      fetch: f.fetch,
      ...http,
    })
    const r = await g.refund("1", { amount: 1500, idempotencyKey: "rf-1" })
    expect(JSON.parse(f.calls[0].body!).data.attributes).toEqual({ amount: 1500 })
    expect(r).toMatchObject({ gatewayId: "1:refund:1500", amount: 1500, status: "processed" })
  })
})

describe("paypal", () => {
  const routes = (extra: Record<string, unknown>) => ({
    "POST /v1/oauth2/token": {
      access_token: "A21AA-made-up",
      token_type: "Bearer",
      expires_in: 3600,
    },
    "POST /v1/notifications/verify-webhook-signature": { verification_status: "SUCCESS" },
    ...extra,
  })
  const make = (f: typeof globalThis.fetch) =>
    paypal({
      clientId: "made-up",
      clientSecret: "made-up",
      webhookId: "WH-TEST",
      fetch: f,
      ...http,
    })

  test("saved methods list vault v3 payment tokens", async () => {
    const f = fakeFetch(
      routes({
        "GET /v3/vault/payment-tokens": {
          customer: { id: "customer_4029352050" },
          payment_tokens: [
            {
              id: "8kk8451t",
              customer: { id: "customer_4029352050" },
              payment_source: { card: { brand: "VISA", last_digits: "1111" } },
            },
            {
              id: "9pp9",
              customer: { id: "customer_4029352050" },
              payment_source: { paypal: { email_address: "buyer@example.test" } },
            },
          ],
        },
      }),
    )
    const list = await make(f.fetch).listPaymentMethods("customer_4029352050")
    expect(new URL(f.calls[1].url).searchParams.get("customer_id")).toBe("customer_4029352050")
    expect(list.map((m) => [m.gatewayId, m.type, m.label])).toEqual([
      ["8kk8451t", "card", "VISA 1111"],
      ["9pp9", "paypal", "buyer@example.test"],
    ])
  })

  test("a capture webhook without supplementary_data reads the capture for its order", async () => {
    const f = fakeFetch(
      routes({
        "GET /v2/payments/captures/3C679366HH908993F": {
          id: "3C679366HH908993F",
          supplementary_data: { related_ids: { order_id: "5O190127TN364715T" } },
        },
      }),
    )
    const body = JSON.stringify({
      id: "WH-made-up-2",
      create_time: "2026-01-01T10:01:00Z",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "3C679366HH908993F", amount: { currency_code: "USD", value: "50.00" } },
    })
    const e = await make(f.fetch).verifyWebhook(
      new Request("https://x.test", {
        method: "POST",
        body,
        headers: {
          "paypal-transmission-id": "t1",
          "paypal-transmission-time": new Date().toISOString(),
          "paypal-transmission-sig": "sig",
          "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-made-up",
          "paypal-auth-algo": "SHA256withRSA",
        },
      }),
    )
    expect(e).toMatchObject({
      type: "payment.captured",
      paymentId: "5O190127TN364715T",
      orderId: "5O190127TN364715T",
    })
  })
})
