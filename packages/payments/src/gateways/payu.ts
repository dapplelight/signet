/**
 * PayU India. Checkout is a browser form POST to `/_payment` with a SHA-512
 * hash of `key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||SALT`;
 * this adapter returns that form (`checkout.form`). Server calls go to the
 * merchant postservice (`command`, `var1..`, hash `sha512(key|command|var1|salt)`).
 * Amounts on the wire are rupee strings ("10.00"); INR only. `gatewayId` is your
 * `txnid`.
 *
 * Webhooks carry no signature header: the payload's `hash` is checked with the
 * reverse hash `sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)`
 * (prefixed with `additional_charges|` when present). Payloads without a hash
 * (dispute notifications) cannot be verified and are rejected; split-payment
 * payloads (`splitInfo`) are rejected too.
 *
 * Manual capture: checkout adds `pre_authorize=1` (same hash), and `capture`
 * sends `capture_transaction` (var1 mihpayid, var2 your idempotency key as the
 * request token, var3 amount) to the same postservice host as verify.
 *
 * Unsupported: subscriptions (PayU standing instructions are merchant-run
 * `si_transaction` debits on a mandate, not a gateway-run subscription to get
 * or cancel), customers (PayU has none; saved cards hang off a user string),
 * payouts (a separate product with its own OAuth; its reference pages could not
 * be read, see the README).
 */

import { PaymentsError } from "../errors.js"
import {
  badSignature,
  defineGateway,
  type Json,
  request,
  safeEqual,
  sha512Hex,
  toDate,
  toMajor,
  toMinor,
  unsupported,
} from "../http.js"
import type { Event, HttpOptions, Payment, PaymentGateway, SettlementLine } from "../types.js"

export type PayUConfig = HttpOptions & {
  key: string
  salt: string
  /** Override the postservice URL. */
  postserviceUrl?: string
}

const G = "payu"
const pipe = (parts: unknown[]) =>
  parts.map((p) => (p === undefined || p === null ? "" : String(p))).join("|")

