// One case per adapter: recorded, docs-shaped responses (hand-written from each
// gateway's API reference, no real keys) and a signed webhook built with
// node:crypto, independently of the adapter's Web Crypto code.

import { createHash, createHmac } from "node:crypto"
import { cashfree } from "../src/gateways/cashfree"
import { dodo } from "../src/gateways/dodo"
import { hyperswitch } from "../src/gateways/hyperswitch"
import { lemonsqueezy } from "../src/gateways/lemonsqueezy"
import { paddle } from "../src/gateways/paddle"
import { paypal } from "../src/gateways/paypal"
import { payu } from "../src/gateways/payu"
import { phonepe } from "../src/gateways/phonepe"
import { razorpay } from "../src/gateways/razorpay"
import { stripe } from "../src/gateways/stripe"
import type { CheckoutInput, EventType, PaymentGateway, PaymentStatus } from "../src/types"
import type { Route } from "./fake"

export const SECRET = "whsec_test_made_up_secret"
const DODO_SECRET = `whsec_${Buffer.from("made-up-dodo-signing-key").toString("base64")}`
const now = () => Math.floor(Date.now() / 1000)
const hmacHex = (algo: string, secret: string, msg: string) =>
  createHmac(algo, secret).update(msg).digest("hex")
const sha512 = (s: string) => createHash("sha512").update(s).digest("hex")

export type Case = {
  name: string
  make: (f: typeof globalThis.fetch) => PaymentGateway
  routes: Record<string, Route>
  checkout: Omit<CheckoutInput, "idempotencyKey">
  expectCheckout: { gatewayId: string; via: "url" | "clientSecret" | "form" | "none" }
  payment: { id: string; amount: number; currency: string; status: PaymentStatus }
  refund: { paymentId: string; amount?: number; expectAmount: number }
  webhook?: {
    build: () => { headers: Record<string, string>; body: string }
    type: EventType
    paymentId: string
    amount: number
    /** The scheme authenticates the sender, not the body; the adapter re-reads state from the API. */
    unsignedBody?: boolean
  }
}

const http = { retryDelayMs: 0, sandbox: true }

