import { createApiClient, qs, retryAfterSeconds } from "../src/api/client"
import { isErrorEnvelope } from "../src/api/contract"
import { ApiError, AuthError } from "../src/api/errors"
import { onAuthErrorRedirect, queryDefaults } from "../src/api/query-client"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean) => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n))
}

let lastInit: RequestInit | undefined
let lastUrl = ""
const stub = (status: number, body: unknown, contentType = "application/json") => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    lastUrl = String(url)
    lastInit = init
    return new Response(
      body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body),
      { status, headers: contentType ? { "content-type": contentType } : {} },
    )
  }) as typeof fetch
}
const hdr = (k: string) => (lastInit?.headers as Record<string, string> | undefined)?.[k]

// --- res.ok is always checked (ipl bug: 5 of 9 endpoints skipped it) ---
stub(500, "<html>Internal Error</html>", "text/html")
let caught: unknown
try {
  await createApiClient().get("/x")
} catch (e) {
  caught = e
}
ok(
  "500 HTML throws ApiError, never reaches json()",
  caught instanceof ApiError && (caught as ApiError).status === 500,
)
ok("500 HTML is not the message", (caught as ApiError)?.message === "Request failed (HTTP 500)")

// --- custom header must not drop Content-Type (app-a bug) ---
stub(200, { ok: true })
await createApiClient().post("/x", { a: 1 }, { headers: { "X-Foo": "1" } })
ok(
  "custom header keeps Content-Type",
  hdr("Content-Type") === "application/json" && hdr("X-Foo") === "1",
)

// --- FormData must NOT set Content-Type ---
stub(200, { ok: true })
await createApiClient().postForm("/up", new FormData())
ok("FormData sends no Content-Type", hdr("Content-Type") === undefined)

// --- 401 ---
stub(401, { success: false, error: "nope" })
let authHookFired = false
caught = undefined
try {
  await createApiClient({
    onAuthError: () => {
      authHookFired = true
    },
  }).get("/x")
} catch (e) {
  caught = e
}
ok("401 throws AuthError", caught instanceof AuthError)
ok("401 fires onAuthError hook", authHookFired)

// --- error envelope parsed into ApiError ---
stub(422, {
  success: false,
  error: "Validation failed",
  code: "VALIDATION_FAILED",
  details: { formErrors: [], fieldErrors: { email: ["Required"] } },
})
caught = undefined
try {
  await createApiClient().post("/x", {})
} catch (e) {
  caught = e
}
const ae = caught as ApiError
ok("envelope -> ApiError code", ae?.code === "VALIDATION_FAILED")
ok("envelope -> ApiError details", ae?.details?.fieldErrors.email?.[0] === "Required")
ok("envelope -> message", ae?.message === "Validation failed")

// --- non-envelope error body falls back ---
stub(400, "plain text problem", "text/plain")
caught = undefined
try {
  await createApiClient().get("/x")
} catch (e) {
  caught = e
}
ok(
  "plain-text error body gets a generic message, not the text",
  caught instanceof ApiError && (caught as ApiError).message === "Request failed (HTTP 400)",
)

// --- a proxy's HTML 502 (Cloudflare) must not become the message ---
globalThis.fetch = (async () =>
  new Response(
    "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>cloudflare</body></html>",
    { status: 502, statusText: "Bad Gateway", headers: { "content-type": "text/html" } },
  )) as typeof fetch
caught = undefined
try {
  await createApiClient().get("/x")
} catch (e) {
  caught = e
}
ok(
  "HTML 502 -> 'Request failed (502 Bad Gateway)'",
  (caught as ApiError)?.message === "Request failed (502 Bad Gateway)",
)
ok(
  "HTML 502 keeps status, body undefined",
  (caught as ApiError)?.status === 502 && (caught as ApiError)?.body === undefined,
)

globalThis.fetch = (async () =>
  new Response("upstream connect error", {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "content-type": "text/plain" },
  })) as typeof fetch
