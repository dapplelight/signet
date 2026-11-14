# Changelog

Packages are versioned independently (see PUBLISHING.md). Every entry below is
a package at the version it had when the repository was opened to the public.

## Unreleased

### signet-db 0.1.0 (new, private: not published yet)

- New `@dapplelight/signet-db`: Drizzle helpers with a driver-free core and
  thin `createDb` entry points for Cloudflare D1 (`./d1`), bun:sqlite
  (`./sqlite`) and postgres-js (`./postgres`); `fromDrizzle` for any other driver.
- Columns for SQLite and Postgres (`./columns/sqlite`, `./columns/pg`): `id()`
  (sortable, time-ordered), `timestamps()`, `softDelete()`, `money()`
  (integer minor units + currency), `encrypted()`, and an `auditLog()` table.
- `scoped(db, { userId })`: every read, update and delete filtered to the
  user, inserts owned by them, soft-deleted rows hidden unless `withDeleted`.
- `audited()`: who (`{ type: "user" | "agent" | "system", id }`), what, when,
  before and after for each changed row.
- `createCipher`: AES-GCM field encryption with key ids, rotation and
  fail-closed reads (reuses `@dapplelight/signet-lib/crypto`).
- Money helpers that refuse floats and mixed currencies, with exact formatting.
- `exportUser` / `deleteUser` (atomic, audited), `seed()` (deterministic,
  Indian names, +91 numbers, PIN codes), `describeSchema()`, `defineQuery()`.
- `signet-db-check` CLI and `checkMigrationSql`: flags table/column drops,
  renames and NOT NULL without a default; exits non-zero for CI.
- Errors are `SignetDbError` with a stable `code`.
- `./zod`: `toZod(table, { mode: "insert" | "update" | "select" })`, Zod
  schemas generated from the columns (no drizzle-zod), usable with
  signet-server's `parseBody`.
- Transactional outbox: `outbox()` table, `enqueue` inside `db.batch` or a
  transaction, `drainOutbox(db, queue)` with leases, attempt counts, backoff
  and dead rows; `pruneOutbox`.
- Idempotency keys: `idempotencyKeys()` table, `withIdempotency(db, key,
  scope, fn)` that replays stored results and rejects in-flight duplicates;
  `pruneIdempotency`.
- `./agent`: `agentTools(db, { tables, userId, allowWrites, maxRows })`,
  list/get/search (and opt-in insert/update with `dryRun`) tools for AI
  agents, always user-scoped, soft-deleted rows hidden, encrypted fields
  excluded unless opted in, row cap enforced; shaped for signet-server's MCP
  server. `describeSchema(tables, { format: "json" })` adds a JSON form with
  relations. `packages/db/AGENTS.md` is the guide for agents.
- Tests run on bun:sqlite, a D1 stand-in and PGlite always, and on a real
  Postgres server when `SIGNET_TEST_PG_URL` is set.

### signet-server: portability adapters

- New `@dapplelight/signet-server/adapters` with `KeyValue`, `Queue<T>`,
  `BlobStore` and `Defer` interfaces, plus `memoryKv`, `memoryQueue`,
  `processDefer`, `waitUntilDefer` and `kvRateLimitStore` (exact over a store
  with atomic `incr`, approximate without).
- `./adapters/node`: `fsBlobStore(dir)`, path-traversal safe.
- `./adapters/cloudflare`: `cloudflareKv`, `r2BlobStore`.
- `./adapters/upstash`: `upstashKv` (atomic `incr` via MULTI/EXEC),
  `upstashRateLimitStore`, `qstashQueue`.
- `./adapters/supabase`: `supabaseBlobStore` with signed download and upload URLs.
- No Netlify Blobs adapter: Netlify documents Blobs only through its SDK, not as
  an HTTP API. `waitUntilDefer(context)` covers Netlify background work.
- No new dependencies; every adapter is fetch or a structural binding type.

### signet-ai

- `kvCache(kv)`: the `Cache` interface over a shared key-value store.
- `kvBudgetStore` also accepts a `KeyValueLike` (`set` with `ttlSeconds`), so an
  Upstash store fits as well as a raw Workers KV namespace.

### create-signet-app

- The api template runs off Cloudflare too: `src/server.ts` serves the same app
  with `Bun.serve` (`bun run start`), and a `Dockerfile` on `oven/bun` runs it.
  The app moved to `src/app.ts`; `src/index.ts` is the Worker entry.

### signet-server 0.4.0

