# @dapplelight/signet-lib

Client primitives. The API layer, because six products hand-rolled one.

## What the audit found

`lib/api.ts` or `services/api.ts` existed in six families. None shared an error
convention, and reading them turned up two real bugs rather than mere
duplication:

| Product | Lines | State |
|---|---|---|
| app-j | 123 | own conventions |
| app-c | 88 | handled non-JSON and 204 correctly; errors untyped (`Error` with `.status` bolted on) |
| app-a | 59 | typed `ApiError`/`AuthError`, considered retry policy — **but custom headers silently dropped Content-Type** |
| app-d | 49 | **no `res.ok` check on 5 of 9 endpoints** — a 500 HTML page reached `res.json()` |
| dhairya11 | 23 | minimal |
| app-b | 2 | stub |

## The contract

Errors are enveloped, successes are not:

```ts
{ success: false, error: string, code?: string, details?: { formErrors, fieldErrors }, requestId?: string }
```

`error` is human text; branch on `code`, never on `error`. Every error the
server kit raises itself has one (`VALIDATION_FAILED`, `RATE_LIMITED`,
`INTERNAL_ERROR`, …). `requestId` is present when the server runs the
`requestId` middleware, and `ApiError.requestId` falls back to the
`X-Request-Id` header, so a user's report can be traced to the log line.

`client.send(path, init)` sends with the configured headers and credentials and
turns a 401 into `AuthError`, but returns every other Response untouched —
status, `redirected`, `url` — for a flow that follows a redirect and checks
where it landed. `toApiError(res)` turns a failed Response into the same
`ApiError` the other methods throw.

`ApiError.retryAfter` is the seconds until a retry can succeed, when the server
said so (a 429 from `rateLimit` does): from `Retry-After`, else `RateLimit-Reset`,
else `X-RateLimit-Reset`. Use it to say "try again in 30 seconds".

`ERROR_CODES` (and `type ErrorCode`) lists every code the server kit emits, so
an app's user-facing copy can be checked by the compiler rather than a test:

```ts
import type { ErrorCode } from "@dapplelight/signet-lib/api"
const copy = { ...appCopy, RATE_LIMITED: "Slow down a little." } satisfies Record<ErrorCode | AppErrorCode, string>
```

`DEFAULT_ERROR_COPY` gives every one of those codes plain, product-neutral copy
(`{ title, detail, action }`), so an app writes copy only for its own codes and
the few it wants to phrase differently:

```ts
import { DEFAULT_ERROR_COPY, errorCopy, type ErrorCode, type ErrorCopy } from "@dapplelight/signet-lib/api"

export const COPY = {
  ...DEFAULT_ERROR_COPY,
  RATE_LIMITED: { title: "Easy there", detail: "Search again shortly.", action: "wait" },
  PROVIDER_UNAVAILABLE: { title: "Store unavailable", detail: "Try another store.", action: "go_back" },
} satisfies Record<ErrorCode | AppErrorCode, ErrorCopy>

const { title, detail, action } = errorCopy(err.code, COPY)   // unknown code -> INTERNAL_ERROR's copy
```

`action` is one of `retry`, `wait`, `edit`, `sign_in`, `go_back`; pair `wait`
with `ApiError.retryAfter`. Need a product action? `ErrorCopy` is generic:
`satisfies Record<ErrorCode | AppErrorCode, ErrorCopy<ErrorAction | "new_search">>`,
and the spread defaults still fit. A new Signet code arrives with its default; a
new app code fails the build until it has copy.

Codes are UPPER_SNAKE, except `invalid_token` and `insufficient_scope`, whose
spelling RFC 6750 fixes. The server test fails if the server emits a code the
list is missing.

Asymmetric on purpose — it matches what app-a already serves, so existing routes
adopt it without rewriting, and success payloads stay directly usable with no
unwrapping at the call site.

`@dapplelight/signet-server/http` writes exactly what `@dapplelight/signet-lib/api` parses.

## Use

```ts
import { createApiClient, ApiError, AuthError } from "@dapplelight/signet-lib/api"

export const api = createApiClient({
  baseUrl: "/api",
  onAuthError: () => { window.location.href = "/login" },
  headers: async () => ({ Authorization: `Bearer ${await getToken()}` }),
})

await api.get<Transaction[]>("/transactions" + qs({ from, to, q: search }))
await api.post<Transaction>("/transactions", body)
await api.postForm<ImportResult>("/import", formData)
const pdf = await api.raw("/receipt/42/pdf")
```

`qs` appends one `k=v` per array item (`tag=a&tag=b`). A one-item array is
`tag=a`, which the server's `parseQuery` reads as a string, not an array, so give
an array-typed query field a schema that accepts a lone string:
`z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string()))`.

Validation errors arrive structured, not as a JSON string inside a message:

```ts
catch (e) {
  if (e instanceof ApiError && e.code === "VALIDATION_FAILED") {
    setFieldErrors(e.details?.fieldErrors ?? {})
  }
}
```

### Typed client (Hono RPC)

