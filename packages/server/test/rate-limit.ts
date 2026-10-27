import { readdirSync, readFileSync } from "node:fs"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { ERROR_CODES } from "../../lib/src/api/codes"
import { ApiException, errorHandler, STATUS_CODES } from "../src/http/errors"
import { memoryStore, type RateLimitStore, rateLimit } from "../src/middleware/rate-limit"
import {
  durableObjectStore,
  RateLimitCounter,
  type RateLimitCounterState,
  type RateLimitNamespace,
} from "../src/middleware/rate-limit-do"
import { requestId } from "../src/middleware/request-id"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

// --- a Durable Object namespace, faithful where it matters ---
// One instance per name, and requests to an instance are delivered one at a
// time (the runtime's input gate). Storage is async, so without that
// serialisation this test WOULD over-admit — which is the point of checking.
function fakeState() {
  const data = new Map<string, unknown>()
  let alarm: number | null = null
  const state: RateLimitCounterState = {
    storage: {
      async get<T>(k: string) {
        await Promise.resolve()
        return data.get(k) as T | undefined
      },
      async put<T>(k: string, v: T) {
        await Promise.resolve()
        data.set(k, structuredClone(v))
      },
      async deleteAll() {
        data.clear()
      },
      async setAlarm(t: number) {
        alarm = t
      },
    },
  }
  return { state, data, alarm: () => alarm }
}

function fakeNamespace() {
  const instances = new Map<
    string,
    { counter: RateLimitCounter; queue: Promise<unknown>; st: ReturnType<typeof fakeState> }
  >()
  const ns: RateLimitNamespace = {
    idFromName: (name) => name,
    get: (id) => {
      const name = id as unknown as string
      let inst = instances.get(name)
      if (!inst) {
        const st = fakeState()
        inst = { counter: new RateLimitCounter(st.state), queue: Promise.resolve(), st }
        instances.set(name, inst)
      }
      const i = inst
      return {
        fetch: (input, init) => {
          const run = i.queue.then(() => i.counter.fetch(new Request(input, init)))
          i.queue = run.catch(() => {})
          return run
        },
      }
    },
  }
  return { ns, instances }
}

// --- exact under concurrency ---
{
  const { ns, instances } = fakeNamespace()
  const store = durableObjectStore(ns)
  const results = await Promise.all(
    Array.from({ length: 300 }, () => store.hit("api", "1.2.3.4", 100, 60)),
  )
  const allowed = results.filter((r) => r.ok).length
  ok("DO store admits exactly max of 300 concurrent hits", allowed === 100, String(allowed))
  ok(
    "DO store: remaining never negative",
    results.every((r) => r.remaining >= 0),
  )
  ok("DO store: one object per scope:key", instances.size === 1 && instances.has("api:1.2.3.4"))
  await store.hit("login", "1.2.3.4", 5, 60)
  ok("DO store: scopes do not share a counter", instances.size === 2)
  const st = instances.get("api:1.2.3.4")!.st
  ok("DO counter schedules cleanup at window end", (st.alarm() ?? 0) > Date.now())
  await instances.get("api:1.2.3.4")!.counter.alarm()
  ok("DO alarm deletes the window", st.data.size === 0)
}

// --- window resets ---
{
  const { ns } = fakeNamespace()
  const store = durableObjectStore(ns)
  const realNow = Date.now
  let t = 1_000_000
  Date.now = () => t
  try {
    await store.hit("api", "k", 1, 10)
    const blocked = await store.hit("api", "k", 1, 10)
    t += 10_000
    const after = await store.hit("api", "k", 1, 10)
    ok("DO counter blocks past max within window", blocked.ok === false)
    ok("DO counter resets after the window", after.ok === true && after.remaining === 0)
  } finally {
    Date.now = realNow
  }
}

// --- unreachable object throws, so rateLimit can decide ---
{
  const broken: RateLimitNamespace = {
    idFromName: (n) => n,
    get: () => ({ fetch: async () => new Response("overloaded", { status: 503 }) }),
  }
  let threw = false
  try {
    await durableObjectStore(broken).hit("api", "k", 1, 60)
  } catch {
    threw = true
  }
  ok("DO store throws on a non-2xx from the object", threw)
}

// --- store built per request from c.env (a binding is not available earlier) ---
{
  const { ns } = fakeNamespace()
  const app = new Hono<{ Bindings: { RATE_LIMIT: RateLimitNamespace } }>()
    .use("*", rateLimit({ store: (c) => durableObjectStore(c.env.RATE_LIMIT), max: 2 }))
    .get("/", (c) => c.text("ok"))
  const env = { RATE_LIMIT: ns }
  const codes = [
    await app.request("/", {}, env),
    await app.request("/", {}, env),
    await app.request("/", {}, env),
  ].map((r) => r.status)
  ok("store factory reads the binding from c.env", codes.join() === "200,200,429", codes.join())
}