- **Breaking:** `clientIp(c, trust)` and `rateLimit({ trust })` take a trust
  setting: `"cloudflare"`, `{ forwardedHops: n }` or `"none"`. The old
  `clientIp` read `cf-connecting-ip` first and fell back to `x-forwarded-for`,
  so off Cloudflare a client could set `cf-connecting-ip` and pick its own
  bucket. Now `cf-connecting-ip` is read only under `"cloudflare"`;
  `forwardedHops: n` takes the n-th `x-forwarded-for` entry from the right.
  **Migration:** on Cloudflare pass `trust: "cloudflare"`; behind `n` proxies
  of your own pass `trust: { forwardedHops: n }`. `rateLimit` throws at
  construction when neither `trust` nor `keyFor` is given, rather than quietly
  putting all clients in one bucket; `trust: "none"` is the explicit opt-in to
  that. Custom `keyFor` is unaffected.
- **Breaking:** `clientIp` returns `string | null`, never `"unknown"`. A missing
  IP gets the key `no-ip` inside the limiter's own scope instead of a bucket
  shared by every limiter.
- IPv6 clients are keyed by their /64 (`2001:db8:0:1::/64`); IPv4-mapped addresses (`::ffff:1.2.3.4`) are keyed as the plain IPv4.
- The `memoryStore` doc said sliding window; it is a fixed window.

### signet-server 0.4.0

- New `csrfMiddleware` at `@dapplelight/signet-server/middleware/csrf`: Hono's
  `csrf()` (Origin + Sec-Fetch-Site) with origins from the same env keys as
  `corsMiddleware`, bearer-token requests skipped, and a 403 `FORBIDDEN` envelope.
  `corsMiddleware` now shares `allowedOrigins()` with it. The create-signet-app
  API template enables it on `/api/*`; existing apps need no migration, and apps
  with `sameSite: "none"` cookies should add it.

### signet-server 0.4.0 (web push)

- New `webCryptoPushSender` at `@dapplelight/signet-server/notify/push`: a
  `PushSender` for Workers that signs VAPID (ES256 JWT, RFC 8292) and encrypts
  the payload with aes128gcm (RFC 8291) on Web Crypto only, with no Node APIs
  and no new dependency. Pass it as `createPusher({ send })`. Also exported:
  `encryptAes128gcm`, `vapidJwt`. Tested against the RFC 8291 test vector.
  Not breaking: injecting your own sender (for example `web-push` on Node)
  still works.

### signet-server 0.4.0

- `createSentry` posts to the envelope endpoint (`/api/<project>/envelope/`),
  not the deprecated Store API, so it keeps working when Sentry retires it.
  **Breaking for `beforeSend` and tests:** the stack is no longer
  `event.extra.stacktrace` (a string); it is `exception.values[0].stacktrace.frames`
  (parsed, oldest first). Read frames there, and parse the request body as an
  envelope (three newline-separated JSON lines) if you stub `fetch`.
- `captureException(err, context, scope)`: `scope` carries `tags`, `request`
  (headers named like `key|token|secret|auth|cookie|session|password` dropped,
  other header values scrubbed) and `user`; `createSentry({ tags })` adds tags to
  every event. `parseStack` is exported.

### signet-lib 0.3.0

- create-signet-app 0.3.0: new apps depend on signet-server ^0.4.0 and signet-lib ^0.3.0; the API template turns on `csrfMiddleware` and passes `trust: "cloudflare"` to `rateLimit`.

- The date formatters take `{ timeZone }`. Date-only strings are not shifted.
- Currency formatters use each currency's own fraction digits when `exact`:
  JPY 0, KWD and BHD 3. **Behaviour change:** `exact` was always 2 decimals, so
  JPY and KWD output differs; USD and INR are unchanged.
- `Amount` accepts `bigint`; `{ minorUnits: true }` reads integer minor units
  (exact for a bigint). Migration: none for existing calls.
- Compact currency treats `or` (Odia) and `as` (Assamese) locales as lakh/crore.

### signet-ai 0.3.1

- Accepts signet-lib 0.3 as a peer (`^0.2.0 || ^0.3.0`).

### signet-ai 0.3.0

- **Breaking:** the budget ledger is async and takes a `BudgetStore`:
  `createBudgetLedger(windowUsd, windowSeconds, { store, perKeyUsd })`. Await
  `spentUsd`, `remainingUsd`, `canSpend` and `record`. `reset()` is gone.
- New stores: `durableObjectBudgetStore` + `BudgetCounter` at
  `@dapplelight/signet-ai/budget-do` (exact, global) and `kvBudgetStore`
  (approximate). The default `memoryBudgetStore` is per isolate, as before.
