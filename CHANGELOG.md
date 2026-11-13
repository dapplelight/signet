# Changelog

Packages are versioned independently (see PUBLISHING.md). Every entry below is
a package at the version it had when the repository was opened to the public.

## Unreleased

### signet-server

- New `csrfMiddleware` at `@dapplelight/signet-server/middleware/csrf`: Hono's
  `csrf()` (Origin + Sec-Fetch-Site) with origins from the same env keys as
  `corsMiddleware`, bearer-token requests skipped, and a 403 `FORBIDDEN` envelope.
  `corsMiddleware` now shares `allowedOrigins()` with it. The create-signet-app
  API template enables it on `/api/*`; existing apps need no migration, and apps
  with `sameSite: "none"` cookies should add it.

### signet-server (version bump pending)

- New `webCryptoPushSender` at `@dapplelight/signet-server/notify/push`: a
  `PushSender` for Workers that signs VAPID (ES256 JWT, RFC 8292) and encrypts
  the payload with aes128gcm (RFC 8291) on Web Crypto only, with no Node APIs
  and no new dependency. Pass it as `createPusher({ send })`. Also exported:
  `encryptAes128gcm`, `vapidJwt`. Tested against the RFC 8291 test vector.
  Not breaking: injecting your own sender (for example `web-push` on Node)
  still works.

### signet-server

- `createSentry` posts to the envelope endpoint (`/api/<project>/envelope/`),
  not the deprecated Store API, so it keeps working when Sentry retires it.
  **Breaking for `beforeSend` and tests:** the stack is no longer
  `event.extra.stacktrace` (a string); it is `exception.values[0].stacktrace.frames`
  (parsed, oldest first). Read frames there, and parse the request body as an
  envelope (three newline-separated JSON lines) if you stub `fetch`.
- `captureException(err, context, scope)`: `scope` carries `tags`, `request`
  (credential headers dropped) and `user`; `createSentry({ tags })` adds tags to
  every event. `parseStack` is exported.

### signet-lib

- The date formatters take `{ timeZone }`. Date-only strings are not shifted.
- Currency formatters use each currency's own fraction digits when `exact`:
  JPY 0, KWD and BHD 3. **Behaviour change:** `exact` was always 2 decimals, so
  JPY and KWD output differs; USD and INR are unchanged.
- `Amount` accepts `bigint`; `{ minorUnits: true }` reads integer minor units
  (exact for a bigint). Migration: none for existing calls.
- Compact currency treats `or` (Odia) and `as` (Assamese) locales as lakh/crore.

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

### Audit medium bugs: Content-Type, `qs` arrays, nested validation paths

- lib: the API client sends `Content-Type: application/json` only when a body is
  sent. A GET or body-less DELETE no longer makes a cross-origin preflight.
  Headers you set still win.
- lib: `qs({ tag: ["a", "b"] })` gives `?tag=a&tag=b`, which `parseQuery` reads
  back as an array. Null, undefined and empty items are skipped; an empty array
  adds nothing.
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
| `@dapplelight/signet-ai` | 0.2.2 |
| `@dapplelight/signet-config` | 0.2.2 |
| `@dapplelight/signet-lib` | 0.2.2 |
| `@dapplelight/signet-server` | 0.3.2 |
| `@dapplelight/signet-tokens` | 0.2.2 |
| `@dapplelight/signet-ui` | 0.2.2 |
| `create-signet-app` | 0.2.2 |
