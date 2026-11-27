import { AsyncLocalStorage } from "node:async_hooks"
import {
  type Context,
  type ContextManager,
  context,
  ROOT_CONTEXT,
  type Span,
  type SpanContext,
  type SpanStatus,
  trace,
} from "@opentelemetry/api"
import { Hono } from "hono"
import { requestId } from "../src/middleware/request-id"
import { createLogger } from "../src/observability/logger"
import { requestLog } from "../src/observability/request-log"
import { createSentry } from "../src/observability/sentry"
import { traceContext, traceMiddleware, withSpan } from "../src/observability/trace"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
const PARENT_SPAN = "00f067aa0ba902b7"

/** Lines written by a logger, parsed. */
function capture(opts: Parameters<typeof createLogger>[0] = {}) {
  const lines: Record<string, unknown>[] = []
  const logger = createLogger({ ...opts, write: (line) => lines.push(JSON.parse(line)) })
  return { logger, lines }
}

function app(logger = capture().logger) {
  const a = new Hono()
  a.use("*", requestId())
  a.use("*", traceMiddleware({ serviceName: "api", skipPaths: ["/health"] }))
  a.use("*", requestLog({ logger, skipPaths: ["/health"], slowMs: 20 }))
  a.get("/health", (c) => c.text("ok"))
  a.get("/orders/:id", (c) => c.json({ id: c.req.param("id") }))
  a.get("/slow", async (c) => {
    await new Promise((r) => setTimeout(r, 40))
    return c.text("slow")
  })
  a.get("/missing", (c) => c.json({}, 404))
  a.get("/boom", () => {
    throw new Error("boom")
  })
  return a
}

console.log("no provider registered: every call is a no-op")
{
  const { logger, lines } = capture()
  const res = await app(logger).request("/orders/ord_1042?token=abc")
  ok("request still served", res.status === 200)
  ok("no trace id", lines[0]?.traceId === undefined && lines[1]?.traceId === undefined)
  ok("withSpan runs fn", (await withSpan("job", { n: 1 }, () => 7)) === 7)
  let handled: unknown
  await withSpan("job", {}, (s) => {
    s.setAttribute("k", "v")
    handled = s
  })
  ok("withSpan hands a usable handle", typeof (handled as Span).setAttribute === "function")
  ok(
    "withSpan rethrows",
    await withSpan("job", {}, () => {
      throw new Error("x")
    }).then(
      () => false,
      (e) => (e as Error).message === "x",
    ),
  )
}

// An in-memory tracer: records spans, no exporter, no SDK.
type Rec = {
  name: string
  kind?: number
  attributes: Record<string, unknown>
  status?: SpanStatus
  exceptions: Error[]
  ended: boolean
  ctx: SpanContext
  parent?: SpanContext
}
const spans: Rec[] = []
let counter = 0
const hex = (n: number, len: number) => n.toString(16).padStart(len, "0")

const als = new AsyncLocalStorage<Context>()
const manager: ContextManager = {
  active: () => als.getStore() ?? ROOT_CONTEXT,
  with: (ctx, fn, thisArg, ...args) => als.run(ctx, () => fn.call(thisArg, ...args)),
  bind: (_c, target) => target,
  enable() {
    return this
  },
  disable() {
    return this
  },
}
context.setGlobalContextManager(manager)
trace.setGlobalTracerProvider({
  getTracer: () => ({
    startActiveSpan: () => {
      throw new Error("unused")
    },
    startSpan: (name, options, ctx) => {
      const parent = ctx ? trace.getSpanContext(ctx) : undefined
      counter++
      const sc: SpanContext = {
        traceId: parent?.traceId ?? hex(counter, 32),
        spanId: hex(counter, 16),
        traceFlags: 1,
      }
      const rec: Rec = {
        name,
        kind: options?.kind,
        attributes: { ...options?.attributes },
        exceptions: [],
        ended: false,
        ctx: sc,
        parent,
      }
      spans.push(rec)
      const span: Span = {
        spanContext: () => sc,
        setAttribute: (k, v) => {
          rec.attributes[k] = v
          return span
        },
        setAttributes: () => span,
        addEvent: () => span,
        addLink: () => span,
        addLinks: () => span,
        setStatus: (s) => {
          rec.status = s
          return span
        },
        updateName: () => span,
        end: () => {
          rec.ended = true
        },
        isRecording: () => true,
        recordException: (e) => {
          rec.exceptions.push(e as Error)
        },
      }
      return span
    },
  }),
})

const take = () => spans.splice(0)

console.log("server span")
{
  const { logger, lines } = capture()
  const res = await app(logger).request("/orders/ord_1042?token=abc")
  const [s] = take()
  ok("one span", s !== undefined)
  ok("named by method and route pattern", s?.name === "GET /orders/:id", s?.name)
  ok("server kind", s?.kind === 1)
  ok("method attribute", s?.attributes["http.request.method"] === "GET")
  ok("route is the pattern", s?.attributes["http.route"] === "/orders/:id")
  ok("status attribute", s?.attributes["http.response.status_code"] === 200)
  ok("service name", s?.attributes["service.name"] === "api")
  ok("ok span has no error status", s?.status === undefined)
  ok("ended", s?.ended === true)
  ok(
    "no path, query or header attribute",
    !JSON.stringify(s?.attributes).includes("ord_1042") &&
      !JSON.stringify(s?.attributes).includes("token"),
  )
  ok("no incoming traceparent: new root", s?.parent === undefined)
  ok("log lines carry the span's trace id", lines[0]?.traceId === s?.ctx.traceId)
  ok("request id header still set", res.headers.get("x-request-id") !== null)
}