export const CASES: Case[] = [
  {
    name: "razorpay",
    make: (fetch) =>
      razorpay({
        keyId: "rzp_test_key",
        keySecret: "test_secret",
        webhookSecret: SECRET,
        fetch,
        ...http,
      }),
    routes: {
      "POST /v1/orders": ({ json }: any) => ({
        id: "order_T1",
        entity: "order",
        amount: json.amount,
        currency: json.currency,
        receipt: json.receipt,
        status: "created",
        created_at: 1692694191,
      }),
      "GET /v1/payments/pay_T1": {
        id: "pay_T1",
        entity: "payment",
        amount: 5000,
        currency: "INR",
        status: "captured",
        order_id: "order_T1",
        method: "upi",
        amount_refunded: 0,
        fee: 118,
        created_at: 1692694191,
      },
      "POST /v1/payments/pay_T1/refund": ({ json }: any) => ({
        id: "rfnd_T1",
        entity: "refund",
        amount: json.amount ?? 5000,
        currency: "INR",
        payment_id: "pay_T1",
        status: "processed",
        created_at: 1692694300,
      }),
      "GET /v1/settlements/recon/combined": { entity: "collection", count: 0, items: [] },
    },
    checkout: { amount: 5000, currency: "INR", reference: "order-ref-1" },
    expectCheckout: { gatewayId: "order_T1", via: "none" },
    payment: { id: "pay_T1", amount: 5000, currency: "INR", status: "captured" },
    refund: { paymentId: "pay_T1", amount: 2000, expectAmount: 2000 },
    webhook: {
      build: () => {
        const body = JSON.stringify({
          entity: "event",
          account_id: "acc_T1",
          event: "payment.captured",
          contains: ["payment"],
          payload: {
            payment: {
              entity: {
                id: "pay_T1",
                entity: "payment",
                amount: 5000,
                currency: "INR",
                status: "captured",
                order_id: "order_T1",
                fee: 118,
                created_at: 1692694191,
              },
            },
          },
          created_at: 1692694200,
        })
        return {
          body,
          headers: {
            "x-razorpay-signature": hmacHex("sha256", SECRET, body),
            "x-razorpay-event-id": "evt_T1",
          },
        }
      },
      type: "payment.captured",
      paymentId: "pay_T1",
      amount: 5000,
    },
  },
  {
    name: "stripe",
    make: (fetch) =>
      stripe({ secretKey: "sk_test_made_up", webhookSecret: SECRET, fetch, ...http }),
    routes: {
      "POST /v1/payment_intents": ({ form }: any) => ({
        id: "pi_T1",
        object: "payment_intent",
        amount: Number(form.get("amount")),
        currency: form.get("currency"),
        client_secret: "pi_T1_secret_made_up",
        status: "requires_payment_method",
        created: 1692694191,
      }),
      "GET /v1/payment_intents/pi_T1": {
        id: "pi_T1",
        object: "payment_intent",
        amount: 5000,
        amount_received: 5000,
        currency: "usd",
        status: "succeeded",
        latest_charge: {
          id: "ch_T1",
          amount_refunded: 0,
          balance_transaction: { id: "txn_T1", fee: 175 },
          payment_method_details: { type: "card" },
        },
        created: 1692694191,
      },
      "POST /v1/refunds": ({ form }: any) => ({
        id: "re_T1",
        object: "refund",
        amount: Number(form.get("amount") ?? 5000),
        currency: "usd",
        payment_intent: form.get("payment_intent"),
        status: "succeeded",
        created: 1692694300,
      }),
    },
    checkout: { amount: 5000, currency: "USD" },
    expectCheckout: { gatewayId: "pi_T1", via: "clientSecret" },
    payment: { id: "pi_T1", amount: 5000, currency: "USD", status: "captured" },
    refund: { paymentId: "pi_T1", amount: 2000, expectAmount: 2000 },
    webhook: {
      build: () => {
        const body = JSON.stringify({
          id: "evt_T1",
          object: "event",
          type: "payment_intent.succeeded",
          created: now(),
          data: {
            object: {
              id: "pi_T1",
              object: "payment_intent",
              amount: 5000,
              amount_received: 5000,
              currency: "usd",
            },
          },
        })
        const t = now()
        return {
          body,
          headers: {
            "stripe-signature": `t=${t},v1=${hmacHex("sha256", SECRET, `${t}.${body}`)},v0=ignored`,
          },
        }
      },
      type: "payment.captured",
      paymentId: "pi_T1",
      amount: 5000,
    },
  },
  {
    name: "cashfree",
    make: (fetch) => cashfree({ clientId: "TEST_APP_ID", clientSecret: SECRET, fetch, ...http }),
    routes: {
      "POST /pg/orders": ({ json }: any) => ({
        cf_order_id: "2149460581",
        order_id: json.order_id,
        entity: "order",
        order_amount: json.order_amount,
        order_currency: "INR",
        order_status: "ACTIVE",
        payment_session_id: "session_made_up",
        created_at: "2026-01-01T10:00:00+05:30",
      }),
      "GET /pg/orders/ord_T1": {
        cf_order_id: "2149460581",
        order_id: "ord_T1",
        entity: "order",
        order_amount: 50.0,
        order_currency: "INR",
        order_status: "PAID",
        created_at: "2026-01-01T10:00:00+05:30",
      },
      "POST /pg/orders/ord_T1/refunds": ({ json }: any) => ({
        cf_refund_id: "11325632",
        refund_id: json.refund_id,
        order_id: "ord_T1",
        refund_amount: json.refund_amount,
        refund_currency: "INR",
        refund_status: "PENDING",
        created_at: "2026-01-01T11:00:00+05:30",
      }),
    },
    checkout: {
      amount: 5000,
      currency: "INR",
      reference: "ord_T1",
      customer: { id: "cust-1", phone: "9999999999" },
    },
    expectCheckout: { gatewayId: "ord_T1", via: "clientSecret" },
    payment: { id: "ord_T1", amount: 5000, currency: "INR", status: "captured" },
    refund: { paymentId: "ord_T1", amount: 2015, expectAmount: 2015 },
    webhook: {
      build: () => {
        const body = JSON.stringify({
          type: "PAYMENT_SUCCESS_WEBHOOK",
          event_time: "2026-01-01T10:05:00+05:30",
          data: {
            order: { order_id: "ord_T1", order_amount: 50, order_currency: "INR" },
            payment: {
              cf_payment_id: 5114910580153,
              payment_status: "SUCCESS",
              payment_amount: 50,
              payment_currency: "INR",
            },
          },
        })
        const ts = String(Date.now())
        return {
          body,
          headers: {
            "x-webhook-timestamp": ts,
            "x-webhook-signature": createHmac("sha256", SECRET)
              .update(ts + body)
              .digest("base64"),
          },
        }
      },
      type: "payment.captured",
      paymentId: "ord_T1",
      amount: 5000,
    },
  },
  {
    name: "phonepe",
    make: (fetch) =>
      phonepe({
        clientId: "TEST_CLIENT",
        clientSecret: "test_secret",
        clientVersion: 1,
        webhookUsername: "hook_user",
        webhookPassword: "hook_pass_made_up",
        fetch,
        ...http,
      }),
    routes: {
      "POST /apis/pg-sandbox/v1/oauth/token": () => ({
        access_token: "made-up-token",
        expires_at: now() + 3600,
        token_type: "O-Bearer",
      }),
      "POST /apis/pg-sandbox/checkout/v2/pay": {
        orderId: "OMO2601011000",
        state: "PENDING",
        expireAt: 1767250000000,
        redirectUrl: "https://mercury-uat.phonepe.com/transact/uat_v2?token=made-up",
      },
      "GET /apis/pg-sandbox/checkout/v2/order/ref-1/status": {
        orderId: "OMO2601011000",
        state: "COMPLETED",
        amount: 5000,
        expireAt: 1767250000000,
        paymentDetails: [
          {
            transactionId: "OM1",
            paymentMode: "UPI_INTENT",
            timestamp: 1767240000000,
            amount: 5000,
            state: "COMPLETED",
          },
        ],
      },
      "POST /apis/pg-sandbox/payments/v2/refund": ({ json }: any) => ({
        refundId: "OMR1",
        amount: json.amount,
        state: "PENDING",
      }),
    },
    checkout: {
      amount: 5000,
      currency: "INR",
      reference: "ref-1",
      returnUrl: "https://shop.example.test/done",
    },
    expectCheckout: { gatewayId: "ref-1", via: "url" },
    payment: { id: "ref-1", amount: 5000, currency: "INR", status: "captured" },
    refund: { paymentId: "ref-1", amount: 2000, expectAmount: 2000 },
    webhook: {
      build: () => ({
        body: JSON.stringify({
          event: "checkout.order.completed",
          payload: {
            orderId: "OMO2601011000",
            merchantId: "MERCHANTUAT",
            merchantOrderId: "ref-1",
            state: "COMPLETED",
            amount: 5000,
            expireAt: 1767250000000,
            paymentDetails: [],
          },
        }),
        headers: {
          authorization: createHash("sha256").update("hook_user:hook_pass_made_up").digest("hex"),
        },
      }),
      type: "payment.captured",
      paymentId: "ref-1",
      amount: 5000,
      unsignedBody: true,
    },
  },
  {
    name: "payu",
    make: (fetch) => payu({ key: "TESTKEY", salt: "test_salt", fetch, ...http }),
    routes: {
      "POST /merchant/postservice.php": ({ form }: any) => {
        const cmd = form.get("command")
        if (form.get("hash") !== sha512(`TESTKEY|${cmd}|${form.get("var1")}|test_salt`))
          return { status: 0, msg: "bad hash" }
        if (cmd === "verify_payment")
          return {
            status: 1,
            msg: "1 out of 1 Transactions Fetched Successfully",
            transaction_details: {
              "ref-1": {
                mihpayid: "403993715521",
                status: "success",
                unmappedstatus: "captured",
                amt: "50.00",
                mode: "UPI",
                addedon: "2026-01-01 10:00:00",
              },
            },
          }
        if (cmd === "cancel_refund_transaction")
          return {
            status: 1,
            msg: "Refund Request Queued",
            request_id: "131",
            mihpayid: form.get("var1"),
            amount: form.get("var3"),
          }
        return { status: 0, msg: "unknown command" }
      },
    },
    checkout: {
      amount: 5000,
      currency: "INR",
      reference: "ref-1",
      returnUrl: "https://shop.example.test/done",
      customer: { name: "Test Buyer", email: "buyer@example.test" },
    },
    expectCheckout: { gatewayId: "ref-1", via: "form" },
    payment: { id: "ref-1", amount: 5000, currency: "INR", status: "captured" },
    refund: { paymentId: "ref-1", amount: 2000, expectAmount: 2000 },
    webhook: {
      build: () => {
        const d: Record<string, string> = {
          mihpayid: "403993715521",
          status: "success",
          unmappedstatus: "captured",
          key: "TESTKEY",
          txnid: "ref-1",
          amount: "50.00",
          productinfo: "Order",
          firstname: "Test Buyer",
          email: "buyer@example.test",
          udf1: "",
          udf2: "",
          udf3: "",
          udf4: "",
          udf5: "",
        }
        d.hash = sha512(
          `test_salt|success|||||||||||buyer@example.test|Test Buyer|Order|50.00|ref-1|TESTKEY`,
        )
        return { body: JSON.stringify(d), headers: { "content-type": "application/json" } }
      },
      type: "payment.captured",
      paymentId: "ref-1",
      amount: 5000,
    },
  },
  {
    name: "paddle",
    make: (fetch) =>
      paddle({ apiKey: "pdl_sdbx_apikey_made_up", webhookSecret: SECRET, fetch, ...http }),
    routes: {
      "POST /transactions": ({ json }: any) => ({
        data: {
          id: "txn_01",
          status: "ready",
          currency_code: json.currency_code,
          details: { totals: { subtotal: "5000", tax: "0", total: "5000" } },
          checkout: { url: "https://shop.example.test/pay?_ptxn=txn_01" },
          created_at: "2026-01-01T10:00:00Z",
        },
      }),
      "GET /transactions/txn_01": {
        data: {
          id: "txn_01",
          status: "completed",
          currency_code: "USD",
          customer_id: "ctm_01",
          details: { totals: { total: "5000" } },
          created_at: "2026-01-01T10:00:00Z",
        },
      },
      "POST /adjustments": ({ json }: any) => ({
        data: {
          id: "adj_01",
          action: json.action,
          type: json.type,
          transaction_id: json.transaction_id,
          status: "pending_approval",
          currency_code: "USD",
          totals: { total: "5000" },
          created_at: "2026-01-02T10:00:00Z",
        },
      }),
    },
    checkout: {
      amount: 5000,
      currency: "USD",
      extra: { items: [{ price_id: "pri_01", quantity: 1 }] },
    },
    expectCheckout: { gatewayId: "txn_01", via: "url" },
    payment: { id: "txn_01", amount: 5000, currency: "USD", status: "captured" },
    refund: { paymentId: "txn_01", expectAmount: 5000 },
    webhook: {
      build: () => {
        const body = JSON.stringify({
          event_id: "evt_01",
          event_type: "transaction.completed",
          occurred_at: "2026-01-01T10:01:00Z",
          notification_id: "ntf_01",
          data: {
            id: "txn_01",
            status: "completed",
            currency_code: "USD",
            details: { totals: { total: "5000" } },
            custom_data: { reference: "ref-1" },
          },
        })
        const ts = now()
        return {
          body,
          headers: {
            "paddle-signature": `ts=${ts};h1=${hmacHex("sha256", SECRET, `${ts}:${body}`)}`,
          },
        }
      },
      type: "payment.captured",
      paymentId: "txn_01",
      amount: 5000,
    },
  },
  {
    name: "lemonsqueezy",
    make: (fetch) =>
      lemonsqueezy({
        apiKey: "made-up",
        storeId: "1",
        currency: "USD",
        variantId: "7",
        webhookSecret: SECRET,
        fetch,
        ...http,
      }),
    routes: {
      "POST /v1/checkouts": {
        data: {
          type: "checkouts",
          id: "ck-0001",
          attributes: { url: "https://shop.example.test/checkout/custom/ck-0001" },
        },
      },
      "GET /v1/orders/1": {
        data: {
          type: "orders",
          id: "1",
          attributes: {
            status: "paid",
            total: 5000,
            currency: "USD",
            refunded_amount: 0,
            customer_id: 1,
            created_at: "2026-01-01T10:00:00.000000Z",
          },
        },
      },
      "POST /v1/orders/1/refund": {
        data: {
          type: "orders",
          id: "1",
          attributes: {
            status: "refunded",
            total: 5000,
            currency: "USD",
            refunded: true,
            refunded_amount: 5000,
            refunded_at: "2026-01-02T10:00:00.000000Z",
            created_at: "2026-01-01T10:00:00.000000Z",
          },
        },
      },
    },
    checkout: { amount: 5000, currency: "USD", reference: "ref-1" },
    expectCheckout: { gatewayId: "ck-0001", via: "url" },
    payment: { id: "1", amount: 5000, currency: "USD", status: "captured" },
    refund: { paymentId: "1", expectAmount: 5000 },
    webhook: {
      build: () => {
        const body = JSON.stringify({
          meta: { event_name: "order_created", custom_data: { reference: "ref-1" } },
          data: {
            type: "orders",
            id: "1",
            attributes: {
              status: "paid",
              total: 5000,
              currency: "USD",
              created_at: "2026-01-01T10:00:00.000000Z",
              updated_at: "2026-01-01T10:00:01.000000Z",
            },
          },
        })
        return {
          body,
          headers: {
            "x-signature": hmacHex("sha256", SECRET, body),
            "x-event-name": "order_created",
          },
        }
      },
      type: "payment.captured",
      paymentId: "1",
      amount: 5000,
    },
  },
  {
    name: "paypal",
    make: (fetch) =>
      paypal({
        clientId: "made-up",
        clientSecret: "made-up",
        webhookId: "WH-TEST",
        fetch,
        ...http,
      }),
    routes: {
      "POST /v1/oauth2/token": {
        access_token: "A21AA-made-up",
        token_type: "Bearer",
        expires_in: 32400,
      },
      "POST /v2/checkout/orders": {
        id: "5O190127TN364715T",
        status: "CREATED",
        links: [
          {
            href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T",
            rel: "approve",
            method: "GET",
          },
        ],
      },
      "GET /v2/checkout/orders/5O190127TN364715T": {
        id: "5O190127TN364715T",
        status: "COMPLETED",
        create_time: "2026-01-01T10:00:00Z",
        purchase_units: [
          {
            amount: { currency_code: "USD", value: "50.00" },
            payments: {
              captures: [
                {
                  id: "3C679366HH908993F",
                  status: "COMPLETED",
                  amount: { currency_code: "USD", value: "50.00" },
                },
              ],
            },
          },
        ],
      },
      "POST /v2/payments/captures/3C679366HH908993F/refund": ({ json }: any) => ({
        id: "1JU08902781691411",
        status: "COMPLETED",
        amount: json.amount ?? { value: "50.00", currency_code: "USD" },
        create_time: "2026-01-02T10:00:00Z",
      }),
      "POST /v1/notifications/verify-webhook-signature": ({ json }: any) => ({
        verification_status:
          json.transmission_sig === "made-up-valid-sig" &&
          json.webhook_event?.id === "WH-58D329510W468432D-8HN650336L201105X" &&
          json.webhook_event.resource.amount.value === "50.00"
            ? "SUCCESS"
            : "FAILURE",
      }),
    },
    checkout: { amount: 5000, currency: "USD" },
    expectCheckout: { gatewayId: "5O190127TN364715T", via: "url" },
    payment: { id: "5O190127TN364715T", amount: 5000, currency: "USD", status: "captured" },
    refund: { paymentId: "5O190127TN364715T", amount: 2000, expectAmount: 2000 },
    webhook: {
      build: () => {
        const body = JSON.stringify({
          id: "WH-58D329510W468432D-8HN650336L201105X",
          create_time: "2026-01-01T10:01:00Z",
          resource_type: "capture",
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          resource: {
            id: "3C679366HH908993F",
            status: "COMPLETED",
            amount: { currency_code: "USD", value: "50.00" },
            supplementary_data: { related_ids: { order_id: "5O190127TN364715T" } },
          },
        })
        return {
          body,
          headers: {
            "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
            "paypal-transmission-time": new Date().toISOString(),
            "paypal-transmission-sig": "made-up-valid-sig",
            "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-made-up",
            "paypal-auth-algo": "SHA256withRSA",
          },
        }
      },
      type: "payment.captured",
      paymentId: "5O190127TN364715T",
      amount: 5000,
    },
  },
  {
    name: "hyperswitch",
    make: (fetch) =>
      hyperswitch({ apiKey: "snd_made_up", paymentResponseHashKey: SECRET, fetch, ...http }),
    routes: {
      "POST /payments": ({ json }: any) => ({
        payment_id: "pay_hs1",
        amount: json.amount,
        currency: json.currency,
        client_secret: "pay_hs1_secret_made_up",
        status: "requires_payment_method",
        created: "2026-01-01T10:00:00Z",
      }),
      "GET /payments/pay_hs1": {
        payment_id: "pay_hs1",
        amount: 5000,
        currency: "USD",
        status: "succeeded",
        payment_method: "card",
        created: "2026-01-01T10:00:00Z",
      },
      "POST /refunds": ({ json }: any) => ({
        refund_id: "ref_hs1",
        payment_id: json.payment_id,
        amount: json.amount ?? 5000,
        currency: "USD",
        status: "pending",
        created_at: "2026-01-02T10:00:00Z",
      }),
    },
    checkout: { amount: 5000, currency: "USD" },
    expectCheckout: { gatewayId: "pay_hs1", via: "clientSecret" },
    payment: { id: "pay_hs1", amount: 5000, currency: "USD", status: "captured" },
    refund: { paymentId: "pay_hs1", amount: 2000, expectAmount: 2000 },
    webhook: {
      build: () => {
        const body = JSON.stringify({
          merchant_id: "merchant_made_up",
          event_id: "evt_hs1",
          event_type: "payment_succeeded",
          timestamp: "2026-01-01T10:01:00Z",
          content: {
            type: "payment_details",
            object: { payment_id: "pay_hs1", status: "succeeded", amount: 5000, currency: "USD" },
          },
        })
        return { body, headers: { "x-webhook-signature-512": hmacHex("sha512", SECRET, body) } }
      },
      type: "payment.captured",
      paymentId: "pay_hs1",
      amount: 5000,
    },
  },
  {
    name: "dodo",
    make: (fetch) =>
      dodo({
        apiKey: "dodo_test_made_up",
        webhookSecret: DODO_SECRET,
        productId: "pdt_pwyw",
        fetch,
        ...http,
      }),
    routes: {
      "POST /checkouts": ({ json }: any) => ({
        session_id: "cks_0001",
        checkout_url: "https://test.checkout.dodopayments.com/session/cks_0001",
        echo: json,
      }),
      "GET /payments/pay_dd1": {
        payment_id: "pay_dd1",
        business_id: "bus_made_up",
        total_amount: 5000,
        currency: "USD",
        status: "succeeded",
        payment_method: "card",
        checkout_session_id: "cks_0001",
        customer: { customer_id: "cus_1", email: "buyer@example.test", name: "Test Buyer" },
        refunds: [],
        created_at: "2026-01-01T10:00:00Z",
      },
      "GET /payments/pay_dd1/line-items": {
        currency: "USD",
        partial_refund_allowed: true,
        items: [{ items_id: "pdt_pwyw", amount: 5000, tax: 0, refundable_amount: 5000 }],
      },
      "POST /refunds": ({ json }: any) => ({
        refund_id: "ref_dd1",
        payment_id: json.payment_id,
        business_id: "bus_made_up",
        status: "pending",
        is_partial: !!json.items,
        amount: json.items ? json.items.reduce((a: number, x: any) => a + x.amount, 0) : 5000,
        currency: "USD",
        created_at: "2026-01-02T10:00:00Z",
        metadata: {},
      }),
    },
    checkout: { amount: 5000, currency: "USD", reference: "ref-1" },
    expectCheckout: { gatewayId: "cks_0001", via: "url" },
    payment: { id: "pay_dd1", amount: 5000, currency: "USD", status: "captured" },
    refund: { paymentId: "pay_dd1", amount: 2000, expectAmount: 2000 },
    webhook: {
      build: () => {
        const body = JSON.stringify({
          business_id: "bus_made_up",
          type: "payment.succeeded",
          timestamp: "2026-01-01T10:01:00Z",
          data: {
            payload_type: "Payment",
            payment_id: "pay_dd1",
            total_amount: 5000,
            currency: "USD",
            status: "succeeded",
            checkout_session_id: "cks_0001",
            metadata: { reference: "ref-1" },
          },
        })
        const id = "msg_made_up_1"
        const ts = String(now())
        const key = Buffer.from(DODO_SECRET.slice(6), "base64")
        const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")
        return {
          body,
          headers: {
            "webhook-id": id,
            "webhook-timestamp": ts,
            // A rotated-out signature first: any matching v1 entry is enough.
            "webhook-signature": `v1,bm90LXRoaXMtb25l v1,${sig}`,
          },
        }
      },
      type: "payment.captured",
      paymentId: "pay_dd1",
      amount: 5000,
    },
  },
]
