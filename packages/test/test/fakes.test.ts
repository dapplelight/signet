// The fakes against the real Signet modules that consume them: createPayments
// with the real adapters' webhook verification, appstore()/googleplay() with
// test-generated keys, createNotifier with fake senders, the AI SDK with the mock.
import { describe, expect, test } from "bun:test"
import { createPayments, isPaymentsError, memoryStore } from "@dapplelight/signet-payments"
import { appstore } from "@dapplelight/signet-payments/appstore"
import { googleplay } from "@dapplelight/signet-payments/googleplay"
import { generateText, streamText } from "ai"
import { fakeModel } from "../src/ai"
import { DAY, fakeClock } from "../src/clock"
import { fakeFetch } from "../src/fetch"
import { createOutbox, fakeSenders } from "../src/notify"
import { fakeGateway, type GatewayShape } from "../src/payments"
import { fakeAppStore, fakeGooglePlay } from "../src/stores"

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return isPaymentsError(e) ? e.code : String(e)
  }
}

describe("fakeClock", () => {
  test("set, advance, and a bound now", () => {
    const c = fakeClock("2026-11-01T00:00:00Z")
    const { now } = c
    expect(new Date(now()).toISOString()).toBe("2026-11-01T00:00:00.000Z")
    c.advance(DAY)
    expect(c.date().toISOString()).toBe("2026-11-02T00:00:00.000Z")
    c.set(0)
    expect(now()).toBe(0)
    expect(() => fakeClock("not a date")).toThrow()
  })
})

describe("fakeFetch", () => {
  test("routes by method and path, logs calls, 404s the rest", async () => {
    const f = fakeFetch({ "POST /v1/x": ({ json }: any) => ({ echo: json.a }) })
    const r = await f.fetch("https://api.example.test/v1/x", { method: "POST", body: '{"a":1}' })
    expect(await r.json()).toEqual({ echo: 1 })
    expect((await f.fetch("https://api.example.test/nope")).status).toBe(404)
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /v1/x", "GET /nope"])
  })
})

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

describe("fakeGateway", () => {
  for (const shape of ["razorpay", "stripe", "payu"] as GatewayShape[]) {
    test(`${shape}: checkout, complete, real webhook verification, ledger, refund`, async () => {
      const gw = fakeGateway(shape)
      const db = memoryStore()
      const payments = createPayments({ gateways: [gw], db })
      const c = await payments.checkout({ ...CHECKOUT[shape], idempotencyKey: "k1", userId: "u1" })
      expect(c.gateway).toBe(shape)
      if (shape === "stripe") expect(c.clientSecret).toContain("_secret_")
      if (shape === "payu") expect(c.form?.fields.hash).toHaveLength(128)

      const res = await payments.handleWebhook(shape, await gw.complete(c.gatewayId))
      expect(res.status).toBe(200)
      const paymentId = shape === "razorpay" ? [...gw.payments.keys()][0] : c.gatewayId
      const rec = await db.getPayment(shape, paymentId as string)
      expect(rec).toMatchObject({
        status: "captured",
        amount: CHECKOUT[shape].amount,
        userId: "u1",
      })

      // Replayed webhook: a duplicate, not a second capture.
      const again = await payments.handleWebhook(shape, await gw.complete(c.gatewayId))
      expect(again.status).toBe(200)

      const r = await gw.refund(paymentId as string, { amount: 100, idempotencyKey: "r1" })
      expect(r.amount).toBe(100)
      expect((await gw.getPayment(paymentId as string)).status).toBe("partially_refunded")
      expect(gw.calls.map((x) => x.method)).toContain("verifyWebhook")
    })
  }

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

  test("failed payments and honest capabilities", async () => {
    const gw = fakeGateway("payu")
    expect(await code(gw.createCustomer({ email: "a@example.test" }))).toBe("UNSUPPORTED")
    const s = fakeGateway("stripe")
    const c = await s.createCheckout({ amount: 500, currency: "USD", idempotencyKey: "k" })
    const e = await s.verifyWebhook(await s.complete(c.gatewayId, { status: "failed" }))
    expect(e.type).toBe("payment.failed")
    const a = await s.createCheckout({ amount: 500, currency: "USD", idempotencyKey: "k2" })
    await s.complete(a.gatewayId, { status: "authorized" })
    expect((await s.capture(a.gatewayId, { idempotencyKey: "c" })).status).toBe("captured")
  })
})

describe("fakeAppStore", () => {
  test("a signed notification verifies through the real appstore() adapter", async () => {
    const clock = fakeClock("2026-11-01T10:00:00Z")
    const apple = fakeAppStore({ now: clock.now })
    const gw = appstore({ ...apple.config, now: clock.now })
    const t = apple.transaction({ productId: "pro.yearly", price: 49990 })
    const e = await gw.verifyWebhook(apple.notification("SUBSCRIBED", "INITIAL_BUY", t))
    expect(e).toMatchObject({
      gateway: "appstore",
      paymentId: t.transactionId,
      productId: "pro.yearly",
      amount: 4999,
      currency: "USD",
      environment: "sandbox",
    })
    apple.serve(t)
    expect((await gw.getPayment(t.transactionId)).productId).toBe("pro.yearly")
    expect(apple.calls[0]?.path).toBe(`/inApps/v1/transactions/${t.transactionId}`)
  })

  test("another fake's chain is not trusted", async () => {
    const a = fakeAppStore()
    const b = fakeAppStore()
    const gw = appstore(a.config)
    expect(
      await code(gw.verifyWebhook(b.notification("SUBSCRIBED", undefined, b.transaction()))),
    ).toBe("BAD_SIGNATURE")
  })
})

