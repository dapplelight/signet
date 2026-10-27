import {
  createJev,
  JEV_DEFAULT_MIN_CONFIDENCE,
  JEV_DEFAULT_MODEL,
  JEV_DEFAULT_TIMEOUT_MS,
  type JevEvent,
  type JevFetch,
} from "../src/jev"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const KEY = "jev_test_SECRET_9f8e7d6c5b4a"

interface Call {
  url: string
  init: RequestInit
  body: any
}

/** A fake fetch that records calls and answers with `reply`. */
function fakeFetch(reply: (body: any) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn: JevFetch = async (url, init) => {
    const body = JSON.parse(String(init.body))
    calls.push({ url, init, body })
    return reply(body)
  }
  return { fn, calls }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })

const answer = (result: Record<string, unknown>) =>
  json({ model: JEV_DEFAULT_MODEL, answers: { result } })

const events: JevEvent[] = []
const onEvent = (e: JevEvent) => events.push(e)

const choiceArgs = {
  question: "Which category fits?",
  options: ["food", "travel", "unsure"] as const,
  state: "SWIGGY BANGALORE",
  fallback: "unsure" as const,
  sensitive: false,
}

// --- defaults ---
ok("default model is pinned, not jev-latest", JEV_DEFAULT_MODEL === "jev-1.13.0")
ok("default floor is 0.95", JEV_DEFAULT_MIN_CONFIDENCE === 0.95)
ok("default timeout is 8 s", JEV_DEFAULT_TIMEOUT_MS === 8000)

// --- confident result is used ---
{
  const f = fakeFetch(() => answer({ type: "choice", choice: "food", confidence: 0.98 }))
  const jev = createJev({ apiKey: KEY, fetch: f.fn, onEvent })
  const d = await jev.choice(choiceArgs)
  ok("confident: value from jev", d.value === "food", d)
  ok("confident: source jev, confident true", d.source === "jev" && d.confident, d)
  ok("confident: no reason", d.reason === undefined, d)
  ok("one request", f.calls.length === 1)
  const c = f.calls[0]
  ok("posts to /v1/systemone", c.url === "https://api.typesafe.ai/v1/systemone", c.url)
  ok(
    "Bearer auth header",
    (c.init.headers as Record<string, string>).Authorization === `Bearer ${KEY}`,
  )
  ok("sends the pinned model", c.body.model === JEV_DEFAULT_MODEL, c.body)
  ok(
    "list options become label -> null criteria",
    JSON.stringify(c.body.questions.result) ===
      JSON.stringify({
        type: "choice",
        instructions: "Which category fits?",
        criteria: { food: null, travel: null, unsure: null },
      }),
    c.body.questions,
  )
  ok("jev.enabled with a key", jev.enabled)
}

// --- low confidence falls back ---
{
  const f = fakeFetch(() => answer({ type: "choice", choice: "travel", confidence: 0.94 }))
  const jev = createJev({ apiKey: KEY, fetch: f.fn })
  const d = await jev.choice(choiceArgs)
  ok("0.94 < 0.95 falls back", d.value === "unsure" && d.source === "fallback", d)
  ok("reason low_confidence", d.reason === "low_confidence", d)
  ok(
    "low confidence keeps jev's answer for review",
    !d.confident && d.answer === "travel" && d.confidence === 0.94,
    d,
  )
  const lax = await jev.choice({ ...choiceArgs, minConfidence: 0.9 })
  ok("per-call floor override is honoured", lax.value === "travel" && lax.confident, lax)
}

// --- the floor is on by default: app-b's no-floor mistake cannot recur ---
{
  const f = fakeFetch(() => answer({ type: "choice", choice: "travel", confidence: 0.3 }))
  const jev = createJev({ apiKey: KEY, fetch: f.fn })
  const d = await jev.choice(choiceArgs)
  ok("no floor configured still means 0.95", d.value === "unsure" && !d.confident, d)
}

// --- label outside the offered set is never acted on ---
{
  const f = fakeFetch(() => answer({ type: "choice", choice: "crypto", confidence: 0.99 }))
  const d = await createJev({ apiKey: KEY, fetch: f.fn }).choice(choiceArgs)
  ok("unknown label falls back", d.value === "unsure" && d.reason === "invalid_response", d)
}

