import { ApiError } from "@dapplelight/signet-lib/api"
import { z } from "zod"
import { costOf, createBudgetLedger, kvBudgetStore, memoryBudgetStore } from "../src/budget"
import { BudgetCounter, durableObjectBudgetStore } from "../src/budget-do"
import { cacheKey, fingerprintSchema, kvCache, memoryCache } from "../src/cache"
import {
  AiError,
  ALL_PROVIDERS_FAILED,
  BUDGET_EXCEEDED,
  BUDGET_STORE_FAILED,
  isTransient,
  NO_PROVIDERS,
  SCHEMA_INVALID,
  UNPRICED_PROVIDER,
} from "../src/errors"
import { createExtractor } from "../src/extract"
import { fakeProvider } from "../src/fake"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const schema = z.object({ budget: z.number(), category: z.string() })
const good = { budget: 8000, category: "snowboard" }
const base = {
  schema,
  input: "8000 se kam ka snowboard",
  instructions: "Pull budget and category.",
}

// --- happy path ---
let r = await createExtractor({ providers: [fakeProvider(good)] }).extract(base)
ok("returns the typed value", r.value.budget === 8000 && r.value.category === "snowboard")
ok("meta names the provider", r.meta.provider === "fake" && r.meta.model === "fake-1")
ok("meta counts attempts", r.meta.attempts === 1)
ok("meta reports no cache hit", r.meta.cacheHit === false)

// --- schema validation is enforced even if the provider claims success ---
let caught: unknown
try {
  await createExtractor({ providers: [fakeProvider({ budget: "not a number" })] }).extract(base)
} catch (e) {
  caught = e
}
ok(
  "rejects output that fails the schema",
  caught instanceof AiError && (caught as AiError).code === ALL_PROVIDERS_FAILED,
)

// a schema failure must NOT be retried — it fails identically every time
let calls = 0
const alwaysBad = {
  name: "bad",
  model: "m",
  async generate() {
    calls++
    return { value: { budget: "x" } }
  },
}
try {
  await createExtractor({ providers: [alwaysBad as never], maxRetriesPerProvider: 3 }).extract(base)
} catch {}
ok("schema failure is NOT retried", calls === 1, `called ${calls}x`)

// --- retry only transient ---
calls = 0
r = await createExtractor({
  providers: [fakeProvider(good, { failTimes: 1 })],
  maxRetriesPerProvider: 2,
}).extract(base)
ok("retries a transient failure", r.value.budget === 8000 && r.meta.attempts === 2)

let attempts = 0
const counting = {
  name: "c",
  model: "m",
  async generate(): Promise<never> {
    attempts++
    throw Object.assign(new Error("unauthorized"), { status: 401 })
  },
}
try {
  await createExtractor({ providers: [counting as never], maxRetriesPerProvider: 3 }).extract(base)
} catch {}
ok("401 is NOT retried", attempts === 1, `attempts=${attempts}`)

ok("isTransient: 429 yes", isTransient({ status: 429 }))
ok("isTransient: 503 yes", isTransient({ status: 503 }))
ok("isTransient: 401 no", !isTransient({ status: 401 }))
ok(
  "isTransient: Workers AI 3036 yes",
  isTransient(new Error("Error 3036: free allocation exhausted")),
)
ok("isTransient: AbortError yes", isTransient({ name: "AbortError" }))
ok("isTransient: unknown shape treated as permanent", !isTransient(new Error("who knows")))

// --- failover ---
const failing = fakeProvider(good, { name: "first", failTimes: 99 })
r = await createExtractor({
  providers: [failing, fakeProvider(good, { name: "second" })],
  maxRetriesPerProvider: 0,
}).extract(base)
ok("fails over to the next provider", r.meta.provider === "second")
ok("attempts counts across providers", r.meta.attempts === 2)

try {
  await createExtractor({ providers: [] }).extract(base)
} catch (e) {
  caught = e
}
ok("no providers is a clear error", (caught as AiError).code === NO_PROVIDERS)

