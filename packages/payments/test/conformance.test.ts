// The shared suite every adapter runs: capability matrix, checkout, payment,
// refund and webhook verification against recorded fixtures.

import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { isPaymentsError } from "../src/errors"
import type { Feature, PaymentGateway } from "../src/types"
import { fakeFetch } from "./fake"
import { CASES } from "./fixtures"

const CALL: Record<Feature, (g: PaymentGateway) => Promise<unknown>> = {
  capture: (g) => g.capture("x", { idempotencyKey: "key-0000000001" }),
  refunds: (g) => g.refund("x", { idempotencyKey: "key-0000000001" }),
  partialRefunds: (g) => g.refund("x", { amount: 1, idempotencyKey: "key-0000000001" }),
  subscriptions: (g) => g.getSubscription("x"),
  customers: (g) => g.createCustomer({ email: "a@example.test", name: "A", phone: "9999999999" }),
  savedMethods: (g) => g.listPaymentMethods("x"),
  payouts: (g) =>
    g.createPayout({
      amount: 100,
      currency: "INR",
      destination: "x",
      idempotencyKey: "key-0000000001",
    }),
  settlements: (g) => g.listSettlements({ date: "2026-01-01" }),
  webhooks: (g) => g.verifyWebhook(new Request("https://x.test", { method: "POST", body: "{}" })),
}

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return isPaymentsError(e) ? e.code : String(e)
  }
}

for (const c of CASES) {
  describe(`conformance: ${c.name}`, () => {
    test("every unsupported capability rejects UNSUPPORTED before any network call", async () => {
      const f = fakeFetch(c.routes)
      const g = c.make(f.fetch)
      for (const feature of Object.keys(CALL) as Feature[]) {
        if (g.supports(feature)) continue
        expect(`${feature}:${await code(CALL[feature](g))}`).toBe(`${feature}:UNSUPPORTED`)
      }
      expect(f.calls).toHaveLength(0)
    })

    test("a method outside the matrix rejects UNSUPPORTED with no call", async () => {
      const f = fakeFetch(c.routes)
      const g = c.make(f.fetch)
      const missing = (["upi", "card", "netbanking", "wallet", "emi"] as const).find(
        (m) => !g.capabilities.methods.includes(m),
      )
      if (!missing) return
      expect(
        await code(
          g.createCheckout({ ...c.checkout, method: missing, idempotencyKey: "key-0000000001" }),
        ),
      ).toBe("UNSUPPORTED")
      expect(f.calls).toHaveLength(0)
    })

    test("charges and refunds need an idempotency key and integer minor units", async () => {
      const f = fakeFetch(c.routes)
      const g = c.make(f.fetch)
      expect(await code(g.createCheckout({ ...c.checkout } as any))).toBe(
        "IDEMPOTENCY_KEY_REQUIRED",
      )
      expect(
        await code(
          g.createCheckout({ ...c.checkout, amount: 10.5, idempotencyKey: "key-0000000001" }),
        ),
      ).toBe("BAD_INPUT")
      if (g.supports("refunds"))
        expect(await code(g.refund("x", {} as any))).toBe("IDEMPOTENCY_KEY_REQUIRED")
      expect(f.calls).toHaveLength(0)
    })

    test("createCheckout", async () => {
      const f = fakeFetch(c.routes)
      const out = await c
        .make(f.fetch)
        .createCheckout({ ...c.checkout, idempotencyKey: "key-0000000001" })
      expect(out.gateway).toBe(c.name)
      expect(out.gatewayId).toBe(c.expectCheckout.gatewayId)
      expect(out.amount).toBe(c.checkout.amount)
      expect(out.currency).toBe(c.checkout.currency)
      if (c.expectCheckout.via !== "none") expect(out[c.expectCheckout.via]).toBeTruthy()
    })

    test("getPayment normalises to minor units and a canonical status", async () => {
      const f = fakeFetch(c.routes)
      const p = await c.make(f.fetch).getPayment(c.payment.id)
      expect({ id: p.gatewayId, amount: p.amount, currency: p.currency, status: p.status }).toEqual(
        c.payment,
      )
      expect(Number.isSafeInteger(p.amount)).toBe(true)
      expect(p.raw).toBeTruthy()
    })

    test("refund", async () => {
      const f = fakeFetch(c.routes)
      const r = await c.make(f.fetch).refund(c.refund.paymentId, {
        ...(c.refund.amount !== undefined ? { amount: c.refund.amount } : {}),
        idempotencyKey: "refund-key-0001",
      })
      expect(r.amount).toBe(c.refund.expectAmount)
      expect(r.paymentId).toBe(c.refund.paymentId)
      expect(["pending", "processed"]).toContain(r.status)
    })

    test("raw() reaches the API with this adapter's auth", async () => {
      const f = fakeFetch(c.routes)
      const g = c.make(f.fetch)
      if (c.name === "payu") return // raw is the postservice, covered by getPayment
      await code(g.raw("GET", "/nothing-here"))
      const last = f.calls[f.calls.length - 1]!
      expect(
        Object.keys(last.headers).some((h) =>
          ["authorization", "x-client-secret", "api-key"].includes(h),
        ),
      ).toBe(true)
    })

    if (c.webhook) {
      const w = c.webhook
      test("verifyWebhook accepts a correctly signed event and normalises it", async () => {
        const f = fakeFetch(c.routes)
        const { body, headers } = w.build()
        const e = await c
          .make(f.fetch)
          .verifyWebhook(
            new Request("https://shop.example.test/hook", { method: "POST", body, headers }),
          )
        expect(e.type).toBe(w.type)
        expect(e.paymentId).toBe(w.paymentId)
        expect(e.amount).toBe(w.amount)
        expect(e.id).toBeTruthy()
      })
      test("verifyWebhook rejects a tampered body", async () => {
        const f = fakeFetch(c.routes)
        const { body, headers } = w.build()
        const tampered = body
          .replace("5000", "9000")
          .replace("50.00", "90.00")
          .replace(":50,", ":90,")
        expect(tampered).not.toBe(body)
        if (w.unsignedBody) {
          const e = await c
            .make(f.fetch)
            .verifyWebhook(
              new Request("https://x.test", { method: "POST", body: tampered, headers }),
            )
          expect(e.amount).toBe(w.amount)
          const bad = { ...headers, authorization: "0".repeat(64) }
          expect(
            await code(
              c
                .make(f.fetch)
                .verifyWebhook(
                  new Request("https://x.test", { method: "POST", body, headers: bad }),
                ),
            ),
          ).toBe("BAD_SIGNATURE")
          return
        }
        expect(
          await code(
            c
              .make(f.fetch)
              .verifyWebhook(
                new Request("https://x.test", { method: "POST", body: tampered, headers }),
              ),
          ),
        ).toBe("BAD_SIGNATURE")
      })
    } else {
      test("webhooks are explicitly unsupported", () => {
        expect(c.make(fakeFetch({}).fetch).supports("webhooks")).toBe(false)
      })
    }
  })
}

test("payu checkout form hash matches the documented formula", async () => {
  const c = CASES.find((x) => x.name === "payu")!
  const out = await c
    .make(fakeFetch({}).fetch)
    .createCheckout({ ...c.checkout, idempotencyKey: "k" })
  const f = out.form!.fields
  const expected = createHash("sha512")
    .update(`TESTKEY|ref-1|50.00|Order|Test Buyer|buyer@example.test|||||||||||test_salt`)
    .digest("hex")
  expect(f.hash).toBe(expected)
  expect(f.amount).toBe("50.00")
  expect(out.form!.action).toBe("https://test.payu.in/_payment")
})