// --- timeout falls back (short timeout; fetch ignores the signal entirely) ---
{
  const f = fakeFetch(() => new Promise<Response>(() => {}))
  const jev = createJev({ apiKey: KEY, fetch: f.fn, timeoutMs: 20 })
  const t0 = Date.now()
  const d = await jev.choice(choiceArgs)
  ok("timeout falls back", d.value === "unsure" && d.reason === "timeout", d)
  ok("timeout is bounded", Date.now() - t0 < 1000, Date.now() - t0)
}

// --- timeout aborts the signal for fetches that honour it ---
{
  let aborted = false
  const fn: JevFetch = (_u, init) =>
    new Promise((_r, reject) => {
      init.signal?.addEventListener("abort", () => {
        aborted = true
        reject(new DOMException("aborted", "AbortError"))
      })
    })
  const d = await createJev({ apiKey: KEY, fetch: fn, timeoutMs: 20 }).choice(choiceArgs)
  ok("signal aborted on timeout", aborted && d.reason === "timeout", d)
}

// --- errors fall back ---
{
  const net = fakeFetch(() => {
    throw new TypeError("fetch failed")
  })
  const d1 = await createJev({ apiKey: KEY, fetch: net.fn }).choice(choiceArgs)
  ok("network error falls back", d1.value === "unsure" && d1.reason === "network_error", d1)

  const events2: JevEvent[] = []
  const http = fakeFetch(() => json({ error: "rate limited" }, 429))
  const d2 = await createJev({
    apiKey: KEY,
    fetch: http.fn,
    onEvent: (e) => events2.push(e),
  }).choice(choiceArgs)
  ok("429 falls back", d2.value === "unsure" && d2.reason === "http_error", d2)
  ok("event carries the status", events2[0]?.status === 429, events2)

  const garbage = fakeFetch(() => new Response("<html>oops</html>", { status: 200 }))
  const d3 = await createJev({ apiKey: KEY, fetch: garbage.fn }).choice(choiceArgs)
  ok("non-JSON 200 falls back", d3.reason === "invalid_response", d3)

  const missing = fakeFetch(() => json({ answers: {} }))
  const d4 = await createJev({ apiKey: KEY, fetch: missing.fn }).choice(choiceArgs)
  ok("missing answer falls back", d4.reason === "invalid_response", d4)

  const throwingObserver = fakeFetch(() => answer({ choice: "food", confidence: 0.99 }))
  const d5 = await createJev({
    apiKey: KEY,
    fetch: throwingObserver.fn,
    onEvent: () => {
      throw new Error("observer bug")
    },
  }).choice(choiceArgs)
  ok("a throwing onEvent does not throw the call", d5.value === "food", d5)
}

// --- missing key falls back without calling fetch ---
for (const apiKey of [undefined, "", "   "]) {
  const f = fakeFetch(() => answer({ choice: "food", confidence: 1 }))
  const jev = createJev({ apiKey, fetch: f.fn })
  const d = await jev.choice(choiceArgs)
  ok(
    `missing key (${JSON.stringify(apiKey)}) falls back, no fetch`,
    d.value === "unsure" && d.reason === "no_key" && f.calls.length === 0 && !jev.enabled,
    d,
  )
}

