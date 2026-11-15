// The gateway fakes through the real adapters, and the books (inbox, ledger,
// entitlements) under every injected failure: declines, timeouts, 5xx,
// duplicate and out-of-order webhooks. Nothing here touches the network.
import { describe, expect, test } from "bun:test"
import { isPaymentsError } from "@dapplelight/signet-payments"
import { DAY } from "../src/clock"
import { type FakeGateway, fakeGateway, type GatewayShape } from "../src/payments"
import { books } from "./harness"

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return isPaymentsError(e) ? e.code : String(e)
  }
}

const CHECKOUT = {
  razorpay: { amount: 49900, currency: "INR" },
  stripe: { amount: 1999, currency: "USD" },
  payu: {
    amount: 49900,
    currency: "INR",
    reference: "order-1",
    returnUrl: "https://app.example.test/done",
    customer: { name: "Test Buyer", email: "buyer@example.test" },
  },
} as const
const CUR = { razorpay: "INR", stripe: "USD", payu: "INR" } as const
const SHAPES: GatewayShape[] = ["razorpay", "stripe", "payu"]

/** A fake gateway and books on the same clock. */
function gwBooks(shape: GatewayShape) {
  const b = books((now) => [fakeGateway(shape, { now })])
  return { ...b, gw: b.gws[0] as FakeGateway }
}

/** A gateway, books on the same clock, and a captured payment. */
async function paid(shape: GatewayShape, key = "checkout-key-1") {
  const b = gwBooks(shape)
  const gw = b.gw
  const c = await b.payments.checkout({ ...CHECKOUT[shape], idempotencyKey: key, userId: "u1" })
  const hook = await gw.complete(c.gatewayId)
  const [r] = await b.deliver(shape, hook.clone())
  const paymentId = (await gw.verifyWebhook(hook.clone())).paymentId as string
  return { ...b, gw, c, r, paymentId, hook }
}

