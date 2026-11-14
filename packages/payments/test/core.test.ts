import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { paymentTools } from "../src/agent"
import { isPaymentsError, PaymentsError } from "../src/errors"
import { razorpay } from "../src/gateways/razorpay"
import { defineGateway, toMajor, toMinor } from "../src/http"
import { post, postings, receivable, toEntries } from "../src/ledger"
import { createPayments } from "../src/payments"
import { reconcile } from "../src/reconcile"
import { memoryStore, type PaymentsStore, paymentsSchema, sqlStore } from "../src/store"
import { fakeFetch } from "./fake"

const SECRET = "whsec_made_up"

const fail = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p)
    return "OK"
  } catch (e) {
    return isPaymentsError(e) ? e.code : String(e)
  }
}

function sqliteStore(): PaymentsStore {
  const db = new Database(":memory:")
  for (const s of paymentsSchema("sqlite")) db.run(s)
  return sqlStore(
    { query: (s, p) => db.query(s).all(...(p as never[])) as Record<string, unknown>[] },
    { dialect: "sqlite" },
  )
}

function rzpHook(
  event: string,
  entity: Record<string, unknown>,
  id: string,
  at: number,
  key = "payment",
) {
  const body = JSON.stringify({
    entity: "event",
    event,
    payload: { [key]: { entity } },
    created_at: at,
  })
  return new Request("https://shop.example.test/hooks/razorpay", {
    method: "POST",
    body,
    headers: {
      "x-razorpay-signature": createHmac("sha256", SECRET).update(body).digest("hex"),
      "x-razorpay-event-id": id,
    },
  })
}

const rzpRoutes = {
  "POST /v1/orders": ({ json }: any) => ({
    id: "order_A",
    amount: json.amount,
    currency: json.currency,
    receipt: json.receipt,
    status: "created",
  }),
  "POST /v1/payments/pay_A/refund": ({ json }: any) => ({
    id: "rfnd_A",
    amount: json.amount,
    currency: "INR",
    payment_id: "pay_A",
    status: "processed",
    created_at: 1767240100,
  }),
}

describe("money", () => {
  test("minor <-> major without floats", () => {
    expect(toMajor(1015, "INR")).toBe("10.15")
    expect(toMajor(5, "INR")).toBe("0.05")
    expect(toMajor(500, "JPY")).toBe("500")
    expect(toMajor(1234, "BHD")).toBe("1.234")
    expect(toMinor("10.15", "INR")).toBe(1015)
    expect(toMinor(10.15, "INR")).toBe(1015)
    expect(toMinor("10.1", "INR")).toBe(1010)
    expect(toMinor("0.29", "INR")).toBe(29) // 0.29 * 100 is 28.999... as a float
    expect(toMinor("10.150", "INR")).toBe(1015)
    expect(fail(() => toMinor("10.155", "INR"))).resolves.toBe("BAD_INPUT")
    expect(fail(() => toMajor(10.5, "INR"))).resolves.toBe("BAD_INPUT")
  })
})

describe("ledger", () => {
  test("rejects unbalanced or fractional transactions", () => {
    expect(
      fail(() =>
        toEntries({
          txId: "t",
          kind: "x",
          legs: [
            { account: "a", amount: 10, currency: "INR" },
            { account: "b", amount: -9, currency: "INR" },
          ],
        }),
      ),
    ).resolves.toBe("UNBALANCED")
    expect(
      fail(() =>
        toEntries({
          txId: "t",
          kind: "x",
          legs: [
            { account: "a", amount: 1.5, currency: "INR" },
            { account: "b", amount: -1.5, currency: "INR" },
          ],
        }),
      ),
    ).resolves.toBe("BAD_INPUT")
    expect(
      fail(() =>
        toEntries({
          txId: "t",
          kind: "x",
          legs: [
            { account: "a", amount: 10, currency: "INR" },
            { account: "b", amount: -10, currency: "USD" },
          ],
        }),
      ),
    ).resolves.toBe("UNBALANCED")
  })

  for (const [name, make] of [
    ["memory", memoryStore],
    ["sqlite", sqliteStore],
  ] as const) {
    test(`${name}: posting is atomic and idempotent; balances are integer sums`, async () => {
      const db = make()
      const tx = postings.capture({ gateway: "g", paymentId: "p1", amount: 5000, currency: "INR" })
      expect(await post(db, tx)).toBe(true)
      expect(await post(db, tx)).toBe(false)
      await post(db, postings.fee({ gateway: "g", paymentId: "p1", amount: 118, currency: "INR" }))
      expect(await db.balance(receivable("g"), "INR")).toBe(4882)
      expect(await db.balance("revenue", "INR")).toBe(-5000)
      expect(await db.balance("fees", "INR")).toBe(118)
    })
  }
})

