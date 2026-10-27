import { Hono } from "hono"
import { errorHandler } from "../src/http/errors"
import { createEmailer } from "../src/notify/email"
import { createPusher, isGone, type PushSubscription } from "../src/notify/push"
import { createTelegram, escapeMarkdown } from "../src/notify/telegram"
import { createSentry } from "../src/observability/sentry"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

let calls: Array<{ url: string; body: unknown }> = []
const stubFetch = (status = 200) => {
  calls = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(status === 200 ? "{}" : "error", { status })
  }) as typeof fetch
}

// --- sentry ---
stubFetch()
createSentry({ dsn: "https://key@o1.ingest.sentry.io/123", enabled: true }).captureException(
  new Error("boom"),
)
await new Promise((r) => setTimeout(r, 10))
ok(
  "sentry posts to store endpoint",
  calls[0]?.url === "https://o1.ingest.sentry.io/api/123/store/",
  calls[0]?.url,
)
ok("sentry sends exception", (calls[0]?.body as any)?.exception?.values?.[0]?.value === "boom")
stubFetch()
createSentry({ dsn: "https://key@h/1", enabled: false }).captureException(new Error("x"))
await new Promise((r) => setTimeout(r, 10))
ok("disabled sentry sends nothing", calls.length === 0)
stubFetch()
createSentry({ dsn: "not-a-url", enabled: true }).captureException(new Error("x"))
await new Promise((r) => setTimeout(r, 10))
ok("malformed dsn sends nothing", calls.length === 0)
ok("isEnabled false without dsn", createSentry({ enabled: true }).isEnabled === false)
// A reporting failure must not throw into the caller
globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch
const failed = createSentry({ dsn: "https://k@h/1", enabled: true }).captureException(
  new Error("x"),
)
ok(
  "sentry network failure resolves false, never rejects",
  (await failed.catch(() => "rejected")) === false,
)

// The report is returned so a Worker can waitUntil it. Fire-and-forget was cut
// off when the isolate froze after the response, so consumers slept 3s instead.
stubFetch()
ok(
  "sentry report resolves true when accepted",
  (await createSentry({ dsn: "https://k@h/1", enabled: true }).captureException(new Error("x"))) ===
    true,
)
stubFetch(500)
ok(
  "sentry report resolves false when rejected",
  (await createSentry({ dsn: "https://k@h/1", enabled: true }).captureException(new Error("x"))) ===
    false,
)
ok(
  "disabled sentry resolves false",
  (await createSentry({ dsn: "https://k@h/1", enabled: false }).captureException(
    new Error("x"),
  )) === false,
)

// Scrubbing: error text carries credentials and personal data. On by default.
{
  const { redactSecrets } = await import("../src/observability/sentry")
  const dirty =
    "query failed for user a.b@x.com with Authorization: Bearer sk_live_abc123 password=hunter2 acct 123456789012 token eyJhbGciOi.eyJzdWIiOjF9.c2lnbmF0dXJl"
  const clean = redactSecrets(dirty)
  ok("redacts email", !clean.includes("a.b@x.com") && clean.includes("[redacted-email]"))
  ok("redacts bearer token", !clean.includes("sk_live_abc123"))
  ok("redacts password=", !clean.includes("hunter2"))
  ok("redacts long digit runs", !clean.includes("123456789012"))
  ok("redacts JWT", !clean.includes("eyJhbGciOi.eyJzdWIiOjF9"))
  ok("keeps ordinary text", clean.startsWith("query failed for user"))

  stubFetch()
  const secretErr = new Error("login failed for a.b@x.com password=hunter2")
  await createSentry({ dsn: "https://k@h/1", enabled: true }).captureException(secretErr)
  const sent = calls[0]?.body as any
  ok(
    "message scrubbed by default",
    !JSON.stringify(sent).includes("hunter2") && !JSON.stringify(sent).includes("a.b@x.com"),
  )
  ok(
    "stack scrubbed by default",
    typeof sent?.extra?.stacktrace === "string" && !sent.extra.stacktrace.includes("hunter2"),
  )

  stubFetch()
  const named = Object.assign(new Error("x"), { name: "Failed for a.b@x.com" })
  await createSentry({ dsn: "https://k@h/1", enabled: true }).captureException(named)
  ok(
    "a non-identifier error name becomes Error",
    (calls[0]?.body as any)?.exception?.values?.[0]?.type === "Error",
  )
  stubFetch()
  class ValidationError extends Error {
    name = "ValidationError"
  }
  await createSentry({ dsn: "https://k@h/1", enabled: true }).captureException(
    new ValidationError("x"),
  )
  ok(
    "a class-like error name is kept",
    (calls[0]?.body as any)?.exception?.values?.[0]?.type === "ValidationError",
  )

  stubFetch()
  await createSentry({ dsn: "https://k@h/1", enabled: true, includeStack: false }).captureException(
    new Error("x"),
  )
  ok("includeStack:false omits the stack", (calls[0]?.body as any)?.extra?.stacktrace === undefined)

  stubFetch()
  const dropped = await createSentry({
    dsn: "https://k@h/1",
    enabled: true,
    beforeSend: () => null,
  }).captureException(new Error("x"))
  ok("beforeSend null drops the event", dropped === false && calls.length === 0)

  stubFetch()
  await createSentry({
    dsn: "https://k@h/1",
    enabled: true,
    beforeSend: (e) => ({ ...e, extra: { reqId: e.extra?.reqId } }),
  }).captureException(new Error("x"), { reqId: "r1", email: "leak@x.com" })
  ok(
    "beforeSend can allowlist context",
    JSON.stringify(calls[0]?.body).includes("r1") &&
      !JSON.stringify(calls[0]?.body).includes("leak@x.com"),
  )
}