// --- fallback value ---
r = await createExtractor({
  providers: [fakeProvider(good, { failTimes: 99 })],
  maxRetriesPerProvider: 0,
}).extract({ ...base, fallback: { value: { budget: 0, category: "unknown" } } })
ok("fallback value returned when all fail", r.value.category === "unknown")
ok("fallback meta marked", r.meta.provider === "fallback" && r.meta.costUsd === 0)

// --- budget ---
ok(
  "costOf computes from usage",
  costOf(
    { inputTokens: 1_000_000, outputTokens: 0 },
    { inputPerMTokens: 2, outputPerMTokens: 6 },
  ) === 2,
)
ok("costOf without pricing is free", costOf({ inputTokens: 999, outputTokens: 9 }, undefined) === 0)

const pricey = {
  ...fakeProvider(good, { usage: { inputTokens: 1_000_000, outputTokens: 0 } }),
  pricing: { inputPerMTokens: 10, outputPerMTokens: 10 },
}
try {
  await createExtractor({ providers: [pricey] }).extract({ ...base, budget: { maxCostUsd: 0.002 } })
  caught = null
} catch (e) {
  caught = e
}
ok("per-call cap enforced", (caught as AiError)?.code === BUDGET_EXCEEDED)
ok("budget error is a 429", (caught as AiError)?.status === 429)

// a fallback must NOT mask a budget refusal — that hides a config problem
try {
  await createExtractor({ providers: [pricey] }).extract({
    ...base,
    budget: { maxCostUsd: 0.002 },
    fallback: { value: good },
  })
  caught = null
} catch (e) {
  caught = e
}
ok("fallback does NOT swallow a budget refusal", (caught as AiError)?.code === BUDGET_EXCEEDED)

ok(
  "costOf adds a flat per-call price, even with no usage",
  costOf(undefined, { perCallUsd: 0.01 }) === 0.01 &&
    costOf({ inputTokens: 1_000_000, outputTokens: 0 }, { inputPerMTokens: 2, perCallUsd: 1 }) ===
      3,
)

const ledger = createBudgetLedger(1.0, 3600)
await ledger.record(0.6)
ok("ledger tracks spend", Math.abs((await ledger.spentUsd()) - 0.6) < 1e-9)
ok("ledger reports remaining", Math.abs((await ledger.remainingUsd()) - 0.4) < 1e-9)
ok("ledger allows within window", await ledger.canSpend(0.3))
ok("ledger refuses beyond window", !(await ledger.canSpend(0.5)))
await ledger.record(0.5)
try {
  await createExtractor({ providers: [fakeProvider(good)], ledger }).extract({
    ...base,
    budget: { maxCostUsd: 0.01 },
  })
  caught = null
} catch (e) {
  caught = e
}
ok("window exhaustion fails CLOSED", (caught as AiError)?.code === BUDGET_EXCEEDED)
try {
  await createExtractor({ providers: [fakeProvider(good)], ledger }).extract(base)
  caught = null
} catch (e) {
  caught = e
}
ok(
  "ledger refuses even when the call passes no budget",
  (caught as AiError)?.code === BUDGET_EXCEEDED,
)
const old = createBudgetLedger(1.0, 60)
await old.record(0.9, Date.now() - 120_000)
ok("ledger prunes outside the window", (await old.spentUsd()) === 0)

// two isolates (two extractors) sharing one store hit the cap together
const shared = memoryBudgetStore()
const dollar = {
  ...fakeProvider(good, { usage: { inputTokens: 1_000_000, outputTokens: 0 } }),
  pricing: { inputPerMTokens: 0.6 },
}
const a = createExtractor({
  providers: [dollar],
  ledger: createBudgetLedger(1, 3600, { store: shared }),
})
const b = createExtractor({
  providers: [dollar],
  ledger: createBudgetLedger(1, 3600, { store: shared }),
})
await a.extract(base)
try {
  await b.extract({ ...base, cache: false })
  await b.extract({ ...base, cache: false })
  caught = null
} catch (e) {
  caught = e
}
ok("a shared store caps across extractors", (caught as AiError)?.code === BUDGET_EXCEEDED)

