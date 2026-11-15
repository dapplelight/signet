/**
 * A fake payment gateway with the real `PaymentGateway` interface, shaped
 * like Razorpay, Stripe or PayU: their id formats, checkout handoff (order id,
 * client secret, POST form) and capabilities, with state kept in memory.
 *
 * Webhooks are the real thing: `complete()` returns a Request carrying the
 * gateway's own payload and signature, and `verifyWebhook` is the real
 * adapter's, configured with the fake's test secret. So an app's webhook
 * route, `createPayments().handleWebhook` and the ledger run unchanged.
 *
 *   const gw = fakeGateway("razorpay")
 *   const payments = createPayments({ gateways: [gw], db: memoryStore() })
 *   const c = await payments.checkout({ amount: 49900, currency: "INR", idempotencyKey: "k1" })
 *   await payments.handleWebhook("razorpay", await gw.complete(c.gatewayId))
 */

import type {
  Checkout,
  Customer,
  Feature,
  Payment,
  PaymentGateway,
  PaymentStatus,
  Refund,
} from "@dapplelight/signet-payments"
import { PaymentsError } from "@dapplelight/signet-payments"
import { payu } from "@dapplelight/signet-payments/payu"
import { razorpay } from "@dapplelight/signet-payments/razorpay"
import { stripe } from "@dapplelight/signet-payments/stripe"

export type GatewayShape = "razorpay" | "stripe" | "payu"

export type GatewayCall = { method: string; args: unknown[] }

export type FakeGateway = PaymentGateway & {
  readonly shape: GatewayShape
  /** Every interface call, in order. */
  readonly calls: GatewayCall[]
  /** Payments by gateway id. */
  readonly payments: Map<string, Payment>
  readonly refunds: Refund[]
  /** The secret webhooks are signed with. */
  readonly webhookSecret: string
  /**
   * The buyer finishes (or fails) checkout `checkoutId`. Updates the payment
   * and returns the gateway's signed webhook for it.
   */
  complete(
    checkoutId: string,
    options?: { status?: "captured" | "authorized" | "failed" },
  ): Promise<Request>
}

const offline = (async () => {
  throw new Error("signet-test: the fake gateway made a network call")
}) as unknown as typeof fetch

const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("")
async function hmacHex(secret: string, msg: string) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)))
}
const sha512 = async (s: string) =>
  hex(await crypto.subtle.digest("SHA-512", new TextEncoder().encode(s)))

