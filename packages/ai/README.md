# @dapplelight/signet-ai

Provider-agnostic structured LLM calls with budget caps, caching and failover.
Resolves [signet#1](https://github.com/dapplelight/signet/issues/1).

**Structured output only.** Every call goes through a Zod schema and returns a
typed, validated object — never free text. That keeps the surface small and every
call verifiable.

```ts
import { createExtractor, memoryCache, createBudgetLedger } from "@dapplelight/signet-ai"
// The AI SDK adapter is a SUBPATH, not on the barrel — see "Why the adapter is
// a separate import" below. Requires `ai` installed.
import { aiSdkProvider } from "@dapplelight/signet-ai/providers/ai-sdk"
import { createWorkersAI } from "workers-ai-provider"

const workersAi = createWorkersAI({ binding: env.AI })

const ai = createExtractor({
  providers: [
    aiSdkProvider({ name: "workers-ai", model: workersAi("@cf/meta/llama-3.3-70b-instruct-fp8-fast") }),
    aiSdkProvider({ name: "backup", model: someOtherModel,
      pricing: { inputPerMTokens: 0.15, outputPerMTokens: 0.6 } }),
  ],
  cache: memoryCache(),
  ledger: createBudgetLedger(5, 86_400),  // $5/day, fails closed
})

const { value, meta } = await ai.extract({
  schema: intentSchema,
  input: "8000 se kam ka snowboard",
  instructions: "Pull the budget, size and category from this shopping request.",
  budget: { maxCostUsd: 0.002 },
})
// meta: { provider, model, usage, costUsd, cacheHit, attempts, durationMs }
```

## Model choice matters more than anything in this package

Benchmarked through this extractor on real inputs by the first production
consumer, five free Workers AI models, same work:

| Model | Latency |
|---|---|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | **1.1s** |
| `@cf/zai-org/glm-4.7-flash` | 17.7s / 30.0s / 21.0s, one `ALL_PROVIDERS_FAILED` |
| `@cf/meta/llama-3.1-8b-instruct` | fails instantly — no structured output on this path |

`glm-4.7-flash` was this README's example and is unusable inline. If you copied
it before, change it. End-to-end latency in production went from 17–30s to
1.6–3.0s including a Shopify call.

A model with no structured-output support fails closed in ~0.1s, which is the
correct behaviour — but a provider array containing only that model will always
fail.

## Schema validity is not truth

**This package guarantees shape, not correctness.** "Typed and validated or it
is an error" is easy to read as "correct". It is not the same claim, and the
difference matters.

Observed in production, all schema-valid and all wrong:

- `maxPrice: 8000` for *"snowboards for a beginner"* — no price in the input
- a field meant to hold `"ski jacket"` returned *"The user asked for a warm
  skiing item with a maximum price of $900…"*
- every model returned `inStock: true` for requests that never mentioned
  availability

Re-validation passes all of these, correctly — they are the right shape with
invented content. If a hallucinated value would cause harm, verify each claim
against the input text and discard what the text does not support. That layer
is application-specific and deliberately not in this package.

## Decisions that are load-bearing

**Providers are an array, tried in order.** Adding or reordering is config, not
code. Exhausting Workers AI's free allocation (error 3036, delivered as a 429)
fails over to the next entry with no product change.

**Budget fails closed.** Once a window is exhausted, calls are refused. A
`fallback` value does **not** mask a budget refusal — running out of money is a
configuration problem the caller must see, not a soft failure.

**Only transient errors retry.** A schema violation or a bad key fails
identically every time; retrying spends budget and latency for a guaranteed
failure. Unknown error shapes are treated as *permanent* — "retry on doubt" is
how a cap gets spent on something that was never going to work.

**The SDK's own retries are disabled** (`maxRetries: 0`). Retrying in both
places multiplies spend silently underneath a cap.

**Output is re-validated** against the schema even though the provider claims to
have done it. A provider returning an unvalidated object is the exact failure
this package exists to prevent.

**The schema is part of the cache key.** The same prompt against a changed
schema is a different question; reusing the old answer returns data that no
longer validates.

## Why the adapter is a separate import

`aiSdkProvider` lives at `@dapplelight/signet-ai/providers/ai-sdk` and is deliberately
**not** re-exported from the barrel.

`export *` resolves eagerly in ESM, so barrelling it would make importing
`createExtractor` alone pull in `ai` — turning an optional peer into a hard
requirement. Anyone using only `fakeProvider` in tests, or writing their own
`Provider`, would need a dependency they never asked for, and would only find
out at runtime.

The core package is transport-agnostic and depends on nothing but
`@dapplelight/signet-lib`. Same reasoning as `@dapplelight/signet-server/http` needing
`hono` only if you use it.

```ts
import { createExtractor } from "@dapplelight/signet-ai"              // no `ai` needed
import { aiSdkProvider } from "@dapplelight/signet-ai/providers/ai-sdk" // needs `ai`
```

## Testing without network or spend

```ts
import { createExtractor, fakeProvider } from "@dapplelight/signet-ai"

const ai = createExtractor({ providers: [fakeProvider({ budget: 8000, category: "snowboard" })] })
```

`fakeProvider` takes a fixed value, a list, or a function of the input, and can
be told to fail N times first to exercise retry and failover paths.

## Errors

`AiError extends ApiError` from `@dapplelight/signet-lib/api`, so an AI failure is handled
like any other API failure. Codes: `AI_BUDGET_EXCEEDED` (429),
`AI_ALL_PROVIDERS_FAILED` (502), `AI_SCHEMA_INVALID` (502), `AI_NO_PROVIDERS`
(500).

## Jev: `@dapplelight/signet-ai/jev`

A safe wrapper for Jev, TypeSafe's System One classifier: text in, typed
decision out. app-a, app-b and app-d each had their own copy with the
same model pin, 0.95 floor and 8 s timeout. One of them had no floor and threw.

```ts
import { createJev } from "@dapplelight/signet-ai/jev"

// Build it where env exists (a handler, a CLI main), never at module scope.
const jev = createJev({
  apiKey: env.JEV_API_KEY,        // missing: every call returns its fallback
  // model = "jev-1.13.0", minConfidence = 0.95, timeoutMs = 8000
  // allowSensitive = false       // the explicit opt-in for private/financial text
  onEvent: (e) => log.info("jev", e),   // redacted: no key, state or question text
})

const d = await jev.choice({
  question: "Which spending category fits this bank transaction?",
  options: { food: "Restaurants, delivery", travel: "Flights, cabs", unsure: null },
  state: `Money paid out. Narration: "${narration}"`,
  fallback: "unsure",
  sensitive: true,                // required: bank text is financial
})
// { value, confident, source: "jev" | "fallback", confidence?, reason?, answer? }
if (d.confident) apply(d.value)
else review.push({ best: d.answer, confidence: d.confidence })
```

| Method | Jev primitive | `value` |
|---|---|---|
| `choice({ question, options, fallback, ... })` | `choice`, up to 255 labels, as a list or label -> description | one of the labels |
| `score({ question, levels, fallback, ... })` | `score`, 2-10 ordered levels | a number, can fall between levels |
| `noul({ question, fallback, ... })` | `noul` | a boolean; `probability` carries the raw yes-probability |
| `batch({ state, questions, ... })` | several named questions about one state, in one request | a decision per name |

Every call takes `state`, `sensitive`, `fallback`, and optionally `minConfidence`
and `signal`. `jev.enabled` is `false` without a key, so an app can skip
preparing work it will not send.

**It never throws for the failures that matter.** Every call resolves to a
decision the app can act on. The fallback is used, with a `reason`, when:

| `reason` | When |
|---|---|
| `sensitive_not_allowed` | `sensitive: true` and the instance lacks `allowSensitive: true`. Checked first; fetch is never called |
| `no_key` | `apiKey` missing or blank. Fetch is never called |
| `low_confidence` | below the floor. `answer` and `confidence` keep what Jev said, for a review queue |
| `timeout` | over `timeoutMs`, even if the fetch ignores its abort signal |
| `http_error` | a non-2xx response, such as 401 or 429. The event carries `status` |
| `network_error` | fetch rejected |
| `invalid_response` | not JSON, a missing answer, or a label outside the offered set |
| `invalid_request` | no questions, an out-of-range floor, score levels outside 2-10, or a fallback not among the options |
| `aborted` | the caller's `signal` fired |

**Decisions that are load-bearing:**

- **The 0.95 floor is on by default.** On app-a's first real run, 0.85-0.94 let
  wrong guesses through and 0.95 let none through. Pass `minConfidence` per
  call where a wrong answer is cheap, as app-b's loop does.
- **`sensitive` is required by the type**, and a JS caller that omits it is
  treated as sensitive. The opt-in belongs to the instance, so the owner decides
  it once in config, not each caller in code. Deciding what is safe to send is
  still the app's job: app-a strips digit runs from narrations.
- **The noul confidence is `max(p, 1 - p)`.** Jev reports none for noul, so a
  0.7 "yes" falls back at the default floor. Rank by `probability` if you need to.
- **Fetch only, no SDK.** The API is a single `POST /v1/systemone` with Bearer
  auth. `@typesafe-ai/sdk` retries twice by default with a per-attempt timeout,
  so its "8 s" could reach about 27 s. It also falls back to `TYPESAFE_API_KEY`
  from env and logs request bodies at debug level. Here `timeoutMs` is the
  total, with no retries, because the fallback is the retry.
- **The key goes into the Authorization header and nowhere else.** Upstream
  error messages and response bodies are never copied into a result or event,
  because a transport can echo headers. A test drives every failure path
  through a transport that tries to leak the key.
- **Not on the barrel.** Import it from `@dapplelight/signet-ai/jev`. It has no
  dependencies.

### Migrating the existing copies

- **app-a** (`packages/mcp/src/lib/jev-categorize.ts`): drop `JEV_MODEL`,
  `TIMEOUT_MS`, `makeJevClassifier`, the `TypeSafeClient` import and the
  `@typesafe-ai/sdk` dependency. Build `createJev({ apiKey: env.JEV_API_KEY,
  allowSensitive: env.JEV_ALLOW_PRIVATE_MODE === "1" })`, then call
  `jev.choice({ ..., fallback: "unsure", sensitive: Boolean(crypto) })`. That
  replaces `assertPrivateModeAllowed` inside `jevCategorize`, and a `try/catch`
  counting errors becomes `reason` not being `low_confidence`. The confidence
  comparison moves into the wrapper; `low_confidence` rows go to `review` using
  `answer` and `confidence`. Keep `sanitizeNarration`, the `unsure` label and
  the no-auto-apply rule for transfers: those are product rules.
- **app-b** (`scripts/jev-client.mjs`): delete the file. `decide()` in
  `loop/jev-steps.mjs` becomes `jev.choice({ ..., fallback: safe, minConfidence,
  sensitive: false })`. **Behaviour fix:** `jev-pr-risk.mjs`, `jev-triage.mjs`
  and `jev-stop-gate.mjs` call `classify` with no floor, so a 0.3 guess
  labelled a PR, and any error or missing key threw and killed the script. They
  now get the 0.95 floor and a fallback: `medium` for PR risk, `structural` for
  the stop gate so E2E still runs, and no tier for triage. `assessCompleteness`
  becomes `jev.noul({ ..., fallback: false })`.
- **app-d** (`src/lib/jev.ts`): delete `JEV_MODEL`, `MIN_CONFIDENCE`,
  `TIMEOUT_MS`, `getClient`, and the `try/catch` returning `null` in
  `jevClassify`. `jevEnabled()` becomes `jev.enabled`. The null-or-low-confidence
  check in `match.ts` `confident()` and in `route.ts` becomes `d.confident`.
  `jevScore` becomes a `jev.batch` of `noul` questions per chunk of 25, reading
  `probability` with a fallback of `true` so an unscored video is kept. All
  app-d calls send public content, so they use `sensitive: false`.

## Out of scope

Streaming, chat state, agents and tool loops, embeddings, RAG. Add when a second
product needs them, not before.

## Test

`bun run test` runs 42 extractor assertions (failover, retry classification,
budget fail-closed, cache keying and schema enforcement) and 59 Jev assertions
(the confident path, every fallback reason, the privacy gate, batch, and the
key never leaking), all against a fake fetch with no network.
