# Changelog

Packages are versioned independently (see PUBLISHING.md). Every entry below is
a package at the version it had when the repository was opened to the public.

## Unreleased

### signet-server (next minor)

- **Breaking:** `clientIp(c, trust)` and `rateLimit({ trust })` take a trust
  setting: `"cloudflare"`, `{ forwardedHops: n }` or `"none"`. The old
  `clientIp` read `cf-connecting-ip` first and fell back to `x-forwarded-for`,
  so off Cloudflare a client could set `cf-connecting-ip` and pick its own
  bucket. Now `cf-connecting-ip` is read only under `"cloudflare"`;
  `forwardedHops: n` takes the n-th `x-forwarded-for` entry from the right.
  **Migration:** on Cloudflare pass `trust: "cloudflare"`; behind `n` proxies
  of your own pass `trust: { forwardedHops: n }`. The default is `"none"`, so
  without it all clients share one bucket per limiter (too strict, not too
  loose). Custom `keyFor` is unaffected.
- **Breaking:** `clientIp` returns `string | null`, never `"unknown"`. A missing
  IP gets the key `no-ip` inside the limiter's own scope instead of a bucket
  shared by every limiter.
- IPv6 clients are keyed by their /64 (`2001:db8:0:1::/64`); IPv4-mapped addresses (`::ffff:1.2.3.4`) are keyed as the plain IPv4.
- The `memoryStore` doc said sliding window; it is a fixed window.

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
