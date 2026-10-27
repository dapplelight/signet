# @dapplelight/signet-server

Backend primitives. Auth first, because the audit found it was the most
duplicated concern with no shared implementation.

## What the audit actually found

`STARTER-KIT-AUDIT.md` §9 claimed "6 products, 6 auth implementations, zero
overlap". That was inferred from filenames. **Reading the code corrected it:**
there are **three shapes**, and the two products with a real user system had
already converged on the same library.

| Shape | Products | Answer |
|---|---|---|
| Full user system, OAuth, user table | app-a, app-b — **both already on Better Auth** | `auth/better-auth` — defaults only, not a reimplementation |
| Shared passcode, no user table | app-c, invite tier (`pin-gate`, `LoginScreen`) | `auth/session` + `auth/passcode` |
| Single bearer token for machines | app-h, app-a API tokens | `auth/bearer` |

They are three different problems, not three failed attempts at one. This
package ships all three rather than forcing them together.

## Modules

| Import | Deps | Use |
|---|---|---|
| `@dapplelight/signet-server/auth/session` | none | Stateless HMAC cookie session. Workers and Node. |
| `@dapplelight/signet-server/auth/passcode` | none | PBKDF2 passcode hash + constant-time verify. |
| `@dapplelight/signet-server/auth/bearer` | none | API tokens, prefixed and stored hashed. |
| `@dapplelight/signet-server/auth/guards` | none | Config guards that fail loudly. |
| `@dapplelight/signet-server/auth/better-auth` | none | Opinionated Better Auth options object. |
| `@dapplelight/signet-server/auth/hono` | `hono` (optional peer) | `requireAuth`, `requireSession`. |
| `@dapplelight/signet-server/mcp` | `@modelcontextprotocol/server` ^2.1, `zod` >=4.2 (optional peers; not `hono`) | `defineTool`, `createMcpServer`; stdio via the SDK's `serveStdio`. See [MCP servers](#mcp-servers). |
| `@dapplelight/signet-server/mcp/hono` | the above, plus `hono` | `mountMcp`, `mcpHandler`: streamable HTTP through the SDK's `createMcpHandler`, 2026-07-28 and 2025 clients, per request. |

Everything but the Hono middleware is dependency-free Web Crypto.

## Passcode gate

```ts
import { verifyPasscode } from "@dapplelight/signet-server/auth/passcode"
import { issueSession, sessionCookie } from "@dapplelight/signet-server/auth/session"

const opts = { cookieName: "rsvp_session", secret: env.SESSION_SECRET, sameSite: "none" as const }

if (!(await verifyPasscode(body.passcode, env.PASSCODE_HASH))) return c.json({ error: "Wrong passcode" }, 401)
c.header("Set-Cookie", sessionCookie(await issueSession(opts), opts))
```

Generate the stored hash offline and put it in a secret — never the passcode:
```ts
await hashPasscode("your-passcode")  // -> "a1b2…:c3d4…"
```

## User system

```ts
import { betterAuthDefaults, socialProviders } from "@dapplelight/signet-server/auth/better-auth"

betterAuth({
  ...betterAuthDefaults(env),
  database: drizzleAdapter(db, { provider: "pg", schema }),
  socialProviders: socialProviders(
    { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } },
    (p, reason) => logger.warn("auth.provider_skipped", { provider: p, reason }),
  ),
})
```

Returns a plain options object, so this package needs no Better Auth dependency
and no version coupling.

**Anything that changes Better Auth's behaviour is opt-in**, and the default is
Better Auth's own. An earlier version shipped app-a's settings as defaults, which
would have quietly weakened every other app. Each option says what it costs:

| Option | Effect | Cost |
|---|---|---|
| `cookieCacheSeconds` | trusts the signed cookie, skipping a DB read | a deleted account or revoked session stays signed in this long |
| `skipStateCookieCheck` | drops the OAuth state-cookie check | that check is CSRF protection on the callback |
| `sessionSeconds` | session lifetime (else `SESSION_DURATION_SECONDS`, else 7 days) | |
| `rateLimit` | Better Auth's own limiter on `/api/auth/*` | a second limiter on top of the app's |
| `baseURL`, `trustedOrigins` | override `BETTER_AUTH_URL` / `WEB_URL` and the env-built origin list | |

## Carried forward deliberately

Things one product got right that the others lacked:

- **`isDevAuthEnabled` throws in production/staging** rather than returning false.
  A dev-auth flag reaching prod is a total authentication bypass; failing the boot
  is correct. From app-a, the only implementation that had this.
- **Constant-time signature compare.** app-c used `!==`, which leaks
  signature bytes through response timing. `timingSafeEqual` is from app-h,
  which was the only one doing it.