describe("payments through the real adapters", () => {
  for (const shape of SHAPES) {
    describe(shape, () => {
      test("checkout, capture webhook, ledger, refund", async () => {
        const { gw, store, bal, paymentId, r, c } = await paid(shape)
        expect(r).toMatchObject({ received: true, duplicate: false })
        const amount = CHECKOUT[shape].amount
        expect(await store.getPayment(shape, paymentId)).toMatchObject({
          status: "captured",
          amount,
          userId: "u1",
        })
        expect(await bal("revenue", CUR[shape])).toBe(-amount)
        if (shape === "stripe") expect(c.clientSecret).toContain("_secret_")
        if (shape === "payu") expect(c.form?.fields.hash).toHaveLength(128)
        expect((await gw.getPayment(paymentId)).status).toBe("captured")

        const refund = await gw.refund(paymentId, { amount: 100, idempotencyKey: "refund-key-1" })
        expect(refund).toMatchObject({ amount: 100, paymentId })
        expect(gw.state.refunds.size).toBe(1)
        // Every request went to the fake server; the adapter's own URLs prove the shape.
        const hosts = new Set(gw.requests.map((x) => new URL(x.url).host))
        expect([...hosts]).toEqual(
          shape === "razorpay"
            ? ["api.razorpay.com"]
            : shape === "stripe"
              ? ["api.stripe.com"]
              : ["test.payu.in"],
        )
      })

      test("declined payment: failed record, nothing on the ledger", async () => {
        const b = gwBooks(shape)
        const gw = b.gw
        const c = await b.payments.checkout({ ...CHECKOUT[shape], idempotencyKey: "declined-1" })
        const hook = await gw.complete(c.gatewayId, { status: "failed" })
        const e = await gw.verifyWebhook(hook.clone())
        expect(e.type).toBe("payment.failed")
        await b.deliver(shape, hook)
        expect(await b.bal("revenue", CUR[shape])).toBe(0)
        expect(await b.bal(`receivable:${shape}`, CUR[shape])).toBe(0)
      })

      test("duplicate delivery: stored once, booked once", async () => {
        const { deliver, hook, bal } = await paid(shape)
        const again = await deliver(shape, hook.clone(), hook.clone())
        expect(again.map((x) => x.duplicate)).toEqual([true, true])
        expect(await bal("revenue", CUR[shape])).toBe(-CHECKOUT[shape].amount)
      })

      test("5xx: GETs retry through a blip, then give up as GATEWAY_UNAVAILABLE", async () => {
        const { gw, paymentId } = await paid(shape)
        gw.fail("unavailable", { times: 1 })
        expect((await gw.getPayment(paymentId)).status).toBe("captured")
        gw.fail("unavailable", { times: 3 })
        expect(await code(gw.getPayment(paymentId))).toBe("GATEWAY_UNAVAILABLE")
        gw.fail("unavailable", { times: 1 })
        expect(await code(gw.getPayment(paymentId))).toBe("OK")
      })

      test("timeout after the refund went through: the keyed retry gets the same refund", async () => {
        const { gw, paymentId, payments } = await paid(shape)
        gw.fail("timeout", { on: shape === "payu" ? "cancel_refund" : "refund" })
        const first = gw.refund(paymentId, { amount: 500, idempotencyKey: "refund-key-2" })
        if (shape === "payu") {
          // PayU refunds are not retried by the adapter (a POST without a key header), so the
          // caller sees the timeout although the refund went through.
          expect(await code(first)).toBe("GATEWAY_UNAVAILABLE")
        } else expect((await first).amount).toBe(500)
        expect(gw.state.refunds.size).toBe(1)
        // The same key again (an app retrying after its own crash): still one refund.
        await gw.refund(paymentId, { amount: 500, idempotencyKey: "refund-key-2" })
        expect(gw.state.refunds.size).toBe(1)
        // Through createPayments, a timeout that exhausts retries surfaces, and nothing is doubled.
        gw.fail("timeout", {
          on: shape === "payu" ? "cancel_refund" : "refund",
          times: shape === "payu" ? 1 : 3,
        })
        expect(
          await code(
            payments.refund({
              gateway: shape,
              paymentId,
              amount: 100,
              idempotencyKey: "refund-key-3",
            }),
          ),
        ).toBe("GATEWAY_UNAVAILABLE")
        expect(gw.state.refunds.size).toBe(2)
      })

      test("decline on a refund", async () => {
        const { gw, paymentId } = await paid(shape)
        gw.fail("decline", { on: shape === "payu" ? "cancel_refund" : "refund" })
        expect(await code(gw.refund(paymentId, { idempotencyKey: "refund-key-4" }))).toBe(
          shape === "payu" ? "GATEWAY_ERROR" : "DECLINED",
        )
        expect(gw.state.refunds.size).toBe(0)
      })

      test("over-refund is refused by the server, as the gateway does", async () => {
        const { gw, paymentId } = await paid(shape)
        const amount = CHECKOUT[shape].amount
        expect(
          await code(gw.refund(paymentId, { amount: amount + 1, idempotencyKey: "refund-key-5" })),
        ).toBe("GATEWAY_ERROR")
      })

      test("settlements: captures and refunds for the day, with fees", async () => {
        const { gw, paymentId, clock } = await paid(shape)
        await gw.refund(paymentId, { amount: 1000, idempotencyKey: "refund-key-6" })
        const date = new Date(clock.now() + (shape === "payu" ? 5.5 * 3600_000 : 0))
          .toISOString()
          .slice(0, 10)
        const [s] = await gw.listSettlements({ date })
        const kinds = s?.lines.map((l) => `${l.kind}:${l.amount}`).sort()
        expect(kinds).toEqual([`payment:${CHECKOUT[shape].amount}`, "refund:1000"])
        expect(s?.lines.find((l) => l.kind === "payment")?.fee).toBeGreaterThan(0)
        expect((await gw.listSettlements({ date: "2020-01-01" }))[0]?.lines).toEqual([])
      })

      test("reset empties the server", async () => {
        const { gw, paymentId } = await paid(shape)
        gw.fail("unavailable", { times: 5 })
        gw.reset()
        expect(gw.state.payments.size).toBe(0)
        expect(gw.calls).toHaveLength(0)
        expect(await code(gw.getPayment(paymentId))).toBe("NOT_FOUND")
      })
    })
  }

  test("payu has no subscriptions, customers or payouts: UNSUPPORTED before any request", async () => {
    const gw = fakeGateway("payu")
    expect(await code(gw.getSubscription("x"))).toBe("UNSUPPORTED")
    expect(await code(gw.createCustomer({ email: "a@example.test" }))).toBe("UNSUPPORTED")
    expect(
      await code(
        gw.createPayout({ amount: 1, currency: "INR", destination: "x", idempotencyKey: "k" }),
      ),
    ).toBe("UNSUPPORTED")
    expect(gw.requests).toHaveLength(0)
    await expect(gw.subscribe({ plan: "p" })).rejects.toThrow(/no subscriptions/)
  })

  test("unknown endpoints answer 404, never the network", async () => {
    const gw = fakeGateway("stripe")
    expect(await code(gw.raw("GET", "/v1/charges/ch_x"))).toBe("NOT_FOUND")
  })

  test("a tampered body fails the real signature check", async () => {
    const gw = fakeGateway("razorpay")
    const c = await gw.createCheckout({ amount: 100, currency: "INR", idempotencyKey: "k" })
    const req = await gw.complete(c.gatewayId)
    const forged = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: (await req.text()).replace('"amount":100', '"amount":1'),
    })
    expect(await code(gw.verifyWebhook(forged))).toBe("BAD_SIGNATURE")
  })

  test("a Stripe webhook outside the 5-minute tolerance is refused, on the fake clock", async () => {
    const b = gwBooks("stripe")
    const gw = b.gw
    const c = await gw.createCheckout({ amount: 500, currency: "USD", idempotencyKey: "k" })
    const hook = await gw.complete(c.gatewayId)
    b.clock.advance(10 * 60_000)
    expect(await code(gw.verifyWebhook(hook))).toBe("BAD_SIGNATURE")
  })
})

