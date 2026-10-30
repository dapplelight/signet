# Changelog

Packages are versioned independently (see PUBLISHING.md). Every entry below is
a package at the version it had when the repository was opened to the public.

## Unreleased

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

## Current versions

| Package | Version |
|---|---|
| `@dapplelight/signet-ai` | 0.2.1 |
| `@dapplelight/signet-config` | 0.2.1 |
| `@dapplelight/signet-lib` | 0.2.1 |
| `@dapplelight/signet-server` | 0.3.1 |
| `@dapplelight/signet-tokens` | 0.2.1 |
| `@dapplelight/signet-ui` | 0.2.1 |
| `create-signet-app` | 0.2.1 |