caught = undefined
try {
  await createApiClient().get("/x")
} catch (e) {
  caught = e
}
ok(
  "plain-text 503 with statusText -> generic message",
  (caught as ApiError)?.message === "Request failed (503 Service Unavailable)",
)

stub(500, undefined, "")
caught = undefined
try {
  await createApiClient().get("/x")
} catch (e) {
  caught = e
}
ok(
  "empty error body -> generic message",
  (caught as ApiError)?.message === "Request failed (HTTP 500)",
)

// --- empty / non-JSON success (app-c handled, app-a did not) ---
stub(204, undefined, "")
ok("204 returns undefined", (await createApiClient().delete("/x")) === undefined)
stub(200, "%PDF-1.4", "application/pdf")
ok("non-JSON 200 returns undefined", (await createApiClient().get("/x")) === undefined)

// --- baseUrl + trailing slash ---
stub(200, { ok: true })
await createApiClient({ baseUrl: "https://api.example.com/" }).get("/v1/x")
ok("baseUrl trailing slash stripped", lastUrl === "https://api.example.com/v1/x")

// --- async auth headers ---
stub(200, { ok: true })
await createApiClient({ headers: async () => ({ Authorization: "Bearer t" }) }).get("/x")
ok("async headers applied", hdr("Authorization") === "Bearer t")

// --- credentials default ---
ok("credentials include by default", lastInit?.credentials === "include")

// --- raw() for binaries ---
stub(200, "%PDF", "application/pdf")
ok("raw() returns Response", (await createApiClient().raw("/pdf")) instanceof Response)

// --- qs ---
ok(
  "qs drops empty/null/undefined",
  qs({ a: 1, b: "", c: null, d: undefined, e: false }) === "?a=1&e=false",
)
ok("qs empty -> empty string", qs({ a: undefined }) === "")

// --- contract guard ---
ok("isErrorEnvelope true", isErrorEnvelope({ success: false, error: "x" }))
ok(
  "isErrorEnvelope false",
  !isErrorEnvelope({ success: true }) && !isErrorEnvelope(null) && !isErrorEnvelope("x"),
)

// --- query defaults ---
const d = queryDefaults()
ok("never retries AuthError", d.queries.retry(0, new AuthError()) === false)
ok("retries other errors", d.queries.retry(0, new ApiError("x", 500)) === true)
ok("stops after maxRetries", d.queries.retry(2, new ApiError("x", 500)) === false)
ok("backoff capped at 30s", d.queries.retryDelay(20) === 30_000 && d.queries.retryDelay(0) === 1000)
ok("mutations never retry", d.mutations.retry === false)
// A 4xx is an answer, not a blip — retrying it only delays the error.
ok("does not retry a 404", d.queries.retry(0, new ApiError("x", 404)) === false)
ok("does not retry a 422", d.queries.retry(0, new ApiError("x", 422)) === false)
ok(
  "retries a 429 and a 408",
  d.queries.retry(0, new ApiError("x", 429)) && d.queries.retry(0, new ApiError("x", 408)),
)
ok("retries a network failure", d.queries.retry(0, new TypeError("Failed to fetch")) === true)
ok(
  "429 waits the server's Retry-After",
  d.queries.retryDelay(0, new ApiError("x", 429, "RATE_LIMITED", undefined, undefined, 7)) === 7000,
)
ok(
  "Retry-After capped at 30s too",
  d.queries.retryDelay(0, new ApiError("x", 429, undefined, undefined, undefined, 600)) === 30_000,
)
ok(
  "shouldRetry overrides the filter",
  queryDefaults({ shouldRetry: () => true }).queries.retry(0, new ApiError("x", 404)) === true,
)
ok(
  "custom maxRetries honoured",
  queryDefaults({ maxRetries: 5 }).queries.retry(4, new ApiError("x", 500)) === true,
)