// --- privacy guard ---
{
  const f = fakeFetch(() => answer({ choice: "food", confidence: 0.99 }))
  const jev = createJev({ apiKey: KEY, fetch: f.fn })
  const d = await jev.choice({ ...choiceArgs, sensitive: true })
  ok(
    "sensitive without opt-in falls back",
    d.value === "unsure" && d.reason === "sensitive_not_allowed",
    d,
  )
  ok("sensitive without opt-in never calls fetch", f.calls.length === 0, f.calls.length)

  const b = await jev.batch({
    state: "x",
    sensitive: true,
    questions: { a: { type: "noul", question: "?", fallback: false } },
  })
  ok("batch obeys the guard too", b.a.reason === "sensitive_not_allowed" && f.calls.length === 0)

  // Plain JS callers can omit the field; that must count as sensitive.
  const loose = await jev.choice({ ...choiceArgs, sensitive: undefined as unknown as boolean })
  ok(
    "omitted sensitive is treated as sensitive",
    loose.reason === "sensitive_not_allowed" && f.calls.length === 0,
    loose,
  )

  const optedIn = createJev({ apiKey: KEY, fetch: f.fn, allowSensitive: true })
  const d2 = await optedIn.choice({ ...choiceArgs, sensitive: true })
  ok("sensitive with opt-in calls fetch", f.calls.length === 1 && d2.value === "food", d2)

  const noKey = createJev({ fetch: f.fn })
  const d3 = await noKey.choice({ ...choiceArgs, sensitive: true })
  ok("privacy is reported before a missing key", d3.reason === "sensitive_not_allowed", d3)
}

// --- the type requires `sensitive` ---
{
  const jev = createJev({ apiKey: KEY, fetch: fakeFetch(() => json({})).fn })
  // @ts-expect-error sensitive is required: nobody may forget to declare it
  await jev.choice({ question: "?", options: ["a", "b"], state: "s", fallback: "a" })
  const ab = { question: "?", options: ["a", "b"] as const, state: "s", sensitive: false }
  // @ts-expect-error the fallback must be one of the options
  await jev.choice({ ...ab, fallback: "c" })
  ok("type-level guards compile (see @ts-expect-error)", true)
}

// --- score ---
{
  const f = fakeFetch(() => answer({ type: "score", score: 2.4, confidence: 0.97 }))
  const jev = createJev({ apiKey: KEY, fetch: f.fn })
  const d = await jev.score({
    question: "How risky?",
    levels: ["none", "low", "medium", "high"],
    state: "diff",
    fallback: 3,
    sensitive: false,
  })
  ok("score: confident value used", d.value === 2.4 && d.confident, d)
  ok(
    "score: levels sent as ordered criteria",
    JSON.stringify(f.calls[0].body.questions.result.criteria) ===
      JSON.stringify(["none", "low", "medium", "high"]),
  )
  const bad = await jev.score({
    question: "?",
    levels: ["only one"],
    state: "s",
    fallback: 0,
    sensitive: false,
  })
  ok(
    "score: <2 levels is an invalid request, no fetch",
    bad.reason === "invalid_request" && f.calls.length === 1,
    bad,
  )
}

// --- noul ---
{
  const f = fakeFetch(() => answer({ type: "noul", noul: 0.02 }))
  const jev = createJev({ apiKey: KEY, fetch: f.fn })
  const d = await jev.noul({
    question: "Is it a person?",
    state: "RAHUL K",
    fallback: true,
    sensitive: false,
  })
  ok("noul: confident no", d.value === false && d.confident && d.probability === 0.02, d)

  const g = fakeFetch(() => answer({ type: "noul", noul: 0.7 }))
  const d2 = await createJev({ apiKey: KEY, fetch: g.fn }).noul({
    question: "?",
    state: "s",
    fallback: false,
    sensitive: false,
  })
  ok(
    "noul: 0.7 is below the floor, falls back but keeps the probability",
    d2.value === false && d2.reason === "low_confidence" && d2.probability === 0.7,
    d2,
  )
}