- **Half-configured social providers are skipped and logged**, not silently
  broken at redirect time. From app-b.
- **`SameSite=None; Secure`** with optional `Domain`, for Pages → Worker
  cross-origin fetches. Both user-system products needed it.
- **Tokens stored hashed** with a greppable prefix, so a database leak yields no
  live credentials.

## Not carried forward

app-a's `auth.ts` also contains households, seeded dev users, an email allowlist
with blind-index hashing, and PII encryption. Those are app-a's domain, not a
design system's — the same class of leak as the finance-green Badge default that
`@dapplelight/signet-ui` had to strip. Expose them via Better Auth's `databaseHooks` in the
app, not here.

## Test

`bun run test` — 39 assertions covering signature tampering, expiry, wrong
secrets, constant-time compare, passcode salting, token prefixes and the
production guard.

## HTTP — error envelope and validation

`@dapplelight/signet-server/http` is the server half of the contract in `@dapplelight/signet-lib/api`.

```ts
import { errorHandler, ApiException } from "@dapplelight/signet-server/http"
import { parseBody } from "@dapplelight/signet-server/http/validate"

app.onError(errorHandler({
  isProduction: () => getRuntimeEnv().NODE_ENV === "production",
  onError: (err, meta) => captureException(err, meta),
}))

app.post("/things", async (c) => {
  const body = await parseBody(c, thingSchema)   // 400 + structured field errors
  if (!allowed) throw new ApiException(403, "Not allowed", "NOT_IN_HOUSEHOLD")
  return c.json(await create(body))
})
```

Unhandled error messages are replaced in production — they carry connection
strings, file paths and query text. `isProduction` is a function so it is read
per request; a module-scope `process.env` read is unreliable on Workers.

Validation failures put `flatten()` output in `details`, where the envelope has
a place for it. app-a stringified it into the message field, forcing the client
to `JSON.parse` an error string to render field errors.

## Env — Workers-safe configuration

```ts
import { initRuntimeEnv, createEnv } from "@dapplelight/signet-server/env"

export default {
  fetch(req, env, ctx) {
    initRuntimeEnv(env)     // first thing — Workers pass secrets here, not process.env
    return app.fetch(req, env, ctx)
  },
}

export const env = createEnv(
  z.object({ DATABASE_URL: z.string().url(), SENTRY_DSN: z.string().url().optional() }),
  { optionalFeatures: [["SENTRY_DSN", "error reporting"]] },
)
```

`createEnv` validates on **first property access**, not at import. Cloudflare runs
top-level module code during deploy validation with no secrets injected, so
eager validation fails the deploy of a working Worker. From app-a, which was the
only product that had hit this.

`getRuntimeEnv()` merges injected bindings over `process.env`, injected winning.
app-a's version short-circuited to `process.env` whenever Bun was present, which
silently discarded injected values when running a Worker locally under Bun.

## Middleware

```ts
app.use("*", requestId({ childLogger: (id) => logger.child({ reqId: id }) }))
app.use("*", secureHeaders({ relaxedPaths: ["/docs", "/openapi.json"] }))
app.use("*", corsMiddleware({ originEnvKeys: ["WEB_URL", "ADMIN_URL"] }))
app.use("/api/*", rateLimit({ max: 100, windowSeconds: 60 }))
app.use("/api/auth/login", rateLimit({
  scope: "login", max: 5, windowSeconds: 60,
  store: (c) => durableObjectStore(c.env.RATE_LIMIT),   // built per request: bindings live on c.env
  failOpen: false,                                      // a login limit is a security control
}))
```

### Rate limiting has a pluggable store, on purpose

The audit found two implementations with opposite tradeoffs. app-a used an
in-memory Map — fast, zero setup, but **per-isolate on Workers**, so the real
limit is `max × isolates`. app-c used D1 — correct across isolates, costs
a query.

Neither is wrong. `memoryStore()` (the default) is fine for smoothing general
API traffic. **A login limiter needs a durable store**, or an attacker just
spreads attempts across POPs.

**For an exact count on Workers, use the Durable Object store.** Cloudflare's
rate-limit binding is approximate too: app-b saw it allow 300 of 300
requests on workers.dev. `@dapplelight/signet-server/middleware/rate-limit-do` has a
`RateLimitCounter` class (one object per `scope:key`, so the count is exact) and
`durableObjectStore(namespace)`. Export the class from your worker entry and bind
it; the module's header has the wrangler config. Checked on workerd: 300
concurrent requests against `max: 100` gave exactly 100 allowed, 200 limited.

**A store failure fails open by default** — a limiter outage should not take the
API down. Only the store call is guarded, so a handler error is never retried or
mistaken for one. Set `failOpen: false` where the limit is the security control;
the request then gets a 503 `RATE_LIMIT_UNAVAILABLE`. `onStoreError` hears about
every failure either way.