describe("manual capture and out-of-order webhooks", () => {
  for (const shape of ["razorpay", "stripe"] as const) {
    test(`${shape}: captured arrives before authorized; the late one cannot undo it`, async () => {
      const b = gwBooks(shape)
      const gw = b.gw
      const c = await b.payments.checkout({
        ...CHECKOUT[shape],
        capture: "manual",
        idempotencyKey: "manual-1",
      })
      const authorized = await gw.complete(c.gatewayId, { status: "authorized" })
      const paymentId = (await gw.verifyWebhook(authorized.clone())).paymentId as string
      expect((await gw.capture(paymentId, { idempotencyKey: "capture-1" })).status).toBe("captured")
      const [captured] = await gw.takeWebhooks()
      await b.deliver(shape, captured as Request, authorized)
      expect((await b.store.getPayment(shape, paymentId))?.status).toBe("captured")
      expect(await b.bal("revenue", CUR[shape])).toBe(-CHECKOUT[shape].amount)
      // Capturing twice is refused by the server.
      expect(await code(gw.capture(paymentId, { idempotencyKey: "capture-2" }))).toBe(
        "GATEWAY_ERROR",
      )
    })
  }
})

describe("subscriptions: renewals, failures and cancels, with entitlements", () => {
  for (const shape of ["razorpay", "stripe"] as const) {
    const plan = shape === "razorpay" ? "plan_pro" : "price_pro"

    test(`${shape}: subscribe grants pro; renewals extend it; replays grant nothing twice`, async () => {
      const b = gwBooks(shape)
      const gw = b.gw
      const { id, webhooks } = await gw.subscribe({ plan })
      await b.deliver(shape, ...webhooks.map((w) => w.clone()))
      expect(await b.plan()).toBe("pro")
      const first = (await b.ent.get("u1")).currentPeriodEnd?.getTime() as number
      const cur = shape === "razorpay" ? "INR" : "USD"
      const price = shape === "razorpay" ? 49900 : 1999
      expect(await b.bal("revenue", cur)).toBe(-price)

      // Duplicates of every event: no new grant, no second charge on the ledger.
      await b.deliver(shape, ...webhooks.map((w) => w.clone()))
      expect(await b.bal("revenue", cur)).toBe(-price)
      expect((await b.ent.get("u1")).entitlements.filter((e) => e.plan === "pro")).toHaveLength(1)

      b.clock.advance(30 * DAY)
      const renewal = await gw.renew(id)
      await b.deliver(shape, ...renewal)
      expect(await b.plan()).toBe("pro")
      expect((await b.ent.get("u1")).currentPeriodEnd?.getTime()).toBe(first + 30 * DAY * 1)
      expect(await b.bal("revenue", cur)).toBe(-2 * price)
      expect((await gw.getSubscription(id)).status).toBe("active")
    })

    test(`${shape}: a failed renewal suspends access; out-of-order stale events cannot restore it`, async () => {
      const b = gwBooks(shape)
      const gw = b.gw
      const { id, webhooks } = await gw.subscribe({ plan })
      await b.deliver(shape, ...webhooks.map((w) => w.clone()))
      b.clock.advance(30 * DAY + 60_000)
      const failed = await gw.renew(id, { fail: true })
      await b.deliver(shape, ...failed)
      expect((await gw.getSubscription(id)).status).toBe("past_due")
      expect(await b.plan()).toBe("free")
      // The original activation, delivered late, is older than the stored state.
      await b.deliver(shape, ...webhooks.map((w) => w.clone()))
      expect(await b.plan()).toBe("free")
    })

    test(`${shape}: cancel through the API ends access, and the webhook is queued`, async () => {
      const b = gwBooks(shape)
      const gw = b.gw
      const { id, webhooks } = await gw.subscribe({ plan })
      await b.deliver(shape, ...webhooks)
      b.clock.advance(DAY)
      expect((await gw.cancelSubscription(id)).status).toBe("cancelled")
      const queued = await gw.takeWebhooks()
      expect(queued).toHaveLength(1)
      await b.deliver(shape, ...(queued as Request[]))
      expect(await b.plan()).toBe("free")
      expect(await gw.takeWebhooks()).toHaveLength(0)
      expect(await code(gw.cancelSubscription(id))).toBe("GATEWAY_ERROR")
    })

    test(`${shape}: cancel at period end keeps access until renewal time`, async () => {
      const b = gwBooks(shape)
      const gw = b.gw
      const { id, webhooks } = await gw.subscribe({ plan })
      await b.deliver(shape, ...webhooks)
      await gw.cancelSubscription(id, { atPeriodEnd: true })
      await b.deliver(shape, ...(await gw.takeWebhooks()))
      expect(await b.plan()).toBe("pro")
      b.clock.advance(30 * DAY)
      const end = await gw.renew(id)
      expect(end).toHaveLength(1)
      await b.deliver(shape, ...end)
      expect(await b.plan()).toBe("free")
      expect((await gw.getSubscription(id)).status).toBe("cancelled")
    })

    test(`${shape}: payouts, processed and failed, verified webhooks, idempotent create`, async () => {
      const gw = fakeGateway(shape)
      const destination = shape === "razorpay" ? "fa_FAKE" : "ba_FAKE"
      const p = await gw.createPayout({
        amount: 10000,
        currency: shape === "razorpay" ? "INR" : "USD",
        destination,
        idempotencyKey: "payout-key-1",
      })
      expect(p.status).toBe(shape === "razorpay" ? "processing" : "pending")
      gw.fail("timeout", { on: "payouts" })
      const again = await gw.createPayout({
        amount: 10000,
        currency: shape === "razorpay" ? "INR" : "USD",
        destination,
        idempotencyKey: "payout-key-1",
      })
      expect(again.gatewayId).toBe(p.gatewayId)
      expect(gw.state.payouts.size).toBe(1)
      const ok = await gw.verifyWebhook(await gw.settlePayout(p.gatewayId, "processed"))
      expect(ok).toMatchObject({ type: "payout.processed", payoutId: p.gatewayId, amount: 10000 })
      const q = await gw.createPayout({
        amount: 500,
        currency: shape === "razorpay" ? "INR" : "USD",
        destination,
        idempotencyKey: "payout-key-2",
      })
      expect((await gw.verifyWebhook(await gw.settlePayout(q.gatewayId, "failed"))).type).toBe(
        "payout.failed",
      )
    })

    test(`${shape}: customers and saved methods`, async () => {
      const gw = fakeGateway(shape)
      const c = await gw.createCustomer({ email: "buyer@example.test", name: "Test Buyer" })
      expect(c.email).toBe("buyer@example.test")
      expect(await gw.listPaymentMethods(c.gatewayId)).toEqual([])
      expect(await code(gw.listPaymentMethods("cus_missing"))).toBe("NOT_FOUND")
      if (shape === "stripe") {
        await gw.subscribe({ plan, customer: c.gatewayId })
        expect((await gw.listPaymentMethods(c.gatewayId))[0]?.label).toBe("visa 4242")
      }
    })
  }
})

