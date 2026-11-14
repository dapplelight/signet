# Changelog

Packages are versioned independently (see PUBLISHING.md). Every entry below is
a package at the version it had when the repository was opened to the public.

## Unreleased

### signet-ai: AI SDK 7, usage hook, tool loops, streaming, embeddings, grounding

- **Breaking peer:** `ai` is now `>=7.0.0` (was `>=5`). `aiSdkProvider` calls
  `generateText` with `output: Output.object({ schema })` instead of the
  deprecated `generateObject`; its behaviour and `meta` are unchanged.
- `onUsage` on `createExtractor`: tokens and cost of every provider call that
  returned, with the budget key for per-user cost. `analyticsUsage(sink)` turns
  any `AnalyticsSink` into an `onUsage`. A throwing hook or rejecting sink is
  ignored. `UsageReport`, `OnUsage` and `reportUsage` are on the barrel.
- New `./chat`: `runTools` (multi-step tool calling with `maxSteps`, default 5,
  and a `capped` flag) and `streamChat` (UI message stream `Response` from
  `useChat` messages, usage sent as message metadata).
- New `./react`: `useSignetChat`, `useChat` from `@ai-sdk/react` pointed at a
  `streamChat` route, plus the conversation's summed `usage`; `sumUsage`.
  `@ai-sdk/react` is a new optional peer.
- New `./ground`: `embedDocuments`, `searchDocuments` (cosine similarity, `topK`,
  `minScore`) and `groundedAnswer`, which answers from app-provided documents
  and keeps only citations whose quote appears verbatim in the cited document.
- Tests drive every helper through the SDK's mock models (`ai/test`).

### signet-server: auth backend (sessions, key rotation, phone OTP, API keys)

- New `./auth/sessions`: opt-in stored sessions. `SessionStore` (create, get,
  touch, list by user, revoke, revoke all with an optional exception) and
  `kvSessionStore` over any `KeyValue` (memory, Workers KV, Upstash).
  `startSession` always mints a new id and revokes the incoming one (no
  fixation); `rotateSession` for privilege changes; `validateSession` checks the
  store; `cachedSessionStore` is an opt-in read cache; `deviceLabel` parses a
  user agent without a dependency.
- Signing-key rotation: `SessionOptions.previousSecrets`. `checkSession` returns
  the payload and a copy re-signed with the current key; `requireSession` sends
  it back. `issueSession` takes an optional `sid`; `sessionCookie` an optional
  max age; `hmacSha256` is exported. `verifySession` now refuses tokens that
  carry `sid` (stored sessions), and tokens with extra `.` segments.
- `./auth/hono`: `requireStoredSession`, `sessionRoutes` (list my sessions,
  revoke one, sign out everywhere else) and `requireApiKey`.
- New `./auth/otp`: `requestPhoneOtp` / `verifyPhoneOtp` with hashed codes,
  expiry, an attempt cap, single use and per-phone and per-IP limits through a
  `RateLimitStore`, plus a per-IP cap on verifies (`verifyFailuresPerIp`);
  `SmsSender` with `devSmsSender` only; `normalizePhone`
  (Indian national forms and E.164).
- New `./auth/api-keys`: `createApiKey` (secret shown once), `listApiKeys`,
  `revokeApiKey`, `verifyApiKey`, `kvApiKeyStore`; scopes, optional expiry,
  hash-only storage, cheap `lastUsedAt`.
- New `./auth/mcp`: `authTools` with `list_my_sessions`, `revoke_session`,
  `list_api_keys`, `revoke_api_key`; revokes go through `requireApproval`.

### signet-lib: error codes for phone codes

- `ERROR_CODES` and `DEFAULT_ERROR_COPY` gain `INVALID_PHONE`, `INVALID_CODE`,
  `CODE_EXPIRED` and `TOO_MANY_ATTEMPTS`.

### signet-db: plans, entitlements and feature flags

