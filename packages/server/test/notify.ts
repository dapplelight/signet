import { Hono } from "hono"
import { errorHandler } from "../src/http/errors"
import { createEmailer } from "../src/notify/email"
import { createPusher, isGone, type PushSubscription } from "../src/notify/push"
import { createTelegram, escapeMarkdown } from "../src/notify/telegram"
import { createSentry, parseStack } from "../src/observability/sentry"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

let calls: Array<{ url: string; body: unknown; raw: string; headers: Record<string, string> }> = []
/** JSON body as is; an envelope (header, item header, payload lines) as its payload. */
const parseBody = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return JSON.parse(raw.split("\n")[2] ?? "null")
  }
}
const stubFetch = (status = 200) => {
  calls = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const raw = init?.body ? String(init.body) : ""
    calls.push({
      url: String(url),
      body: raw ? parseBody(raw) : null,
      raw,
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
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
  "sentry posts to the envelope endpoint, not the deprecated store",
  calls[0]?.url === "https://o1.ingest.sentry.io/api/123/envelope/",
  calls[0]?.url,
)
{
  const [header, item, payload, ...rest] = (calls[0]?.raw ?? "").split("\n")
  const h = JSON.parse(header ?? "{}")
  const p = JSON.parse(payload ?? "{}")
  ok("envelope: three lines", rest.length === 0 && !!payload)
  ok("envelope: item header is an event", JSON.parse(item ?? "{}").type === "event")
  ok(
    "envelope: header carries the event id and sent_at",
    h.event_id === p.event_id && !Number.isNaN(Date.parse(h.sent_at)),
  )
  ok(
    "envelope: content type and auth",
    calls[0]?.headers["Content-Type"] === "application/x-sentry-envelope" &&
      calls[0]?.headers["X-Sentry-Auth"]?.includes("sentry_key=key") === true,
  )
}
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
    "stack frames are parsed",
    sent?.exception?.values?.[0]?.stacktrace?.frames?.length > 0 &&
      sent.exception.values[0].stacktrace.frames.every(
        (f: any) => typeof f.filename === "string" && Number.isInteger(f.lineno),
      ),
  )
  ok(
    "last frame is where the error was thrown",
    sent.exception.values[0].stacktrace.frames.at(-1).filename.includes("notify.ts"),
  )
  stubFetch()
  const leaky = new Error("x")
  leaky.stack = "Error: x\n    at login (/srv/app/user=a.b@x.com/run.ts:3:9)"
  await createSentry({ dsn: "https://k@h/1", enabled: true }).captureException(leaky)
  ok(
    "frames are scrubbed by default",
    !JSON.stringify(calls[0]?.body).includes("a.b@x.com") &&
      JSON.stringify(calls[0]?.body).includes("[redacted-email]"),
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
  ok(
    "includeStack:false omits the stack",
    (calls[0]?.body as any)?.exception?.values?.[0]?.stacktrace === undefined &&
      !calls[0]?.raw.includes("notify.ts"),
  )

  // parseStack: both engines' formats, oldest call first
  const frames = parseStack(
    [
      "    at async handler (file:///srv/app/src/a.ts:10:5)",
      "    at new Thing (/srv/app/node_modules/lib/b.js:2:3)",
      "    at /srv/app/src/anon.ts:7:1",
      "    at node:internal/process:1:1",
    ].join("\n"),
  )
  ok(
    "parseStack: oldest first",
    frames[0]?.filename === "node:internal/process" && frames.length === 4,
  )
  ok(
    "parseStack: function, file, line, column",
    frames[3]?.function === "async handler" &&
      frames[3].filename === "file:///srv/app/src/a.ts" &&
      frames[3].lineno === 10 &&
      frames[3].colno === 5,
  )
  ok(
    "parseStack: anonymous frame has no function",
    frames[1]?.function === undefined && frames[1]?.filename === "/srv/app/src/anon.ts",
  )
  ok(
    "parseStack: in_app false for node_modules and node:",
    frames[0]?.in_app === false && frames[2]?.in_app === false && frames[3]?.in_app === true,
  )
  const gecko = parseStack(
    "run@https://x.test/app.js:12:34\n@https://x.test/app.js:5\nnative@[native code]",
  )
  ok(
    "parseStack: Firefox/Safari format",
    gecko.length === 2 &&
      gecko[1]?.function === "run" &&
      gecko[1].colno === 34 &&
      gecko[0]?.lineno === 5 &&
      gecko[0].colno === undefined,
  )
  ok(
    "parseStack: empty and junk give no frames",
    parseStack("").length === 0 && parseStack("Error: x").length === 0,
  )

  // tags, request and user context
  stubFetch()
  await createSentry({
    dsn: "https://k@h/1",
    enabled: true,
    tags: { service: "api", region: "eu" },
  }).captureException(
    new Error("x"),
    { job: "sync" },
    {
      tags: { region: "us", route: "/pay" },
      request: {
        url: "https://app.test/pay?token=abc123",
        method: "POST",
        headers: {
          Authorization: "Bearer s3cret",
          "X-Forwarded-For": "1.2.3.4",
          cookie: "sid=9",
          "x-api-key": "k-111",
          "X-Auth-Token": "t-222",
          "x-csrf-token": "c-333",
          "x-custom": "Bearer eyJhbGciOi.payload.sig-444",
        },
      },
      user: { id: "u1", ip_address: "1.2.3.4" },
    },
  )
  {
    const ev = calls[0]?.body as any
    ok(
      "tags: scope overrides config",
      ev.tags.service === "api" && ev.tags.region === "us" && ev.tags.route === "/pay",
    )
    ok(
      "request: method and url",
      ev.request.method === "POST" && ev.request.url.startsWith("https://app.test/pay"),
    )
    ok("request: url is scrubbed", !JSON.stringify(ev.request).includes("abc123"))
    ok(
      "request: credential headers are dropped, others kept",
      !JSON.stringify(ev.request).includes("s3cret") &&
        !JSON.stringify(ev.request).includes("sid=9") &&
        !/k-111|t-222|c-333|sig-444/.test(JSON.stringify(ev.request)) &&
        ev.request.headers["X-Forwarded-For"] === "1.2.3.4",
    )
    ok("user", ev.user.id === "u1" && ev.user.ip_address === "1.2.3.4")
    ok("context still goes in extra", ev.extra.job === "sync" && ev.extra.stacktrace === undefined)
  }
  stubFetch()
  await createSentry({ dsn: "https://k@h/1", enabled: true }).captureException(new Error("x"))
  {
    const ev = calls[0]?.body as any
    ok(
      "no scope: no tags, request or user keys",
      !("tags" in ev) && !("request" in ev) && !("user" in ev),
    )
  }

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