describe("concurrency and idempotency keys", () => {
  for (const shape of SHAPES) {
    test(`${shape}: the same webhook delivered concurrently books once`, async () => {
      const b = gwBooks(shape)
      const c = await b.payments.checkout({ ...CHECKOUT[shape], idempotencyKey: "k", userId: "u1" })
      const hook = await b.gw.complete(c.gatewayId)
      const out = await Promise.all(
        Array.from({ length: 5 }, () => b.payments.handleWebhook(shape, hook.clone())),
      )
      expect(out.every((r) => r.status === 200)).toBe(true)
      expect(await b.bal("revenue", CUR[shape])).toBe(-CHECKOUT[shape].amount)
    })

    test(`${shape}: concurrent refunds with one key refund once`, async () => {
      const { gw, paymentId } = await paid(shape)
      const rs = await Promise.all(
        Array.from({ length: 4 }, () =>
          gw.refund(paymentId, { amount: 100, idempotencyKey: "refund-key-1" }),
        ),
      )
      expect(new Set(rs.map((r) => r.gatewayId)).size).toBe(1)
      expect(gw.state.refunds.size).toBe(1)
    })
  }

  for (const shape of ["razorpay", "stripe"] as const) {
    test(`${shape}: a key reused with another body is rejected, as the gateway does`, async () => {
      const { gw, paymentId } = await paid(shape)
      await gw.refund(paymentId, { amount: 100, idempotencyKey: "refund-key-1" })
      expect(
        await code(gw.refund(paymentId, { amount: 200, idempotencyKey: "refund-key-1" })),
      ).toBe("GATEWAY_ERROR")
      expect(gw.state.refunds.size).toBe(1)
    })

    test(`${shape}: one key on two endpoints is two requests`, async () => {
      const { gw, paymentId } = await paid(shape)
      await gw.refund(paymentId, { amount: 100, idempotencyKey: "same-key-1" })
      await gw.createPayout({
        amount: 100,
        currency: CUR[shape],
        destination: shape === "razorpay" ? "fa_FAKE" : "ba_FAKE",
        idempotencyKey: "same-key-1",
      })
      expect(gw.state.refunds.size).toBe(1)
      expect(gw.state.payouts.size).toBe(1)
    })
  }

  test("an unavailable reply is not stored: the retry with the same key runs", async () => {
    const gw = fakeGateway("stripe")
    gw.fail("unavailable", { on: "payouts", times: 10 })
    const input = { amount: 100, currency: "USD", destination: "ba_FAKE", idempotencyKey: "p" }
    expect(await code(gw.createPayout(input))).toBe("GATEWAY_UNAVAILABLE")
    gw.reset() // also clears faults
    expect((await gw.createPayout(input)).status).toBe("pending")
  })
})
