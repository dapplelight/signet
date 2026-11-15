import { Hono } from "hono"
import {
  type AnalyticsEngineDataset,
  createAnalyticsEngine,
  LIMITS,
  toDataPoint,
  truncateBytes,
} from "../src/analytics/engine"
import { registerIngest } from "../src/analytics/ingest"
import { analyticsContext, serverTracker } from "../src/analytics/session"
import { type AnalyticsSink, consoleSink, httpSink, memorySink } from "../src/analytics/sinks"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

let written: Array<{ blobs?: string[]; doubles?: number[]; indexes?: string[] }> = []
const dataset: AnalyticsEngineDataset = {
  writeDataPoint: (p) => {
    written.push(p)
  },
}
const reset = () => {
  written = []
}

// --- shaping ---
const dp = toDataPoint({ name: "signup", props: { plan: "pro", seats: 3, nope: null }, ts: 42 })
ok("event name is first blob", dp.blobs[0] === "signup")
ok("timestamp is first double", dp.doubles[0] === 42)
ok("numbers go to doubles", dp.doubles.includes(3))
ok("strings go to blobs as key/value", dp.blobs.includes("plan") && dp.blobs.includes("pro"))
ok("null props dropped", !dp.blobs.includes("nope"))
ok("indexed by event name", dp.indexes[0] === "signup")

// --- limits: violating these makes CF drop the write SILENTLY ---
const manyProps = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, `v${i}`]))
const big = toDataPoint({ name: "e", props: manyProps })
ok("blobs capped at 20", big.blobs.length <= LIMITS.maxBlobs, String(big.blobs.length))
const manyNums = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`n${i}`, i]))
ok(
  "doubles capped at 20",
  toDataPoint({ name: "e", props: manyNums }).doubles.length <= LIMITS.maxDoubles,
)
const huge = toDataPoint({ name: "e", props: { a: "x".repeat(9000) } })
ok(
  "total blob bytes under 5120",
  huge.blobs.reduce((n, b) => n + new TextEncoder().encode(b).length, 0) <= LIMITS.maxBlobBytes,
)
ok("event name survives truncation", huge.blobs[0] === "e")
ok(
  "index capped at 96 bytes",
  new TextEncoder().encode(toDataPoint({ name: "n".repeat(300) }).indexes[0]).length <=
    LIMITS.maxIndexBytes,
)
ok("truncateBytes keeps short strings", truncateBytes("abc", 96) === "abc")
ok(
  "truncateBytes does not split multibyte chars",
  (() => {
    const t = truncateBytes("é".repeat(60), 15)
    return new TextEncoder().encode(t).length <= 15 && !t.includes("�")
  })(),
)

// --- custom index ---
ok(
  "indexBy override",
  toDataPoint({ name: "e", props: { tenant: "acme" } }, (e) => String(e.props?.tenant))
    .indexes[0] === "acme",
)

// --- writer ---
reset()
ok(
  "writes each event",
  createAnalyticsEngine({ dataset }).write([{ name: "a" }, { name: "b" }]) === 2 &&
    written.length === 2,
)
const events: string[] = []
ok(
  "no dataset -> 0 written, no throw",
  createAnalyticsEngine({ onEvent: (e) => events.push(e) }).write([{ name: "a" }]) === 0,
)
ok("emits skip event", events[0] === "analytics.skipped")
ok("isEnabled false without dataset", createAnalyticsEngine({}).isEnabled === false)
const failing = createAnalyticsEngine({
  dataset: {
    writeDataPoint: () => {
      throw new Error("binding down")
    },
  },
  onEvent: (e) => events.push(e),
})
ok("write failure does not throw", failing.write([{ name: "a" }]) === 0)
ok("emits failure event", events.includes("analytics.write_failed"))