A 429 carries `code: "RATE_LIMITED"` and the `requestId`, like every other error.

**Check the setup with `npx signet-doctor [dir]`.** The Durable Object needs a
binding and a migration in wrangler config and an export from the Worker entry —
three places no library can reach, each failing differently when wrong. The
doctor checks all three, that the code's `c.env.X` matches the binding, and that
the entry exports no plain values, and prints the snippet for each gap —
including swapping out hono-rate-limiter's `DurableObjectRateLimiter`. Exits 1
on a problem, so it fits in CI. `create-signet-app --template api` scaffolds a
Worker that passes it.

**Your own request-id middleware?** `errorHandler` and `rateLimit` read
`c.get("reqId")` by default; pass `getRequestId: (c) => ...` to either. Pass your
app's env type, `rateLimit<AppEnv>({...})`, for typed variables in `keyFor`,
`store` and `onStoreError`. `X-RateLimit-Reset` is epoch seconds (GitHub's
convention), not the IETF draft's seconds-from-now `RateLimit-Reset`.

**A dependency being down** is a deliberate error, not a crash: `throw new
ApiException(503, "Store unreachable", "STORE_UNAVAILABLE")`. `ApiException`
accepts 502, 503 and 504 for this, and does not go to `onError`.

`clientIp()` prefers `CF-Connecting-IP`, which the edge sets and a client cannot
spoof, and only falls back to `x-forwarded-for`, which a client *can*. Do not
reorder those.

429s use the same error envelope as everything else, so the client's `ApiError`
path handles them without a special case.

## Logging

```ts
import { createLogger, type Logger } from "@dapplelight/signet-server/observability/logger"
import { requestId } from "@dapplelight/signet-server/middleware/request-id"

export const log = createLogger({ level: "info", base: { service: "api" } })

const app = new Hono<{ Variables: { reqId: string; logger: Logger } }>()
app.use("*", requestId({ childLogger: (id) => log.child({ reqId: id }) }))
app.get("/x", (c) => {
  c.get("logger").info({ userId: "u1" }, "handled")
  return c.text("ok")
})
```

```json
{"level":"info","time":"2026-09-25T07:15:49.201Z","msg":"handled","service":"api","reqId":"9f3c…","userId":"u1"}
```

One JSON line per entry, written through `console`, with no dependencies. pino
is Node-flavoured: its pretty transport needs `worker_threads`, which is why
app-a deploys with `--external:pino-pretty --external:worker_threads`.

- **pino's call shapes**: `log.info({ ...fields }, "msg")`, `log.info("msg")`,
  `log.error(err, "msg")` (the error goes under `err`), and also
  `log.info("msg", { ...fields })`, app-b's. `trace` to `fatal`.
  printf interpolation (`%s`) is not supported.
- **Levels are live.** `log.level = cfEnv.LOG_LEVEL` takes a string and throws
  on an unknown one. A child follows its parent's level, including later
  changes, until given its own (`child.level = …` or `child(b, { level })`).
  `silent` writes nothing.
- **Secrets are redacted by default**, at any depth: in fields, child bindings,
  arrays, `Headers`, `Map`s and error properties. The keys are password,
  passwd, token, secret, authorization, cookie and apiKey. Matching ignores
  case, `_` and `-`, and takes suffixes, so `accessToken`, `x-api-key` and
  `set-cookie` are covered while `maxTokens` is not. `redact: ["email",
  "user.phone", "items.*.card"]` adds a key name (any depth) or a path from the
  top of the fields. Values become `"[redacted]"`. Strings are not scanned: a
  secret inside `msg` or an error message goes out as written.
- **Errors** anywhere in the fields become `{ name, message, stack, cause,
  ...own props }`. `production: true` drops `stack`.
- **It never throws on data.** Cycles become `"[Circular]"`, bigints become
  strings, functions are dropped. A throwing getter still yields the line, with
  a `logError` field saying why the fields are missing.
- **`write(line, level)`** defaults to `console.error` for error and fatal,
  `console.warn` for warn and `console.log` otherwise; Workers Logs takes
  severity from the console method. `messageKey` renames `msg`.
- **`redactFields(ctx)`** is the same cleaning on its own, for context sent
  elsewhere: `createSentry` scrubs error text but not context.
- It takes config and never reads env.

### Migrating app-a: yes, it can drop pino

`lib/logger.ts` (30 lines) becomes:

```ts
import { createLogger } from "@dapplelight/signet-server/observability/logger"
import { getRuntimeEnv } from "./runtime-env"

export const logger = createLogger({ level: getRuntimeEnv().LOG_LEVEL ?? "info" })
```

