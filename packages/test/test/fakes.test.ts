// The small fakes against the real modules that consume them: createNotifier
// with fake senders, the AI SDK with the mock model. Gateways and stores have
// their own files.
import { describe, expect, test } from "bun:test"
import { generateText, streamText } from "ai"
import { fakeModel } from "../src/ai"
import { DAY, fakeClock } from "../src/clock"
import { fakeFetch } from "../src/fetch"
import { createOutbox, fakeNotifyStore, fakeSenders } from "../src/notify"

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

describe("outbox edge cases", () => {
  test("a resend with the same idempotency key is recorded once", async () => {
    const { outbox, senders } = fakeSenders()
    const a = await senders.sms.send("+1", { text: "x" }, { idempotencyKey: "k" })
    const b = await senders.sms.send("+1", { text: "x" }, { idempotencyKey: "k" })
    expect(b.id).toBe(a.id)
    expect(outbox.messages).toHaveLength(1)
    // Same key on another channel is a different message.
    await senders.email.send(
      "a@example.test",
      { subject: "s", html: "h", text: "t", headers: {} },
      { idempotencyKey: "k" },
    )
    expect(outbox.messages).toHaveLength(2)
  })

  test("a throwing listener does not break the send or other listeners", async () => {
    const { outbox, senders } = fakeSenders()
    const seen: string[] = []
    const err = console.error
    console.error = () => {}
    try {
      outbox.subscribe(() => {
        throw new Error("boom")
      })
      outbox.subscribe((m) => seen.push(m.channel))
      await senders.sms.send("+1", { text: "x" }, { idempotencyKey: "a" })
    } finally {
      console.error = err
    }
    expect(seen).toEqual(["sms"])
    expect(outbox.messages).toHaveLength(1)
  })

  test("concurrent sends all land, in call order, with unique ids", async () => {
    const { outbox, senders } = fakeSenders()
    const ids = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        senders.push.send(`u${i}`, { title: "T", body: "B" }, { idempotencyKey: `p${i}` }),
      ),
    )
    expect(new Set(ids.map((r) => r.id)).size).toBe(50)
    expect(outbox.messages.map((m) => m.to)).toEqual(ids.map((_, i) => `u${i}`))
  })

  test("failNext only fails its own channel, once", async () => {
    const { outbox, senders } = fakeSenders()
    outbox.failNext("email")
    await senders.sms.send("+1", { text: "x" }, { idempotencyKey: "a" })
    const r = { subject: "s", html: "h", text: "t", headers: {} }
    expect(
      await senders.email.send("a@x.test", r, { idempotencyKey: "b" }).catch(() => "failed"),
    ).toBe("failed")
    await senders.email.send("a@x.test", r, { idempotencyKey: "c" })
    expect(outbox.messages.map((m) => m.channel)).toEqual(["sms", "email"])
  })
})