// --- ingest route ---
reset()
const app = new Hono()
registerIngest(app as never, "/events", {
  engine: createAnalyticsEngine({ dataset }),
  enrich: () => ({ country: "IN" }),
})
const post = (body: unknown) =>
  app.request("/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

let res = await post({ events: [{ name: "pageview", props: { path: "/" } }] })
ok("accepts a batch with 202", res.status === 202)
ok("writes to the dataset", written.length === 1)
ok("server enrichment applied", written[0].blobs?.includes("IN") === true)

reset()
res = await post({ nope: true })
ok("rejects a malformed payload with 400", res.status === 400)
ok("rejected payload writes nothing", written.length === 0)

reset()
await post({ events: Array.from({ length: 200 }, () => ({ name: "spam" })) })
ok("caps events per request", written.length === 50, String(written.length))

reset()
await post({ events: [{ name: "x".repeat(500) }, { nope: 1 }, null, "junk"] })
ok("truncates long event names", (written[0].blobs?.[0]?.length ?? 0) === 64)
ok("skips entries with no name", written.length === 1)

// a client must not be able to spoof server-derived fields
reset()
await post({ events: [{ name: "e", props: { country: "XX" } }] })
ok(
  "client cannot spoof enriched fields",
  written[0].blobs?.includes("IN") === true && !written[0].blobs?.includes("XX"),
)

// --- sinks ---
{
  // The Analytics Engine writer is one sink among several.
  const engineSink: AnalyticsSink = createAnalyticsEngine({ dataset })
  ok("createAnalyticsEngine satisfies AnalyticsSink", typeof engineSink.write === "function")

  const mem = memorySink()
  const memApp = new Hono()
  registerIngest(memApp as never, "/events", { engine: mem })
  const r = await memApp.request("/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [{ name: "a" }, { name: "b" }] }),
  })
  const rb = (await r.json()) as { written?: number }
  ok(
    "registerIngest takes any sink",
    r.status === 202 && rb.written === 2 && mem.events.length === 2,
  )

  const logged: string[] = []
  ok(
    "consoleSink logs each event and counts them",
    consoleSink((e) => logged.push(e.name)).write([{ name: "x" }, { name: "y" }]) === 2 &&
      logged.join() === "x,y",
  )

  // httpSink against a fake fetch
  const posts: { url: string; headers: Record<string, string>; body: { events: unknown[] } }[] = []
  let status = 200
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if (status === 0) throw new Error("network down")
    posts.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: JSON.parse(String(init.body)),
    })
    return new Response(null, { status })
  }) as typeof fetch
  try {
    const deferred: Promise<unknown>[] = []
    const failures: Record<string, unknown>[] = []
    const sink = httpSink({
      url: "https://collector.example/e",
      headers: { authorization: "Bearer t" },
      defer: (p) => deferred.push(p),
      maxBatch: 2,
      onEvent: (_e, d) => failures.push(d),
    })
    ok(
      "httpSink write returns the count accepted",
      sink.write([{ name: "1" }, { name: "2" }]) === 2,
    )
    sink.write([{ name: "3" }])
    ok("httpSink coalesces writes in one tick into one deferred flush", deferred.length === 1)
    ok("httpSink sends nothing before the flush runs", posts.length === 0)
    await Promise.all(deferred)
    ok(
      "httpSink POSTs batches of maxBatch as JSON { events }",
      posts.length === 2 &&
        posts[0]?.body.events.length === 2 &&
        posts[1]?.body.events.length === 1,
      JSON.stringify(posts.map((p) => p.body.events.length)),
    )
    ok(
      "httpSink sends to the url with content type and extra headers",
      posts[0]?.url === "https://collector.example/e" &&
        posts[0]?.headers["content-type"] === "application/json" &&
        posts[0]?.headers.authorization === "Bearer t",
    )
    ok("httpSink empty write schedules nothing", sink.write([]) === 0 && deferred.length === 1)

    posts.length = 0
    status = 500
    sink.write([{ name: "lost" }])
    await Promise.all(deferred)
    ok(
      "httpSink reports a failed POST and does not throw",
      failures.length === 1 && failures[0]?.status === 500 && failures[0]?.count === 1,
    )
    status = 0
    sink.write([{ name: "lost" }])
    await Promise.all(deferred)
    ok("httpSink reports a network error", failures.length === 2 && "err" in (failures[1] ?? {}))

    status = 200
    posts.length = 0
    const manual = httpSink({ url: "https://collector.example/e", defer: () => {} })
    manual.write([{ name: "m" }])
    await manual.flush()
    ok("httpSink flush() sends the buffer now", posts.length === 1)
    await manual.flush()
    ok("httpSink flush() with nothing buffered sends nothing", posts.length === 1)
  } finally {
    globalThis.fetch = realFetch
  }
}

// --- sessions and identify ---
{
  const ids = { anonymousId: "anon-1", sessionId: "sess-1", userId: "spoofed" }
  const send = async (opts: Partial<Parameters<typeof registerIngest>[2]>) => {
    const mem = memorySink()
    const a = new Hono()
    registerIngest(a as never, "/e", { engine: mem, ...opts })
    await a.request("/e", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [
          { name: "x", ...ids },
          { name: "y", anonymousId: "bad id; drop" },
        ],
      }),
    })
    return mem.events
  }
  let ev = await send({})
  ok(
    "ingest keeps anonymous and session ids",
    ev[0].anonymousId === "anon-1" && ev[0].sessionId === "sess-1",
  )
  ok("ingest drops a client userId by default", ev[0].userId === undefined)
  ok("ingest drops malformed ids", ev[1].anonymousId === undefined)
  ev = await send({ userId: () => "real-user" })
  ok("userId resolver wins over the client", ev[0].userId === "real-user")
  ev = await send({ trustClientUserId: true })
  ok("trustClientUserId keeps it", ev[0].userId === "spoofed")

  const dp2 = toDataPoint({ name: "n", anonymousId: "a1", sessionId: "s1", props: { k: "v" } })
  ok(
    "engine keeps ids as blobs",
    dp2.blobs.join(",") === "n,aid,a1,sid,s1,k,v",
    dp2.blobs.join(","),
  )

  const h = new Headers({ "x-signet-anonymous-id": "anon-9", "x-signet-session-id": "<script>" })
  const ctx = analyticsContext(h)
  ok(
    "analyticsContext reads headers, drops junk",
    ctx.anonymousId === "anon-9" && ctx.sessionId === undefined,
  )
  const mem = memorySink()
  const t = serverTracker(mem, ctx)
  await t.track("before")
  await t.identify("u-1")
  await t.track("signup", { plan: "free" })
  ok(
    "serverTracker stamps ids and links after identify",
    mem.events[0].userId === undefined &&
      mem.events[1].name === "$identify" &&
      mem.events[1].anonymousId === "anon-9" &&
      mem.events[2].userId === "u-1",
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