- **Breaking:** with a ledger, `createExtractor` throws `AI_UNPRICED_PROVIDER`
  when a provider has no `pricing`; pass `allowUnpriced: true` to opt out.
  Unpriced providers used to count as $0, so the cap never filled.
- **Breaking:** the ledger is checked on every call. It used to be checked only
  when the call passed `budget.windowUsd`; `windowUsd` and `windowSeconds` are
  removed from `BudgetOptions` (the ledger owns the window).
- `budget.key` charges a call to a per-user or per-key cap (`perKeyUsd`).
- `Pricing` fields are optional and add `perCallUsd`, for flat-rate providers.
  `workersAiProvider` takes an optional `pricing`.

- Open-source preparation: MIT license, package metadata, README,
  CONTRIBUTING, and the move to the `@dapplelight` npm scope (was `@nimit9`).
- **Breaking (server):** `betterAuthDefaults` now defaults `crossOrigin` to false
  (SameSite=Lax). Apps whose frontend and API are on different origins pass
  `crossOrigin: true`.
- **Breaking (server):** `corsMiddleware` allows the localhost dev origins only
  when `APP_ENV` (or `NODE_ENV`) is `local`, `development` or `test`.
- **Breaking (ui):** `Markdown` and `markdownToc` prefix heading ids with
  `user-content-` by default. Pass `idPrefix=""` for the old ids.
- **Breaking (server):** session secrets shorter than 32 characters now throw.
- `hashPasscode` stores `iterations:salt:hash`; old `salt:hash` values still verify.
- `timingSafeEqual` no longer reveals the expected value's length.
- `secureHeaders`: `relaxedPaths` cover sub-paths; adds COOP `same-origin` and
  CORP `same-site`.
- **Breaking (lib):** the API client throws `ApiError` on a 2xx with a non-empty,
  non-JSON body (use `raw()` for binaries); `+json` types such as
  `application/problem+json` are parsed. `Headers` objects passed as headers are
  kept. A 401 keeps the server's message and code on `AuthError`, and
  `onAuthError` receives the error.
- oauth-rs: P-384 keys without `alg` work; stale keys are kept when a JWKS
  refresh fails; JWKS fetch times out after 5 s; the header `alg` must match the
  selected key; bad base64 signatures are `TokenError`; `requireAtJwt` option.
- `parseQuery`: a repeated key becomes an array. Validation errors no longer use
  the deprecated `flatten()`.
- tokens: text, status and button colours meet WCAG AA (4.5:1) in editorial and
  cinematic, light and dark; input borders are visible; focus ring at full
  strength; 8px scrollbars; `tw-animate-css` ships so the overlay animations
  run; motion is off under `prefers-reduced-motion`. `test/contrast.ts` checks
  every theme.

### signet-lib 0.3.0 and signet-server 0.4.0: Content-Type, `qs` arrays, nested validation paths

- lib: the API client sends `Content-Type: application/json` only when a body is
  sent. A GET or body-less DELETE no longer makes a cross-origin preflight.
  Headers you set still win.
- lib: `qs({ tag: ["a", "b"] })` gives `?tag=a&tag=b`, which `parseQuery` reads
  back as an array. Null, undefined and empty items are skipped; an empty array
  adds nothing. A one-item array gives `?tag=a`, which `parseQuery` reads as the
  string `"a"`, because a URL cannot tell the two apart. A route whose schema is
  a bare `z.array(z.string())` then answers 400 VALIDATION_FAILED. Migration:
  wrap a lone string in the schema,
  `z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string()))`.
- **Breaking (server):** `parseBody`, `parseQuery` and `parseParams` key
  `fieldErrors` by the full dotted path (`address.city`, `guests.2.name`), not
  by the first segment. Top-level keys (`email`) are unchanged. Migration: a
  client that read `fieldErrors.address` for a nested object now reads
  `fieldErrors["address.city"]`. `signet-lib/form` `applyServerErrors` already
  matches the new keys, turning `guests.2.name` into TanStack's `guests[2].name`.

- npm pages: every package lists homepage, repository, issues and keywords; `ui` and
  `tokens` get their own README; `create-signet-app` runs from npm (`bunx`).
- Docs site at https://signet.dapplelight.in; package homepages point there.

## Current versions

| Package | Version |
|---|---|
| `@dapplelight/signet-ai` | 0.3.1 |
| `@dapplelight/signet-config` | 0.2.2 |
| `@dapplelight/signet-lib` | 0.3.0 |
| `@dapplelight/signet-server` | 0.4.0 |
| `@dapplelight/signet-tokens` | 0.2.2 |
| `@dapplelight/signet-ui` | 0.2.2 |
| `create-signet-app` | 0.3.0 |