Every call site keeps working. They are all `(fields, msg)`, `(fields)` or
`(msg)`, and none uses `%s`. `index.ts`'s per-fetch `logger.level =
cfEnv.LOG_LEVEL` compiles as is, and `middleware/request-id.ts` does not change.
Remove `pino` and `pino-pretty` from `package.json`, and both `--external` flags
from `deploy:api`. `{ err: e }` still serialises the error.

If anything reads the logs, four things change on the wire: `level` is
`"info"`, not `30`; `time` is ISO, not epoch ms; there is no `pid` or
`hostname`; and the error has `name` where pino's serializer wrote `type`. The
loss is pino-pretty's coloured local output. A `write` for local dev covers most
of it:

```ts
write: isDev
  ? (line) => {
      const { level, time, msg, ...rest } = JSON.parse(line)
      console.log(`${time.slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${msg ?? ""}`, rest)
    }
  : undefined,
```

Unlike pino as app-a configured it, which had no `redact`, it redacts by default.

### Migrating app-b

Its call sites are `logger.info("event", fields)`, not pino's shape. That form
is supported, so they stay. `packages/observability/src/logger.ts` (43 lines)
becomes a shim that keeps the `event` key and writes every line to
`console.log`, because `index.test.ts` captures `console.log`, error lines
included:

```ts
import { createLogger as create, type Logger } from "@dapplelight/signet-server/observability/logger"
import type { RunContext } from "./context"

export type { Logger }
export { redactFields as redact } from "@dapplelight/signet-server/observability/logger"

export const createLogger = (context: RunContext, write = (line: string) => console.log(line)): Logger =>
  create({ base: context, messageKey: "event", write })
```

`context.ts` and `hono.ts` stay: the `req_` and `trace_` ids, the `traceparent`
parse and the request start and complete lines belong to it. Three things
change. The line has `time`, not `timestamp`. The censor is `"[redacted]"`, not
`"[REDACTED]"`, which is one assertion in `logger.test.ts`. And a sink now
receives the JSON line, so that test pushes `JSON.parse(line)`. Its old
redaction matched a secret word anywhere in a top-level key: `tokenCount` was
redacted and a nested `apiKey` was not. This one matches the suffix at any
depth. It gains level filtering and error serialisation, so `request.failed`
can log the error itself instead of `error.message`.

## Notifications and reporting

```ts
import { createEmailer } from "@dapplelight/signet-server/notify/email"
import { createTelegram } from "@dapplelight/signet-server/notify/telegram"
import { createPusher } from "@dapplelight/signet-server/notify/push"
import { createSentry } from "@dapplelight/signet-server/observability/sentry"
```

All plain `fetch` — they run on Workers, where the official Sentry SDK does not.
All return `false` rather than throwing: a failed notification must not fail the
request that triggered it.

**`createPusher` prunes dead subscriptions.** A push endpoint returning 404 or
410 is permanently gone, and one that is never pruned is retried on every future
notification forever. A transient 500 is *not* pruned. VAPID signing is injected
rather than implemented, because `web-push` is Node-only and would make this
module unusable on Workers.

**`createTelegram` is operator-level only.** The chat is a single owned channel,
so no user or household data belongs in it — amounts, names, account
identifiers. Use push for per-user messages. That warning is carried from
app-a, where it was the reason the two were separate functions.

`createSentry` takes configuration rather than reading a module-level env
singleton, which is what made app-a's version untestable and non-portable.

**Error text is scrubbed before it leaves.** Messages and stacks routinely
carry credentials and personal data — a failed query with an email in it, a URL
with a token. `redactSecrets` runs over both by default (bearer tokens, JWTs,
`password=`/`token:`-style secrets, emails, 9+ digit runs). Pass `scrub` to
extend it, `includeStack: false` to drop stacks, and `beforeSend` to allowlist
context or drop an event (`return null`). Context values are not scrubbed —
pass only what you mean to send.

**`captureException` returns its request — keep it alive on Workers.** It
resolves to whether Sentry accepted the event and never rejects. A Worker's
isolate is frozen once the response is sent, so an unawaited report is cut off
mid-flight; pass it to `ctx.waitUntil`. `errorHandler` does this for you when
`onError` returns the promise, as in the example above. Do not sleep instead.

```ts
c.executionCtx.waitUntil(sentry.captureException(err, { job: "sync" }))
```

### Not lifted

`scheduled.ts` is a map from cron expressions to app-a's own task names
(`zerodha-sync`, `monthly-reports`). The pattern is trivial and the content is
entirely product-specific, so there is nothing general to share.

## OAuth 2.1 resource server

For making a product **agent-reachable**: an MCP server, or any API an agent
calls holding a token someone else issued. This is the opposite side from
`auth/` — that logs users in; this accepts tokens minted elsewhere.

```ts
import { createTokenVerifier } from "@dapplelight/signet-server/oauth-rs"
import { registerProtectedResourceMetadata, requireToken, requireScopes }
  from "@dapplelight/signet-server/oauth-rs/hono"