// --- fail open / closed ---
const throwing: RateLimitStore = {
  hit: async () => {
    throw new Error("DO down")
  },
}
{
  let runs = 0
  const reported: unknown[] = []
  const app = new Hono()
    .use("*", rateLimit({ store: throwing, onStoreError: (e) => reported.push(e) }))
    .get("/", (c) => {
      runs++
      return c.text("ok")
    })
  const res = await app.request("/")
  ok("store failure fails open by default", res.status === 200)
  ok("fail-open runs the handler exactly once", runs === 1, String(runs))
  ok("store failure is reported", reported.length === 1)
}
{
  let runs = 0
  const app = new Hono()
    .use("*", requestId())
    .use("*", rateLimit({ store: throwing, failOpen: false }))
    .get("/", (c) => {
      runs++
      return c.text("ok")
    })
  const res = await app.request("/")
  const body = (await res.json()) as { code?: string; requestId?: string }
  ok("failOpen:false answers 503", res.status === 503)
  ok("failOpen:false does not run the handler", runs === 0)
  ok("503 has a code and requestId", body.code === "RATE_LIMIT_UNAVAILABLE" && !!body.requestId)
}
{
  // A handler error must not be mistaken for a store failure and retried.
  let runs = 0
  const reported: unknown[] = []
  const app = new Hono()
    .use("*", rateLimit({ store: memoryStore(), onStoreError: (e) => reported.push(e) }))
    .get("/", () => {
      runs++
      throw new Error("handler broke")
    })
    .onError(errorHandler({ isProduction: () => true }))
  const res = await app.request("/")
  ok("handler error is a 500, not a store failure", res.status === 500 && reported.length === 0)
  ok("handler error does not run the handler twice", runs === 1, String(runs))
}

// --- envelope: a code on every built-in error, requestId when available ---
{
  const app = new Hono()
    .use("*", requestId())
    .use("*", rateLimit({ store: memoryStore(), max: 1 }))
    .get("/", (c) => c.text("ok"))
  await app.request("/")
  const res = await app.request("/", { headers: { "x-request-id": "trace-me" } })
  const body = (await res.json()) as { success: boolean; code?: string; requestId?: string }
  ok("429 has code RATE_LIMITED", res.status === 429 && body.code === "RATE_LIMITED")
  ok("429 carries the request id", body.requestId === "trace-me", String(body.requestId))
}
{
  const app = new Hono()
    .use("*", requestId())
    .get("/boom", () => {
      throw new Error("secret internals")
    })
    .get("/nope", () => {
      throw new ApiException(403, "Not allowed", "FORBIDDEN")
    })
    .onError(errorHandler({ isProduction: () => true }))
  const boom = (await (
    await app.request("/boom", { headers: { "x-request-id": "r1" } })
  ).json()) as Record<string, unknown>
  ok("500 has code INTERNAL_ERROR", boom.code === "INTERNAL_ERROR")
  ok("500 carries the request id", boom.requestId === "r1")
  ok("500 still hides internals in production", boom.error === "Internal server error")
  const nope = (await (
    await app.request("/nope", { headers: { "x-request-id": "r2" } })
  ).json()) as Record<string, unknown>
  ok("ApiException carries the request id", nope.requestId === "r2" && nope.code === "FORBIDDEN")
  const bare = new Hono()
    .get("/", () => {
      throw new Error("x")
    })
    .onError(errorHandler({ isProduction: () => true }))
  const noId = (await (await bare.request("/")).json()) as Record<string, unknown>
  ok("no requestId key without the requestId middleware", !("requestId" in noId))
}

// --- a bare HTTPException still gets a code ---
{
  const app = new Hono()
    .get("/401", () => {
      throw new HTTPException(401, { message: "Unauthorized" })
    })
    .get("/418", () => {
      throw new HTTPException(418 as never, { message: "teapot" })
    })
    .onError(errorHandler({ isProduction: () => true }))
  const u = (await (await app.request("/401")).json()) as Record<string, unknown>
  const t = (await (await app.request("/418")).json()) as Record<string, unknown>
  ok("bare 401 gets code UNAUTHORIZED", u.code === "UNAUTHORIZED")
  ok("unmapped status gets code HTTP_ERROR", t.code === "HTTP_ERROR")
}