// per-key cap: one user runs out, another still has room
const perUser = createBudgetLedger(10, 3600, { perKeyUsd: 1 })
await perUser.record(0.9, Date.now(), "u1")
ok("per-key cap refuses the spent key", !(await perUser.canSpend(0.2, Date.now(), "u1")))
ok("per-key cap leaves other keys alone", await perUser.canSpend(0.2, Date.now(), "u2"))
ok("per-key spend also counts globally", Math.abs((await perUser.spentUsd()) - 0.9) < 1e-9)

// an unpriced provider with a ledger would count as $0 forever
try {
  createExtractor({
    providers: [{ ...fakeProvider(good), pricing: undefined }],
    ledger: createBudgetLedger(1),
  })
  caught = null
} catch (e) {
  caught = e
}
ok("unpriced provider with a ledger throws", (caught as AiError)?.code === UNPRICED_PROVIDER)
let built = true
try {
  createExtractor({
    providers: [{ ...fakeProvider(good), pricing: undefined }],
    ledger: createBudgetLedger(1),
    allowUnpriced: true,
  })
} catch {
  built = false
}
ok("allowUnpriced opts out", built)

// KV store: shared through the namespace, fixed window
const kvData = new Map<string, string>()
const kv = {
  get: async (k: string) => kvData.get(k) ?? null,
  put: async (k: string, v: string) => void kvData.set(k, v),
}
const k1 = createBudgetLedger(1, 3600, { store: kvBudgetStore(kv) })
const k2 = createBudgetLedger(1, 3600, { store: kvBudgetStore(kv) })
await k1.record(0.7)
ok("kv store shares spend across ledgers", !(await k2.canSpend(0.5)))

// The same store over a KeyValue (set + ttlSeconds), e.g. upstashKv
const kvSets: Array<[string, string, number | undefined]> = []
const keyValue = {
  get: async (k: string) => kvData.get(k) ?? null,
  set: async (k: string, v: string, o?: { ttlSeconds?: number }) => {
    kvSets.push([k, v, o?.ttlSeconds])
    kvData.set(k, v)
  },
}
await createBudgetLedger(1, 3600, { store: kvBudgetStore(keyValue) }).record(0.2)
ok(
  "kv store accepts a KeyValue (set with ttlSeconds)",
  Math.abs(Number(kvSets[0]?.[1]) - 0.9) < 1e-9 && kvSets[0]?.[2] === 7200,
)

// Durable Object store: one counter per key, reached through a fake namespace
const objects = new Map<string, BudgetCounter>()
const storage = () => {
  const m = new Map<string, unknown>()
  return {
    get: async <T>(k: string) => m.get(k) as T | undefined,
    put: async <T>(k: string, v: T) => void m.set(k, v),
    deleteAll: async () => m.clear(),
    setAlarm: async () => {},
  }
}
const ns = {
  idFromName: (name: string) => name,
  get: (id: never) => {
    const name = id as unknown as string
    if (!objects.has(name)) objects.set(name, new BudgetCounter({ storage: storage() }))
    const obj = objects.get(name) as BudgetCounter
    return { fetch: (url: string, init?: RequestInit) => obj.fetch(new Request(url, init)) }
  },
}
const d1 = createBudgetLedger(1, 3600, { store: durableObjectBudgetStore(ns), perKeyUsd: 0.5 })
const d2 = createBudgetLedger(1, 3600, { store: durableObjectBudgetStore(ns), perKeyUsd: 0.5 })
await d1.record(0.4, Date.now(), "u1")
ok("durable object store shares spend", Math.abs((await d2.spentUsd()) - 0.4) < 1e-9)
ok("durable object store keeps a counter per key", !(await d2.canSpend(0.2, Date.now(), "u1")))
await d1.record(0.5, Date.now() - 7_200_000)
ok("durable object store prunes outside the window", Math.abs((await d2.spentUsd()) - 0.4) < 1e-9)
const busy = createBudgetLedger(1000, 86_400, { store: durableObjectBudgetStore(ns) })
const t0 = Date.now()
for (let i = 0; i < 500; i++) await busy.record(0.001, t0 + i * 1000)
const stored =
  (await (
    objects.get("global") as unknown as {
      state: { storage: { get: (k: string) => Promise<object> } }
    }
  ).state.storage.get("buckets")) ?? {}
ok(
  "durable object storage stays bounded by the window",
  Object.keys(stored).length <= 61,
  `${Object.keys(stored).length} buckets`,
)