// --- batch ---
{
  const f = fakeFetch(() =>
    json({
      answers: {
        cat: { type: "choice", choice: "food", confidence: 0.99 },
        person: { type: "noul", noul: 0.6 },
        risk: { type: "score", score: 1, confidence: 0.96 },
      },
    }),
  )
  const jev = createJev({ apiKey: KEY, fetch: f.fn })
  const r = await jev.batch({
    state: "SWIGGY",
    sensitive: false,
    questions: {
      cat: {
        type: "choice",
        question: "category?",
        options: ["food", "unsure"],
        fallback: "unsure",
      },
      person: { type: "noul", question: "person?", fallback: true },
      risk: { type: "score", question: "risk?", levels: ["low", "mid", "high"], fallback: 2 },
    },
  })
  ok("batch: one request for all questions", f.calls.length === 1)
  ok(
    "batch: questions sent by name",
    Object.keys(f.calls[0].body.questions).join() === "cat,person,risk",
  )
  ok("batch: confident choice used", r.cat.value === "food" && r.cat.confident)
  ok(
    "batch: unsure noul falls back alone",
    r.person.value === true && r.person.reason === "low_confidence",
  )
  ok("batch: confident score used", r.risk.value === 1 && r.risk.confident)

  const down = fakeFetch(() => json({}, 503))
  const r2 = await createJev({ apiKey: KEY, fetch: down.fn }).batch({
    state: "s",
    sensitive: false,
    questions: {
      a: { type: "choice", question: "?", options: ["x", "y"], fallback: "y" },
      b: { type: "noul", question: "?", fallback: false },
    },
  })
  ok("batch: a failed request falls back per question", r2.a.value === "y" && r2.b.value === false)
  ok(
    "batch: every question gets the reason",
    r2.a.reason === "http_error" && r2.b.reason === "http_error",
  )
}

// --- caller abort ---
{
  const ac = new AbortController()
  ac.abort()
  const f = fakeFetch(() => answer({ choice: "food", confidence: 1 }))
  const d = await createJev({ apiKey: KEY, fetch: f.fn }).choice({
    ...choiceArgs,
    signal: ac.signal,
  })
  ok("pre-aborted signal falls back, no fetch", d.reason === "aborted" && f.calls.length === 0, d)
}

// --- the key never leaks ---
{
  const seen: unknown[] = []
  const collect = (e: JevEvent) => seen.push(e)
  // Every failure mode, each with a transport that tries hard to leak the key.
  const leaky: JevFetch[] = [
    async (_u, init) => {
      throw new Error(`boom ${JSON.stringify(init.headers)}`)
    },
    async (_u, init) => json({ echo: init.headers }, 401),
    async (_u, init) => new Response(`not json ${JSON.stringify(init.headers)}`, { status: 200 }),
    async (_u, init) =>
      json({ answers: { result: { choice: JSON.stringify(init.headers), confidence: 1 } } }),
    async () => answer({ choice: "food", confidence: 0.5 }),
    async () => answer({ choice: "food", confidence: 0.99 }),
    () => new Promise<Response>(() => {}),
  ]
  for (const fn of leaky) {
    const jev = createJev({ apiKey: KEY, fetch: fn, onEvent: collect, timeoutMs: 20 })
    seen.push(await jev.choice(choiceArgs))
    seen.push(await jev.choice({ ...choiceArgs, sensitive: true }))
    seen.push(await jev.noul({ question: "?", state: "s", fallback: false, sensitive: false }))
  }
  const dump = JSON.stringify(seen)
  ok("key appears in no decision or event", !dump.includes(KEY) && !dump.includes("SECRET"))
  ok("events were actually collected", seen.filter((s) => (s as JevEvent).kind).length >= 14)
  ok(
    "events carry no state or question text",
    !dump.includes("SWIGGY") && !dump.includes("Which category"),
  )
  const jevObj = createJev({ apiKey: KEY })
  ok("the instance does not expose the key", !JSON.stringify(jevObj).includes(KEY))
}

// --- events ---
{
  ok("events emitted for the first call", events.length >= 1)
  const e = events[0]
  ok(
    "event is redacted and complete",
    e.kind === "choice" &&
      e.name === "result" &&
      e.source === "jev" &&
      e.model === JEV_DEFAULT_MODEL &&
      e.sensitive === false &&
      typeof e.durationMs === "number",
    e,
  )
}

// --- no env reads ---
{
  const src = await Bun.file(new URL("../src/jev.ts", import.meta.url)).text()
  ok("jev.ts never reads process.env", !/process\.env|Bun\.env|import\.meta\.env/.test(src))
  ok(
    "jev.ts does not import the SDK",
    !/@typesafe-ai\/sdk/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")),
  )
  const barrel = await import("../src/index")
  ok("jev is a subpath, not on the barrel", !("createJev" in barrel))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
