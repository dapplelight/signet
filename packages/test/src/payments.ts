/**
 * Fake payment gateways: the real Razorpay, Stripe and PayU adapters, pointed
 * at an in-memory server that speaks each gateway's own API. Every interface
 * call goes through the real adapter (its request building, response parsing,
 * retries and error mapping), and the server answers in the gateway's real
 * formats: orders and payments, refunds, customers and saved methods,
 * subscriptions, payouts and settlement reports. Nothing reaches the network:
 * an unknown endpoint answers 404.
 *
 * Lifecycle helpers move the server's state the way the gateway would and
 * return its webhooks, signed in its format, for the real `verifyWebhook`:
 *
 *   const gw = fakeGateway("razorpay")
 *   const payments = createPayments({ gateways: [gw], db: memoryStore() })
 *   const c = await payments.checkout({ amount: 49900, currency: "INR", idempotencyKey: "k1" })
 *   await payments.handleWebhook("razorpay", await gw.complete(c.gatewayId))
 *
 * Failure injection: `gw.fail("decline" | "unavailable" | "timeout", { on, times })`.
 * Webhooks are plain Requests: `req.clone()` delivers one twice, and holding
 * one back delivers out of order.
 *
 * PayU has no gateway-run subscriptions, customers or payouts; those reject
 * UNSUPPORTED, as the real adapter does.
 */
import type { PaymentGateway } from "@dapplelight/signet-payments"
import { payu } from "@dapplelight/signet-payments/payu"
import { razorpay } from "@dapplelight/signet-payments/razorpay"
import { stripe } from "@dapplelight/signet-payments/stripe"
import type { FetchCall } from "./fetch.js"

export type GatewayShape = "razorpay" | "stripe" | "payu"

/** An interface call on the fake, in order. */
export type GatewayCall = { method: string; args: unknown[] }

/**
 * - `decline`: the gateway refuses (Razorpay and Stripe answer 402, so the
 *   adapter throws DECLINED; PayU answers status 0, GATEWAY_ERROR).
 * - `unavailable`: 503 before anything happens (GATEWAY_UNAVAILABLE once
 *   retries run out).
 * - `timeout`: the server does the work, then the response is lost. A keyed
 *   retry must get the stored answer, not do it twice.
 */
export type Fault = "decline" | "unavailable" | "timeout"

type Json = any

export type FakeGatewayState = {
  /** Gateway-format payment objects (Razorpay payment, Stripe PaymentIntent, PayU transaction), by id. */
  payments: Map<string, Json>
  /** Razorpay orders by id (other shapes keep none). */
  orders: Map<string, Json>
  refunds: Map<string, Json>
  customers: Map<string, Json>
  /** Saved methods (Razorpay tokens, Stripe PaymentMethods) by customer id. */
  methods: Map<string, Json[]>
  subscriptions: Map<string, Json>
  payouts: Map<string, Json>
}

export type FakeGateway = PaymentGateway & {
  readonly shape: GatewayShape
  /** Interface calls, in order. */
  readonly calls: GatewayCall[]
  /** HTTP requests the adapter made to the fake server. */
  readonly requests: FetchCall[]
  readonly state: FakeGatewayState
  readonly webhookSecret: string
  /** Make the next `times` (default 1) server requests matching `on` fail. `on` matches "METHOD /path" (PayU: the command name). */
  fail(fault: Fault, options?: { on?: string | RegExp; times?: number }): void
  /** The buyer finishes checkout: captured (default), authorized (manual capture) or failed (declined). */
  complete(
    checkoutId: string,
    options?: { status?: "captured" | "authorized" | "failed" },
  ): Promise<Request>
  /** Start an active subscription (the buyer authorised the mandate). Not on PayU. */
  subscribe(options: {
    plan: string
    amount?: number
    currency?: string
    customer?: string
    periodDays?: number
    notes?: Record<string, string>
  }): Promise<{ id: string; webhooks: Request[] }>
  /**
   * The billing cycle ends. Charges and moves the period on; with `fail`, the
   * charge fails (Razorpay halts, Stripe goes past_due). A subscription set to
   * cancel at period end is cancelled instead.
   */
  renew(subscriptionId: string, options?: { fail?: boolean }): Promise<Request[]>
  /** A payout finishes. Not on PayU. */
  settlePayout(payoutId: string, outcome: "processed" | "failed" | "reversed"): Promise<Request>
  /** Webhooks the server queued for changes made through the API (cancelSubscription, refund), oldest first. */
  takeWebhooks(): Promise<Request[]>
  /** Empty every map, queued webhook and fault. Ids keep counting. */
  reset(): void
}

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

/** PayU's zone-less IST timestamp. */
const istString = (ms: number) =>
  new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 19).replace("T", " ")