console.log("incoming traceparent")
{
  const { logger, lines } = capture()
  await app(logger).request("/orders/ord_1042", {
    headers: { traceparent: `00-${TRACE_ID}-${PARENT_SPAN}-01` },
  })
  const [s] = take()
  ok("continues the caller's trace", s?.ctx.traceId === TRACE_ID)
  ok("caller's span is the parent", s?.parent?.spanId === PARENT_SPAN && s.parent.isRemote === true)
  ok("log carries the caller's trace id", lines[0]?.traceId === TRACE_ID)

  await app(logger).request("/orders/ord_1042", { headers: { traceparent: "garbage" } })
  const [bad] = take()
  ok("malformed traceparent is ignored", bad?.parent === undefined)
  await app(logger).request("/orders/ord_1042", {
    headers: { traceparent: `00-${"0".repeat(32)}-${PARENT_SPAN}-01` },
  })
  ok("all-zero trace id is ignored", take()[0]?.parent === undefined)
}

console.log("skipPaths")
{
  const { logger, lines } = capture()
  await app(logger).request("/health")
  ok("no span", take().length === 0)
  ok("no log line", lines.length === 0)
}

console.log("status and errors")
{
  const { logger, lines } = capture()
  await app(logger).request("/missing")
  const [s404] = take()
  ok("4xx is not a span error", s404?.status === undefined)
  ok("4xx status attribute", s404?.attributes["http.response.status_code"] === 404)
  ok("4xx logs at warn level", lines[1]?.level === "warn" && lines[1]?.msg === "request.completed")

  lines.length = 0
  const res = await app(logger).request("/boom")
  const [s500] = take()
  ok("a throw still answers 500", res.status === 500)
  ok("error status on the span", s500?.status?.code === 2)
  ok("exception recorded", s500?.exceptions[0]?.message === "boom")
  ok("span ended", s500?.ended === true)
  ok(
    "failed line at error level",
    lines[1]?.msg === "request.failed" && lines[1]?.level === "error",
  )
  ok("failed line carries the message", lines[1]?.error === "boom")
}

console.log("rethrow")
{
  // Hono turns a handler's throw into `c.error`, so `next()` rarely throws.
  // Call the middleware by hand with a `next` that does, to prove it rethrows.
  const { logger, lines } = capture()
  const a = new Hono()
  let caught: unknown
  const mws = [traceMiddleware({ serviceName: "api" }), requestLog({ logger })]
  a.get("/x", async (c) => {
    const run = async (i: number): Promise<void> => {
      if (i === mws.length) throw new Error("direct")
      await mws[i]?.(c, () => run(i + 1))
    }
    try {
      await run(0)
    } catch (e) {
      caught = e
    }
    return c.text("x")
  })
  await a.request("/x")
  const [s] = take()
  ok("rethrown to the caller", (caught as Error | undefined)?.message === "direct")
  ok("recorded on the span", s?.exceptions[0]?.message === "direct" && s.status?.code === 2)
  ok("span ended", s?.ended === true)
  ok(
    "failed line logged",
    lines.some((l) => l.msg === "request.failed" && l.error === "direct"),
  )
}

console.log("requestLog lines")
{
  const { logger, lines } = capture()
  await app(logger).request("/orders/ord_1042", { headers: { "x-request-id": "req-1" } })
  take()
  const [started, done] = lines
  ok(
    "started then completed",
    started?.msg === "request.started" && done?.msg === "request.completed",
  )
  ok("started has method and route", started?.method === "GET" && started?.route === "/orders/:id")
  ok("completed has status", done?.status === 200)
  ok("durationMs is an integer", Number.isInteger(done?.durationMs))
  ok("reqId", done?.reqId === "req-1")
  ok("traceId is 32 hex", /^[0-9a-f]{32}$/.test(String(done?.traceId)))
  ok("info level", started?.level === "info" && done?.level === "info")
  ok("not slow", done?.slow === undefined)
  ok(
    "no query string or path",
    !JSON.stringify(lines).includes("ord_1042") && !JSON.stringify(lines).includes("?"),
  )
}

console.log("slow")
{
  const { logger, lines } = capture()
  await app(logger).request("/slow")
  take()
  const done = lines[1]
  ok("same message, slow: true", done?.msg === "request.completed" && done?.slow === true)
}

console.log("level override")
{
  const { logger, lines } = capture()
  const a = new Hono()
  a.use("*", requestLog({ logger, level: () => "warn" }))
  a.get("/x", (c) => c.text("x"))
  await a.request("/x")
  ok("level(status) decides", lines[1]?.msg === "request.completed" && lines[1]?.level === "warn")
}

