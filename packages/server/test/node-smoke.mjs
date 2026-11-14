// Runs under plain `node`, against the built dist and through the package's
// own exports map (a package may import itself by name). Bun runs every other
// suite; this one proves the published files load and work on Node too.
// Build first: `bun run build`, then `node test/node-smoke.mjs`.

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  kvRateLimitStore,
  memoryKv,
  memoryQueue,
  processDefer,
} from "@dapplelight/signet-server/adapters"
import { cloudflareQueue } from "@dapplelight/signet-server/adapters/cloudflare"
import { fsBlobStore } from "@dapplelight/signet-server/adapters/node"
import { upstashKv } from "@dapplelight/signet-server/adapters/upstash"
import { vercelDefer } from "@dapplelight/signet-server/adapters/vercel"
import { createAnalyticsEngine } from "@dapplelight/signet-server/analytics/engine"
import { httpSink, memorySink } from "@dapplelight/signet-server/analytics/sinks"
import { createTestJobs, defineJob, inProcessJobs } from "@dapplelight/signet-server/jobs"
import { z } from "zod"

let pass = 0
let fail = 0
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++
    console.log("  PASS", name)
  } else {
    fail++
    console.log("  FAIL", name, detail)
  }
}

console.log(`node ${process.version}`)

// --- adapters ---
{
  const kv = memoryKv()
  await kv.set("a", "1", { ttlSeconds: 60 })
  ok("memoryKv get/set", (await kv.get("a")) === "1")
  const limiter = kvRateLimitStore(memoryKv())
  const hits = []
  for (let i = 0; i < 3; i++) hits.push((await limiter.hit("s", "k", 2, 60)).ok)
  ok("kvRateLimitStore limits", hits.join() === "true,true,false", hits.join())

  const got = await new Promise((resolve) => memoryQueue(resolve).send({ n: 1 }))
  ok("memoryQueue delivers", got.n === 1)

  const errors = []
  processDefer((e) => errors.push(e))(Promise.reject(new Error("x")))
  const handed = []
  vercelDefer((p) => handed.push(p))(Promise.resolve(1))
  await new Promise((r) => setTimeout(r, 10))
  ok("processDefer catches", errors.length === 1)
  ok("vercelDefer hands work to waitUntil", handed.length === 1)

  const batches = []
  const q = cloudflareQueue({
    send: async () => {},
    sendBatch: async (messages) => batches.push([...messages].length),
  })
  await q.sendBatch(Array.from({ length: 150 }, (_, i) => i))
  ok("cloudflareQueue splits batches", batches.join() === "100,50", batches.join())

  const dir = mkdtempSync(join(tmpdir(), "signet-node-smoke-"))
  try {
    const blobs = fsBlobStore(dir)
    await blobs.put("a/b.txt", "hello")
    const blob = await blobs.get("a/b.txt")
    ok("fsBlobStore round trip", new TextDecoder().decode(blob?.body) === "hello")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- fetch adapters and sinks against a fake fetch ---
{
  const realFetch = globalThis.fetch
  const posts = []
  globalThis.fetch = async (url, init = {}) => {
    posts.push({ url: String(url), body: String(init.body) })
    return new Response(JSON.stringify({ result: "v" }), { status: 200 })
  }
  try {
    const kv = upstashKv({ url: "https://redis.example", token: "t" })
    ok("upstashKv over fetch", (await kv.get("k")) === "v" && posts[0]?.body === '["GET","k"]')

    posts.length = 0
    const sink = httpSink({ url: "https://collector.example/e", defer: () => {} })
    sink.write([{ name: "a" }, { name: "b" }])
    await sink.flush()
    ok("httpSink POSTs a batch", JSON.parse(posts[0]?.body ?? "{}").events?.length === 2)
  } finally {
    globalThis.fetch = realFetch
  }
  const mem = memorySink()
  mem.write([{ name: "x" }])
  ok("memorySink keeps events", mem.events.length === 1)
  ok(
    "createAnalyticsEngine without a dataset is a no-op",
    createAnalyticsEngine({}).write([]) === 0,
  )
}

// --- jobs ---
{
  const seen = []
  const greet = defineJob({
    name: "greet",
    input: z.object({ who: z.string() }),
    run: async ({ who }) => {
      seen.push(who)
    },
  })
  const jobs = createTestJobs({ jobs: [greet] })
  await greet.enqueue({ who: "node" })
  const results = await jobs.runAll()
  ok(
    "createTestJobs runs a job",
    seen.join() === "node" && results[0]?.status === "done",
    JSON.stringify(results),
  )

  inProcessJobs({ jobs: [greet] }, () => {})
  await greet.enqueue({ who: "bg" })
  await new Promise((r) => setTimeout(r, 50))
  ok("inProcessJobs runs in the background", seen.includes("bg"))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