const major = (minor: number) => (minor / 100).toFixed(2)
const toMinorInr = (s: string) => Math.round(Number(s) * 100)
/** 2% gateway fee, rounded: plausible, and nonzero for settlement tests. */
const feeOf = (amount: number) => Math.round(amount * 0.02)

type Reply = { status: number; body: unknown }
const ok = (body: unknown): Reply => ({ status: 200, body })
const notFound = (what: string): Reply => ({
  status: 404,
  body: { error: { code: "BAD_REQUEST_ERROR", description: `${what} does not exist` } },
})

export function fakeGateway(
  shape: GatewayShape,
  options: {
    webhookSecret?: string
    /** Epoch ms for every timestamp the server writes, and Stripe's signature check. Default `Date.now`. */
    now?: () => number
  } = {},
): FakeGateway {
  const secret = options.webhookSecret ?? "whsec_signet_test_fake_secret"
  const now = options.now ?? Date.now
  const sec = () => Math.floor(now() / 1000)
  const state: FakeGatewayState = {
    payments: new Map(),
    orders: new Map(),
    refunds: new Map(),
    customers: new Map(),
    methods: new Map(),
    subscriptions: new Map(),
    payouts: new Map(),
  }
  const calls: GatewayCall[] = []
  const requests: FetchCall[] = []
  const faults: { fault: Fault; on?: string | RegExp; left: number }[] = []
  /** Idempotency keys: "METHOD path key" -> the request body and its (possibly in-flight) reply. */
  const replays = new Map<string, { body: string; reply: Promise<Reply> }>()
  /** PayU checkouts waiting for the buyer: txnid -> form fields. */
  const pending = new Map<string, Record<string, string>>()
  let queued: Promise<Request>[] = []
  let n = 0
  const id = (prefix: string) => `${prefix}${String(++n).padStart(6, "0")}FAKE`
  const url = `https://app.example.test/webhooks/${shape}`

  // ------------------------------------------------------------ webhooks

  async function razorpayHook(event: string, payload: Record<string, Json>): Promise<Request> {
    const body = JSON.stringify({
      entity: "event",
      account_id: "acc_FAKE",
      event,
      contains: Object.keys(payload),
      payload: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, { entity: v }])),
      created_at: sec(),
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

  async function stripeHook(type: string, object: Json): Promise<Request> {
    const t = sec()
    const body = JSON.stringify({
      id: id("evt_"),
      object: "event",
      type,
      created: t,
      data: { object: structuredClone(object) },
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

  async function payuHook(t: Json): Promise<Request> {
    const f = t.form as Record<string, string>
    const d: Record<string, string> = {
      mihpayid: t.mihpayid,
      status: t.status,
      unmappedstatus: t.unmappedstatus,
      key: f.key as string,
      txnid: t.txnid,
      amount: f.amount as string,
      productinfo: f.productinfo as string,
      firstname: f.firstname as string,
      email: f.email as string,
      udf1: "",
      udf2: "",
      udf3: "",
      udf4: "",
      udf5: "",
      addedon: t.addedon,
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
  }

  // ------------------------------------------------------------ server

  const stripeCharge = (pi: Json) => pi.latest_charge as Json

  function razorpayRoute(method: string, path: string, json: Json): Reply {
    /** Match the path; the first group, decoded, lands in `seg`. */
    let seg = ""
    const at = (re: RegExp) => {
      const r = re.exec(path)
      seg = r ? decodeURIComponent(r[1] ?? "") : ""
      return r !== null
    }
    if (method === "POST" && path === "/v1/orders") {
      const o = {
        id: id("order_"),
        entity: "order",
        amount: json.amount,
        amount_paid: 0,
        amount_due: json.amount,
        currency: json.currency,
        receipt: json.receipt,
        status: "created",
        notes: json.notes ?? [],
        capture: json.payment?.capture ?? "automatic",
        created_at: sec(),
      }
      state.orders.set(o.id, o)
      return ok(o)
    }
    if (at(/^\/v1\/payments\/([^/]+)$/) && method === "GET") {
      const p = state.payments.get(seg)
      return p ? ok(p) : notFound("payment")
    }
    if (at(/^\/v1\/payments\/([^/]+)\/capture$/) && method === "POST") {
      const p = state.payments.get(seg)
      if (!p) return notFound("payment")
      if (p.status !== "authorized")
        return {
          status: 400,
          body: { error: { code: "BAD_REQUEST_ERROR", description: `payment is ${p.status}` } },
        }
      p.status = "captured"
      p.captured = true
      p.amount = json.amount ?? p.amount
      p.fee = feeOf(p.amount)
      queued.push(razorpayHook("payment.captured", { payment: p }))
      return ok(p)
    }
    if (at(/^\/v1\/payments\/([^/]+)\/refund$/) && method === "POST") {
      const p = state.payments.get(seg)
      if (!p) return notFound("payment")
      const left = p.amount - p.amount_refunded
      const amount = json.amount ?? left
      if (p.status !== "captured" || amount <= 0 || amount > left)
        return {
          status: 400,
          body: {
            error: {
              code: "BAD_REQUEST_ERROR",
              description: "The refund amount provided is greater than amount captured",
            },
          },
        }
      p.amount_refunded += amount
      p.refund_status = p.amount_refunded === p.amount ? "full" : "partial"
      const r = {
        id: id("rfnd_"),
        entity: "refund",
        amount,
        currency: p.currency,
        payment_id: p.id,
        notes: json.notes ?? [],
        status: "processed",
        speed_processed: "normal",
        created_at: sec(),
      }
      state.refunds.set(r.id, r)
      queued.push(razorpayHook("refund.processed", { refund: r, payment: p }))
      return ok(r)
    }
    if (method === "POST" && path === "/v1/customers") {
      const c = {
        id: id("cust_"),
        entity: "customer",
        name: json.name ?? null,
        email: json.email ?? null,
        contact: json.contact ?? null,
        created_at: sec(),
      }
      state.customers.set(c.id, c)
      return ok(c)
    }
    if (at(/^\/v1\/customers\/([^/]+)\/tokens$/) && method === "GET") {
      const cid = seg
      if (!state.customers.has(cid)) return notFound("customer")
      const items = state.methods.get(cid) ?? []
      return ok({ entity: "collection", count: items.length, items })
    }
    if (at(/^\/v1\/subscriptions\/([^/]+)$/) && method === "GET") {
      const s = state.subscriptions.get(seg)
      return s ? ok(s) : notFound("subscription")
    }
    if (at(/^\/v1\/subscriptions\/([^/]+)\/cancel$/) && method === "POST") {
      const s = state.subscriptions.get(seg)
      if (!s) return notFound("subscription")
      if (s.status === "cancelled" || s.status === "completed")
        return {
          status: 400,
          body: {
            error: { code: "BAD_REQUEST_ERROR", description: "Subscription is not cancellable" },
          },
        }
      if (json.cancel_at_cycle_end) s.cancel_at_cycle_end = true
      else {
        s.status = "cancelled"
        s.ended_at = sec()
        queued.push(razorpayHook("subscription.cancelled", { subscription: s }))
      }
      return ok(s)
    }
    if (method === "POST" && path === "/v1/payouts") {
      const p = {
        id: id("pout_"),
        entity: "payout",
        fund_account_id: json.fund_account_id,
        amount: json.amount,
        currency: json.currency,
        fees: 0,
        tax: 0,
        status: "processing",
        purpose: json.purpose,
        utr: null,
        mode: json.mode,
        reference_id: json.reference_id ?? null,
        failure_reason: null,
        created_at: sec(),
      }
      state.payouts.set(p.id, p)
      return ok(p)
    }
    if (method === "GET" && path === "/v1/settlements/recon/combined") return ok(razorpayRecon())
    return notFound(`${method} ${path}`)
  }

  function sameDay(createdSec: number, q: URLSearchParams) {
    const d = new Date(createdSec * 1000).toISOString().slice(0, 10)
    return d === `${q.get("year")}-${q.get("month")}-${q.get("day")}`
  }
  let query = new URLSearchParams()
  function razorpayRecon() {
    const items: Json[] = []
    for (const p of state.payments.values())
      if (p.captured && sameDay(p.created_at, query))
        items.push({
          entity_id: p.id,
          type: "payment",
          amount: p.amount,
          currency: p.currency,
          fee: p.fee,
          tax: 0,
          settlement_id: "setl_FAKE",
          settled: true,
          created_at: p.created_at,
        })
    for (const r of state.refunds.values())
      if (sameDay(r.created_at, query))
        items.push({
          entity_id: r.id,
          type: "refund",
          payment_id: r.payment_id,
          amount: r.amount,
          currency: r.currency,
          fee: 0,
          tax: 0,
          settlement_id: "setl_FAKE",
          settled: true,
          created_at: r.created_at,
        })
    const skip = Number(query.get("skip") ?? 0)
    const count = Number(query.get("count") ?? 1000)
    const page = items.slice(skip, skip + count)
    return { entity: "collection", count: page.length, items: page }
  }

  const balance: Json[] = []
  function stripeRoute(method: string, path: string, f: URLSearchParams): Reply {
    /** Match the path; the first group, decoded, lands in `seg`. */
    let seg = ""
    const at = (re: RegExp) => {
      const r = re.exec(path)
      seg = r ? decodeURIComponent(r[1] ?? "") : ""
      return r !== null
    }
    if (method === "POST" && path === "/v1/payment_intents") {
      const pid = id("pi_")
      const pi = {
        id: pid,
        object: "payment_intent",
        amount: Number(f.get("amount")),
        amount_received: 0,
        currency: f.get("currency"),
        status: "requires_payment_method",
        capture_method: f.get("capture_method") ?? "automatic",
        client_secret: `${pid}_secret_fake`,
        customer: f.get("customer"),
        description: f.get("description"),
        metadata: Object.fromEntries(
          [...f.entries()]
            .filter(([k]) => k.startsWith("metadata["))
            .map(([k, v]) => [k.slice(9, -1), v]),
        ),
        payment_method_types: ["card"],
        latest_charge: null,
        created: sec(),
      }
      state.payments.set(pi.id, pi)
      return ok(pi)
    }
    if (at(/^\/v1\/payment_intents\/([^/]+)$/) && method === "GET") {
      const pi = state.payments.get(seg)
      return pi ? ok(pi) : stripeMissing("payment_intent")
    }
    if (at(/^\/v1\/payment_intents\/([^/]+)\/capture$/) && method === "POST") {
      const pi = state.payments.get(seg)
      if (!pi) return stripeMissing("payment_intent")
      if (pi.status !== "requires_capture")
        return {
          status: 400,
          body: {
            error: { type: "invalid_request_error", code: "payment_intent_unexpected_state" },
          },
        }
      pi.amount_received = Number(f.get("amount_to_capture") ?? pi.amount)
      pi.status = "succeeded"
      stripeSettle(pi)
      queued.push(stripeHook("payment_intent.succeeded", pi))
      return ok(pi)
    }
    if (method === "POST" && path === "/v1/refunds") {
      const pi = state.payments.get(f.get("payment_intent") ?? "")
      if (!pi) return stripeMissing("payment_intent")
      const ch = stripeCharge(pi)
      const left = pi.amount_received - (ch?.amount_refunded ?? 0)
      const amount = Number(f.get("amount") ?? left)
      if (pi.status !== "succeeded" || amount <= 0 || amount > left)
        return {
          status: 400,
          body: { error: { type: "invalid_request_error", code: "amount_too_large" } },
        }
      ch.amount_refunded += amount
      ch.refunded = ch.amount_refunded === pi.amount_received
      const r = {
        id: id("re_"),
        object: "refund",
        amount,
        currency: pi.currency,
        payment_intent: pi.id,
        charge: ch.id,
        status: "succeeded",
        created: sec(),
      }
      state.refunds.set(r.id, r)
      balance.push({
        id: id("txn_"),
        object: "balance_transaction",
        type: "refund",
        amount: -amount,
        currency: pi.currency,
        fee: 0,
        created: r.created,
        source: { id: r.id, object: "refund", payment_intent: pi.id },
      })
      queued.push(stripeHook("refund.updated", r))
      return ok(r)
    }
    if (method === "POST" && path === "/v1/customers") {
      const c = {
        id: id("cus_"),
        object: "customer",
        email: f.get("email"),
        name: f.get("name"),
        phone: f.get("phone"),
        created: sec(),
      }
      state.customers.set(c.id, c)
      return ok(c)
    }
    if (at(/^\/v1\/customers\/([^/]+)\/payment_methods$/) && method === "GET") {
      const cid = seg
      if (!state.customers.has(cid)) return stripeMissing("customer")
      return ok({ object: "list", data: state.methods.get(cid) ?? [], has_more: false })
    }
    if (at(/^\/v1\/subscriptions\/([^/]+)$/)) {
      const s = state.subscriptions.get(seg)
      if (!s) return stripeMissing("subscription")
      if (method === "GET") return ok(s)
      if (method === "DELETE") {
        if (s.status === "canceled")
          return { status: 400, body: { error: { type: "invalid_request_error" } } }
        s.status = "canceled"
        s.canceled_at = sec()
        s.ended_at = sec()
        queued.push(stripeHook("customer.subscription.deleted", s))
        return ok(s)
      }
      if (method === "POST") {
        if (f.get("cancel_at_period_end") === "true") s.cancel_at_period_end = true
        queued.push(stripeHook("customer.subscription.updated", s))
        return ok(s)
      }
    }
    if (method === "POST" && path === "/v1/payouts") {
      const p = {
        id: id("po_"),
        object: "payout",
        amount: Number(f.get("amount")),
        currency: f.get("currency"),
        destination: f.get("destination"),
        status: "pending",
        method: "standard",
        arrival_date: sec() + 2 * 86400,
        failure_code: null,
        metadata: f.get("metadata[reference]") ? { reference: f.get("metadata[reference]") } : {},
        created: sec(),
      }
      state.payouts.set(p.id, p)
      return ok(p)
    }
    if (method === "GET" && path === "/v1/balance_transactions") {
      const gte = Number(query.get("created[gte]") ?? 0)
      const lt = Number(query.get("created[lt]") ?? Number.MAX_SAFE_INTEGER)
      const after = query.get("starting_after")
      let rows = balance.filter((t) => t.created >= gte && t.created < lt)
      if (after) rows = rows.slice(rows.findIndex((t) => t.id === after) + 1)
      const limit = Number(query.get("limit") ?? 10)
      return ok({ object: "list", data: rows.slice(0, limit), has_more: rows.length > limit })
    }
    return stripeMissing(`${method} ${path}`)
  }
  const stripeMissing = (what: string): Reply => ({
    status: 404,
    body: {
      error: {
        type: "invalid_request_error",
        code: "resource_missing",
        message: `No such ${what}`,
      },
    },
  })
  function stripeSettle(pi: Json) {
    const fee = feeOf(pi.amount_received)
    pi.latest_charge = {
      id: id("ch_"),
      object: "charge",
      amount: pi.amount_received,
      amount_refunded: 0,
      refunded: false,
      payment_intent: pi.id,
      payment_method_details: { type: "card" },
      balance_transaction: { id: id("txn_"), fee },
    }
    balance.push({
      id: pi.latest_charge.balance_transaction.id,
      object: "balance_transaction",
      type: "charge",
      amount: pi.amount_received,
      currency: pi.currency,
      fee,
      created: sec(),
      source: { id: pi.latest_charge.id, object: "charge", payment_intent: pi.id },
    })
  }

  async function payuRoute(f: URLSearchParams, path: string): Promise<Reply> {
    if (path === "/settlement/range") return ok(payuSettlements())
    const cmd = f.get("command") ?? ""
    const var1 = f.get("var1") ?? ""
    if (f.get("hash") !== (await sha512(`FAKEKEY|${cmd}|${var1}|${secret}`)))
      return ok({ status: 0, msg: "Invalid Hash." })
    const byMihpayid = (v: string) => [...state.payments.values()].find((t) => t.mihpayid === v)
    if (cmd === "verify_payment") {
      const details: Record<string, Json> = {}
      for (const txnid of var1.split("|")) {
        const t = state.payments.get(txnid)
        details[txnid] = t
          ? {
              mihpayid: t.mihpayid,
              txnid,
              status: t.status,
              unmappedstatus: t.unmappedstatus,
              amt: t.amt,
              transaction_amount: t.amt,
              mode: t.mode,
              addedon: t.addedon,
            }
          : { mihpayid: "Not Found", status: "Not Found" }
      }
      return ok({
        status: 1,
        msg: `${Object.keys(details).length} out of ${Object.keys(details).length} Transactions Fetched Successfully`,
        transaction_details: details,
      })
    }
    if (cmd === "capture_transaction") {
      const t = byMihpayid(var1)
      if (t?.unmappedstatus !== "auth") return ok({ status: 0, msg: "Capture not allowed" })
      t.unmappedstatus = "captured"
      t.amt = f.get("var3") ?? t.amt
      return ok({ status: 1, msg: "Capture Request Queued", mihpayid: var1 })
    }
    if (cmd === "cancel_refund_transaction") {
      const t = byMihpayid(var1)
      const token = f.get("var2") ?? ""
      const amount = toMinorInr(f.get("var3") ?? "0")
      if (t?.status !== "success") return ok({ status: 0, msg: "Invalid payuid" })
      if (amount <= 0 || amount > toMinorInr(t.amt) - t.refunded)
        return ok({ status: 0, msg: "Refund amount exceeds the transaction amount" })
      t.refunded += amount
      const r = {
        request_id: String(100 + ++n),
        token,
        mihpayid: var1,
        txnid: t.txnid,
        amount: major(amount),
        status: "queued",
        created: now(),
      }
      state.refunds.set(r.request_id, r)
      return ok({
        status: 1,
        msg: "Refund Request Queued",
        request_id: r.request_id,
        mihpayid: var1,
        amount: r.amount,
      })
    }
    return ok({ status: 0, msg: `unknown command ${cmd}` })
  }

  function payuSettlements() {
    const date = query.get("dateFrom")
    const txns: Json[] = []
    for (const t of state.payments.values())
      if (t.status === "success" && t.unmappedstatus === "captured" && t.addedon.startsWith(date))
        txns.push({
          action: "capture",
          payuId: t.mihpayid,
          merchantTransactionId: t.txnid,
          transactionAmount: t.amt,
          merchantServiceFee: major(feeOf(toMinorInr(t.amt))),
          merchantServiceTax: "0.00",
          transactionDate: t.addedon,
        })
    for (const r of state.refunds.values())
      if (istString(r.created).startsWith(date ?? ""))
        txns.push({
          action: "refund",
          payuId: r.mihpayid,
          requestId: r.request_id,
          merchantTransactionId: r.txnid,
          transactionAmount: r.amount,
          merchantServiceFee: "0.00",
          merchantServiceTax: "0.00",
          transactionDate: istString(r.created),
        })
    if (!txns.length) return { status: 1, message: "No data found" }
    return {
      status: 0,
      result: {
        page: 1,
        size: 1000,
        totalCount: 1,
        data: [{ settlementId: "FAKE-UTR-1", transaction: txns }],
      },
    }
  }

  const declineBody =
    shape === "razorpay"
      ? {
          error: {
            code: "BAD_REQUEST_ERROR",
            description: "Payment was declined",
            reason: "payment_declined",
          },
        }
      : { error: { type: "card_error", code: "card_declined", decline_code: "generic_decline" } }

  const server = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(input instanceof Request ? input.url : input))
    const method = (init.method ?? "GET").toUpperCase()
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v
    })
    const body = typeof init.body === "string" ? init.body : undefined
    requests.push({ method, url: u.toString(), path: u.pathname, headers, body })
    query = u.searchParams
    const form = new URLSearchParams(body && !body.startsWith("{") ? body : "")
    const label =
      shape === "payu"
        ? `${method} ${u.pathname} ${form.get("command") ?? ""}`
        : `${method} ${u.pathname}`

    const fault = faults.find(
      (x) =>
        x.left > 0 &&
        (!x.on || (typeof x.on === "string" ? label.includes(x.on) : x.on.test(label))),
    )
    if (fault) fault.left--
    if (fault?.fault === "unavailable")
      return Response.json({ error: { description: "Service unavailable" } }, { status: 503 })
    if (fault?.fault === "decline")
      return shape === "payu"
        ? Response.json({ status: 0, msg: "Transaction declined by bank" })
        : Response.json(declineBody, { status: 402 })

    // Idempotent replay, as the gateways do for a repeated key.
    const key =
      headers["idempotency-key"] ??
      headers["x-refund-idempotency"] ??
      headers["x-payout-idempotency"] ??
      (form.get("command") === "cancel_refund_transaction" ? `payu:${form.get("var2")}` : undefined)
    const route = async (): Promise<Reply> => {
      const r =
        shape === "razorpay"
          ? razorpayRoute(method, u.pathname, body ? JSON.parse(body) : {})
          : shape === "stripe"
            ? stripeRoute(method, u.pathname, form)
            : await payuRoute(form, u.pathname)
      return { status: r.status, body: structuredClone(r.body) }
    }
    let reply: Reply
    if (key && method === "POST") {
      // Scoped to the endpoint like the gateways; the same key with another
      // body is the caller's bug, which the real gateways reject.
      const slot = `${method} ${u.pathname} ${key}`
      const seen = replays.get(slot)
      if (seen && seen.body !== (body ?? "")) {
        reply = {
          status: 400,
          body: {
            error: {
              code: "idempotency_error",
              description: "Idempotency key reused with a different request body",
            },
          },
        }
      } else if (seen) {
        reply = structuredClone(await seen.reply)
      } else {
        // Stored before it settles, so a concurrent repeat waits for this one.
        const pending = route()
        replays.set(slot, { body: body ?? "", reply: pending })
        reply = await pending
        if (reply.status >= 500) replays.delete(slot)
      }
    } else reply = await route()
    if (fault?.fault === "timeout")
      throw new DOMException("signet-test: response lost (injected timeout)", "TimeoutError")
    return Response.json(reply.body, { status: reply.status })
  }) as typeof fetch

  // ------------------------------------------------------------ adapter

  const http = { fetch: server, retryDelayMs: 0, sandbox: true }
  const real: PaymentGateway =
    shape === "razorpay"
      ? razorpay({
          keyId: "rzp_test_fake",
          keySecret: "fake",
          webhookSecret: secret,
          accountNumber: "7878780080316316",
          ...http,
        })
      : shape === "stripe"
        ? stripe({ secretKey: "sk_test_fake", webhookSecret: secret, ...http })
        : payu({ key: "FAKEKEY", salt: secret, ...http })

  const logged =
    <A extends unknown[], R>(method: string, fn: (...a: A) => Promise<R>) =>
    (...args: A) => {
      calls.push({ method, args })
      return fn(...args)
    }

  const needs = (feature: "subscriptions" | "payouts") => {
    if (!real.supports(feature))
      throw new Error(
        `signet-test: ${shape} has no ${feature} (the real adapter rejects them UNSUPPORTED)`,
      )
  }

  const gw: FakeGateway = {
    name: real.name,
    capabilities: real.capabilities,
    supports: (f) => real.supports(f),
    shape,
    calls,
    requests,
    state,
    webhookSecret: secret,
    createCheckout: logged("createCheckout", async (i) => {
      const c = await real.createCheckout(i)
      if (shape === "payu") pending.set(c.gatewayId, { ...(c.form?.fields ?? {}) })
      return c
    }),
    getPayment: logged("getPayment", real.getPayment),
    capture: logged("capture", real.capture),
    refund: logged("refund", real.refund),
    createCustomer: logged("createCustomer", real.createCustomer),
    listPaymentMethods: logged("listPaymentMethods", real.listPaymentMethods),
    getSubscription: logged("getSubscription", real.getSubscription),
    cancelSubscription: logged("cancelSubscription", real.cancelSubscription),
    createPayout: logged("createPayout", real.createPayout),
    listSettlements: logged("listSettlements", real.listSettlements),
    raw: logged("raw", real.raw),
    verifyWebhook: logged("verifyWebhook", (req, o) => real.verifyWebhook(req, { now, ...o })),

    fail(fault, o = {}) {
      faults.push({ fault, on: o.on, left: o.times ?? 1 })
    },

    async complete(checkoutId, o = {}) {
      const status = o.status ?? "captured"
      if (shape === "razorpay") {
        const order = state.orders.get(checkoutId)
        if (!order) throw new Error(`signet-test: no order ${checkoutId}`)
        const auto = order.capture !== "manual" && status === "captured"
        const p = {
          id: id("pay_"),
          entity: "payment",
          amount: order.amount,
          currency: order.currency,
          status:
            status === "failed"
              ? "failed"
              : auto || status === "captured"
                ? "captured"
                : "authorized",
          order_id: order.id,
          method: "upi",
          amount_refunded: 0,
          refund_status: null,
          captured: status === "captured",
          fee: status === "captured" ? feeOf(order.amount) : null,
          tax: 0,
          error_code: status === "failed" ? "BAD_REQUEST_ERROR" : null,
          error_description: status === "failed" ? "Payment was declined by the bank" : null,
          notes: order.notes,
          created_at: sec(),
        }
        state.payments.set(p.id, p)
        if (status === "captured") {
          order.status = "paid"
          order.amount_paid = order.amount
          order.amount_due = 0
        } else order.status = "attempted"
        return razorpayHook(`payment.${p.status}`, { payment: p })
      }
      if (shape === "stripe") {
        const pi = state.payments.get(checkoutId)
        if (!pi) throw new Error(`signet-test: no PaymentIntent ${checkoutId}`)
        if (status === "failed") {
          pi.status = "requires_payment_method"
          pi.last_payment_error = {
            type: "card_error",
            code: "card_declined",
            decline_code: "generic_decline",
          }
          return stripeHook("payment_intent.payment_failed", pi)
        }
        if (status === "authorized" || pi.capture_method === "manual") {
          pi.status = "requires_capture"
          pi.amount_capturable = pi.amount
          return stripeHook("payment_intent.amount_capturable_updated", pi)
        }
        pi.status = "succeeded"
        pi.amount_received = pi.amount
        stripeSettle(pi)
        return stripeHook("payment_intent.succeeded", pi)
      }
      const fields = pending.get(checkoutId)
      if (!fields) throw new Error(`signet-test: no PayU checkout ${checkoutId}`)
      const t = {
        txnid: checkoutId,
        mihpayid: String(403993715000 + ++n),
        status: status === "failed" ? "failure" : "success",
        unmappedstatus:
          status === "failed"
            ? "failed"
            : status === "authorized" || fields.pre_authorize
              ? "auth"
              : "captured",
        amt: fields.amount,
        mode: "UPI",
        addedon: istString(now()),
        refunded: 0,
        form: fields,
      }
      state.payments.set(checkoutId, t)
      return payuHook(t)
    },

    async subscribe(o) {
      needs("subscriptions")
      const days = o.periodDays ?? 30
      const amount = o.amount ?? (shape === "razorpay" ? 49900 : 1999)
      const currency = o.currency ?? (shape === "razorpay" ? "INR" : "usd")
      const start = sec()
      if (shape === "razorpay") {
        const s = {
          id: id("sub_"),
          entity: "subscription",
          plan_id: o.plan,
          customer_id: o.customer ?? null,
          status: "active",
          current_start: start,
          current_end: start + days * 86400,
          ended_at: null,
          quantity: 1,
          notes: o.notes ?? [],
          charge_at: start + days * 86400,
          start_at: start,
          total_count: 12,
          paid_count: 1,
          remaining_count: 11,
          customer_notify: true,
          cancel_at_cycle_end: false,
          created_at: start,
          period_days: days,
          amount,
          currency,
        }
        state.subscriptions.set(s.id, s)
        const p = subscriptionPayment(s)
        return {
          id: s.id,
          webhooks: [
            await razorpayHook("subscription.activated", { subscription: s }),
            await razorpayHook("subscription.charged", { subscription: s, payment: p }),
          ],
        }
      }
      const s = {
        id: id("sub_"),
        object: "subscription",
        status: "active",
        customer: o.customer ?? id("cus_"),
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        created: start,
        start_date: start,
        metadata: o.notes ?? {},
        items: {
          object: "list",
          data: [
            {
              id: id("si_"),
              object: "subscription_item",
              price: {
                id: o.plan,
                object: "price",
                unit_amount: amount,
                currency,
                recurring: { interval: "day", interval_count: days },
              },
              current_period_start: start,
              current_period_end: start + days * 86400,
            },
          ],
        },
      }
      state.subscriptions.set(s.id, s)
      if (!state.methods.has(s.customer))
        state.methods.set(s.customer, [
          {
            id: id("pm_"),
            object: "payment_method",
            type: "card",
            card: { brand: "visa", last4: "4242" },
            created: start,
          },
        ])
      const pi = subscriptionPayment(s)
      return {
        id: s.id,
        webhooks: [
          await stripeHook("customer.subscription.created", s),
          await stripeHook("payment_intent.succeeded", pi),
        ],
      }
    },

    async renew(subId, o = {}) {
      needs("subscriptions")
      const s = state.subscriptions.get(subId)
      if (!s) throw new Error(`signet-test: no subscription ${subId}`)
      if (shape === "razorpay") {
        if (s.status === "cancelled" || s.status === "completed")
          throw new Error(`signet-test: subscription ${subId} is ${s.status}`)
        if (s.cancel_at_cycle_end) {
          s.status = "cancelled"
          s.ended_at = s.current_end
          return [await razorpayHook("subscription.cancelled", { subscription: s })]
        }
        if (o.fail) {
          s.status = "halted"
          s.auth_attempts = 4
          return [await razorpayHook("subscription.halted", { subscription: s })]
        }
        s.status = "active"
        s.current_start = s.current_end
        s.current_end += s.period_days * 86400
        s.charge_at = s.current_end
        s.paid_count++
        s.remaining_count--
        const p = subscriptionPayment(s)
        return [await razorpayHook("subscription.charged", { subscription: s, payment: p })]
      }
      if (s.status === "canceled") throw new Error(`signet-test: subscription ${subId} is canceled`)
      const item = s.items.data[0]
      if (s.cancel_at_period_end) {
        s.status = "canceled"
        s.ended_at = item.current_period_end
        return [await stripeHook("customer.subscription.deleted", s)]
      }
      if (o.fail) {
        s.status = "past_due"
        return [await stripeHook("customer.subscription.updated", s)]
      }
      s.status = "active"
      const len = item.current_period_end - item.current_period_start
      item.current_period_start = item.current_period_end
      item.current_period_end += len
      const pi = subscriptionPayment(s)
      return [
        await stripeHook("payment_intent.succeeded", pi),
        await stripeHook("customer.subscription.updated", s),
      ]
    },

    async settlePayout(payoutId, outcome) {
      needs("payouts")
      const p = state.payouts.get(payoutId)
      if (!p) throw new Error(`signet-test: no payout ${payoutId}`)
      if (shape === "razorpay") {
        p.status = outcome
        if (outcome === "processed") p.utr = `FAKEUTR${n}`
        if (outcome === "failed") p.failure_reason = "Beneficiary bank is offline"
        return razorpayHook(`payout.${outcome}`, { payout: p })
      }
      if (outcome === "reversed") throw new Error("signet-test: Stripe payouts are not reversed")
      p.status = outcome === "processed" ? "paid" : "failed"
      if (outcome === "failed") p.failure_code = "account_closed"
      else
        balance.push({
          id: id("txn_"),
          object: "balance_transaction",
          type: "payout",
          amount: -p.amount,
          currency: p.currency,
          fee: 0,
          created: sec(),
          source: { id: p.id, object: "payout" },
        })
      return stripeHook(outcome === "processed" ? "payout.paid" : "payout.failed", p)
    },

    async takeWebhooks() {
      const out = await Promise.all(queued)
      queued = []
      return out
    },

    reset() {
      for (const m of Object.values(state)) m.clear()
      faults.length = 0
      replays.clear()
      pending.clear()
      balance.length = 0
      queued = []
      calls.length = 0
      requests.length = 0
    },
  }

  /** The payment a subscription charge creates, stored on the server. */
  function subscriptionPayment(s: Json): Json {
    if (shape === "razorpay") {
      const p = {
        id: id("pay_"),
        entity: "payment",
        amount: s.amount,
        currency: s.currency,
        status: "captured",
        order_id: null,
        invoice_id: id("inv_"),
        method: "card",
        amount_refunded: 0,
        captured: true,
        fee: feeOf(s.amount),
        tax: 0,
        customer_id: s.customer_id,
        created_at: sec(),
      }
      state.payments.set(p.id, p)
      return p
    }
    const price = s.items.data[0].price
    const pi = {
      id: id("pi_"),
      object: "payment_intent",
      amount: price.unit_amount,
      amount_received: price.unit_amount,
      currency: price.currency,
      status: "succeeded",
      customer: s.customer,
      invoice: id("in_"),
      metadata: {},
      payment_method_types: ["card"],
      latest_charge: null,
      created: sec(),
    }
    state.payments.set(pi.id, pi)
    stripeSettle(pi)
    return pi
  }

  return gw
}