const RESOURCE = "https://mcp.example.com"
const META = `${RESOURCE}/.well-known/oauth-protected-resource`

registerProtectedResourceMetadata(app, {
  resource: RESOURCE,
  authorizationServers: ["https://auth.example.com"],
  scopesSupported: ["read", "write"],
})

const verifier = createTokenVerifier({
  issuer: "https://auth.example.com",
  audience: RESOURCE,          // REQUIRED — see below
  jwksUri: "https://auth.example.com/.well-known/jwks.json",
})

app.use("/mcp/*", requireToken({ verifier, resourceMetadataUrl: META }))
app.post("/mcp/orders", requireScopes(META, "write"), handler)
```

### The audience check is the whole point

`audience` is required, not optional. A token signed by the correct issuer but
minted for a **different** resource passes signature and expiry checks and looks
entirely valid. Omit the `aud` check and you have an open door that passes every
test you are likely to write — any token from that issuer, for any service, is
accepted.

RFC 8707 exists for this. The test suite mints a real token for a different
audience and asserts rejection, because a positive test cannot catch this.

### What else is enforced

- **Algorithm allow-list.** `none` and symmetric algorithms are rejected before
  key selection — the classic alg-confusion bypass. Asserted for both.
- **Issuer, expiry, not-before, subject**, with configurable clock skew.
- **Scope step-up.** A 403 carries `WWW-Authenticate` naming the scope required,
  so a client can request a new token instead of just failing.
- **Key rotation.** An unknown `kid` triggers a refetch, rate-limited to once a
  minute. That is a deliberate tradeoff and both halves are tested: 20 bogus
  `kid`s cause at most one fetch, and a rotated key is picked up once the
  cooldown passes. A rotation can therefore fail for up to a minute; lower
  `minRefetchSeconds` if that matters more than the flood guard.
- **The raw token never reaches the context.** Only claims are set, so
  forwarding a client's token to a provider is harder to do by accident.

### Not included

Token introspection (RFC 7662) for opaque tokens — this verifies JWTs locally.
Dynamic client registration. Being an authorization server; this is only the
resource side.

## MCP servers

`@dapplelight/signet-server/mcp` and `/mcp/hono`: typed tools on the official MCP
TypeScript SDK **v2** (`@modelcontextprotocol/server` `^2.1`), served over
streamable HTTP from a Hono route or over stdio. One endpoint serves both
protocol eras, per request:

- **2026-07-28**, the stateless revision: no `initialize` and no
  `Mcp-Session-Id`; each request carries its version, client info and
  capabilities in `_meta`; `server/discover` replaces the handshake; results
  carry `resultType`; `Mcp-Method` / `Mcp-Name` headers are required.
- **2025-era** clients (up to 2025-11-25), through the SDK's stateless legacy
  fallback: `initialize` and every other request answered by a fresh server.

The SDK does all of that; Signet adds typed tools, the error envelope, scope
checks and the per-request Hono context. `@modelcontextprotocol/server` and
`zod` (`>=4.2`) are optional peers; `hono` is one for `/mcp/hono` only. `/mcp`
imports hono for types alone and recognises an `HTTPException` (or
`ApiException`) by shape, so a stdio server built with `createMcpServer` loads
without hono installed.

```ts
import { ApiException } from "@dapplelight/signet-server/http"
import { defineTool } from "@dapplelight/signet-server/mcp"
import { mountMcp } from "@dapplelight/signet-server/mcp/hono"
import { registerProtectedResourceMetadata, requireToken } from "@dapplelight/signet-server/oauth-rs/hono"

const RESOURCE = "https://api.example.com/mcp"
const META = "https://api.example.com/.well-known/oauth-protected-resource"

// Module scope: defined once, shared by every request.
const tools = [
  defineTool({
    name: "get_order",
    description: "Read back an order by id.",
    input: z.object({ id: z.string().uuid(), expand: z.boolean().default(false) }),
    scopes: ["orders:read"],                            // checked against the verified token
    annotations: { readOnlyHint: true },
    handler: async ({ id, expand }, { token, c }) => {  // typed from the schema
      const order = await ordersFor(c!.env).get(id, token!.claims.sub)
      if (!order) throw new ApiException(404, "Order not found", "ORDER_NOT_FOUND")
      return expand ? order : { id: order.id, status: order.status }  // sent as JSON text
    },
  }),
]