for (const [name, make] of [
  ["memory", memoryStore],
  ["sqlite", sqliteStore],
] as const) {
  describe(`inbox + ledger flow (${name})`, () => {
    test("checkout, webhook dedupe, ordering, refund, replay, timeline", async () => {
      const f = fakeFetch(rzpRoutes)
      const db = make()
      const seen: string[] = []
      const keys: string[] = []
      const payments = createPayments({
        gateways: [
          razorpay({
            keyId: "k",
            keySecret: "s",
            webhookSecret: SECRET,
            fetch: f.fetch,
            retryDelayMs: 0,
          }),
        ],
        db,
        idempotency: async (key, scope, fn) => (keys.push(`${scope}:${key}`), fn()),
        onEvent: (e) => void seen.push(e.type),
      })

      const c = await payments.checkout({
        amount: 5000,
        currency: "INR",
        idempotencyKey: "chk-1",
        reference: "order-1",
        userId: "user-a",
      })
      expect(c.gatewayId).toBe("order_A")
      expect(keys).toContain("payments:checkout:chk-1")

      const pay = {
        id: "pay_A",
        amount: 5000,
        currency: "INR",
        order_id: "order_A",
        fee: 118,
        status: "captured",
      }
      const r1 = await payments.handleWebhook(
        "razorpay",
        rzpHook("payment.captured", pay, "evt_1", 1767240000),
      )
      expect(r1.status).toBe(200)
      const dup = await payments.receive(
        "razorpay",
        rzpHook("payment.captured", pay, "evt_1", 1767240000),
      )
      expect(dup.duplicate).toBe(true)
      // An older "authorized" arriving late must not undo "captured".
      await payments.receive(
        "razorpay",
        rzpHook("payment.authorized", { ...pay, status: "authorized" }, "evt_0", 1767239990),
      )
      const bad = await payments.handleWebhook(
        "razorpay",
        new Request("https://x.test", {
          method: "POST",
          body: "{}",
          headers: { "x-razorpay-signature": "nope" },
        }),
      )
      expect(bad.status).toBe(400)

      let rec = await db.getPayment("razorpay", "pay_A")
      expect(rec?.status).toBe("captured")
      expect(rec?.userId).toBe("user-a") // linked from the checkout's order
      expect(await db.getPayment("razorpay", "order_A")).toBeUndefined()
      expect(await db.balance("receivable:razorpay", "INR")).toBe(4882)

      const refund = await payments.refund({
        gateway: "razorpay",
        paymentId: "pay_A",
        amount: 2000,
        idempotencyKey: "refund-key-01",
        reason: "damaged",
        actor: { type: "user", id: "support-1" },
      })
      expect(refund.status).toBe("processed")
      expect(f.calls.find((x) => x.path.endsWith("/refund"))?.headers["x-refund-idempotency"]).toBe(
        "refund-key-01",
      )
      // The refund webhook arriving afterwards does not double-post.
      await payments.receive(
        "razorpay",
        rzpHook(
          "refund.processed",
          { id: "rfnd_A", payment_id: "pay_A", amount: 2000, currency: "INR", status: "processed" },
          "evt_2",
          Math.floor(Date.now() / 1000) + 10,
          "refund",
        ),
      )
      expect(await db.balance("refunds", "INR")).toBe(2000)
      rec = await db.getPayment("razorpay", "pay_A")
      expect(rec?.status).toBe("partially_refunded")
      expect(rec?.amountRefunded).toBe(2000)

      expect(await payments.replay("razorpay", "evt_1")).toBe(true)
      expect(await db.balance("revenue", "INR")).toBe(-5000)

      const tl = await payments.timeline("razorpay", "pay_A")
      expect(tl.map((e) => e.type)).toEqual([
        "payment.authorized",
        "payment.captured",
        "refund.requested",
        "refund.processed",
      ])
      expect(tl.find((e) => e.type === "refund.requested")?.actor).toEqual({
        type: "user",
        id: "support-1",
      })
      expect(seen.filter((t) => t === "payment.captured")).toHaveLength(2) // first apply + replay
    })

    test("inline: false stores only; processInbox applies oldest first", async () => {
      const db = make()
      const payments = createPayments({
        gateways: [
          razorpay({
            keyId: "k",
            keySecret: "s",
            webhookSecret: SECRET,
            fetch: fakeFetch({}).fetch,
          }),
        ],
        db,
        inline: false,
      })
      const pay = { id: "pay_B", amount: 1000, currency: "INR" }
      await payments.receive("razorpay", rzpHook("payment.captured", pay, "e2", 200))
      await payments.receive("razorpay", rzpHook("payment.authorized", pay, "e1", 100))
      expect(await db.getPayment("razorpay", "pay_B")).toBeUndefined()
      expect(await payments.processInbox()).toEqual({ processed: 2, failed: 0 })
      expect((await db.getPayment("razorpay", "pay_B"))?.status).toBe("captured")
      expect(await payments.processInbox()).toEqual({ processed: 0, failed: 0 })
    })
  })
}