// errorHandler hands onError's promise to waitUntil on Workers
stubFetch()
const sentry = createSentry({ dsn: "https://k@h/1", enabled: true })
const failing = new Hono()
  .get("/", () => {
    throw new Error("route broke")
  })
  .onError(
    errorHandler({
      isProduction: () => true,
      onError: (err, meta) => sentry.captureException(err, meta),
    }),
  )
const waited: Promise<unknown>[] = []
const workerRes = await failing.request("/", {}, {}, {
  waitUntil: (p: Promise<unknown>) => waited.push(p),
  passThroughOnException() {},
  props: {},
} as any)
ok("errorHandler still returns 500", workerRes.status === 500, String(workerRes.status))
ok("errorHandler passes the report to waitUntil", waited.length === 1)
await Promise.all(waited)
ok(
  "waited report reached sentry",
  calls.length === 1 && (calls[0]?.body as any)?.exception?.values?.[0]?.value === "route broke",
)
const bunRes = await failing.request("/")
ok("errorHandler without executionCtx does not throw", bunRes.status === 500, String(bunRes.status))

// --- email ---
stubFetch()
const mailer = createEmailer({ apiKey: "re_x", from: "A <a@b.com>" })
ok("sends", await mailer.send({ to: "x@y.com", subject: "S", html: "<p>h</p>" }))
ok("uses resend endpoint", calls[0]?.url === "https://api.resend.com/emails")
ok("applies default from", (calls[0]?.body as any)?.from === "A <a@b.com>")
stubFetch(500)
ok(
  "500 returns false, does not throw",
  (await mailer.send({ to: "x@y.com", subject: "S" })) === false,
)
stubFetch()
const events: string[] = []
const noKey = createEmailer({ from: "f", apiKey: undefined, onEvent: (e) => events.push(e) })
ok(
  "no api key -> false, no request",
  (await noKey.send({ to: "a", subject: "b" })) === false && calls.length === 0,
)
ok("emits skip event", events[0] === "email.skipped")

// --- telegram ---
ok(
  "escapes markdown reserved chars",
  escapeMarkdown("a_b*c[d]") === "a\\_b\\*c\\[d\\]",
  escapeMarkdown("a_b*c[d]"),
)
stubFetch()
ok("sends", await createTelegram({ botToken: "t", chatId: "c" }).send("Title", "Body"))
ok("uses MarkdownV2", (calls[0]?.body as any)?.parse_mode === "MarkdownV2")
stubFetch()
ok(
  "no token -> false, no request",
  (await createTelegram({}).send("a", "b")) === false && calls.length === 0,
)

// --- push ---
const subs: PushSubscription[] = [
  { id: "1", endpoint: "e1", keys: { p256dh: "p", auth: "a" } },
  { id: "2", endpoint: "e2", keys: { p256dh: "p", auth: "a" } },
  { id: "3", endpoint: "e3", keys: { p256dh: "p", auth: "a" } },
]
ok("isGone on 410", isGone({ statusCode: 410 }))
ok("isGone on 404", isGone({ status: 404 }))
ok("not gone on 500", !isGone({ statusCode: 500 }))

const pruned: string[] = []
const pusher = createPusher({
  send: async (s) => {
    if (s.id === "2") throw { statusCode: 410 }
    if (s.id === "3") throw { statusCode: 500 }
  },
  removeSubscription: async (id) => {
    pruned.push(id)
  },
})
const sent = await pusher.sendTo(subs, { title: "T", message: "M" })
ok("counts only delivered", sent === 1, String(sent))
ok("prunes the gone subscription", pruned.length === 1 && pruned[0] === "2")
ok("does NOT prune a transient 500", !pruned.includes("3"))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