export function payu(config: PayUConfig): PaymentGateway {
  const payUrl =
    config.baseUrl ??
    (config.sandbox ? "https://test.payu.in/_payment" : "https://secure.payu.in/_payment")
  const postUrl =
    config.postserviceUrl ??
    (config.sandbox
      ? "https://test.payu.in/merchant/postservice.php?form=2"
      : "https://info.payu.in/merchant/postservice.php?form=2")

  async function command(cmd: string, vars: string[]): Promise<Json> {
    const fields: Record<string, string> = {
      key: config.key,
      command: cmd,
      hash: await sha512Hex(pipe([config.key, cmd, vars[0], config.salt])),
    }
    vars.forEach((v, i) => {
      fields[`var${i + 1}`] = v
    })
    return request(
      {
        gateway: G,
        method: "POST",
        url: postUrl,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
        retryable: cmd === "verify_payment" || cmd === "get_settlement_details",
      },
      config,
    )
  }

  async function verify(txnid: string): Promise<Payment> {
    const r: Json = await command("verify_payment", [txnid])
    const t = r.transaction_details?.[txnid]
    if (!t || t.status === "Not Found")
      throw new PaymentsError("NOT_FOUND", `payu: no transaction ${txnid}.`, { gateway: G, raw: r })
    return {
      gateway: G,
      gatewayId: txnid,
      orderId: t.mihpayid,
      amount: toMinor(String(t.amt ?? t.transaction_amount), "INR"),
      currency: "INR",
      status:
        t.status === "success"
          ? t.unmappedstatus === "auth"
            ? "authorized"
            : "captured"
          : t.status === "failure"
            ? "failed"
            : "pending",
      method: t.mode ?? undefined,
      createdAt: toDate(t.addedon),
      raw: t,
    }
  }

  return defineGateway(
    G,
    {
      methods: ["upi", "card", "netbanking", "wallet"],
      features: ["capture", "refunds", "partialRefunds", "settlements", "webhooks"],
      currencies: ["INR"],
    },
    {
      raw: async (method, path, body) => {
        if (method.toUpperCase() !== "POST" || path !== "/postservice")
          throw unsupported(
            G,
            `raw ${method} ${path} (only POST /postservice with { command, vars })`,
          )
        const b = body as { command: string; vars: string[] }
        return command(b.command, b.vars)
      },
      async createCheckout(i) {
        if (!i.returnUrl || !i.customer?.email || !i.customer.name)
          throw new PaymentsError(
            "BAD_INPUT",
            "PayU checkout needs returnUrl, customer.email and customer.name.",
            { gateway: G },
          )
        const f = {
          key: config.key,
          txnid: i.reference ?? i.idempotencyKey,
          amount: toMajor(i.amount, "INR"),
          productinfo: i.description ?? "Order",
          firstname: i.customer.name,
          email: i.customer.email,
        }
        const hash = await sha512Hex(
          pipe([
            f.key,
            f.txnid,
            f.amount,
            f.productinfo,
            f.firstname,
            f.email,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            config.salt,
          ]),
        )
        const fields = {
          ...f,
          phone: i.customer.phone ?? "",
          surl: i.returnUrl,
          furl: i.returnUrl,
          hash,
          // Pre-authorize only; the hash is unchanged.
          // https://docs.payu.in/docs/credit-card-merchant-hosted-integration-pre-authorize-payment
          ...(i.capture === "manual" ? { pre_authorize: "1" } : {}),
          ...(i.extra as Record<string, string>),
        }
        return {
          gateway: G,
          gatewayId: f.txnid,
          amount: i.amount,
          currency: "INR",
          form: { action: payUrl, fields },
          raw: fields,
        }
      },
      getPayment: verify,
      // capture_transaction on the postservice host (test.payu.in / info.payu.in).
      // https://docs.payu.in/docs/credit-card-merchant-hosted-integration-pre-authorize-payment (Step 3)
      // https://docs.payu.in/docs/debit-card-merchant-hosted-integration-preauthorize-payments
      async capture(txnid, i) {
        const p = await verify(txnid)
        const r: Json = await command("capture_transaction", [
          String(p.orderId),
          i.idempotencyKey,
          toMajor(i.amount ?? p.amount, "INR"),
        ])
        if (Number(r.status) !== 1)
          throw new PaymentsError("GATEWAY_ERROR", `payu capture: ${r.msg ?? "refused"}`, {
            gateway: G,
            raw: r,
          })
        // Capture is queued; the payment flips to captured when PayU processes it.
        return verify(txnid)
      },
      async refund(txnid, i) {
        const p = await verify(txnid)
        const amount = i.amount ?? p.amount
        const r: Json = await command("cancel_refund_transaction", [
          String(p.orderId),
          i.idempotencyKey,
          toMajor(amount, "INR"),
        ])
        if (Number(r.status) !== 1)
          throw new PaymentsError("GATEWAY_ERROR", `payu refund: ${r.msg ?? "refused"}`, {
            gateway: G,
            raw: r,
          })
        return {
          gateway: G,
          gatewayId: String(r.request_id),
          paymentId: txnid,
          amount,
          currency: "INR",
          status: "pending",
          createdAt: new Date(),
          raw: r,
        }
      },
      async listSettlements({ date }) {
        const r: Json = await command("get_settlement_details", [date])
        const rows: Json[] = Array.isArray(r.result) ? r.result : []
        const lines: SettlementLine[] = rows.map((x) => {
          const refund = String(x.requestaction ?? "")
            .toLowerCase()
            .includes("refund")
          const fee =
            toMinor(String(x.mer_service_fee ?? "0"), "INR") +
            toMinor(String(x.mer_service_tax ?? "0"), "INR")
          return {
            kind: refund ? "refund" : "payment",
            gatewayId: refund ? String(x.requestid) : String(x.txnId),
            paymentId: String(x.txnId),
            amount: toMinor(String(refund ? (x.requestamount ?? x.amount) : x.amount), "INR"),
            currency: "INR",
            fee,
            settlementId: x.mer_utr ?? undefined,
            createdAt: toDate(x.txndate),
            raw: x,
          }
        })
        return [{ gateway: G, date, lines, raw: r }]
      },
      async verifyWebhook(req) {
        const text = await req.text()
        let d: Record<string, string>
        try {
          d = JSON.parse(text)
        } catch {
          d = Object.fromEntries(new URLSearchParams(text))
        }
        if (!d.hash) throw badSignature(G, "payload has no hash to verify")
        if (d.splitInfo) throw badSignature(G, "split-payment payloads are not supported")
        if (d.key !== config.key) throw badSignature(G, "payload is for another merchant key")
        const parts = [
          config.salt,
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
        ]
        const expected = await sha512Hex(
          pipe(d.additional_charges ? [d.additional_charges, ...parts] : parts),
        )
        if (!safeEqual(expected, String(d.hash).toLowerCase())) throw badSignature(G)
        const ok = d.status === "success"
        const out: Event = {
          id: `${d.mihpayid}:${d.status}:${d.unmappedstatus ?? ""}`,
          gateway: G,
          type: ok
            ? d.unmappedstatus === "auth"
              ? "payment.authorized"
              : "payment.captured"
            : d.status === "failure"
              ? "payment.failed"
              : "unknown",
          gatewayType: `payment.${d.status}`,
          occurredAt: d.addedon ? toDate(d.addedon) : new Date(),
          paymentId: d.txnid,
          orderId: d.mihpayid,
          amount: d.amount ? toMinor(String(d.amount), "INR") : undefined,
          currency: "INR",
          raw: d,
        }
        return out
      },
    },
  )
}
