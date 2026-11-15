// The small fakes against the real modules that consume them: createNotifier
// with fake senders, the AI SDK with the mock model. Gateways and stores have
// their own files.
import { describe, expect, test } from "bun:test"
import { generateText, streamText } from "ai"
import { fakeModel } from "../src/ai"
import { DAY, fakeClock } from "../src/clock"
import { fakeFetch } from "../src/fetch"
import { createOutbox, fakeSenders } from "../src/notify"

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