describe("fakeNotifyStore", () => {
  const setup = async () => {
    const { createNotifier, defineTemplates } = await import(
      "@dapplelight/signet-server/notify/notifier"
    )
    const { z } = await import("zod")
    const clock = fakeClock("2026-11-01T10:00:00Z")
    const store = fakeNotifyStore({ now: clock.now })
    const { outbox, senders } = fakeSenders(createOutbox({ now: clock.now }))
    const notifier = createNotifier({
      channels: senders,
      store,
      templates: defineTemplates({
        shipped: {
          category: "orders",
          data: z.object({ id: z.string() }),
          en: {
            email: { subject: (d) => `Order ${d.id}`, html: (d) => `<p>${d.id}</p>` },
            inApp: { title: () => "Shipped", body: (d) => `Order ${d.id}` },
          },
        },
      }),
      recipients: async () => ({ email: "buyer@example.test" }),
      retry: { baseSeconds: 0 },
      now: clock.now,
    })
    const settle = () => new Promise((r) => setTimeout(r, 20))
    return { clock, store, outbox, notifier, settle }
  }

  test("the real notifier writes deliveries and the inbox to it", async () => {
    const { store, outbox, notifier, settle } = await setup()
    await notifier.notify("u1", "shipped", { id: "o1" })
    await settle()
    expect(outbox.last("email")?.rendered.subject).toBe("Order o1")
    expect([...store.deliveries.values()].map((d) => d.channel).sort()).toEqual(["email", "inApp"])
    expect(await notifier.inbox.unreadCount("u1")).toBe(1)
    const [item] = (await notifier.inbox.list("u1")).items
    await notifier.inbox.markRead("u1", [item?.id as string])
    expect(await notifier.inbox.unreadCount("u1")).toBe(0)
  })

  test("failNext: a permanent failure is final, a transient one is retried", async () => {
    const { store, outbox, notifier, settle } = await setup()
    outbox.failNext("email", { code: "BOUNCED", permanent: true })
    await notifier.notify("u1", "shipped", { id: "o1" })
    await settle()
    const email = () => [...store.deliveries.values()].filter((d) => d.channel === "email")
    expect(email()[0]).toMatchObject({ status: "failed", reason: "BOUNCED", attempts: 1 })
    expect(outbox.messages).toHaveLength(0)

    outbox.failNext("email", { code: "RATE_LIMITED" })
    await notifier.notify("u1", "shipped", { id: "o2" })
    await settle()
    const retried = email().find((d) => d.status !== "failed")
    expect(retried).toMatchObject({ status: "sent", attempts: 2 })
    expect(outbox.last("email")?.rendered.subject).toBe("Order o2")
  })

  test("returned values are copies; deleteUser and reset clear it", async () => {
    const { store, notifier, settle } = await setup()
    await notifier.notify("u1", "shipped", { id: "o1" })
    await notifier.notify("u2", "shipped", { id: "o2" })
    await settle()
    const items = await store.listInbox("u1")
    ;(items[0] as { title: string }).title = "changed"
    expect((await store.listInbox("u1"))[0]?.title).toBe("Shipped")
    await notifier.deleteUser("u1")
    expect(await store.listInbox("u1")).toEqual([])
    expect(await store.listDeliveries("u1")).toEqual([])
    expect(await store.listDeliveries("u2")).toHaveLength(2)
    store.reset()
    expect(store.deliveries.size).toBe(0)
  })

  test("payloads and WhatsApp windows expire on the fake clock", async () => {
    const { clock, store } = await setup()
    await store.putPayload("d1", { a: 1 }, 60)
    await store.openWindow("+1", 24 * 3600)
    clock.advance(59_000)
    expect(await store.getPayload("d1")).toEqual({ a: 1 })
    clock.advance(1_000)
    expect(await store.getPayload("d1")).toBeNull()
    expect(await store.isWindowOpen("+1")).toBe(true)
    clock.advance(DAY)
    expect(await store.isWindowOpen("+1")).toBe(false)
  })

  test("createDelivery is a claim: the second create of an id fails", async () => {
    const { store } = await setup()
    const d = {
      id: "d1",
      userId: "u1",
      event: "e",
      category: "c",
      channel: "sms" as const,
      to: "+1",
      status: "queued" as const,
      attempts: 0,
      createdAt: "",
      updatedAt: "",
    }
    const claims = await Promise.all([store.createDelivery(d), store.createDelivery(d)])
    expect(claims.sort()).toEqual([false, true])
    expect(await store.isSuppressed("email", "A@X.test")).toBe(false)
    await store.suppress("email", "a@x.test", "bounce")
    expect(await store.isSuppressed("email", "A@X.test")).toBe(true)
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

describe("fakeClock guards", () => {
  test("set and advance refuse a non-time instead of going NaN", () => {
    const clock = fakeClock(0)
    expect(() => clock.set("not a date")).toThrow("not a time")
    expect(() => clock.advance(Number.NaN)).toThrow("not a time")
    expect(clock.now()).toBe(0)
    expect(clock.advance(-1000)).toBe(-1000)
  })
})