// --- redirect fires exactly once ---
let redirects = 0
const listeners: Array<(e: unknown) => void> = []
const fakeClient = {
  getQueryCache: () => ({
    subscribe: (f: (e: unknown) => void) => {
      listeners.push(f)
      return () => {}
    },
  }),
  getMutationCache: () => ({ subscribe: () => () => {} }),
}
onAuthErrorRedirect(fakeClient as never, () => {
  redirects++
})
const evt = { type: "updated", action: { type: "error", error: new AuthError() } }
listeners[0]?.(evt)
listeners[0]?.(evt)
listeners[0]?.(evt)
ok("parallel 401s redirect exactly once", redirects === 1)

// --- requestId carried to ApiError, so a user's report can be traced ---
stub(500, {
  success: false,
  error: "Internal server error",
  code: "INTERNAL_ERROR",
  requestId: "req-body",
})
caught = undefined
try {
  await createApiClient().get("/x")
} catch (e) {
  caught = e
}
ok("envelope requestId -> ApiError.requestId", (caught as ApiError)?.requestId === "req-body")
globalThis.fetch = (async () =>
  new Response("<html>bad gateway</html>", {
    status: 502,
    headers: { "x-request-id": "req-hdr" },
  })) as typeof fetch
caught = undefined
try {
  await createApiClient().get("/x")
} catch (e) {
  caught = e
}
ok(
  "non-envelope error falls back to X-Request-Id header",
  (caught as ApiError)?.requestId === "req-hdr",
)

// --- retryAfter: tell the user when a 429 lifts ---
globalThis.fetch = (async () =>
  new Response(
    JSON.stringify({ success: false, error: "Too many requests", code: "RATE_LIMITED" }),
    { status: 429, headers: { "content-type": "application/json", "retry-after": "30" } },
  )) as typeof fetch
caught = undefined
try {
  await createApiClient().get("/x")
} catch (e) {
  caught = e
}
ok(
  "429 Retry-After -> ApiError.retryAfter",
  (caught as ApiError)?.retryAfter === 30 && (caught as ApiError).code === "RATE_LIMITED",
)
const now = 1_700_000_000_000
ok(
  "Retry-After as HTTP date",
  retryAfterSeconds(new Headers({ "retry-after": new Date(now + 45_000).toUTCString() }), now) ===
    45,
)
ok(
  "RateLimit-Reset as delta seconds",
  retryAfterSeconds(new Headers({ "ratelimit-reset": "12" }), now) === 12,
)
ok(
  "X-RateLimit-Reset as epoch seconds",
  retryAfterSeconds(new Headers({ "x-ratelimit-reset": String(now / 1000 + 20) }), now) === 20,
)
ok(
  "Retry-After wins over the others",
  retryAfterSeconds(new Headers({ "retry-after": "5", "ratelimit-reset": "99" }), now) === 5,
)
ok("no headers -> undefined", retryAfterSeconds(new Headers(), now) === undefined)
ok(
  "garbage -> undefined",
  retryAfterSeconds(new Headers({ "retry-after": "soon" }), now) === undefined,
)

// --- send(): the Response untouched; raw() gets headers and the envelope ---
{
  let seenAuth: string | undefined
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    seenAuth = (init?.headers as Record<string, string>)?.Authorization
    const res = new Response(
      JSON.stringify({ success: false, error: "Nope", code: "OFFER_GONE" }),
      {
        status: 410,
        headers: { "content-type": "application/json" },
      },
    )
    Object.defineProperty(res, "redirected", { value: true })
    return res
  }) as typeof fetch
  const client = createApiClient({ headers: () => ({ Authorization: "Bearer t" }) })
  const sent = await client.send("/open")
  ok("send returns a 4xx instead of throwing", sent.status === 410)
  ok("send keeps response.redirected", sent.redirected === true)
  ok("send sends the configured headers", seenAuth === "Bearer t")
  seenAuth = undefined
  caught = undefined
  try {
    await client.raw("/file")
  } catch (e) {
    caught = e
  }
  ok("raw sends the configured headers (it used to skip them)", seenAuth === "Bearer t")
  ok(
    "raw's error carries the envelope code",
    (caught as ApiError)?.code === "OFFER_GONE" && (caught as ApiError).status === 410,
  )
  globalThis.fetch = (async () => new Response("", { status: 401 })) as typeof fetch
  let authFired = false
  caught = undefined
  try {
    await createApiClient({
      onAuthError: () => {
        authFired = true
      },
    }).send("/x")
  } catch (e) {
    caught = e
  }
  ok("send still turns a 401 into AuthError", caught instanceof AuthError && authFired)
}