describe("fakeGooglePlay", () => {
  test("a signed Pub/Sub push verifies and reads the fake Play API", async () => {
    const play = fakeGooglePlay()
    const gw = googleplay(play.config)
    const orderId = play.subscribe("tok-1", { productId: "pro.monthly" })
    const e = await gw.verifyWebhook(play.notification(4, "tok-1"))
    expect(e).toMatchObject({
      gateway: "googleplay",
      type: "subscription.created",
      subscriptionId: "tok-1",
      paymentId: orderId,
      amount: 499,
      currency: "USD",
    })
    expect((await gw.getSubscription("tok-1")).status).toBe("active")
    expect(play.calls.some((c) => c.path === "/oauth2/v3/certs")).toBe(true)
  })
})

describe("fakeSenders", () => {
  test("captures every channel and fails on request", async () => {
    const clock = fakeClock(1000)
    const { outbox, senders } = fakeSenders(createOutbox({ now: clock.now }))
    const seen: string[] = []
    const off = outbox.subscribe((m) => seen.push(m.channel))
    await senders.email.send(
      "a@example.test",
      { subject: "Hi", html: "<p>Hi</p>", text: "Hi", headers: {} },
      { idempotencyKey: "e1" },
    )
    await senders.sms.send("+15550100", { text: "Code 123456" }, { idempotencyKey: "s1" })
    await senders.whatsapp.send("+15550100", { text: "hello" }, { idempotencyKey: "w1" })
    await senders.push.send("u1", { title: "T", body: "B" }, { idempotencyKey: "p1" })
    expect(outbox.messages).toHaveLength(4)
    expect(outbox.last("email")?.rendered.subject).toBe("Hi")
    expect(outbox.last()?.channel).toBe("push")
    expect(outbox.to("+15550100").map((m) => m.channel)).toEqual(["sms", "whatsapp"])
    expect(outbox.messages[0]?.at).toBe(1000)
    expect(seen).toHaveLength(4)
    off()

    outbox.failNext("sms", { permanent: true, code: "INVALID_NUMBER" })
    const err = await senders.sms
      .send("+1", { text: "x" }, { idempotencyKey: "s2" })
      .catch((e) => e)
    expect(err).toMatchObject({ code: "INVALID_NUMBER", permanent: true })
    await senders.sms.send("+1", { text: "x" }, { idempotencyKey: "s3" })
    expect(outbox.messages).toHaveLength(5)
    outbox.clear()
    expect(outbox.messages).toHaveLength(0)
  })

  test("drives the real createNotifier", async () => {
    const { createNotifier, defineTemplates, kvNotifyStore } = await import(
      "@dapplelight/signet-server/notify/notifier"
    )
    const { memoryKv } = await import("@dapplelight/signet-server/adapters")
    const { z } = await import("zod")
    const { outbox, senders } = fakeSenders()
    const notify = createNotifier({
      channels: senders,
      store: kvNotifyStore(memoryKv()),
      templates: defineTemplates({
        welcome: {
          category: "account",
          data: z.object({ name: z.string() }),
          en: {
            email: { subject: (d) => `Welcome, ${d.name}`, html: (d) => `<p>Hi ${d.name}</p>` },
          },
        },
      }),
      recipients: async () => ({ email: "new@example.test" }),
      retry: { baseSeconds: 0 },
    })
    await notify.notify("u1", "welcome", { name: "Asha" })
    await new Promise((r) => setTimeout(r, 20))
    expect(outbox.last("email")?.to).toBe("new@example.test")
    expect(outbox.last("email")?.rendered.subject).toBe("Welcome, Asha")
  })
})

describe("fakeModel", () => {
  test("generate and stream through the AI SDK, prompts recorded", async () => {
    const model = fakeModel(["one", { n: 2 }])
    const a = await generateText({ model, prompt: "first" })
    const b = await generateText({ model, prompt: "second" })
    expect(a.text).toBe("one")
    expect(JSON.parse(b.text)).toEqual({ n: 2 })
    const s = streamText({ model, prompt: "third question" })
    const parts: string[] = []
    for await (const t of s.textStream) parts.push(t)
    expect(parts.join("")).toBe('{"n":2}')
    expect(model.prompts()).toHaveLength(3)
    expect(model.prompts()[2]).toContain("third question")
    expect(model.doGenerateCalls).toHaveLength(2)

    const words = fakeModel((p) => (p.includes("hello") ? "hi there friend" : "?"))
    const parts2: string[] = []
    for await (const t of streamText({ model: words, prompt: "hello" }).textStream) parts2.push(t)
    expect(parts2).toEqual(["hi ", "there ", "friend"])
  })
})
