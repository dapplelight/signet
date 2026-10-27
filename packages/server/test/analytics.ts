import { Hono } from "hono"
import {
  type AnalyticsEngineDataset,
  createAnalyticsEngine,
  LIMITS,
  toDataPoint,
  truncateBytes,
} from "../src/analytics/engine"
import { registerIngest } from "../src/analytics/ingest"

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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