export function fakeGateway(
  shape: GatewayShape,
  options: {
    /** Gateway name, for apps that register two of a kind. Default: the shape. */
    name?: string
    webhookSecret?: string
    /** Epoch ms, for created dates and Stripe's signed timestamp. Default `Date.now`. */
    now?: () => number
  } = {},
): FakeGateway {
  const secret = options.webhookSecret ?? "whsec_signet_test_fake_secret"
  const now = options.now ?? Date.now
  const real: PaymentGateway =
    shape === "razorpay"
      ? razorpay({
          keyId: "rzp_test_fake",
          keySecret: "fake",
          webhookSecret: secret,
          fetch: offline,
        })
      : shape === "stripe"
        ? stripe({ secretKey: "sk_test_fake", webhookSecret: secret, fetch: offline })
        : payu({ key: "FAKEKEY", salt: secret, fetch: offline, sandbox: true })
  const name = options.name ?? real.name
  const calls: GatewayCall[] = []
  const payments = new Map<string, Payment>()
  const refunds: Refund[] = []
  const checkouts = new Map<
    string,
    Checkout & { email?: string; firstname?: string; productinfo?: string }
  >()
  let n = 0
  const id = (prefix: string) => `${prefix}${String(++n).padStart(6, "0")}FAKE`
  const log = (method: string, args: unknown[]) => calls.push({ method, args })
  const need = (f: Feature) => {
    if (!real.supports(f))
      throw new PaymentsError("UNSUPPORTED", `${name} does not support ${f}.`, { gateway: name })
  }
  const find = (gid: string) => {
    const p = payments.get(gid) ?? [...payments.values()].find((x) => x.orderId === gid)
    if (!p)
      throw new PaymentsError("NOT_FOUND", `No payment ${gid}.`, { gateway: name, status: 404 })
    return p
  }

  const gw: FakeGateway = {
    name,
    shape,
    capabilities: real.capabilities,
    supports: (f) => real.supports(f),
    calls,
    payments,
    refunds,
    webhookSecret: secret,

    async createCheckout(i) {
      log("createCheckout", [i])
      if (shape === "payu") {
        // The real adapter builds PayU's form offline; keep its checks and hash.
        const c = await real.createCheckout(i)
        const out = { ...c, gateway: name }
        const fields = c.form?.fields ?? {}
        checkouts.set(c.gatewayId, {
          ...out,
          email: fields.email,
          firstname: fields.firstname,
          productinfo: fields.productinfo,
        })
        return out
      }
      const gatewayId = id(shape === "razorpay" ? "order_" : "pi_")
      const c: Checkout = {
        gateway: name,
        gatewayId,
        amount: i.amount,
        currency: i.currency,
        ...(shape === "stripe" ? { clientSecret: `${gatewayId}_secret_fake` } : {}),
        raw: { id: gatewayId, fake: true },
      }
      checkouts.set(gatewayId, c)
      return c
    },

    async getPayment(gid) {
      log("getPayment", [gid])
      return find(gid)
    },

    async capture(gid, i) {
      log("capture", [gid, i])
      need("capture")
      const p = find(gid)
      if (p.status !== "authorized")
        throw new PaymentsError("BAD_INPUT", `Payment ${gid} is ${p.status}, not authorized.`, {
          gateway: name,
        })
      const next = { ...p, status: "captured" as const, amount: i.amount ?? p.amount }
      payments.set(p.gatewayId, next)
      return next
    },

    async refund(gid, i) {
      log("refund", [gid, i])
      need("refunds")
      const p = find(gid)
      const left = p.amount - (p.amountRefunded ?? 0)
      const amount = i.amount ?? left
      if (amount <= 0 || amount > left)
        throw new PaymentsError(
          "BAD_INPUT",
          `Refund of ${amount} exceeds ${left} left on ${gid}.`,
          { gateway: name },
        )
      const refunded = (p.amountRefunded ?? 0) + amount
      const status: PaymentStatus = refunded === p.amount ? "refunded" : "partially_refunded"
      payments.set(p.gatewayId, { ...p, amountRefunded: refunded, status })
      const r: Refund = {
        gateway: name,
        gatewayId: id(shape === "razorpay" ? "rfnd_" : shape === "stripe" ? "re_" : ""),
        paymentId: p.gatewayId,
        amount,
        currency: p.currency,
        status: "processed",
        createdAt: new Date(now()),
        raw: { fake: true, reason: i.reason },
      }
      refunds.push(r)
      return r
    },

    async createCustomer(i) {
      log("createCustomer", [i])
      need("customers")
      const c: Customer = {
        gateway: name,
        gatewayId: id(shape === "razorpay" ? "cust_" : "cus_"),
        createdAt: new Date(now()),
        raw: { fake: true },
        ...i,
      }
      return c
    },

    async listPaymentMethods(customerId) {
      log("listPaymentMethods", [customerId])
      need("savedMethods")
      return []
    },

    // Subscriptions, payouts and settlements: fall through to the real adapter,
    // which rejects UNSUPPORTED where the gateway lacks them and would otherwise
    // hit the (offline) network. Fake them with your own spy if a test needs them.
    getSubscription: (sid) => (log("getSubscription", [sid]), real.getSubscription(sid)),
    cancelSubscription: (sid, o) => (
      log("cancelSubscription", [sid, o]), real.cancelSubscription(sid, o)
    ),
    createPayout: (i) => (log("createPayout", [i]), real.createPayout(i)),
    listSettlements: (o) => (log("listSettlements", [o]), real.listSettlements(o)),
    raw: (m, p, b, o) => (log("raw", [m, p, b, o]), real.raw(m, p, b, o)),

    async verifyWebhook(req, o) {
      log("verifyWebhook", [req.url])
      const e = await real.verifyWebhook(req, { now, ...o })
      return { ...e, gateway: name }
    },

    async complete(checkoutId, o = {}) {
      const c = checkouts.get(checkoutId)
      if (!c) throw new Error(`signet-test: no checkout ${checkoutId}`)
      const status = o.status ?? "captured"
      const t = Math.floor(now() / 1000)
      const paymentId = shape === "razorpay" ? id("pay_") : checkoutId
      const p: Payment = {
        gateway: name,
        gatewayId: paymentId,
        amount: c.amount,
        currency: c.currency,
        status,
        amountRefunded: 0,
        createdAt: new Date(now()),
        raw: { fake: true },
        ...(shape === "razorpay" ? { orderId: checkoutId, method: "upi" } : {}),
      }
      payments.set(paymentId, p)
      const url = `https://app.example.test/webhooks/${name}`

      if (shape === "razorpay") {
        const event = status === "failed" ? "payment.failed" : `payment.${status}`
        const body = JSON.stringify({
          entity: "event",
          account_id: "acc_FAKE",
          event,
          contains: ["payment"],
          payload: {
            payment: {
              entity: {
                id: paymentId,
                entity: "payment",
                amount: c.amount,
                currency: c.currency,
                status,
                order_id: checkoutId,
                method: "upi",
                created_at: t,
              },
            },
          },
          created_at: t,
        })
        return new Request(url, {
          method: "POST",
          body,
          headers: {
            "content-type": "application/json",
            "x-razorpay-signature": await hmacHex(secret, body),
            "x-razorpay-event-id": id("evt_"),
          },
        })
      }

      if (shape === "stripe") {
        const type =
          status === "failed"
            ? "payment_intent.payment_failed"
            : status === "authorized"
              ? "payment_intent.amount_capturable_updated"
              : "payment_intent.succeeded"
        const body = JSON.stringify({
          id: id("evt_"),
          object: "event",
          type,
          created: t,
          data: {
            object: {
              id: paymentId,
              object: "payment_intent",
              amount: c.amount,
              amount_received: status === "captured" ? c.amount : 0,
              currency: c.currency.toLowerCase(),
              status:
                status === "captured"
                  ? "succeeded"
                  : status === "authorized"
                    ? "requires_capture"
                    : "requires_payment_method",
            },
          },
        })
        return new Request(url, {
          method: "POST",
          body,
          headers: {
            "content-type": "application/json",
            "stripe-signature": `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`,
          },
        })
      }

      // PayU: the form fields posted back, with the reverse hash.
      const d: Record<string, string> = {
        mihpayid: String(400000000000 + n),
        status: status === "failed" ? "failure" : "success",
        unmappedstatus:
          status === "authorized" ? "auth" : status === "failed" ? "failed" : "captured",
        key: "FAKEKEY",
        txnid: checkoutId,
        amount: (c.amount / 100).toFixed(2), // PayU is INR-only: two minor digits
        productinfo: c.productinfo ?? "Order",
        firstname: c.firstname ?? "",
        email: c.email ?? "",
        udf1: "",
        udf2: "",
        udf3: "",
        udf4: "",
        udf5: "",
      }
      d.hash = await sha512(
        [
          secret,
          d.status,
          "",
          "",
          "",
          "",
          "",
          d.udf5,
          d.udf4,
          d.udf3,
          d.udf2,
          d.udf1,
          d.email,
          d.firstname,
          d.productinfo,
          d.amount,
          d.txnid,
          d.key,
        ].join("|"),
      )
      return new Request(url, {
        method: "POST",
        body: JSON.stringify(d),
        headers: { "content-type": "application/json" },
      })
    },
  }
  return gw
}