describe("routing and fallback", () => {
  const gw = (name: string, status: number, currencies?: string[]) => {
    const f = fakeFetch({ "POST /pay": { id: `${name}_1` } }, { status: { "POST /pay": status } })
    const g = defineGateway(
      name,
      { methods: ["card", "upi"], features: [], ...(currencies ? { currencies } : {}) },
      {
        raw: async () => undefined,
        createCheckout: async (i) => {
          const res = await f.fetch("https://g.test/pay", { method: "POST" })
          if (res.status >= 500) throw new PaymentsError("GATEWAY_UNAVAILABLE", "down")
          if (res.status === 402) throw new PaymentsError("DECLINED", "declined")
          return {
            gateway: name,
            gatewayId: `${name}_1`,
            amount: i.amount,
            currency: i.currency,
            raw: {},
          }
        },
      },
    )
    return { g, f }
  }

  test("routes by currency, fails over on an outage, never on a decline", async () => {
    const inr = gw("inr", 503, ["INR"])
    const any = gw("any", 200)
    const p = createPayments({ gateways: [inr.g, any.g], fallback: true })
    expect(p.route({ amount: 1, currency: "USD" })).toBe("any")
    expect(p.route({ amount: 1, currency: "INR" })).toBe("inr")
    const c = await p.checkout({ amount: 100, currency: "INR", idempotencyKey: "k1" })
    expect(c.gateway).toBe("any")

    const declining = gw("declining", 402)
    const p2 = createPayments({ gateways: [declining.g, any.g], fallback: true })
    expect(await fail(p2.checkout({ amount: 100, currency: "INR", idempotencyKey: "k2" }))).toBe(
      "DECLINED",
    )
    expect(any.f.calls).toHaveLength(1)

    const p3 = createPayments({ gateways: [inr.g, any.g], route: () => "inr" })
    expect(await fail(p3.checkout({ amount: 100, currency: "INR", idempotencyKey: "k3" }))).toBe(
      "GATEWAY_UNAVAILABLE",
    )
    expect(
      await fail(
        createPayments({ gateways: [inr.g] }).checkout({
          amount: 1,
          currency: "USD",
          idempotencyKey: "k",
        }),
      ),
    ).toBe("NO_GATEWAY")
  })

  test("adapter request retries outages for keyed writes, then gives up", async () => {
    const f = fakeFetch(
      { "POST /v1/orders": { id: "order_X", amount: 1, currency: "INR" } },
      { status: { "POST /v1/orders": 503 } },
    )
    const g = razorpay({ keyId: "k", keySecret: "s", fetch: f.fetch, retryDelayMs: 0, retries: 2 })
    // Razorpay order create carries no gateway idempotency header, so it is not retried.
    expect(
      await fail(g.createCheckout({ amount: 100, currency: "INR", idempotencyKey: "k" })),
    ).toBe("GATEWAY_UNAVAILABLE")
    expect(f.calls).toHaveLength(1)
    expect(await fail(g.getPayment("pay_1"))).toBe("NOT_FOUND")
  })
})

