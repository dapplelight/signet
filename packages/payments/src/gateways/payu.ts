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
 * payouts (a separate product whose reference contradicts itself on body
 * format, the `pid` location and the production path; see the README).
 *
 * Settlements come from the Settlement Detail Range API (`GET /settlement/range`,
 * HMAC `sha512(body|date|salt)` over the Date header). PayU writes its
 * timestamps without a zone; they are read as IST (+05:30), the offset PayU
 * prints where it does give one.
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
  /** Override the Settlement Detail Range API URL. */
  settlementUrl?: string
}

const G = "payu"
/** PayU's zone-less "YYYY-MM-DD HH:mm:ss[.ffffff]" as IST; anything else via toDate. */
export function payuDate(v: unknown): Date {
  const m = typeof v === "string" && /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(v)
  return m ? new Date(`${m[1]}T${m[2]}+05:30`) : toDate(v)
}
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
  const rangeUrl =
    config.settlementUrl ??
    (config.sandbox
      ? "https://apitest.payu.in/settlement/range"
      : "https://info.payu.in/settlement/range")

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
        retryable: cmd === "verify_payment",
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
      createdAt: payuDate(t.addedon),
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
      // GET /settlement/range for one day, paged; each settlement (UTR) holds its
      // transactions, whose `action` is capture, refund, chargeback or an ADJ_* adjustment.
      // https://docs.payu.in/reference/settlement-detail-range-api
      async listSettlements({ date }) {
        const pageSize = 1000
        const pages: Json[] = []
        const rows: Json[] = []
        for (let page = 1; ; page++) {
          const now = new Date().toUTCString()
          const sig = await sha512Hex(`|${now}|${config.salt}`)
          const q = new URLSearchParams({
            dateFrom: date,
            dateTo: date,
            page: String(page),
            pageSize: String(pageSize),
          })
          const r: Json = await request(
            {
              gateway: G,
              method: "GET",
              url: `${rangeUrl}?${q}`,
              headers: {
                date: now,
                authorization: `hmac username="${config.key}", algorithm="sha512", headers="date", signature="${sig}"`,
              },
              retryable: true,
            },
            config,
          )
          if (Number(r.status) !== 0) {
            if (/no data/i.test(String(r.message ?? r.result))) break
            throw new PaymentsError(
              "GATEWAY_ERROR",
              `payu settlements: ${r.message ?? "refused"}`,
              {
                gateway: G,
                raw: r,
              },
            )
          }
          pages.push(r)
          const data: Json[] = Array.isArray(r.result?.data) ? r.result.data : []
          rows.push(...data)
          if (data.length < pageSize || page * pageSize >= Number(r.result?.totalCount ?? 0)) break
        }
        const amt = (v: unknown) => toMinor(String(v ?? "") || "0", "INR")
        const lines: SettlementLine[] = rows.flatMap((s) =>
          (Array.isArray(s.transaction) ? s.transaction : []).map((t: Json): SettlementLine => {
            const action = String(t.action ?? "").toLowerCase()
            const kind =
              action === "capture" ? "payment" : action === "refund" ? "refund" : "adjustment"
            const adj = action.startsWith("adj")
            return {
              kind,
              gatewayId: String(
                kind === "payment" ? t.merchantTransactionId : (t.requestId ?? t.payuId),
              ),
              ...(adj ? {} : { paymentId: String(t.merchantTransactionId) }),
              amount: amt(t.transactionAmount),
              currency: "INR",
              fee:
                t.totalProcessingFee !== undefined
                  ? amt(t.totalProcessingFee) + amt(t.totalServiceTax)
                  : amt(t.merchantServiceFee) + amt(t.merchantServiceTax),
              settlementId: s.settlementId === undefined ? undefined : String(s.settlementId),
              createdAt: payuDate(t.transactionDate),
              raw: t,
            }
          }),
        )
        return [{ gateway: G, date, lines, raw: pages }]
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
          occurredAt: d.addedon ? payuDate(d.addedon) : new Date(),
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