// a store that fails on record must not fail over, pay again, or use the fallback
let paid = 0
const payOnce = {
  name: "p",
  model: "m",
  pricing: { inputPerMTokens: 1 },
  async generate() {
    paid++
    return { value: good, usage: { inputTokens: 1000, outputTokens: 0 } }
  },
}
const brokenStore = {
  spent: () => 0,
  record: () => {
    throw new Error("store down")
  },
}
try {
  await createExtractor({
    providers: [payOnce as never, payOnce as never],
    ledger: createBudgetLedger(1, 3600, { store: brokenStore }),
  }).extract({ ...base, fallback: { value: good } })
  caught = null
} catch (e) {
  caught = e
}
ok("store failure fails closed", (caught as AiError)?.code === BUDGET_STORE_FAILED)
ok("store failure does not pay a second provider", paid === 1, `paid=${paid}`)

// --- cache ---
const cache = memoryCache()
let generated = 0
const counted = {
  name: "c",
  model: "m",
  pricing: { inputPerMTokens: 0, outputPerMTokens: 0 },
  async generate() {
    generated++
    return { value: good }
  },
}
const cx = createExtractor({ providers: [counted as never], cache })
await cx.extract(base)
const second = await cx.extract(base)
ok("identical input does not pay twice", generated === 1, `generated=${generated}`)
ok("cache hit flagged in meta", second.meta.cacheHit === true)
await cx.extract({ ...base, input: "different question" })
ok("different input misses the cache", generated === 2)
await cx.extract({ ...base, cache: false })
ok("cache can be bypassed per call", generated === 3)

// the schema is part of the key: same prompt, changed schema is a new question
const other = z.object({ budget: z.number(), category: z.string(), size: z.string() })
ok("schema fingerprint changes with shape", fingerprintSchema(schema) !== fingerprintSchema(other))
ok(
  "schema fingerprint is stable",
  fingerprintSchema(schema) ===
    fingerprintSchema(z.object({ budget: z.number(), category: z.string() })),
)
ok(
  "cache key differs by schema",
  (await cacheKey(fingerprintSchema(schema), "i", "x")) !==
    (await cacheKey(fingerprintSchema(other), "i", "x")),
)

// --- errors flow through the kit's envelope ---
ok("AiError IS an ApiError", new AiError("x", "CODE") instanceof ApiError)
ok("AiError carries its code", new AiError("x", SCHEMA_INVALID).code === SCHEMA_INVALID)

// --- packaging: the barrel must stay dependency-free ---
// aiSdkProvider is deliberately NOT re-exported here. ESM `export *` resolves
// eagerly, so barrelling it would make `ai` a hard requirement for everyone who
// imports createExtractor — including consumers who only use fakeProvider.
// The README documented the barrel import, which did not exist; this asserts the
// intended shape so the docs and the code cannot drift apart again.
const barrel = await import("../src/index")
ok("barrel does NOT export aiSdkProvider", !("aiSdkProvider" in barrel))
ok(
  "barrel exports the core API",
  ["createExtractor", "fakeProvider", "memoryCache", "createBudgetLedger", "AiError"].every(
    (k) => k in barrel,
  ),
)
// kvCache: JSON round trip through a string store, expiry checked on read
{
  const store = new Map<string, string>()
  const kc = kvCache({
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => void store.set(k, v),
  })
  const entry = { value: { a: 1 }, meta: { cacheHit: false } as never }
  await kc.set("k", entry, 60)
  ok("kvCache round trip", JSON.stringify(await kc.get("k")) === JSON.stringify(entry))
  ok("kvCache miss", (await kc.get("absent")) === undefined)
  await kc.set("short", entry, 0.01)
  await Bun.sleep(20)
  ok(
    "kvCache entry expires even if the store keeps it",
    (await kc.get("short")) === undefined && store.size === 2,
  )
  store.set("signet-ai-cache:bad", "{not json")
  ok("kvCache unreadable entry is a miss", (await kc.get("bad")) === undefined)
}

const src = await Bun.file(new URL("../src/index.ts", import.meta.url)).text()
ok("barrel imports no provider adapter", !/providers\//.test(src), src)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