When the API is a Hono app, `createRpcClient` gives end-to-end types: paths,
params, bodies and responses come from the server's routes (validated with
signet-server's `zValidator`). Pass `hc<AppType>` from `hono/client`; this
package does not depend on hono.

```ts
// api/src/app.ts: Signet's groups and the app's own routes, one chain
const app = new Hono()
  .route("/api/sessions", sessionRoutes(sessionOpts))
  .post("/api/notes", zValidator("json", NoteInput), (c) => c.json(save(c.req.valid("json")), 201))
export type AppType = typeof app

// web/src/api.ts
import { hc } from "hono/client"
import { createRpcClient } from "@dapplelight/signet-lib/api"
import type { AppType } from "../../api/src/app"

export const api = createRpcClient(hc<AppType>, {
  baseUrl: "/",
  onAuthError: () => { window.location.href = "/login" },
})

const note = await (await api.api.notes.$post({ json: { title: "Hi" } })).json()
await api.api.notes.$post({ json: { titel: "Hi" } })   // does not compile
```

The fetch underneath is this module's: `headers()` and credentials, an
`x-request-id` per call, and a failed response throws (`AuthError` on 401,
`ApiError` from the envelope otherwise) instead of being returned, so `.json()`
is the success type. `retries` (default 0) retries a GET or HEAD on a network
error, 5xx, 408 or 429, keeping one request id; leave it at 0 under TanStack
Query, which already retries. `fetch` swaps the transport (a Worker service
binding, or `app.request` in tests).

**Timeouts.** `timeoutMs` bounds each attempt's wait for response headers;
`timeout(ms)` in hc's `init` replaces it for one call (`timeout(0)` turns it
off). A timed-out call throws `TimeoutError`: an `ApiError` with status 408
and code `TIMEOUT`, so `errorCopy` and `isRetryable` already handle it. A
timed-out GET or HEAD counts toward `retries`; anything else is never retried.
Your own `signal` still works and its abort is not turned into a timeout.

```ts
export const api = createRpcClient(hc<AppType>, { baseUrl: "/", timeoutMs: 10_000 })
await api.api.reports.$get({}, { init: timeout(60_000) })           // a slow one
await api.api.notes.$get({}, { init: timeout(5_000, { signal }) })  // plus your own abort
```