registerProtectedResourceMetadata(app, {
  resource: RESOURCE,
  authorizationServers: ["https://auth.example.com"],
})
mountMcp(app, "/mcp", {
  name: "orders",
  version: "1.0.0",
  tools,
  middleware: [requireToken({ verifier, resourceMetadataUrl: META })],  // verifier as above
  onError: (err, { tool }) => sentry.captureException(err, { tool }),
})
```

**Typed output.** Give a tool `output: z.object(...)` beside `input` and it is
advertised as `outputSchema`; the handler must then return `z.input` of it (or a
promise of it, or a `toolResult`), which is sent as `structuredContent` plus the
same JSON as a text block for older clients. The SDK validates it against the
schema and answers a mismatch, or a `toolResult` without `structuredContent`, with
an `Output validation error` result; error results are exempt. `title` and
`annotations` are forwarded too, and tools list in the order of the array.

**Unlisted tools.** `listed: false` keeps a tool callable, with scopes, input
validation and error mapping unchanged, but leaves it out of `tools/list`. Use it
for deprecated aliases that old clients still call. The SDK's `disable()` does not
work for this, because it also refuses the call. Signet filters the SDK's own
list, so the listed tools, their order, and the 2026-07-28 `resultType`,
`ttlMs` and `cacheScope` fields are unchanged.

**Resources and prompts.** `createMcpServer({ tools, resources, prompts })`
takes both, with the same `scopes`, `mapError` and `onError` as tools:

```ts
import { definePrompt, defineResource } from "@dapplelight/signet-server/mcp"

const resources = [
  defineResource({ name: "categories", uri: "app://categories", read: () => api.categories() }),
  defineResource({
    name: "transaction",
    template: "app://transactions/{id}",
    scopes: ["finance:read"],
    read: ({ variables }) => api.transaction(variables.id), // null means not found
  }),
]
const prompts = [
  definePrompt({
    name: "monthly_review",
    args: z.object({ month: z.string() }), // prompt arguments are strings
    render: ({ month }) => `Review ${month}. Call \`get_report\` first.`,
  }),
]
```

- `read` returns an object (JSON), a string (text/plain), bytes (a blob),
  `resourceResult(...)` for an exact result, or null for not found. `mimeType`
  overrides the type. A template's optional `list` adds its instances to
  resources/list; without the scope, it lists nothing.
- `render` returns a string (one user message), a list of strings and
  messages, or a whole `GetPromptResult`.
- A failed read or render is a JSON-RPC error, since the protocol has no error
  result for these: `CODE: message`, with the envelope in `data`. It uses -32603
  for a 5xx and -32602 otherwise, and "Internal error" with no data for anything
  unexpected. `onError` hears the last case with `meta.kind` set to "resource"
  or "prompt". `errorResult` is for tools only.
- The resources and prompts capabilities are declared only when there are
  some, with `listChanged: false`, like tools.

**Confirm before a destructive action, and report progress.** Plain
functions a handler calls with its `ToolContext` — no new registration shape:

```ts
import { confirm, isConfirmPending, progress } from "@dapplelight/signet-server/mcp"

createMcpServer({
  name, version, tools,
  confirm: { key: process.env.CONFIRM_KEY }, // >= 32 bytes; binds the answer to the args below
})

// in a tool's handler:
handler: async (input, ctx) => {
  const ok = await confirm(ctx, { message: `Delete ${input.count} transactions?`, args: input })
  if (isConfirmPending(ok)) return ok // ask, then retry on the client's answer
  if (ok === "unsupported") {
    if (!input.confirmDeleteAll) return "Pass confirmDeleteAll to delete without asking."
  } else if (ok !== "confirmed") {
    return "Cancelled."
  }
  for (let i = 0; i < input.count; i++) {
    await deleteOne(i)
    await progress(ctx, i + 1, input.count) // no-op if the caller sent no progressToken
  }
  return "Deleted."
}
```

`confirm` is built on the SDK's multi-round-trip input (`inputRequired`), not
a new mechanism, and resolves to one of three outcomes:

- `"unsupported"` — the client declared no elicitation capability. `confirm`
  never asks it (that would only hang or error); fall back to the tool's own
  pre-confirmation flag or a dry-run step, the way a client with no
  multi-round-trip support has always been handled.
- `"declined"` — a no, a cancel, or (see below) an accepted answer that no
  longer matches what was asked about.
- `"confirmed"` — only this means run the action.

With `createMcpServer`'s `confirm.key` configured and `args` passed to
`confirm`, the accepted answer is cryptographically bound (the SDK's
`createRequestStateCodec`, HMAC-SHA256, fail-closed) to a fingerprint of
those exact arguments: a client that gets "yes" for one call and replays
that answer against a different one — Codex flagged this forgeability
concern in an app's own hand-rolled version — reads as `"declined"`, not
`"confirmed"`. Without a key, `confirm` still asks and still resolves to all
three outcomes, but cannot detect that swap.

`progress` sends the spec's `notifications/progress`, once per call, and
never throws (a client that dropped the connection mid-import must not fail
the import).

`mountMcp` routes GET, POST and DELETE through the middleware, in order, to
`mcpHandler`, so auth runs before MCP does and an unauthenticated GET is a 401,
not a 405. Use `mcpHandler(options)` directly to place it yourself, or pass
`server: (c, { era }) => McpServer` instead of `tools` to build the server in
full (subscriptions, completions, anything the kit does not wrap) — a new one per
call.

`http` is passed to the SDK's `createMcpHandler`: `legacy: "reject"` makes the
endpoint 2026-07-28 only (a 2025 client gets `-32022`), `responseMode: "sse"`
always streams, and `maxRequestBodySize` / `keepAliveMs` / `onerror` are the
SDK's.

### stdio

app-a's server is stdio. The same tools, through the SDK's `serveStdio`, which
also serves both eras — the connection's first message picks one:

```ts
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { createMcpServer } from "@dapplelight/signet-server/mcp"

