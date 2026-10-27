import { ApiError } from "@dapplelight/signet-lib/api"
import { z } from "zod"
import { costOf, createBudgetLedger } from "../src/budget"
import { cacheKey, fingerprintSchema, memoryCache } from "../src/cache"
import {
  AiError,
  ALL_PROVIDERS_FAILED,
  BUDGET_EXCEEDED,
  isTransient,
  NO_PROVIDERS,
  SCHEMA_INVALID,
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

const ledger = createBudgetLedger(1.0, 3600)
ledger.record(0.6)
ok("ledger tracks spend", Math.abs(ledger.spentUsd() - 0.6) < 1e-9)
ok("ledger reports remaining", Math.abs(ledger.remainingUsd() - 0.4) < 1e-9)
ok("ledger allows within window", ledger.canSpend(0.3))
ok("ledger refuses beyond window", !ledger.canSpend(0.5))
ledger.record(0.5)
try {
  await createExtractor({ providers: [fakeProvider(good)], ledger }).extract({
    ...base,
    budget: { windowUsd: 1.0, maxCostUsd: 0.01 },
  })
  caught = null
} catch (e) {
  caught = e
}
ok("window exhaustion fails CLOSED", (caught as AiError)?.code === BUDGET_EXCEEDED)
const old = createBudgetLedger(1.0, 60)
old.record(0.9, Date.now() - 120_000)
ok("ledger prunes outside the window", old.spentUsd() === 0)

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
const src = await Bun.file(new URL("../src/index.ts", import.meta.url)).text()
ok("barrel imports no provider adapter", !/providers\//.test(src), src)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
