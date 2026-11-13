import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cloudflareKv, type KvNamespaceLike, r2BlobStore } from "../src/adapters/cloudflare"
import {
  type KeyValue,
  kvRateLimitStore,
  memoryKv,
  memoryQueue,
  processDefer,
  type Queue,
  waitUntilDefer,
} from "../src/adapters/index"
import { fsBlobStore } from "../src/adapters/node"
import { supabaseBlobStore } from "../src/adapters/supabase"
import { qstashQueue, upstashKv } from "../src/adapters/upstash"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const throws = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
    return false
  } catch {
    return true
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const text = (b: ArrayBuffer) => new TextDecoder().decode(b)

// --- fetch stub: records each call, answers from a queue ---
type Call = { url: string; method: string; headers: Record<string, string>; body: string }
let calls: Call[] = []
let replies: Response[] = []
globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
  calls.push({
    url: String(url),
    method: init.method ?? "GET",
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    body: typeof init.body === "string" ? init.body : init.body ? "<binary>" : "",
  })
  return replies.shift() ?? new Response("{}", { status: 200 })
}) as typeof fetch
const reset = (...r: Response[]) => {
  calls = []
  replies = r
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })

// --- memoryKv ---
{
  const kv = memoryKv()
  await kv.set("a", "1")
  ok("memoryKv get/set", (await kv.get("a")) === "1")
  await kv.delete("a")
  ok("memoryKv delete", (await kv.get("a")) === null)
  await kv.set("t", "x", { ttlSeconds: 0.05 })
  ok("memoryKv incr starts at 1", (await kv.incr?.("n", 60)) === 1)
  ok("memoryKv incr counts", (await kv.incr?.("n", 60)) === 2)
  await sleep(80)
  ok("memoryKv ttl expires", (await kv.get("t")) === null)
}

// --- memoryQueue, processDefer, waitUntilDefer ---
{
  const got: number[] = []
  const errors: unknown[] = []
  const q = memoryQueue<number>(
    (n) => {
      if (n < 0) throw new Error("bad")
      got.push(n)
    },
    (e) => errors.push(e),
  )
  await q.send(1, { delaySeconds: 0.05 })
  await q.send(-1)
  ok("memoryQueue send returns before the handler runs", got.length === 0)
  await sleep(100)
  ok("memoryQueue runs handler after delay", got[0] === 1)
  ok("memoryQueue handler error goes to onError, not the sender", errors.length === 1)

  const deferErrors: unknown[] = []
  processDefer((e) => deferErrors.push(e))(Promise.reject(new Error("x")))
  await sleep(1)
  ok("processDefer catches rejections", deferErrors.length === 1)

  const waited: Promise<unknown>[] = []
  const p = Promise.resolve()
  waitUntilDefer({ waitUntil: (x) => waited.push(x) })(p)
  ok("waitUntilDefer hands the promise to ctx.waitUntil", waited[0] === p)
}

// --- kvRateLimitStore, with and without incr ---
{
  const atomic = kvRateLimitStore(memoryKv())
  const r = [] as boolean[]
  for (let i = 0; i < 4; i++) r.push((await atomic.hit("login", "ip", 3, 60)).ok)
  ok("kvRateLimitStore (incr) allows max then limits", r.join() === "true,true,true,false")
  const other = await atomic.hit("api", "ip", 3, 60)
  ok("scopes do not share a counter", other.ok && other.remaining === 2)
  ok("resetSeconds within the window", other.resetSeconds > 0 && other.resetSeconds <= 60)

  // incr answers 99 and get/set are dead: only the incr path can produce this
  const incrOnly: KeyValue = {
    get: async () => {
      throw new Error("get")
    },
    set: async () => {
      throw new Error("set")
    },
    delete: async () => {},
    incr: async () => 99,
  }
  const viaIncr = await kvRateLimitStore(incrOnly).hit("s", "k", 1, 60)
  ok("uses incr when present", !viaIncr.ok && viaIncr.remaining === 0)
  const fresh = memoryKv()
  const plain: KeyValue = { get: fresh.get, set: fresh.set, delete: fresh.delete }
  const rmw = kvRateLimitStore(plain)
  const s = [] as boolean[]
  for (let i = 0; i < 3; i++) s.push((await rmw.hit("s", "k", 2, 60)).ok)
  ok("kvRateLimitStore (read-modify-write) allows max then limits", s.join() === "true,true,false")
}