serveStdio(() => createMcpServer({ name: "app-a", version: "1.0.0", tools, errorResult, onError }))
```

A stdio tool gets no `c` and no `token`; a scoped tool is refused there. The
factory is called once per connection (and once more for a `server/discover`
probe that the client then abandons for `initialize`), so keep it cheap —
building from a module-scope `tools` array is.

### A handler per request, never shared

A Hono route gets a fresh `createMcpHandler` and a fresh McpServer for every
request, built by a factory that closes over that request's `c` and verified
token. That is what app-b settled on for Workers, where one isolate
serves many users, and it is the only way to reach `c` from a tool: the SDK's
factory sees the raw `Request` alone, and on the legacy leg a clone of it. The
**tools** are the shared part, and each handler gets its request through
`ctx`: `c` (bindings, variables), `token` (claims from `requireToken`, never the
raw token), `signal`, and `mcp`, the SDK's own handler context
(`mcp.mcpReq.envelope` for the 2026 per-request client info,
`mcp.mcpReq.inputResponses`, `mcp.http?.req`). Building the handler and a server
from 120 tools and listing them takes about 4 ms (the tests print it).

The SDK now answers what the kit used to hand-roll: GET and DELETE (2025
session operations) get its 405, `server/discover` and the 2026 header checks
are its own, and a 2026 POST without `Mcp-Method`, or with an `Mcp-Name` that
disagrees with the body, is refused before a tool runs.

The tool list is advertised as fixed (`tools: { listChanged: false }`), so a
2026 client opens no `subscriptions/listen` stream waiting for a change that
cannot come — and a Worker is not billed for holding one open.

**Response shape.** A 2026 request is answered with one JSON body unless a tool
sends progress first (`responseMode: "auto"`). A 2025 request is answered as a
short SSE stream that closes after the result: that is the SDK's stateless
fallback, and unlike 0.1.x there is no JSON-only mode for it.

**Not `@modelcontextprotocol/hono`.** Its `createMcpHonoApp` builds an app of
its own rather than a route on yours, and its Host/Origin validators — DNS
rebinding protection, which matters for a server bound to localhost, not a
public Worker — wrap helpers `@modelcontextprotocol/server` already exports.
If a local server needs them, put `hostHeaderValidation(...)` from that package
in `middleware`.

### Errors

A handler throws; the client gets an MCP error result (`isError: true`), with
`CODE: message` as text and the Signet envelope as `structuredContent`:

| Thrown | Result |
|---|---|
| `ApiException(404, "Order not found", "ORDER_NOT_FOUND")` | its code, message and `details` |
| Hono `HTTPException` (by shape: a numeric `status` and `getResponse()`, or the name) | code from the status, as `errorHandler` does |
| a `ZodError` (by shape, any copy of zod) | `VALIDATION_FAILED` with `fieldErrors` |
| your own type | whatever `mapError` returns for it; undefined falls through |
| anything else | `INTERNAL_ERROR: Internal error`, and the error goes to `onError` |

An unknown error's message never reaches the client, in any environment: the
SDK's own fallback sends `error.message` verbatim, connection strings included.
A missing scope is `insufficient_scope`, naming the scope, and a scoped tool
called with no token is refused, not allowed. `onError`'s promise goes to
`waitUntil`, as with `errorHandler`. The results are the same in both eras.

**Bad input never reaches a handler.** The SDK validates arguments against the
schema first and answers with its own error result, text starting `Input
validation error:` and naming the field. That result has no `code`: the SDK's
validation is private and runs before any hook. **An unknown tool** is a
JSON-RPC `-32602` error in SDK v2, not an `isError` result as in v1.

A proxy to an API built on `@dapplelight/signet-lib/api` passes the upstream code
through:

```ts
mapError: (e) => (e instanceof ApiError ? { code: e.code ?? "HTTP_ERROR", message: e.message } : undefined)
```

**Keeping an existing error shape.** An app moving onto `createMcpServer` whose
clients (or the LLM) already read its error text can build the whole result
with `errorResult(err, { tool })`. It runs first, before `mapError` and the
table above; a returned result is sent as-is, undefined falls through to them.
app-a keeps its plain `{ content: [{ type: "text", text: err.message }], isError: true }`:

```ts
errorResult: (err) =>
  toolResult({ isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] }),