describe("reconcile", () => {
  test("missing, amount_differs and extra against the ledger", async () => {
    const db = memoryStore()
    const at = new Date("2026-01-01T10:00:00Z")
    await post(
      db,
      postings.capture({ gateway: "g", paymentId: "p_ok", amount: 1000, currency: "INR", at }),
    )
    await post(
      db,
      postings.fee({ gateway: "g", paymentId: "p_ok", amount: 20, currency: "INR", at }),
    )
    await post(
      db,
      postings.capture({ gateway: "g", paymentId: "p_diff", amount: 999, currency: "INR", at }),
    )
    await post(
      db,
      postings.capture({
        gateway: "g",
        paymentId: "p_extra",
        amount: 500,
        currency: "INR",
        at: new Date("2026-01-01T10:30:00Z"),
      }),
    )
    await post(
      db,
      postings.refund({
        gateway: "g",
        paymentId: "p_ok",
        refundId: "r1",
        amount: 300,
        currency: "INR",
        at,
      }),
    )
    const line = (
      kind: "payment" | "refund",
      id: string,
      amount: number,
      paymentId = id,
      fee?: number,
      t = "2026-01-01T09:00:00Z",
    ) => ({
      kind,
      gatewayId: id,
      paymentId,
      amount,
      currency: "INR",
      ...(fee !== undefined ? { fee } : {}),
      createdAt: new Date(t),
      raw: {},
    })
    const g = defineGateway(
      "g",
      { methods: ["card"], features: ["settlements"] },
      {
        raw: async () => undefined,
        listSettlements: async ({ date }) => [
          {
            gateway: "g",
            date,
            raw: {},
            lines: [
              line("payment", "p_ok", 1000, "p_ok", 20),
              line("payment", "p_diff", 1000),
              line("payment", "p_missing", 700),
              line("refund", "r1", 300, "p_ok", undefined, "2026-01-01T11:00:00Z"),
            ],
          },
        ],
      },
    )
    const r = await reconcile(db, g, { date: "2026-01-01" })
    expect(r.checked).toBe(4)
    expect(r.mismatches.map((m) => `${m.kind}:${m.paymentId}`).sort()).toEqual([
      "amount_differs:p_diff",
      "extra:p_extra",
      "missing:p_missing",
    ])
    expect(await fail(reconcile(db, g, { date: "01/01/2026" }))).toBe("BAD_INPUT")
  })
})