// --- a dependency being down is a deliberate 5xx, not our own 500 ---
{
  let reported = 0
  const app = new Hono()
    .get("/", () => {
      throw new ApiException(503, "Store unreachable", "STORE_UNAVAILABLE")
    })
    .onError(
      errorHandler({
        isProduction: () => true,
        onError: () => {
          reported++
        },
        getRequestId: () => "req_custom",
      }),
    )
  const res = await app.request("/")
  const body = (await res.json()) as Record<string, unknown>
  ok(
    "ApiException can raise 503 with a code",
    res.status === 503 && body.code === "STORE_UNAVAILABLE" && body.error === "Store unreachable",
  )
  ok("errorHandler uses a custom getRequestId", body.requestId === "req_custom")
  ok("a deliberate 503 is not reported as a crash", reported === 0)
}

// --- rateLimit: custom request id; typed app variables reach callbacks ---
{
  type AppEnv = { Variables: { requestId: string; log: string[] } }
  const store: RateLimitStore = {
    hit: async () => {
      throw new Error("down")
    },
  }
  const app = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("requestId", "req_abc")
      c.set("log", [])
      await next()
    })
    .use(
      "*",
      rateLimit<AppEnv>({
        store,
        failOpen: false,
        getRequestId: (c) => c.get("requestId"),
        // Typed: c.get("log") is string[] here with no cast.
        onStoreError: (_e, c) => {
          c.get("log").push("store down")
        },
      }),
    )
    .get("/", (c) => c.text("ok"))
  const body = (await (await app.request("/")).json()) as Record<string, unknown>
  ok("rateLimit uses a custom getRequestId", body.requestId === "req_abc")
}

// --- request id: a caller-controlled header is only reused when it is safe ---
{
  const app = new Hono()
    .use("*", requestId())
    .get("/", (c) => c.text(String(c.get("reqId" as never))))
  const keep = await app.request("/", { headers: { "x-request-id": "req_abc-123" } })
  ok("a safe incoming id is reused", (await keep.text()) === "req_abc-123")
  const evil = "a@b.com; DROP TABLE users"
  const bad = await app.request("/", { headers: { "x-request-id": evil } })
  const got = await bad.text()
  ok("an unsafe incoming id is replaced", got !== evil && /^[0-9a-f-]{36}$/.test(got))
  const long = await app.request("/", { headers: { "x-request-id": "a".repeat(129) } })
  ok("an over-long incoming id is replaced", (await long.text()).length === 36)
  const custom = new Hono()
    .use("*", requestId({ accept: () => true }))
    .get("/", (c) => c.text(String(c.get("reqId" as never))))
  ok(
    "accept overrides the filter",
    (await (await custom.request("/", { headers: { "x-request-id": evil } })).text()) === evil,
  )
}

// --- ERROR_CODES (lib) lists every code the server emits ---
// Scans the source rather than a hand-kept list, so a new code added to a
// module without updating lib fails here, not in an app's copy map.
{
  const known = new Set<string>(ERROR_CODES)
  const emitted = new Set<string>(Object.values(STATUS_CODES))
  emitted.add("HTTP_ERROR")
  const patterns = [
    /code: "([A-Za-z_]+)"/g,
    /ApiException\(\d+, "[^"]*", "([A-Za-z_]+)"/g,
    /envelope\(c, "[^"]*", "([A-Za-z_]+)"/g,
    /readonly code: ((?:"[a-z_]+"(?: \| )?)+)/g,
  ]
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(`${dir}/${e.name}`)
        : e.name.endsWith(".ts")
          ? [`${dir}/${e.name}`]
          : [],
    )
  for (const file of walk(new URL("../src", import.meta.url).pathname)) {
    const src = readFileSync(file, "utf8")
    for (const re of patterns)
      for (const m of src.matchAll(re))
        for (const c of m[1]!.matchAll(/[A-Za-z_]+/g)) emitted.add(c[0])
  }
  const missing = [...emitted].filter((c) => !known.has(c))
  ok(
    "scan found the codes it should (not vacuous)",
    [
      "VALIDATION_FAILED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
      "INVALID_PAYLOAD",
      "invalid_token",
      "insufficient_scope",
    ].every((c) => emitted.has(c)),
    [...emitted].join(),
  )
  ok("every emitted code is in ERROR_CODES", missing.length === 0, missing.join())
  const unused = ERROR_CODES.filter((c) => !emitted.has(c))
  ok("ERROR_CODES has nothing the server never emits", unused.length === 0, unused.join())
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