```

The result is byte-identical, in both eras, to what the SDK sends for that
object returned from a raw `registerTool` callback. It sends every message
verbatim, including the unexpected ones the default would hide, so only use it
where that is already the case. Reporting does not change: `onError` still gets
exactly the errors that would otherwise have been `Internal error` (not claimed
by `mapError` or the defaults), whether or not `errorResult` answered them. An
`errorResult` that throws counts as undefined. It never sees a missing scope or
the SDK's input validation; those keep their own results.

### Why `defineTool` and not `server.registerTool`

In SDK v1, `registerTool` was generic over the zod shape through its v3/v4
compat types, and app-a's `tsc` ran out of memory on it at ~80 tools — so app-a
typed its server as a local interface with `handler: (args: any)` and
`@ts-nocheck` on the wiring, giving up the typed input its schemas existed for.
v2's `registerTool` is generic over Standard Schema instead and is cheap: on
TypeScript 7 and zod 4.6, calling it directly for the fixture's 120 tools
checks in 0.04 s (68k instantiations), against 0.08 s for the fixture through
`defineTool`. `defineTool` stays for what it gives beyond that: one array type
for tools with different schemas, so a module-scope `tools` list can be shared
by the HTTP route and stdio, and handlers typed as `z.output` of the tool's
own schema. `createMcpServer` registers through an erased signature, so the
SDK's generic is never instantiated whatever its types do next.

`input` must be a `z.object(...)`; omit it for a tool with no arguments (the
SDK then calls back with `ctx` alone; `createMcpServer` still hands the handler
`{}` and a `ToolContext`). A handler's return value is sent as one text block,
a string as-is and anything else as JSON; return `toolResult({...})` to send an
exact `CallToolResult`. The SDK adds `resultType` on 2026-07-28 results.

**Multi round-trip.** A handler may `return inputRequired({...})` (from
`@modelcontextprotocol/server`) to ask the client for input; it passes through
untouched, the client answers, and the retried call reads the answer from
`ctx.mcp.mcpReq.inputResponses` (the tests do this with a 2026 client over
HTTP). For 2025 clients the SDK's legacy shim turns it into real
server-to-client requests, which needs a connection: over stdio it works, but
over stateless HTTP the SDK documents a clean capability refusal instead.
Signet's tests do not cover the 2025 paths.

### zod: one copy, 4.2 or later

The SDK converts each tool's schema to JSON Schema through the schema's own
`~standard.jsonSchema`, which zod has from 4.2. app-a hit a crash in the
converter, `ctx.deferred.push`, when the app and the SDK resolved different zod
copies: keep a single zod 4 (`>=4.2`) in the tree — `bun why zod` / `npm ls zod`
should show one version — and author tool schemas with it. The peer range is
`>=4.2.0` for that reason.

### Migrating from 0.1.x

0.2.0 is breaking for MCP users only; nothing else in signet-server changed.

- **Dependencies.** Replace `@modelcontextprotocol/sdk` with
  `@modelcontextprotocol/server@^2.1`, and bump zod to `>=4.2` (see above).
  Imports of the SDK in your own code move to v2 (the SDK ships a codemod:
  `npx @modelcontextprotocol/codemod@latest v1-to-v2`). A `server:` factory must
  return a v2 `McpServer`.
- **`mountMcp` / `mcpHandler`.** `json` and `transport` are gone; `http` takes
  the SDK's `createMcpHandler` options instead. A `server:` factory gets a
  second argument, `{ era, requestInfo }`.
- **stdio.** `server.connect(new StdioServerTransport())` still works but
  speaks 2025 only; `serveStdio(() => createMcpServer(...))` serves both eras.
- **Behaviour.** An unknown tool is now a `-32602` JSON-RPC error. 2025 clients
  get SSE responses rather than JSON. GET and DELETE still get a 405, now the
  SDK's (without an `Allow` header). `ToolContext` gains `mcp`.