describe("agent tools", () => {
  async function setup() {
    const f = fakeFetch(rzpRoutes)
    const db = memoryStore()
    const payments = createPayments({
      gateways: [
        razorpay({
          keyId: "k",
          keySecret: "s",
          webhookSecret: SECRET,
          fetch: f.fetch,
          retryDelayMs: 0,
        }),
      ],
      db,
    })
    const now = new Date()
    await db.savePayment({
      gateway: "razorpay",
      gatewayId: "pay_A",
      status: "captured",
      amount: 5000,
      currency: "INR",
      amountRefunded: 0,
      userId: "user-a",
      createdAt: now,
      updatedAt: now,
    })
    await db.savePayment({
      gateway: "razorpay",
      gatewayId: "pay_Z",
      status: "captured",
      amount: 900,
      currency: "INR",
      amountRefunded: 0,
      userId: "user-z",
      createdAt: now,
      updatedAt: now,
    })
    return { f, db, payments }
  }
  const tool = (tools: ReturnType<typeof paymentTools>, name: string) =>
    tools.find((t) => t.name === name)!

  test("scoped reads with a row cap; another user's payment is not found", async () => {
    const { payments } = await setup()
    const tools = paymentTools(payments, { userId: "user-a", maxRows: 10 })
    expect(tools.map((t) => t.name)).toEqual([
      "find_payment",
      "list_payments",
      "payment_timeline",
      "refund_payment",
    ])
    const list: any = await tool(tools, "list_payments").run({ limit: 999 })
    expect(list.payments.map((p: any) => p.id)).toEqual(["pay_A"])
    expect(list.limit).toBe(10)
    expect(
      ((await tool(tools, "find_payment").run({ gateway: "razorpay", id: "pay_A" })) as any)
        .display,
    ).toBe("50.00 INR")
    expect(await fail(tool(tools, "find_payment").run({ gateway: "razorpay", id: "pay_Z" }))).toBe(
      "NOT_FOUND",
    )
    expect(await fail(async () => paymentTools(payments, {}))).toBe("BAD_INPUT")
  })

  test("refund_payment never refunds without approval", async () => {
    const { f, payments } = await setup()
    const out: any = await tool(paymentTools(payments, { userId: "user-a" }), "refund_payment").run(
      { gateway: "razorpay", id: "pay_A", amount: 2000, reason: "damaged" },
    )
    expect(out.structuredContent.code).toBe("APPROVAL_REQUIRED")
    expect(out.structuredContent.approval.summary).toBe(
      "Refund 20.00 INR on razorpay payment pay_A",
    )
    expect(f.calls).toHaveLength(0)

    const declined = await tool(
      paymentTools(payments, { userId: "user-a", approve: () => ({ declined: true }) }),
      "refund_payment",
    ).run({ gateway: "razorpay", id: "pay_A", reason: "x" })
    expect(declined).toEqual({ declined: true })
    expect(f.calls).toHaveLength(0)
  })

  test("approved refunds run once per payment+amount and record the agent", async () => {
    const { f, db, payments } = await setup()
    const asked: any[] = []
    const tools = paymentTools(payments, {
      userId: "user-a",
      actor: { type: "agent", id: "support-bot" },
      approve: (_ctx, r) => void asked.push(r),
    })
    const r: any = await tool(tools, "refund_payment").run({
      gateway: "razorpay",
      id: "pay_A",
      amount: 2000,
      reason: "damaged",
    })
    expect(r).toMatchObject({ refunded: true, refundId: "rfnd_A", amount: 2000 })
    expect(asked[0].details).toMatchObject({ amount: 2000, currency: "INR", reason: "damaged" })
    expect(f.calls[0]!.headers["x-refund-idempotency"]).toBe("agent-refund-razorpay-pay_A-2000")
    const tl = await db.eventsFor("razorpay", "pay_A")
    expect(tl[0]?.actor).toEqual({ type: "agent", id: "support-bot" })
    expect(
      await fail(
        tool(tools, "refund_payment").run({
          gateway: "razorpay",
          id: "pay_A",
          amount: 999999,
          reason: "x",
        }),
      ),
    ).toBe("BAD_INPUT")
  })
})

test("paypal value strings: whole-only currencies", async () => {
  const { paypalValue } = await import("../src/gateways/paypal")
  expect(paypalValue(1050, "USD")).toBe("10.50")
  expect(paypalValue(1000, "JPY")).toBe("1000")
  expect(paypalValue(100000, "HUF")).toBe("1000")
  expect(paypalValue(100000, "TWD")).toBe("1000")
  expect(fail(() => paypalValue(100050, "TWD"))).resolves.toBe("BAD_INPUT")
})