// --- fsBlobStore ---
{
  const dir = mkdtempSync(join(tmpdir(), "signet-blob-"))
  try {
    const fs = fsBlobStore(dir)
    await fs.put("a/b.txt", "hello")
    const got = await fs.get("a/b.txt")
    ok("fsBlobStore round trip", !!got && text(got.body) === "hello")
    await fs.put("bin", new Uint8Array([1, 2, 3]))
    ok(
      "fsBlobStore bytes",
      new Uint8Array((await fs.get("bin"))?.body ?? new ArrayBuffer(0)).join() === "1,2,3",
    )
    await fs.delete("a/b.txt")
    ok("fsBlobStore delete -> null", (await fs.get("a/b.txt")) === null)
    ok("fsBlobStore delete of missing is fine", !(await throws(() => fs.delete("nope"))))
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "a\\..\\x", "", "a//b"]) {
      ok(`fsBlobStore rejects ${JSON.stringify(bad)}`, await throws(() => fs.get(bad)))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- cloudflare ---
{
  const puts: unknown[][] = []
  const ns: KvNamespaceLike = {
    get: async () => "v",
    put: async (...a) => {
      puts.push(a)
    },
    delete: async () => {},
  }
  const kv = cloudflareKv(ns)
  await kv.set("k", "v", { ttlSeconds: 10 })
  await kv.set("k", "v")
  ok(
    "cloudflareKv raises TTL to KV's 60s minimum",
    JSON.stringify(puts[0]) === '["k","v",{"expirationTtl":60}]',
  )
  ok("cloudflareKv no TTL -> no options", puts[1]?.[2] === undefined)
  ok("cloudflareKv has no incr (not atomic)", kv.incr === undefined)

  const stored = new Map<string, { body: unknown; ct?: string }>()
  const r2 = r2BlobStore({
    put: async (k, v, o) => void stored.set(k, { body: v, ct: o?.httpMetadata?.contentType }),
    get: async (k) => {
      const s = stored.get(k)
      return s
        ? {
            arrayBuffer: async () => new TextEncoder().encode(String(s.body)).buffer as ArrayBuffer,
            httpMetadata: { contentType: s.ct },
          }
        : null
    },
    delete: async (k) => void stored.delete(k),
  })
  await r2.put("x", "hi", { contentType: "text/plain" })
  const got = await r2.get("x")
  ok(
    "r2BlobStore round trip with contentType",
    !!got && text(got.body) === "hi" && got.contentType === "text/plain",
  )
  ok("r2BlobStore missing -> null", (await r2.get("y")) === null)

  // A Queues binding is already a Queue<T>: this line is the test.
  const binding = {
    send: async (_b: { id: number }, _o?: { delaySeconds?: number; contentType?: string }) => {},
  }
  const q: Queue<{ id: number }> = binding
  ok("Cloudflare Queue binding fits Queue<T>", typeof q.send === "function")
}

// --- upstash ---
{
  const kv = upstashKv({ url: "https://r.upstash.io/", token: "tok" })
  reset(json({ result: "v" }))
  ok("upstash get returns result", (await kv.get("k")) === "v")
  ok(
    "upstash get: POST base URL, bearer, command array",
    calls[0]?.url === "https://r.upstash.io" &&
      calls[0].method === "POST" &&
      calls[0].headers.authorization === "Bearer tok" &&
      calls[0].body === '["GET","k"]',
    JSON.stringify(calls[0]),
  )
  reset(json({ result: null }))
  ok("upstash get missing -> null", (await kv.get("k")) === null)
  reset(json({ result: "OK" }))
  await kv.set("k", "v", { ttlSeconds: 30 })
  ok("upstash set with EX", calls[0]?.body === '["SET","k","v","EX","30"]')
  reset(json({ result: 1 }))
  await kv.delete("k")
  ok("upstash delete is DEL", calls[0]?.body === '["DEL","k"]')
  reset(json([{ result: "OK" }, { result: 3 }]))
  ok("upstash incr returns INCR result", (await kv.incr?.("k", 60)) === 3)
  ok(
    "upstash incr: one MULTI/EXEC of SET NX EX + INCR",
    calls[0]?.url === "https://r.upstash.io/multi-exec" &&
      calls[0].body === '[["SET","k","0","EX","60","NX"],["INCR","k"]]',
    JSON.stringify(calls[0]),
  )
  reset(json({ error: "ERR wrong" }, 400))
  ok("upstash error reply throws", await throws(() => kv.get("k")))

  const q = qstashQueue<{ id: number }>({ token: "qt", destinationUrl: "https://app.example/jobs" })
  reset(json({ messageId: "m" }))
  await q.send({ id: 1 }, { delaySeconds: 90 })
  ok(
    "qstash publish URL, auth, JSON body, Upstash-Delay",
    calls[0]?.url === "https://qstash.upstash.io/v2/publish/https://app.example/jobs" &&
      calls[0].headers.authorization === "Bearer qt" &&
      calls[0].headers["content-type"] === "application/json" &&
      calls[0].headers["upstash-delay"] === "90s" &&
      calls[0].body === '{"id":1}',
    JSON.stringify(calls[0]),
  )
  reset(json({}))
  await qstashQueue({
    token: "qt",
    destinationUrl: "https://d",
    baseUrl: "https://qstash-us-east-1.upstash.io/",
  }).send(1)
  ok(
    "qstash baseUrl, no delay header without delay",
    calls[0]?.url === "https://qstash-us-east-1.upstash.io/v2/publish/https://d" &&
      !calls[0].headers["upstash-delay"],
  )
  reset(json({ error: "unauthorized" }, 401))
  ok("qstash non-2xx throws", await throws(() => q.send({ id: 2 })))
}

// --- supabase ---
{
  const sb = supabaseBlobStore({
    url: "https://p.supabase.co",
    serviceRoleKey: "srk",
    bucket: "files",
  })
  const base = "https://p.supabase.co/storage/v1"
  reset(json({ Key: "files/a b.txt" }))
  await sb.put("dir/a b.txt", "hi", { contentType: "text/plain" })
  ok(
    "supabase upload: POST object path, auth + apikey, upsert, content type",
    calls[0]?.url === `${base}/object/files/dir/a%20b.txt` &&
      calls[0].method === "POST" &&
      calls[0].headers.authorization === "Bearer srk" &&
      calls[0].headers.apikey === "srk" &&
      calls[0].headers["x-upsert"] === "true" &&
      calls[0].headers["content-type"] === "text/plain" &&
      calls[0].body === "hi",
    JSON.stringify(calls[0]),
  )
  reset(new Response("hi", { headers: { "content-type": "text/plain" } }))
  const got = await sb.get("dir/x")
  ok(
    "supabase download: GET object path",
    calls[0]?.url === `${base}/object/files/dir/x` && calls[0].method === "GET",
  )
  ok(
    "supabase download body + type",
    !!got && text(got.body) === "hi" && got.contentType === "text/plain",
  )
  reset(json({ statusCode: "404", error: "not_found" }, 400))
  ok("supabase missing (400 + statusCode 404) -> null", (await sb.get("x")) === null)
  reset(json({ error: "nope" }, 404))
  ok("supabase missing (404) -> null", (await sb.get("x")) === null)
  reset(json([]))
  await sb.delete("dir/x")
  ok(
    "supabase delete: DELETE bucket with prefixes",
    calls[0]?.url === `${base}/object/files` &&
      calls[0].method === "DELETE" &&
      calls[0].body === '{"prefixes":["dir/x"]}',
  )
  reset(json({ signedURL: "/object/sign/files/dir/x?token=t" }))
  const getUrl = await sb.signedUrl?.("dir/x", { expiresInSeconds: 300 })
  ok(
    "supabase signed GET: POST /object/sign with expiresIn",
    calls[0]?.url === `${base}/object/sign/files/dir/x` &&
      calls[0].body === '{"expiresIn":300}' &&
      getUrl === `${base}/object/sign/files/dir/x?token=t`,
    JSON.stringify(calls[0]),
  )
  reset(json({ url: "/object/upload/sign/files/dir/x?token=u" }))
  const putUrl = await sb.signedUrl?.("dir/x", { expiresInSeconds: 300, method: "PUT" })
  ok(
    "supabase signed PUT: POST /object/upload/sign",
    calls[0]?.url === `${base}/object/upload/sign/files/dir/x` &&
      putUrl === `${base}/object/upload/sign/files/dir/x?token=u`,
  )
  reset()
  ok(
    "supabase rejects traversal keys before fetching",
    (await throws(() => sb.get("../other/x"))) && calls.length === 0,
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