- New `@dapplelight/signet-db/entitlements`: `definePlans` (plans in code;
  `can`, `limit`, `consume` and `setPlan` only accept declared keys) and
  `createEntitlements(db, { plans, default, tables })`. Per subject (a user
  or org id): stored plan, overrides that grant or revoke a feature or set a
  limit, optionally until `expiresAt` (newest unexpired per key wins), all
  written through `audited`.
- `applyBillingEvent(event)` applies signet-payments `subscription.*` events
  to the subject's plan: gateway plan or price ids map to plan keys through
  `billing.plans`; idempotent per event via `withIdempotency`; an event older
  than the stored state is ignored (the guard is in the UPDATE's WHERE);
  `past_due` keeps the plan for `graceMs` (3 days). `created`/`updated` read
  the status from the payload (`statusOf`; Stripe, Paddle, Razorpay shapes by
  default), and events for an old subscription cannot downgrade a newer one. The event type is a local
  structural one, so signet-db does not depend on signet-payments.
- `consume(subject, key, n)`: per-period (month, day or total) usage with the
  check and the increment in one UPDATE, so concurrent requests cannot
  overspend.
- New `@dapplelight/signet-db/flags`: `defineFlags`, `evaluateFlag` and
  `createFlags`. Order: subject override, everyone override, targeting rules
  (plan, attributes), percentage rollout by a stable FNV-1a bucket, default.
  Results carry the reason.
- `entitlementTools(...)`: `get_plan`, `check_entitlement`, `usage`,
  `list_flags` for one subject, and with `allowWrites` `grant_feature`,
  `set_plan`, `set_flag`, which always go through `approve` (signet-server's
  `requireApproval`) and are audited as the agent.
- Column helpers `entitlementTables()` and `flagOverrides()` in
  `./columns/sqlite` and `./columns/pg`.

### signet-server: Phase 1 portability

- `cloudflareQueue(binding)` in `./adapters/cloudflare`: a Queues producer as a
  `Queue<T>`, delays rounded up to whole seconds, plus `sendBatch` split into
  Cloudflare's 100-message calls. `cloudflareConsumer` in `./jobs` is the other
  end. A raw binding still passes as a `Queue<T>`.
- `AnalyticsSink` in `./analytics/sinks` (also re-exported from `./analytics`):
  `createAnalyticsEngine` is one implementation; new `httpSink` (batched JSON
  POSTs, flushed through a `Defer`, failures reported to `onEvent` and never
  thrown), `memorySink` and `consoleSink`. `registerIngest`'s `engine` now
  accepts any sink; existing callers are unchanged.
- New `./adapters/vercel`: `vercelDefer(waitUntil)`, taking `waitUntil` from
  `@vercel/functions` so Signet does not depend on it. KV on Vercel is Upstash
  (use `./adapters/upstash`). No Vercel Blob adapter: Vercel documents Blob only
  through its SDKs, not as an HTTP API.
- `test/node-smoke.mjs`: the built dist under plain Node; CI runs it on Node 22
  and 24.

### create-signet-app: `--target`

- `--template api --target cloudflare|bun|node|vercel` (default `cloudflare`).
  Shared `src/app.ts`, env, tests and CI; only the chosen target's entry and
  config are written: Worker + `wrangler.jsonc`, `Bun.serve` + `Dockerfile`, a
  `node:http` bridge run by Node 22.18+ type stripping, or a Vercel `index.ts` +
  `vercel.json`. A cloudflare scaffold no longer includes `src/server.ts` and
  the `Dockerfile`; use `--target bun` for those. Relative imports in the
  template now carry `.ts`.
- signet-mcp's scaffold index mirrors the default (cloudflare) target, and its
  env-at-module-scope check treats a `node:http` entry as a process entry.

### signet-payments 0.1.0 (new, public; first publish is manual, see PUBLISHING.md)

- New `@dapplelight/signet-payments`: one canonical model (`Payment`, `Refund`,
  `Customer`, `PaymentMethod`, `Subscription`, `Payout`, `Settlement`, `Event`)
  in integer minor units, over ten fetch-only adapters, each a subpath:
  `./razorpay`, `./stripe`, `./cashfree`, `./phonepe`, `./payu`, `./paddle`,
  `./lemonsqueezy`, `./paypal`, `./hyperswitch`, `./dodo`. No SDKs, no runtime
  dependencies.
- Per gateway, beyond checkout/refunds: Razorpay manual capture per order;
  Cashfree subscriptions, Payouts v2 (optional 2FA signature) and settlement
  recon; PhonePe webhooks and Autopay subscriptions; PayU manual capture;
  Paddle and Lemon Squeezy partial refunds; PayPal saved methods (Vault v3);
  Hyperswitch saved methods, payouts, subscriptions and safe refund retries;
  Dodo Payments (merchant of record) with Standard Webhooks.
- PayU settlements use the Settlement Detail Range API (the old
  `get_settlement_details` command is no longer documented); capture, refund
  and adjustment (chargeback, `ADJ_*`) lines are mapped, and PayU's zone-less
  timestamps are read as IST. New `settlementUrl` option. PayU payouts remain
  unsupported: the payout reference contradicts itself on body format, `pid`
  placement and test versus production URLs.
- Apple Pay and Google Pay as canonical methods `applepay` and `googlepay`
  (device wallets; Google Pay's UPI app stays `upi`). Declared where each
  gateway documents them; Cashfree, Hyperswitch and Dodo limit the checkout to
  the wallet when it is passed as `method`. New `applePayDomainAssociation`
  serves the domain-association file Razorpay, PayPal and Dodo give you.
- App store billing: `./appstore` (App Store Server API and App Store Server
  Notifications V2, ES256 JWT auth, every JWS verified up to Apple Root CA -
  G3) and `./googleplay` (Play Developer API through a service account,
  Real-time Developer Notifications over authenticated Pub/Sub push, state read
  back from subscriptionsv2 and orders). Fetch and Web Crypto only.
  `createPayments().verifyPurchase` records a store purchase as a user's, and
  later renewals link to it. `Subscription` gains `productId`, `autoRenew`,
  `inGracePeriod` and `environment`; `Payment` and `Event` gain `productId` and
  `environment`. The inbox treats `subscription.created` / `subscription.charged`
  events that carry an amount as the capture. New agent tool:
  `find_subscription`. `refund_payment` rejects UNSUPPORTED up front for
  gateways that cannot refund.
- App Store amounts (Apple's configured price, not settled revenue) are
  flagged: `Payment.approximate` and `Event.approximate`, and their ledger
  postings use kind `capture:approximate` / `refund:approximate`
  (`Transaction.approximate` in the ledger API; no schema change).
- `capabilities` per adapter; an unsupported call rejects with `UNSUPPORTED`
  before any network call. Features the gateways' docs did not pin down are
  unsupported rather than guessed (see the README matrix).
- `verifyWebhook(request)` per gateway with that gateway's scheme (Web Crypto,
  constant-time compare, timestamp tolerance), normalised to `payment.*`,
  `refund.*`, `subscription.*`, `payout.*` and `dispute.*` events.
- `createPayments`: routing by currency, country or method, failover on outages
  only, an idempotency key on every charge and refund (structural hook for
  signet-db's `withIdempotency`), and a webhook inbox with dedupe, per-payment
  ordering and replay.
- Stores: `memoryStore()` and `sqlStore(client, { dialect })` for SQLite, D1 and
  Postgres, with `paymentsSchema(dialect)`.
- A double-entry ledger (balanced transactions enforced, keyed postings for
  capture, fee, refund and payout) and `reconcile` / `reconcileJob` against
  gateway settlement reports.
- `./agent`: `paymentTools` (`find_payment`, `list_payments`,
  `payment_timeline`, `refund_payment`) as plain MCP tools; refunds always go
  through an approval hook and record the actor. `refund_payment` takes a
  required `idempotencyKey`: retry with the same key and it refunds once.

### signet-server: jobs and storage

- New `@dapplelight/signet-server/jobs`: `defineJob({ name, input, retry, timeoutSeconds, run })`
  with `job.enqueue(input, { delaySeconds, key, actor })` (zod-checked at
  enqueue), and `createJobs({ jobs, queue, store })` whose `handle(message)`
  dispatches by name, aborts on timeout, retries with exponential or fixed
  backoff by re-sending, and dead-letters after the last attempt
  (`listDead`, `retryDead`). Idempotent keys over the `KeyValue`, or an
  `idempotency` hook for signet-db's `withIdempotency`; `outboxMessage` and
  `outboxQueue` for signet-db's outbox. `pause`/`resume`, `onJobRun`.
- Schedules: `defineSchedule` with a 5-field UTC cron matcher (`parseCron`,
  `cronMatches`), `jobs.runDueSchedules(now)`, `cloudflareScheduled`, `startScheduler`.
- Runtimes: `cloudflareConsumer` (Queues batch, ack/retry), `qstashReceiver`
  and `verifyQstashSignature` (Web Crypto HS256, current and next key),
  `inProcessJobs` (memoryQueue) and `startWorker` (polling).
- `jobTools(jobs)`: plain MCP tools `list_failed_jobs`, `retry_job` (behind
  `requireApproval`), `pause_job`, `resume_job`.
- Durable steps: `ctx.step.run` (memoised in the `KeyValue`), `step.sleep`
  (re-enqueues in 12 h legs), `step.waitFor({ event, timeoutSeconds })` and
  `step.waitForApproval`, answered by `jobs.emit`/`jobs.send` and
  `jobs.approve` or the new `list_pending_approvals` / `decide_job_approval`
  tools. Per-key `concurrency` and `rateLimit` (re-enqueue with delay). Event
  triggers: `jobs.on(event, jobs)`, `triggers`, `jobs.emit`, `outboxEvent`.
  `createTestJobs` with `runAll({ advanceTime })` and a virtual clock.
  `jobTools`' `retryWithoutApproval` option is now `withoutApproval`.
- Progress (`ctx.progress`, `jobs.status(id)`, `trackStatus`), cancel
  (`jobs.cancel(id)`: honoured before start, between steps and via
  `ctx.signal` in-process), and per-key AI budgets (`budget`, `budgetStore`
  in signet-ai's shape, `ctx.recordCost`, `costUsd` in `onJobRun`,
  `BUDGET_EXCEEDED`).
- signet-ui: new `@dapplelight/signet-ui/domain/job-runs` (`JobRuns`), a
  data-table of job runs with retry and cancel callbacks; not in the barrel.
- New `@dapplelight/signet-server/storage`: `createUploads({ store, maxBytes, allowedTypes })`
  with `presignUpload` (checks before signing), `presignDownload`,
  `confirmUpload` (re-checks what landed, deletes a bad file, runs
  `afterUpload`), `acceptUpload` (streams through the server, stops at the
  limit, sniffs PNG/JPEG/GIF/WebP/PDF magic bytes) and `remove`. Per-user key
  prefixes by default; `sniffType`, `UploadError`.
- Storage extras: `stripMetadata` (EXIF/XMP/IPTC out of JPEG, PNG, WebP,
  keeping only the Orientation tag when present; on by default in `acceptUpload`), per-user `quota`, abandoned-upload tracking
  with `cleanupAbandoned` and `abandonedUploadsJob`, `dedupe` by SHA-256
  with reference counts, `startResumable` / `completeMultipart`, `read`,
  and `resize` with a `Resizer` (`cloudflareImagesResizer`).
- signet-lib: `ERROR_CODES` and `DEFAULT_ERROR_COPY` gain the codes jobs
  and uploads emit: `BAD_INPUT`, `JOB_FAILED`, `UNKNOWN_JOB`, `CANCELLED`,
  `BUDGET_EXCEEDED`, `TOO_LARGE`, `EMPTY`, `TYPE_NOT_ALLOWED`,
  `TYPE_MISMATCH`, `BAD_KEY`, `QUOTA_EXCEEDED`, `PRESIGN_UNSUPPORTED`,
  `RESUMABLE_UNSUPPORTED`, and the start-up errors `JOBS_NOT_CREATED`,
  `DUPLICATE_JOB`, `NO_BUDGET_STORE` (generic copy). A copy table that spreads `DEFAULT_ERROR_COPY` needs no change.
- New `@dapplelight/signet-server/adapters/s3`: `s3BlobStore` (SigV4 over
  Web Crypto; presigned GET/PUT, multipart). `supabaseBlobStore` gains
  `resumable(key)` (TUS target) and a `publishableKey` option.
- signet-ui: new `@dapplelight/signet-ui/domain/upload` (`Upload`).

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

### signet-server: MCP for apps inside agents

All additive; existing `createMcpServer` / `mountMcp` calls behave as before.

- **Per-user lists.** `tools`, `resources` and `prompts` may be
  `(caller) => list` (caller: Hono `c` and verified `token`), resolved per
  request by the new `resolveMcpServer` (which `mcpHandler` now uses). A
  function list advertises `listChanged: true`; static lists keep `false`.
- **list_changed.** `createMcpChanges()` plus `mountMcp({ changes })` delivers
  `notifications/{tools,prompts,resources}/list_changed` to 2026-07-28
  `subscriptions/listen` streams, to every listener or one principal. In-process;
  `McpChanges` is a four-method interface for your own pub/sub.
- **Plain tool objects.** `tools` accepts `{ name, description, inputSchema, run }`
  (`PlainTool`), where `inputSchema` is JSON Schema (validated by the SDK's
  `fromJsonSchema`) or a zod object. `toMcpTool` converts one.
- **Routes as tools.** `routesAsTools(app, routes)` exposes listed Hono routes
  as tools, called in-process through `app.request` with the caller's
  `authorization` and `cookie` headers. GET/PUT/DELETE get annotation defaults.
- **Approval.** `requireApproval(ctx, { summary, details, args })` returns
  undefined when approved, else a result to return: the pending elicitation,
  `APPROVAL_DECLINED`, or `APPROVAL_REQUIRED` (structured, nothing done) for a
  client without elicitation.
- **Guardrails.** Per-tool `rateLimit` (any `RateLimitStore`, per principal),
  `timeoutMs` (answers `TIMEOUT`, aborts `ctx.signal`), and `onToolCall` with
  name, principal, actor (`client_id`/`azp`, RFC 8693 `act`), duration and
  ok / error code. `principal(caller)` overrides the default (`token.claims.sub`).
- **Client.** New `@dapplelight/signet-server/mcp/client`: `createMcpClient({ url, token })`
  lists and calls a remote server's tools over streamable HTTP, 2025-11-25 or
  2026-07-28, fetch only.
- **signet-lib.** `ERROR_CODES` and `DEFAULT_ERROR_COPY` gain `TIMEOUT`,
  `APPROVAL_REQUIRED` and `APPROVAL_DECLINED`, the codes these tools emit. A
  copy table that spreads `DEFAULT_ERROR_COPY` needs no change.
### signet-mcp 0.1.0 (new, not published yet)

- New `@dapplelight/signet-mcp`: an MCP server for agents, built on
  `@dapplelight/signet-server/mcp`. The `signet-mcp` bin serves stdio
  (`claude mcp add signet -- bunx @dapplelight/signet-mcp`); `signetMcpFetch()`
  and `signetMcpOptions()` host it over HTTP.
- Tools: `search_docs`, `read_doc`, `list_exports`, `get_export`,
  `list_components`, `get_component`, `list_themes`, `get_theme`,
  `list_tokens`, `check_theme`, `scaffold_app`, `scaffold_files`, `check_app`,
  `recipe`, `migration`. Every doc is a resource at `signet://docs/<name>`.
  Prompts: `build-signet-app`, `review-against-signet`, `add-signet-feature`.
- Its content is an index generated from the repo (`bun run gen` in
  `packages/mcp`) and shipped in the package; its test fails when the index is
  stale. `check_app` runs `signet-doctor`'s checks and `check_theme` the tokens
  contrast test, both copied verbatim into the index.
- `private: true` until npm Trusted Publishing is set up for it.

### signet-tokens

- `test/contrast.ts` exports `block`, `resolve` and `PAIRS` beside `ratio`, so
  signet-mcp's `check_theme` reuses them. No change to the package.

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