**Streaming.** The body is not timed, so a stream runs as long as it needs.
Read it as an async iterator with `readText` (chunks), `readNdjson<T>` (one
JSON value per line), `readSse` (server-sent events) or `readSseJson<T>` (each
event's data as JSON, stopping at `[DONE]`). That last one reads signet-ai's
`streamChat` response directly; breaking out of the loop cancels the body.

```ts
import type { UIMessageChunk } from "ai"
const res = await api.api.chat.$post({ json: { messages } })
for await (const chunk of readSseJson<UIMessageChunk>(res)) {
  if (chunk.type === "text-delta") append(chunk.delta)
}
```

### TanStack Query

```ts
import { queryDefaults, onAuthErrorRedirect } from "@dapplelight/signet-lib/api/query-client"

const client = new QueryClient({ defaultOptions: queryDefaults() })
onAuthErrorRedirect(client, () => { window.location.href = "/login" })
```

`AuthError` is never retried — retrying a 401 only delays the redirect and fires
more requests at a dead session. A burst of parallel 401s redirects once.

Only transient failures are retried: network errors, 5xx, 408 and 429. A 400,
403, 404 or 422 fails identically every time, so retrying it only delays the
error. A 429 waits the server's `Retry-After`. Pass `shouldRetry` to change
the filter, `maxRetries` to change the count.

## Fixed here

- **Every response checks `res.ok`.** ipl skipped it on 5 of 9 endpoints.
- **Caller headers extend the defaults instead of replacing them.** app-a spread
  caller options after the computed headers, so any custom header dropped
  Content-Type. FormData still correctly sends none, so the browser sets the
  multipart boundary.
- **Error bodies are read once as text, then parsed.** Calling `res.json()`
  first consumes the stream, so a `res.text()` fallback comes back empty and the
  real message is lost. This one was caught by the test suite, in this package's
  own first draft.
- **204 and non-JSON bodies return undefined** instead of throwing a parse
  error. app-c had this; app-a did not.
- **A non-JSON error body is never the message.** A Cloudflare 502 is a whole
  HTML page, and it reached a toast as `err.message`. The message is the
  envelope's `error`, else a bare string `error`, else a bare string `message`,
  else `"Request failed (502 Bad Gateway)"` (`"(HTTP 502)"` without status
  text). `ApiError.body` holds JSON only, so it is undefined for HTML or plain
  text; use `client.send()` to read such a body.

## Test

`bun run test` — 26 assertions, with `fetch` stubbed. Covers each bug above.

## Format

```ts
import { createCurrencyFormatter, createCompactCurrencyFormatter } from "@dapplelight/signet-lib/format"

const money = createCurrencyFormatter("INR", "en-IN")
money(1234)        // ₹1,234
money(1234.5, true) // ₹1,234.50

const compact = createCompactCurrencyFormatter("INR", "en-IN")
compact(1_200_000)  // ₹12L
compact(35_000_000) // ₹3.5Cr
```

`Intl` compact notation renders 12 lakh as "₹1.2M", which is wrong for Indian
numbering. Locales using the lakh/crore system get that scale; every other
locale falls through to `Intl`. Detection is by locale, not by currency — the
earlier version hardcoded it to INR.

The lakh/crore locales are `en-IN`, `hi`, `bn`, `ta`, `te`, `mr`, `gu`, `kn`,
`ml`, `pa`, `or` and `as`.

Currency formatters use each currency's own fraction digits when `exact` is
true: JPY 0, USD and INR 2, KWD and BHD 3. Amounts may be a number, a decimal
string or a `bigint`. For integer minor units (cents, paise, fils) pass
`{ minorUnits: true }`; a `bigint` is then formatted exactly, with no float:

```ts
const usd = createCurrencyFormatter("USD", "en-US", { minorUnits: true })
usd(12345, true)               // $123.45
usd(900719925474099312345n, true) // $9,007,199,254,740,993,123.45
createCurrencyFormatter("KWD", "en-US")(1.2345, true) // KWD 1.235
createCompactCurrencyFormatter("INR", "en-IN", 1, { minorUnits: true })(120_000_000n) // ₹12L
```

The date formatters take `{ timeZone }` (an IANA zone) as a second argument,
to show an instant in the user's zone rather than the server's:
`createDateTimeFormatter("en-IN", { timeZone: "Asia/Kolkata" })`. A date-only
`"YYYY-MM-DD"` string is a calendar date and is not shifted by it.

Dates use `Intl` throughout. app-a pulled in `date-fns` for what the platform
already does.

### Date arithmetic

```ts
import { addDays, addMonths, startOfMonth, endOfMonth, differenceInCalendarDays } from "@dapplelight/signet-lib/format"

addMonths(new Date(2026, 0, 31), 1)                          // Feb 28 2026 (Feb 29 in a leap year)
addDays(today, -7)                                            // a week ago, same time of day
const range = [startOfMonth(d), endOfMonth(d)]               // 00:00:00.000 → 23:59:59.999
differenceInCalendarDays(new Date(2026, 2, 9), new Date(2026, 2, 8)) // 1, even on a 23-hour DST day
startOfYear(d)                                                // Jan 1st, 00:00:00.000

toDateOnly(new Date(2024, 11, 25, 23, 30))                    // "2024-12-25", the local calendar date
parseDateOnly("2024-12-25")                                   // local midnight on 25 Dec
parseDateOnly("2025-02-30")                                   // invalid Date, not rolled into March
```

`addDays`, `addMonths`, `startOfDay`, `startOfMonth`, `startOfYear`, `endOfMonth`,
`differenceInCalendarDays`, `isSameDay` and `isSameMonth` cover what app-a kept
`date-fns` for. They behave like date-fns' defaults: local time, a `Date` or
epoch ms in, a new `Date` out, the input never mutated. `addMonths` clamps to
the end of a shorter month. `differenceInCalendarDays` compares calendar dates,
not milliseconds / 86,400,000, which floors a spring-forward day to 0. Amounts
may be negative; fractions truncate. An invalid date gives an invalid Date, NaN
or false rather than throwing.

`toDateOnly` and `parseDateOnly` convert between a local calendar date and a
"YYYY-MM-DD" string, for date inputs, query strings and date-only API fields.
`new Date("2024-12-25")` is UTC midnight, which is 24 Dec anywhere west of UTC;
`parseDateOnly` gives local midnight, and returns an invalid Date for any other
shape or for an impossible date. `toDateOnly` gives "" for an invalid date. The
date formatters (`createDateFormatter`, `createDateShortFormatter`,
`createDateTimeFormatter`, `createRelativeTimeFormatter`) read a date-only
string the same way; a string with a time or zone parses as before.

## Crypto: fail-closed field decryption

For apps that encrypt user data on the client (app-a's private mode). You
bring `decrypt`; `decryptFields` enforces the rule that is easy to get wrong:
a field that should be ciphertext and does not decrypt becomes `null`, never
passes through.

```ts
import { decryptFields } from "@dapplelight/signet-lib/crypto"

const { data, undecrypted } = await decryptFields(
  payload,
  ["transactions.description", "transactions.merchant.cleanName"],
  {
    decrypt: (ct) => decryptField(ct, key),
    // Optional. Return false only for values that are certainly legacy plaintext.
    isCiphertext: (v) => looksLikeAesGcmBase64(v),
  },
)
// undecrypted: ["transactions.3.description", ...]  (empty when all decrypted)
```

- Paths are dot-separated; arrays are walked without an index.
- With no `isCiphertext`, every non-empty string at a path is treated as
  ciphertext. A throwing `isCiphertext` also counts as ciphertext.
- Never throws, never mutates the input. A shared object decrypts under every
  reference.