// --- ApiError.body: any JSON body kept, bare { error } used as the message ---
{
  const conflict = { warning: "overlap", message: "Overlaps March", overlapPct: 80, proceed: true }
  stub(409, conflict)
  caught = undefined
  try {
    await createApiClient().post("/imports", {})
  } catch (e) {
    caught = e
  }
  const b = (caught as ApiError)?.body as typeof conflict | undefined
  ok("non-envelope JSON body kept on ApiError.body", b?.overlapPct === 80 && b.proceed === true)
  ok("non-envelope 409 still an ApiError with status", (caught as ApiError)?.status === 409)

  stub(403, { error: "Not your household" })
  caught = undefined
  try {
    await createApiClient().get("/x")
  } catch (e) {
    caught = e
  }
  ok(
    "bare { error } body uses the string as message, not raw JSON",
    (caught as ApiError)?.message === "Not your household",
  )
  ok(
    "bare { error } body kept too",
    ((caught as ApiError)?.body as { error?: string })?.error === "Not your household",
  )

  stub(403, { error: 42 })
  caught = undefined
  try {
    await createApiClient().get("/x")
  } catch (e) {
    caught = e
  }
  ok(
    "non-string error gets the generic message, not the JSON text",
    (caught as ApiError)?.message === "Request failed (HTTP 403)" &&
      ((caught as ApiError)?.body as { error?: number })?.error === 42,
  )

  stub(422, { success: false, error: "Bad", code: "VALIDATION_FAILED" })
  caught = undefined
  try {
    await createApiClient().get("/x")
  } catch (e) {
    caught = e
  }
  ok(
    "envelope body kept on ApiError.body",
    ((caught as ApiError)?.body as { code?: string })?.code === "VALIDATION_FAILED",
  )

  stub(500, "<html>boom</html>", "text/html")
  caught = undefined
  try {
    await createApiClient().get("/x")
  } catch (e) {
    caught = e
  }
  ok("non-JSON body leaves ApiError.body undefined", (caught as ApiError)?.body === undefined)

  stub(409, conflict)
  caught = undefined
  try {
    await createApiClient().raw("/file")
  } catch (e) {
    caught = e
  }
  ok(
    "raw() carries the body too",
    ((caught as ApiError)?.body as typeof conflict)?.overlapPct === 80,
  )

  const legacy = new ApiError("x", 429, "RATE_LIMITED", undefined, "req", 5)
  ok(
    "constructor stays positional-compatible",
    legacy.retryAfter === 5 && legacy.requestId === "req" && legacy.body === undefined,
  )
}

// A non-envelope body whose text is in `message` (app-a's 409 overlap warning)
globalThis.fetch = (async () =>
  new Response(
    JSON.stringify({
      warning: "overlap",
      message: "Looks like a duplicate import",
      overlapPct: 92,
    }),
    { status: 409, headers: { "content-type": "application/json" } },
  )) as typeof fetch
caught = undefined
try {
  await createApiClient().post("/import", {})
} catch (e) {
  caught = e
}
ok(
  "non-envelope `message` becomes the ApiError message",
  (caught as ApiError)?.message === "Looks like a duplicate import",
)
ok(
  "…and the full body is still on .body",
  ((caught as ApiError)?.body as { overlapPct?: number })?.overlapPct === 92,
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