console.log("traceContext and withSpan")
{
  const a = new Hono()
  let seen: ReturnType<typeof traceContext> | undefined
  a.use(
    "*",
    traceMiddleware({ serviceName: "api", tracerName: "t", attributes: () => ({ tenant: "t1" }) }),
  )
  a.get("/x", async (c) => {
    seen = traceContext(c)
    return c.json(
      await withSpan("load", { table: "orders" }, (s) => (s.setAttribute("rows", 2), 2)),
    )
  })
  await a.request("/x")
  const [server, child] = take()
  ok(
    "traceContext matches the span",
    seen?.traceId === server?.ctx.traceId && seen?.spanId === server?.ctx.spanId,
  )
  ok("custom attributes", server?.attributes.tenant === "t1")
  ok("withSpan is a child of the request span", child?.parent?.spanId === server?.ctx.spanId)
  ok("withSpan attributes", child?.attributes.table === "orders" && child?.attributes.rows === 2)
  ok("withSpan ended", child?.ended === true)
  ok("unmounted context is empty", traceContext(fakeCtx()).traceId === undefined)

  const err = await withSpan("bad", {}, () => {
    throw new Error("bad")
  }).catch((e: Error) => e)
  const [bad] = take()
  ok(
    "withSpan error recorded and rethrown",
    (err as Error).message === "bad" && bad?.status?.code === 2 && bad.exceptions.length === 1,
  )
}

function fakeCtx() {
  return { get: () => undefined, req: { header: () => undefined } } as never
}

console.log("logger mixin")
{
  const off = capture({ base: { service: "api" } })
  off.logger.info({ a: 1 }, "hi")
  const plain = JSON.stringify(off.lines[0]).replace(/"time":"[^"]*"/, "")
  const asDefault = capture({ base: { service: "api" }, mixin: undefined })
  asDefault.logger.info({ a: 1 }, "hi")
  ok(
    "unset mixin leaves output unchanged",
    plain === JSON.stringify(asDefault.lines[0]).replace(/"time":"[^"]*"/, ""),
  )

  let n = 0
  const m = capture({ base: { service: "api", n: "base" }, mixin: () => ({ n: ++n, token: "t" }) })
  m.logger.info("a")
  m.logger.child({ k: 1 }).info({ n: "call" }, "b")
  ok("mixin fields on every line", m.lines[0]?.n === 1)
  ok("mixin beats base, call beats mixin", m.lines[1]?.n === "call" && m.lines[1]?.k === 1)
  ok("mixin fields are redacted", m.lines[0]?.token === "[redacted]")
  const t = capture({ mixin: () => ({ traceId: trace.getActiveSpan()?.spanContext().traceId }) })
  await withSpan("s", {}, () => t.logger.info("in span"))
  const [inSpan] = take()
  ok("mixin reads the active span", t.lines[0]?.traceId === inSpan?.ctx.traceId)
  const thrower = capture({
    mixin: () => {
      throw new Error("mixin broke")
    },
  })
  thrower.logger.info("still out")
  ok("a throwing mixin does not lose the line", thrower.lines[0]?.msg === "still out")
}

console.log("sentry traceId tag")
{
  const bodies: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body))
    return new Response("{}", { status: 200 })
  }) as typeof fetch
  try {
    const sentry = createSentry({
      dsn: "https://pub@sentry.example/42",
      enabled: true,
      tags: { app: "api" },
    })
    await sentry.captureException(new Error("e"), undefined, {
      tags: { route: "/pay" },
      traceId: TRACE_ID,
    })
    await sentry.captureException(new Error("e"), undefined, { tags: { route: "/pay" } })
  } finally {
    globalThis.fetch = realFetch
  }
  const tagsOf = (body: string | undefined) =>
    JSON.parse(body?.split("\n")[2] ?? "{}").tags as Record<string, string>
  ok("trace_id tag set", tagsOf(bodies[0]).trace_id === TRACE_ID)
  ok("other tags kept", tagsOf(bodies[0]).app === "api" && tagsOf(bodies[0]).route === "/pay")
  ok("no tag without traceId", tagsOf(bodies[1]).trace_id === undefined)
}

console.log("sentry 429 backoff")
{
  let calls = 0
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    calls++
    return new Response("{}", { status: 429, headers: { "Retry-After": "60" } })
  }) as typeof fetch
  const realNow = Date.now
  try {
    const dsn = "https://pub@sentry-429.example/7"
    const results = []
    // Fresh client per call, as a Worker built per request would.
    for (let i = 0; i < 10; i++) {
      results.push(await createSentry({ dsn, enabled: true }).captureException(new Error("e")))
    }
    ok("one fetch for ten captures after a 429", calls === 1)
    ok(
      "none reported as accepted",
      results.every((r) => r === false),
    )
    Date.now = () => realNow() + 61_000
    await createSentry({ dsn, enabled: true }).captureException(new Error("e"))
    ok("sends again once Retry-After has passed", calls === 2)
  } finally {
    globalThis.fetch = realFetch
    Date.now = realNow
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
