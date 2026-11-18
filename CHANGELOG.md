# Changelog

Packages are versioned independently (see PUBLISHING.md). Every entry below is
a package at the version it had when the repository was opened to the public.

## Unreleased

### create-signet-app: apps install the current Signet releases

Scaffolded apps asked for `@dapplelight/signet-server` `^0.5.0` and `@dapplelight/signet-ui` `^0.3.5`; on 0.x a caret keeps the minor, so they installed the old releases and failed to typecheck against the 0.6 server modules the API imports. They now ask for `^0.6.1` and `^0.4.0`, and the scaffold test fails when a range misses the current release.

### create-signet-app: compose apps from parts

- A web app and its API are now composed from parts: `auth`, `account`,
  `orgs`, `admin`, `notifications`, `privacy`, `payments`, `growth` (waitlist,
  invites, referrals, feedback and marks) and `mcp`. `--with`
  adds parts, `--without` leaves them out, and the parts they need come along
  (the output says which). `--ui` writes the web half only (its client calls
  an API at `VITE_API_URL`), `--api` the API half only (no web files, no Vite);
  both by default.
- `--starter full` is every part on both halves, the app `--template full`
  made; `--template full` still works and means the same. `--starter blank` is
  the shell, API and database with no parts.
- `--platform web|api|cli|extension|desktop` names the single-app platforms;
  `--template` stays as its alias.
- Each part's migration pieces compose: an app's `drizzle/` holds only its
  parts' tables, `db:check` passes and `db:generate` finds nothing to do.
- The full app's API tests are split into one file per part, sharing
  `test/helpers.ts`; `account` gains an API key test and `notifications` an
  inbox test.
- `--pm` also takes `yarn` (modern Yarn through corepack) and `deno` (Deno 2,
  `package.json` scripts through `deno task`), and the default follows
  `npm_config_user_agent` for all five. `--platform cli` is refused with deno.
- `--platform api --target deno`: a Deno.serve entry and a Dockerfile, like
  the bun target.
- A composed app takes `--target bun|deno|node` for its API (default bun, as
  before): deno and node run it on node:sqlite and node:http.

### all packages: dependencies on their latest minor and patch versions

- React 19.3.1, the AI SDK (`ai` 7.0.176, `@ai-sdk/react` 4.0.180), the MCP SDK 2.4.0, OpenTelemetry API 1.10, Radix (checkbox, dropdown menu, popover, tooltip), TanStack Query 5.108 and Table 9.3, Tailwind 4.3.5, lucide-react 1.74, react-day-picker 10.0.2, Fumadocs 16.19.4 and dev tooling. Scaffolded apps get the same versions.
- Held back because they broke here: recharts 3.11 (chart types), Biome 2.6 (reformats code, new rule), Hono 4.13.19 (server declaration types too large to emit). Majors (postgres 4, happy-dom 21, @tanstack/react-hotkeys 0.27, @ui-sdk beta.6) are separate.

### all packages: one zod 4 range

- Every package's zod peer and dev range is now `^4.6.7` (was a mix of `>=4.0.0`, `>=4.2.0`, `^4.0.0` and `^4.6.5`), and scaffolded apps ask for the same. `>=4` no longer admits a future zod 5. A test in `signet-config` fails if any range drifts or the lockfile resolves more than one zod.

### create-signet-app: quieter first install and lint

- Generated `biome.json` points `$schema` at the installed Biome's own schema, so `lint` no longer asks you to run `biome migrate` when a newer Biome 2.x installs.
- With `--pm npm`, the generated `package.json` allows esbuild's install script (`allowScripts`), so npm 11 no longer warns about it, and a future npm that blocks unreviewed scripts still builds.

### signet-server: `./mcp` loads without hono

- `@dapplelight/signet-server/mcp` no longer imports `./http/validate` at runtime, so it loads when the optional `hono` peer is absent. This fixes `npx @dapplelight/signet-mcp` and `bunx @dapplelight/signet-mcp`, which crashed on start with "Cannot find package 'hono'".

### create-signet-app: one quickstart

- The README and the docs now use one quickstart everywhere: `create-signet-app my-app --template full`, then install and `run dev`, at `http://localhost:5173`. The docs gain a Getting started path (Installation, Project structure, First component, First API route, Deploy).

### signet-ai: 0.5.0 publishes ./otel

- `./otel` (AI usage to OpenTelemetry spans) was added without a version bump, so npm did not have it. 0.5.0 publishes it. No breaking change.

### signet-server: 0.6.0 publishes the observability exports

- `./http/observability`, `./observability/trace`, `./observability/request-log` and `./observability/health` were added without a version bump, so npm did not have them. 0.6.0 publishes them. No breaking change; `@dapplelight/signet-mcp` now depends on `^0.6.0`.

### signet-ui: 0.4.0 publishes blocks and the cost dashboard

- `./blocks/*` (nine page-level blocks, copied in with `signet add block <name>`) and `./screens/cost-dashboard` were added without a version bump, so npm did not have them. 0.4.0 publishes them. No breaking change.

### create-signet-app: --describe, a whole-app plan from one sentence

- New `--describe "<sentence>"`: picks the template (`web`, `api` or `full`) and theme from the sentence, scaffolds, then writes `PLAN.md` (pages with their block commands, components, modules and data; data models; recipes; build order; the `signet check` to run after each page) and `AGENTS.md` (follow the plan one page at a time). No LLM call: the same sentence gives the same files. An explicit `--template` or `--theme` wins. Without `--describe` nothing changes.
- create-signet-app now depends on `@dapplelight/signet-mcp`, for `plan_page` and the blocks index.
- signet-mcp: no longer private, and exports `./plan` (`planPage`) and `./generated` (`INDEX`).

### signet-cli: signet check

- New `signet check`: the verify loop for agent-written code. It runs `tsc --noEmit`, Biome and Signet's conventions (`env-module-scope`, `error-handler`, `raw-colour`), then the conformance suite with `--api <url>` and screenshots plus axe at 390 and 1280 px with `--pages <path...>`. It prints a summary or, with `--json`, a findings list (`file`, `line`, `rule`, `level`, `message`, `fix`) and exits 1 on any error.

### mcp: plan_page tool

- New `plan_page({ description, target? })`: describe a page in words and get a file plan. It returns the block to add (with its `signet add block` command), the components it uses, server modules, the matching recipe, the data the page needs and the files to create, each with a one-line purpose. `target` is `web` (default), `api` or `full`. It ranks the blocks, recipes and server exports by words only: no LLM call, and the same description gives the same plan.

### create-signet-app: observability in the full template

- The full template can turn on request logs, a span per request and `/health/live` and `/health/ready` with `OBSERVABILITY=on` (`traceMiddleware`, `requestLog`, `healthRoutes` and the logger `mixin`, wired through `createApp`'s new `observability` option). It is off by default: with the variable unset, the routes and log output are unchanged and there is no `/health`.
- New guide "Trace a Request Across Logs, Sentry and Spans", linking logs, Sentry and spans by `traceId`, Workers tracing (otel-cf-workers and Cloudflare native), AI cost, health and what is never recorded. The observability package pages now point to it, and the `skipPaths` examples use `/health/live` and `/health/ready`.

### server: observability/health routes

- New `./observability/health` with `healthRoutes({ checks, timeoutMs? })`, a Hono app for load balancer probes. `GET /live` always returns 200. `GET /ready` runs every check in parallel with a per-check timeout (default 2000 ms) and returns 503 when any check returns false, throws or times out. The body holds only `ok` and one boolean per check, never error text. Takes config and never reads env. Nothing existing changes.

### signet-cli: conformance command

- New `signet conformance <baseUrl>` runs the Signet wire-contract cases against a live backend, prints one `pass` or `fail` line per case and exits 1 when any fails. Flags: `--auth-prefix`, `--ingest`, `--sessions`, `--json-path`, `--json`.
- signet-spec: `/spec/v1/index.json` lists every file under `/spec/v1/` with its URL and description. `bun run gen` writes it.

### signet-ui: CostDashboard screen

- New `./screens/cost-dashboard` with `CostDashboard`, `DEFAULT_COST_LABELS` and types, for the data of signet-server's `observabilityAdminRoutes` cost endpoints: a spend-over-time chart with cache savings, spend by model, top spenders (hashes as given), global cap usage bars (primary under 80%, amber from 80%, red at 100%) and tiles for spend, cache saved and top model. Give it `data` or a `fetcher(days)` (which also drives Retry); text comes from `labels`, and rows carry `data-slot` plus `data-model`, `data-subject` or `data-period`. Needs the optional peer `recharts`, so it is not in the barrel. Nothing existing changes.

### signet-ui: auth, onboarding, pricing, checkout and error page blocks

- New `./blocks/auth-page`, `./blocks/onboarding`, `./blocks/pricing`, `./blocks/checkout-summary`, `./blocks/empty-page` and `./blocks/error-page`: whole pages with `labels`, `classNames`, `data-block` / `data-slot` hooks and `ready` / `loading` / `error` states. Back-end calls come in as callbacks (`onRequestCode`, `onVerify`, `onPay`), so a block holds no provider logic. `signet add block <name>` copies them.

### spec: conformance cases and runner

- New `conformance/cases.json` (also served at `/spec/v1/conformance-cases.json`): language-neutral request and expected-response cases for the error envelope, analytics ingest, client login and session routes.
- New `./conformance` export: `runConformance({ baseUrl, authPrefix, ingestPath, jsonPath, fetch? })` runs them with `fetch` alone and returns `{ passed, failed, results }`.

### signet-db and signet-server: AI spend ledger and cost admin routes

- signet-db `./ai-spend`: `createAiSpend` keeps an optional dated ledger. New `aiSpendLedger()` table (SQLite and Postgres) with one row per UTC day, model, scope and subject (`units`, `calls`, `cacheSavedUnits`), passed as `tables.aiSpendLedger`. `record(subject, units, at?, { model?, cacheSavedUnits? })` upserts the day rows, and `onUsage` keeps the report's `model` and `savedUsd`. New `series`, `byModel`, `topSpenders` and `prune`; `retentionDays` (default 400) prunes old rows. Raw user and org ids are never stored: the subject is `hashSubject(id)`, SHA-256 hex by default. Migration: create the new table only; past spend is not backfilled. The caps API is unchanged, and the ledger is off without the table.
- signet-server: new `./http/observability` with `observabilityAdminRoutes({ spend, authorize, actor? })`: admin-only `GET /cost/series`, `/cost/by-model`, `/cost/top` and `/cost/cache-savings`, in the same error envelope as `aiSpendAdminRoutes`. Subjects appear only as their hash.

### signet-spec: machine-readable theme contract

- New `schemas/contract.json` (also at `/spec/v1/contract.json`): the 78 required and 16 optional theme CSS variables from `signet-tokens`' CONTRACT.md as `{ version, required, optional }`, each entry `{ name, group }`. Generated by `bun run gen`; a test fails when it drifts from CONTRACT.md.

### spec: OpenAPI document for the auth routes

- New `@dapplelight/signet-spec/openapi/auth.openapi.json` (also served at `/spec/v1/auth.openapi.json`): OpenAPI 3.1 for `sessionRoutes` and `clientLoginRoutes`, including the PKCE, token, device-flow and revoke routes and their OAuth error shape. A test checks every response of the real routes against it.

### signet-ai: usage to spans and spend

- New `./otel`: `otelUsage()` puts `gen_ai.*` token attributes, `signet.cost_usd`, `signet.cache_hit` and `signet.saved_usd` on the active OpenTelemetry span (the budget key only with `includeKey`). `onUsageAll(...hooks)` runs several `onUsage` hooks, each isolated. `spendUsage({ spend, subject })` records each call's cost per user or org in the spend ledger.
- `@opentelemetry/api` is an optional peer; without an SDK registered `otelUsage` does nothing. No exporter is included. If you bundle `./otel` (esbuild, wrangler, Vite), install `@opentelemetry/api` or mark it external, since the bundler resolves it at build time.

### signet-ui: page blocks

- New `./blocks/analytics-dashboard`, `./blocks/list-detail` and `./blocks/settings`: whole pages built from signet-ui components, with `labels`, `classNames`, `data-block` / `data-slot` hooks and `ready` / `loading` / `error` states. Each folder has a `block.json` (name, description, files, deps).
- `signet add block <name>` (signet-cli) copies a block and the components it uses into an app. The registry build fails when a `block.json` does not match what the block imports.

### spec: analytics ingest and webhook delivery schemas

- New `./analytics`: `analyticsIngestRequestSchema`, `analyticsIngestResponseSchema`, `analyticsIngestErrorSchema` and `trackedEventSchema`, with the limits of the ingest route (50 events, 64-character names, 20 props, id pattern `^[A-Za-z0-9_.:-]{1,64}$`).
- New `./webhooks`: `webhookBodySchema`, `webhookHeadersSchema`, `webhookOutboxMessageSchema` and `webhookDeliverySchema`.
- New generated files under `schemas/` and `/spec/v1/`: `analytics-ingest-request.schema.json`, `analytics-ingest-response.schema.json`, `tracked-event.schema.json` and `webhook-delivery.schema.json`. Existing files are unchanged.

### signet-spec: new package with the error envelope and error-code schemas

- New `@dapplelight/signet-spec` (peer: `zod`). `./error` has `errorEnvelopeSchema`, `ERROR_CODE_STATUS` (every `ERROR_CODES` entry from signet-lib mapped to its default HTTP status), `ErrorCode` and `errorCodeSchema`. `./schemas/*.json` ships `error-envelope.schema.json` (JSON Schema 2020-12) and `error-codes.json`, both generated from the Zod source with `"specVersion": "v1"` and served at `/spec/v1/` on the docs site.
- signet-server's `ERROR_ENVELOPE_SCHEMA` is unchanged; a test now fails if it disagrees with the spec package's schema.

### server: request tracing and request logs

- New `./observability/trace`: `traceMiddleware` starts one OpenTelemetry server span per request (method, route pattern, status, errors recorded and rethrown, incoming `traceparent` honoured), with `withSpan` and `traceContext`. It uses only `@opentelemetry/api`, now an optional peer, and is a no-op without it or without an SDK.
- New `./observability/request-log`: `requestLog` logs `request.started`, `request.completed` and `request.failed` with method, route, status, `durationMs`, `reqId` and `traceId`, and marks slow requests with `slow: true`.
- `createLogger` takes a `mixin` function whose fields are added to every line. Default off; output is unchanged without it.
- `SentryScope.traceId` is sent as the `trace_id` tag.

### signet-mcp: recipes install signet-db

- Recipes that use `@dapplelight/signet-db` (collaboration, webhooks, monetisation, AI spend, experiments, store admin, checkout funnels) now list it in their install line; it is published, the old comments saying it was private were stale.

### mcp: component examples are no longer cut off

`get_component` examples stopped after 16 lines, so longer ones (Chart, Alert Dialog and others) ended mid-component. They now run to the closing tag.

### ui: SkipLink

- `SkipLink` (from `skip-link`): a "Skip to content" link, hidden until focused with Tab, that jumps to `#main` (or `target`). Label comes from `useLabels().skipToContent`.

### create-signet-app: skip link in the web template, missing label keys

The root layout renders `SkipLink` first and gives `<main>` `id="main"`. `src/locales/en.json` gains the `signet` keys SchemaForm and SkipLink use (`submit`, `addItem`, `removeItem`, `chooseOption`, `skipToContent`). Needs `@dapplelight/signet-ui` ^0.3.5.

### mcp: scaffold_files includes the template's skip link

### ui: SchemaForm, a form drawn from a zod schema

`@dapplelight/signet-ui/components/schema-form`: `<SchemaForm schema={Expense} onSubmit={save} />` renders every field with Signet's own controls (text, textarea, number, date, switch, select, nested objects and lists), wires labels, descriptions and errors through `Field`, and validates with the schema. Built on AutoForm's TanStack Form adapter.

- Customise a field in the schema with `fieldConfig` from `@autoform/zod` (label, description, control type, order, input props), or replace a control type for the whole form with `formComponents`; every part has a `data-slot`.
- `onSubmitError={(error, form) => applyServerErrors(form, error)}` puts signet-server's 422 field errors under their fields.
- Submit / add / remove text comes from `LabelsProvider` (`submit`, `addItem`, `removeItem`, `chooseOption`).
- Optional peers, only for apps that use it: `@autoform/react` ^5, `@autoform/zod` ^6, `@tanstack/react-form` ^1, `zod` ^4.

### ui: shortcuts in the command palette, and a phone sheet for CommandDialog

- `ShortcutCommands` (from `shortcuts`): every described single-key shortcut becomes a palette item, one group per `meta.group`, with its keys shown; choosing one runs it. Drop it inside a `CommandList`. Sequences ("G then I") stay in the `?` overlay.
- Shortcuts registered with `enabled: false` are no longer listed in the `?` overlay.
- `CommandDialog` opens as a bottom sheet on phones (85% height, list fills it). Desktop is unchanged.

### create-signet-app: Signet's built-in component text goes through i18n

The web template wraps the app in `SignetLabels` (`src/components/signet-labels.tsx`), which feeds ui's `LabelsProvider` from `t()`. Every word Signet's components say by themselves ("Close", "Search…", table headers, aria labels) is now in `src/locales/en.json` under `signet`, next to the app's own text. Needs `@dapplelight/signet-ui` ^0.3.2.

### mcp: scaffold_files includes the template's SignetLabels

### mcp: scaffold_files includes the web template's PWA and i18n dependencies

`scaffold_files` for the web template now lists the same dependencies as `create-signet-app`, so its `package.json` matches a real scaffold again.

### create-signet-app: web template ships i18n (i18next)

New web apps keep every string in `src/locales/en.json` and read it with `useTranslation()` (`i18next` + `react-i18next`, app dependencies; Signet's own packages stay library-free). The browser language picks the file, English is the fallback, and `?pseudo=1` in dev shows accented, padded text so missed strings and cut-off text stand out in review screenshots. A new language is a new JSON file plus one line in `src/lib/i18n.ts`.

### create-signet-app: PWA update applies only when every tab is hidden

Activating a new service worker reloads every open tab, so a background tab applying the update reloaded the one in use. A hidden tab now asks the worker, which applies the update only when no window of the app is visible; the last tab to go to the background applies it.

### ui: LabelsProvider, so apps can translate the words components say by themselves

Text that Signet's components show without being passed it ("Close", "Something went wrong", "Search…", table headers, aria labels…) now comes from `useLabels()`, English by default. Wrap the app once to swap them with any i18n library:

```tsx
<LabelsProvider labels={{ close: t("close"), somethingWentWrong: t("error.title") }}>
```

Unset keys stay English, nested providers merge, and a component prop for the same text (for example `DataTable`'s `emptyMessage`) still wins. Nothing changes for apps that don't use it. Exports: `LabelsProvider`, `useLabels`, `defaultLabels`, `Labels`.

### lib: offline outbox, sync conflict rules, IndexedDB storage

- `@dapplelight/signet-lib/offline`: `createOutbox<T>({ storage })` saves work done offline and `flush(send)` sends it on reconnect, keeping failures. Runs on any `StorageAdapter`. Where `navigator.locks` exists, tabs and the service worker sharing a key take turns, so an item is sent once per flush; `send` should still be safe to repeat for the same `id`.
- `@dapplelight/signet-lib/sync`: hybrid logical clock (`tick`, `receive`, `compareHlc`) and `apply(row, change, { guarded })`: per-field last-write-wins, guarded fields (amounts, dates) keep every edit on the row and `conflictOf(row, field)` gives the same open `Conflict` (`shown` plus `others`) in any arrival order. A person's pick is a `set` with `resolve` listing the values they saw (an older edit they never saw stays in the conflict). Retries, however late, change nothing. Edit-after-delete is flagged (`deletedButEdited`). Tested over 2000 random two-device sessions and every order of three.
- `indexedDbStorage()` in `/storage`: larger than localStorage and reachable from a service worker. Adds its store to an existing database (if another open connection blocks that upgrade it rejects with a clear error rather than hanging, and the next call retries), and writes resolve only once the transaction commits (a full disk rejects). No new dependency.

### create-signet-app: web template is an installable PWA

The web template now builds a service worker with `vite-plugin-pwa` (injectManifest) and Workbox, added as template dev dependencies only:

- precaches the built app and serves `public/offline.html` when a page load has no network; `/api/*` always goes to the network, so nothing private is cached
- checks for a new deploy when the app returns to the foreground and every 30 minutes, shows a "Reload" toast, and applies the update by itself the next time the app is in the background
- handles web push (`{ title, message, url, tag }`) and opens the URL on click
- `manifest.webmanifest` with the app name; add icons under `public/` and list them in `vite.config.ts`

Nothing runs under `bun run dev`; only built or previewed apps register the worker.

### tokens: finance theme drops product category colours

`finance.css` no longer defines `--cat-needs`, `--cat-wants`, `--cat-investments`, `--cat-income`, `--cat-transfer` or their `--color-cat-*` utilities. Those are an app's budgeting vocabulary, and Signet carries no business logic: define them in your app's CSS. The theme keeps the optional money slots (`--money-credit`, `--money-debit`, `--money-transfer`). Breaking for apps that used `bg-cat-*` / `text-cat-*`, hence 0.4.0.

### create-signet-app: desktop template (Tauri v2)

- New `--template desktop`: a Tauri v2 desktop and menu-bar app. React + Vite webview with Signet's UI and tokens (`--theme`, dark mode), a tray icon that toggles a small window, and a main window that hides to the tray.
- Sign-in is authorization code + PKCE (S256) through the system browser and a one-shot loopback listener in Rust, against signet-server's `clientLoginRoutes`. Tokens go through `createSession` with `tauriStorage` over the official store plugin; the API client is bearer-only (`credentials: "omit"`) with `tokenEndpointRefresh`.
- Official Tauri plugins only (opener, store). The window capability is least privilege, and the identifier is a placeholder (`com.example.<app>`) to replace before shipping.
- The template ships its own CI workflow that lints, typechecks and tests, then builds installers on macOS, Windows and Linux. The Rust is verified there; Signet's tests cover the webview, config and capabilities, not cargo.

### create-signet-app: `--template extension` scaffolds a Chrome MV3 extension

`create-signet-app my-ext --template extension` writes a Manifest V3 extension:
a popup, an options page (React, `signet-ui`, a `signet-tokens` theme with dark
mode) and a background service worker, built by plain Vite with no extension
plugin. Sign-in is authorization code + PKCE through `chrome.identity.launchWebAuthFlow`
against `clientLoginRoutes`; tokens are kept with `createSession` and
`chromeStorage()`, and API calls go through `createApiClient` with bearer tokens
and `tokenEndpointRefresh`. The README covers loading it unpacked and registering
the client id and `https://<extension-id>.chromiumapp.org/` redirect URI on the server.

### signet-lib: `StorageAdapter.watch`, so a session follows other windows and workers

- `StorageAdapter` gains an optional `watch(key, cb)` returning an unsubscribe. `chromeStorage` implements it with `chrome.storage` `onChanged`, `webStorage` with the window `storage` event (other tabs), and `tauriStorage` with the injected store's `onKeyChange` when it has one. Memory and file storage have none.
- `createSession` uses it: a sign-in, refresh or sign-out in another context (an extension's service worker, a second window) updates `get()`, `token()` and `subscribe()` listeners. Echoes of its own writes are ignored.

### signet-lib: storage adapters, bearer sessions, platform-free imports

- New `./storage`: `StorageAdapter` (async `get`/`set`/`remove` of strings) with `memoryStorage()`, `webStorage()` (localStorage), `chromeStorage()` (MV3 `chrome.storage.local`, typed by shape) and `tauriStorage(store)` (an injected plugin-store `Store`). No backend is looked up until first use.
- New `./storage/file`: `fileStorage(path)`, a 0600 JSON file for Node/Bun CLIs, on its own path so browser bundles never pull in `fs`.
- New `./session`: `createSession({ storage, refresh })` keeps access and refresh tokens with `get`/`set`/`clear`/`subscribe`, and exposes `token` and `refresh` for the api client. `tokenEndpointRefresh(url, clientId)` and `fromTokenResponse()` talk to an OAuth token endpoint such as signet-server's `clientLoginRoutes`.
- `createApiClient` and `createRpcClient` take `token` (sent as `Authorization: Bearer`) and `refresh` (one refresh-and-retry on a 401). Without them nothing changes, so cookie auth works as before.
- Every export path is tested to import with no `window`, `document`, `localStorage`, `navigator` or `chrome`, so the package loads in a service worker, a Tauri webview, a Bun CLI and React Native.

### server: publish Phase 2 and 3 exports

signet-server 0.5.0, signet-ui 0.3.0, signet-lib 0.4.0, signet-tokens 0.3.0, signet-ai 0.4.1 and signet-db 0.2.0 (needs signet-lib 0.4 for ./webhooks) publish the export paths that landed on main without a version bump. create-signet-app 0.4.1 points its templates at these versions; 0.4.0 scaffolded apps that imported `signet-server/auth/otp` and other paths missing from npm. CI now fails when a package's export paths differ from npm for the same version.

### signet-server: bearer sign-in for extensions, desktop apps and CLIs

- New `./auth/client-login`: authorization code with PKCE (S256 only) for extensions and desktop apps, and the RFC 8628 device code flow (`authorization_pending`, `slow_down`, `expired_token`) for CLIs. Both issue a short-lived access token (a stored-session token, 15 minutes by default) and an opaque refresh token that is single use, rotated on every refresh, and revokes the session when a used one comes back. Each sign-in is a stored session, so it shows in "your devices" and can be revoked there. Codes are hashed at rest, single use, short-lived and compared in constant time; device starts are rate-limited per IP and approvals per user. Redirect URIs are matched exactly, except that a portless loopback entry matches any port (RFC 8252).
- `./auth/hono`: `clientLoginRoutes({ trust, ... })` (which proxy to believe for client IPs, as in `rateLimit`; it throws at setup without one, and `"none"` makes every caller share one device-start limit) mounts `GET /authorize`, `POST /token`, `POST /device/code`, `POST /device/approve` and `POST /revoke`. `requireStoredSession({ bearer: true })` also accepts `Authorization: Bearer <access token>`, so one route serves the web cookie and every other client.

### create-signet-app: `--template cli`

- New `cli` template: a Bun CLI that signs in through signet-server's device code flow (`login`, `logout`, `whoami`), keeps tokens in a 0600 file under the OS config dir via `createSession` and `fileStorage`, and compiles to one binary with `bun build --compile`. Ships a CI matrix that builds a binary per OS on tags, and a unit-tested poll loop that honours `interval`, `slow_down`, `authorization_pending` and `expired_token`. Colour comes from `@dapplelight/signet-tokens/ansi` and respects `NO_COLOR` and pipes. No CLI framework: `node:util` `parseArgs` only.

### signet-tokens: React Native guide, `nativeTheme` takes `useColorScheme()` as is

- `nativeTheme(name, scheme)` now accepts `null` and `"unspecified"` (anything but `"dark"` is light), so `nativeTheme("editorial", useColorScheme())` typechecks. The README has an Expo / React Native section.

### signet-tokens: `./native` and `./ansi`

- New `./native`: every theme's tokens as plain JS for React Native (`nativeTheme(name, mode)`, `NATIVE_THEMES`, `THEME_NAMES`), with colours as `#rrggbb` or `rgba()` strings and radii, spacing and font sizes as numbers. Generated from the theme CSS by `bun run gen:native`; the test fails when the committed data drifts from the stylesheets or a theme leaves a CONTRACT.md colour unresolved.
- New `./ansi`: `ansi(name, { mode, depth })` gives `fg`/`bg` painters per token in truecolor or the nearest xterm 256 colour, with translucent tokens flattened onto the background. `nearest256`, `ansiCode` and `RESET` are exported too.

### release: signet-db and signet-payments publish from CI

Both packages now have a Trusted Publisher and are in the release order, so
the release workflow publishes signet-db 0.1.0 and signet-payments 0.1.0, then
create-signet-app 0.4.0 (npm has 0.3.0 from before the full template existed),
whose full template installs them. PUBLISHING.md's first-release steps use
`npm trust` before the first version instead of a hand publish.

### signet-db: pricing experiments on placements

- `createOfferings(db, { ..., experiments })`: a placement can run a pricing
  experiment (`setPlacement(p, { ..., experiment })`) whose variants serve
  offerings or pinned versions (`value: { offering, version? }`; no value is
  the placement's own). `current(placement, audience, subjectId)` assigns
  sticky through `createExperiments`, records the exposure, and returns
  `experiment: { key, variant, reason }`.
- New `./pricing`: `createPricing(db, { tables, offerings, experiments })`
  with `readout(key)` (per variant: conversion with lift and z-test, trial
  conversion, revenue and revenue per exposed user from the customer
  timeline, followed through identity merges, and an LTV estimate from
  observed churn) and `rollout(key, variant)` (the winner's offering becomes
  the placement's offering and the experiment stops). `pricingReadout` is the
  same math as a pure function.
- Migration: `placements` has a new nullable `experiment` column. On an
  existing database run `ALTER TABLE placements ADD COLUMN experiment text`.

### signet-server: pricing experiment routes

- `monetisationRoutes`: `GET /offerings/:placement` (and the impression and
  redeem routes) pass the subject so a placement's pricing experiment assigns
  and records the exposure.
- `monetisationAdminRoutes({ pricing })`: `GET /pricing/:experiment` (the
  readout) and `POST /pricing/:experiment/rollout` `{ variant }`, deny by
  default; `PUT /placements/:placement` takes `experiment`.

### signet-ui: experiment form, pricing readout and status admin

- `screens/experiment-screens`: `ExperimentForm` (key, variants and weights,
  JSON value or offering picker, goal event, audience, start and stop) and
  `PricingExperimentResults` (per-variant offering, conversion, trial
  conversion, revenue per exposed user and an LTV estimate, one-click
  rollout).
- `screens/status-screens`: `StatusAdmin` with exported parts
  `MaintenanceForm`, `ComponentStatusList`, `IncidentForm` and
  `IncidentUpdateForm`: the maintenance switch with message and until,
  component statuses, and incidents opened, updated and resolved
  (append-only updates).

### signet-ui: RichTextEditor on Tiptap

- `./components/rich-text-editor` is now built on Tiptap v3 instead of `document.execCommand`. New optional peer dependencies (all MIT): `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-mention`, `@tiptap/extension-link` (`>=3.34.0 <4`). Install them to use the editor.
- The props, the markdown value, the `@[Name](user:<id>)` mention tokens, the toolbar's ARIA, `labels`, `icons`, `className`/`classNames` and the `data-slot` parts are unchanged. Mentions now use Tiptap's suggestion API; pasted HTML is cleaned by the same allowlist as the value.
- `RichTextEditor` and its helpers leave the main barrel (like `chart`, an optional-peer component): import them from `@dapplelight/signet-ui/components/rich-text-editor`.

### signet-ui, signet-db, signet-server: data editing

- signet-ui `./domain/csv-import`: `CsvImport`, a CSV import flow (file or paste, RFC 4180 parsing with quotes, escaped quotes, CRLF and BOM, column mapping with auto-match, zod validation per row, errors per cell, import of the valid rows, server errors per row from the import report). Exports `parseCsv`, `toCsv`, `autoMatch` and `validateRows`.
- signet-ui `./components/data-grid`: `DataGrid`, an editable grid on react-table and the Table parts: text, number, select, date and checkbox cells, keyboard navigation with one tab stop, range copy and paste as TSV, row selection, sort and resize, optimistic saves with an error per cell, virtualised rows. Also in the barrel.
- signet-ui `./components/rich-text-editor`: `RichTextEditor`, a contenteditable editor with no editor library (bold, italic, code, links, headings, lists, @mentions stored as signet-db mention tokens), whose value is allowlisted markdown; `RichTextContent` and `richTextToHtml` render it safely. Also in the barrel.
- signet-db `./import`: `bulkInsert(ops, table, rows, { key })`, chunked and idempotent bulk insert through a scope, with a per-row error report.
- signet-server `./http/sanitize`: `sanitizeMarkdown` and `isSafeLinkTarget`, a server-side sanitiser for stored rich text (raw HTML escaped, unsafe link targets removed).
- signet-mcp: an `add-data-editing` recipe.

### signet-db, signet-server, signet-ui: experiments, status page and maintenance mode

- signet-db `./experiments`: `createExperiments` runs A/B/n tests on top of
  feature flags. Weighted variants with sticky assignment from the flags'
  `bucket` (no storage needed), exposure logging once per subject, conversions
  from `analyticsEvents()` goal events after exposure, and `results` with
  per-variant rates, lift and a two-proportion z-test against the control.
  Lifecycle `create` / `update` (draft) / `start` / `stop` / `rollout`. A
  variant's `value` is free JSON, so a placement can later serve an offering
  by variant. Tables: `experimentTables()`.
- signet-db `./status`: `createStatus` for a status page: components,
  incidents with appended updates, the maintenance switch and `summary()`.
  Tables: `statusTables()`.
- signet-server `./http/experiments`: `experimentRoutes` (assignment and
  exposure) and `experimentAdminRoutes` (create, edit, start, stop, results,
  roll out; deny by default).
- signet-server `./http/status`: public `statusRoutes` and
  `statusAdminRoutes` for components, incidents and maintenance.
- signet-server `./middleware/maintenance`: `maintenanceMode` answers 503
  with `Retry-After` and the envelope (`code: "MAINTENANCE"`), with a path
  allowlist and an `allow` callback for admins.
- signet-lib: new error code `MAINTENANCE` with default copy.
- signet-ui `screens/experiment-screens` (`ExperimentList`,
  `ExperimentResults`) and `screens/status-screens` (`StatusPage`).
- signet-mcp: recipe `add-experiments`.

### signet-db: web-to-app funnels

- New `./funnels`: `createFunnels(db, { tables, funnels, discounts, offerings, customers, entitlements, checkout, track?, grant?, onPaid? })`. A funnel is optional questions, a plan picker from an offering placement's priced web products, and the gateway's checkout. `start` prices the product and any discount on the server, creates a new anonymous customer and asks the gateway for exactly that amount under the session id. `applyEvent` grants the plan only on a verified `payment.captured` for the priced amount and currency, once; `refund.processed` ends the access. `redeem(sessionId, userId)` claims the session for one account (race-safe, idempotent for the same account) and merges the buyer in with `customers.merge`. URL discounts (`percentOff` or `amountOff`, `expiresAt`, `maxRedemptions` held atomically and given back for checkouts abandoned longer than `discountHoldMs`, default 1 hour, `plans`) are charged as a price override and recorded on the customer timeline as kind `discount`. Step views, purchase and redemption are analytics events `funnel:<key>:<step>`; `funnelSteps(def)` gives the drop-off steps.
- `funnelTables()` in `./columns/sqlite` and `./columns/pg`. `TimelineKind` gains `discount`.

### signet-server: funnel routes and redemption tokens

- New `./http/funnels`: `funnelRoutes` serves the hosted checkout page (questions, plan picker, Stripe Express Checkout for Apple Pay and Google Pay plus the Payment Element with Stripe.js loaded at runtime, Razorpay Checkout, redirect or form gateways; nonce'd script and strict CSP), its config, step events and checkout API, the session status with a redemption link once paid (only to the browser that started the checkout, by an HttpOnly cookie), and `POST /redeem` for the signed-in app user. `redemptionToken`, `readRedemptionToken` and `redemptionLink` sign expiring, purpose-bound tokens with key rotation.

### signet-lib: funnel error codes

- `ERROR_CODES` and `DEFAULT_ERROR_COPY` gain `BAD_TOKEN` and `REDEEM_REFUSED`.

### signet-ui: funnel screens

- New `./screens/funnel-screens`: `WebFunnel` (questions, `RemotePaywall` with the URL discount priced in, email and code), `ExpressCheckout` (Stripe's Express Checkout and Payment Elements, Stripe.js loaded at runtime), `FunnelRedemption` (waits for payment, then the app link and the code), `discountedOffering` and `loadScript`.

### signet-mcp: add-funnels recipe

- New `add-funnels` recipe: funnels and checkout, URL discounts, redemption, funnel analytics and routes, cut from the db and server READMEs.

### signet-db: subscription charts, offers, promotional entitlements, Apple refund requests

- New `./charts`: `createCharts(db, { tables: { customerEvents, chartAudiences?, offerings? }, products?, fx?, trialDays?, attributionDays? })`. `metrics({ from, to, store?, plan?, country?, offering?, audience? })` gives per UTC day and in total: MRR per currency (normalised to a month; a total in `fx.base` only with a rate for every currency), active subscribers and trials, new versus renewal revenue, refunds, new subscriptions, trials started and converted, churn, paywall impressions and conversions, plus `trialConversion`, `churnRate` and `paywallConversion`. One GROUP BY on SQLite, D1 or Postgres buckets the timeline by day; results with App Store prices say `approximate`. Saved filters: `saveAudience`, `audiences`, `removeAudience`. CSV: `csv(query)` or `chartsCsv(result)`.
- `monetisationTables()` adds `chartAudiences`, and `customerEvents` gains nullable `country` and `offering` columns and an `occurred_at` index. Add them in your next migration.
- Offers: `OfferingProduct.offers` takes free trials, intro and win-back offers (`{ id, type, days?, price?, eligibility?: { neverSubscribed?, lapsedDays?, once? } }`), validated on `publish`. `offerEligible(offer, history)` is the rule: never while subscribed, never-subscribed by default for trials and intro, lapsed at least `lapsedDays` for win-back, once per customer. `customers.withOffers(subject, offering)` cuts an offering to what that customer may see; `customers.redeemOffer(subject, offering, offerId)` claims one once (concurrent claims have one winner). Requests gain the `offer` kind.
- Promotional entitlements: `ent.grantPromotional(subject, plan, { actor, expiresAt })` and `ent.endPromotional`, a `promotional` source that lapses exactly at its expiry. `customers.grantPromotional(subject, { plan, days | expiresAt, note? }, { actor })` and `customers.endPromotional` also put it on the timeline (`promotional`, then `expiration`). The Customer Center treats it like a manual plan.
- Timeline: zero-amount or App Store FREE_TRIAL purchases are `trial`; App Store `CONSUMPTION_REQUEST` is `refund_request` (`isTrial` is exported). `record(e, { country })` stores the customer's country. `customers.logImpression(subject, { offering, version?, placement?, country? })` logs a paywall view, once per customer, offering and day, kept off the timeline.
- `customers.consumptionInfo(event)` builds the answer to a CONSUMPTION_REQUEST from the customer's data (delivery status, share of the paid period used, whether they had a trial), with hooks for each field. With no consent (`consumption.consented`) it returns `respond: false` and nothing is sent, as Apple requires.

### signet-payments: answer App Store CONSUMPTION_REQUEST

- `appstore(...).sendConsumptionInfo(transactionId, body)` PUTs Send Consumption Information v2 (`/inApps/v2/transactions/consumption/{id}`). `checkConsumptionRequest` refuses a body Apple would reject: `customerConsented` other than true, an unknown `deliveryStatus`, a percentage outside 0 to 100000, a non-zero percentage when not delivered, or a percentage with `GRANT_PRORATED`. New types `ConsumptionRequest` and `ConsumptionDeliveryStatus`.

### signet-server: charts, offers and promotional grants in the monetisation routes

- `monetisationRoutes`: `GET /offerings/:placement` returns only the offers this customer may see (`customers.withOffers`); new `POST /offerings/:placement/impression` (204) and `POST /offerings/:placement/redeem` (`{ offerId }`, 409 `OFFER_REFUSED` with the reason).
- `monetisationAdminRoutes({ charts })`, deny by default like the rest: `GET /charts` and `GET /charts/csv` (`?from=&to=&store=&plan=&country=&offering=&audience=`, default the last 30 days), `GET/POST /audiences`, `DELETE /audiences/:id`, `POST /customers/:subject/promotional` and `DELETE /customers/:subject/promotional/:id`. `GET /requests?kind=offer` is accepted. New type `ChartStore`.

### signet-ui: subscription charts screen, offers on the paywall

- New `./screens/subscription-charts`: `SubscriptionCharts` draws signet-db's chart result on the recharts chart parts. It shows summary tiles, then MRR per currency with the converted total, subscribers and trials, new and renewal revenue with refunds, churn and trial conversions, and paywall views against conversions. Filters for store, plan, country and offering, the audience picker, save as audience and the CSV link go out as callbacks. recharts is an optional peer, so the screen is not in the barrel.
- `RemotePaywall` shows the customer's first offer (`RemoteOffer`) in place of the static trial text and passes it to `onPurchase` as a fourth argument. New `onImpression` is called once per offering version. New `PromotionalGrantForm`. The timeline labels `trial`, `promotional` and `refund_request`.

### signet-mcp: add-subscription-charts recipe

- New recipe covering charts, offers, promotional entitlements and CONSUMPTION_REQUEST, cut from the db and server READMEs, with end-to-end checks.

### signet-lib: OFFER_REFUSED error code

- `ERROR_CODES` and `DEFAULT_ERROR_COPY` gain `OFFER_REFUSED` (signet-server's offer claim, 409, with the reason in `details`).

### signet-server: abuse kit (bot checks, disposable email, AI spend routes)

- New `./abuse/captcha`: `captchaVerifier` for Cloudflare Turnstile and hCaptcha (plain `fetch` to siteverify, optional hostname and action checks) with a test mode that passes `CAPTCHA_TEST_PASS`, and `requireCaptcha` middleware for chosen routes. Refusals are 400 `CAPTCHA_REQUIRED`, 403 `CAPTCHA_FAILED`, 503 `CAPTCHA_UNAVAILABLE` (fails closed).
- New `./abuse/email`: `isDisposableEmail`, `disposableEmailChecker({ add, allow })`, `normalizeEmail` (plus-address and Gmail dots) and `blockDisposableEmail` middleware (400 `DISPOSABLE_EMAIL`). Subdomains of listed domains are blocked. Bundles a CC0 list of about 10,000 domains, regenerated by `scripts/disposable-domains.ts`.
- `errorHandler` turns signet-ai's `AI_BUDGET_EXCEEDED` into 429 `AI_SPEND_CAP_EXCEEDED` (with `Retry-After` when the error carries one) and `AI_BUDGET_STORE_FAILED` into 503 `AI_SPEND_UNAVAILABLE`, instead of a 500. This covers concurrent calls that all passed `requireAiSpend` before the ledger refused them.
- New `./http/ai-spend`: `requireAiSpend` (429 `AI_SPEND_CAP_EXCEEDED` naming the cap, with `Retry-After`) and `aiSpendAdminRoutes` (usage, top spenders, set and remove caps; deny by default).

### signet-db: AI spend caps

- New `./ai-spend`: `createAiSpend` with per-user, per-org and global caps per UTC day and month in cost units (micro-USD), counted in `usageCounters`. `spend.ledger` plugs into signet-ai's `createExtractor`; `spend.onUsage` records stream and chat spend. Admin caps live in the new `aiSpendCaps()` table (SQLite and Postgres) and win over the defaults.

### signet-ui: abuse screens

- New `./screens/abuse-screens`: `CaptchaWidget` (loads Turnstile or hCaptcha, reports the token; test mode loads nothing) and `AiSpendAdmin` (spend against caps, top users and orgs, set and remove caps).

### signet-mcp: add-abuse-protection recipe

- New recipe covering bot checks, disposable-email blocking and AI spend caps.

### signet-lib: error codes for the abuse kit

- `ERROR_CODES` and `DEFAULT_ERROR_COPY` add `CAPTCHA_REQUIRED`, `CAPTCHA_FAILED`, `CAPTCHA_UNAVAILABLE`, `DISPOSABLE_EMAIL`, `AI_SPEND_CAP_EXCEEDED` and `AI_SPEND_UNAVAILABLE`.

### Release: signet-db is public, ready for its first manual publish

`@dapplelight/signet-db` is no longer private, so it is at the same step as `signet-payments` in PUBLISHING.md ("A new package's first release"): CI builds and tests both, but does not publish them. The owner publishes 0.1.0 of each by hand and adds the npm Trusted Publisher, and a later change then adds both, together with `create-signet-app` (whose full template depends on them), to the release order, release-status and publish verification.

### signet-db: comments, mentions, activity timeline and version history

- New `./collab`: `createCollab(db, { tables: { comments }, records, orgs, people?, notify?, access?, describe? })` with `collabTables()` (`comments`, `recordVersions`) in `./columns/sqlite` and `./columns/pg`. Comment threads on any org record with replies, edit (`editedAt` marker) and soft delete; `@[Name](user:<id>)` mentions (`parseMentions`, `mentionToken`) kept only for org members and notified once per person per comment, however often it is edited; `mentionable(who, query)` for a picker; `timeline(who, ref)` merges the audit log and comments, newest first and cursor-paginated, each item with field `changes` and a `summary` ("Asha changed status to Done", `describeItem`); `versions`, `diff`, `restore` (a new version plus a `restore` audit entry) and `undo` (409 when `expected` is stale or the record changed outside its history). Deny by default: only tables in `records`, another org's record or a non-member is 404; restore and undo need `<record>:write`.
- `DbConfig.versions: { table, track }` turns on version snapshots per table: every `scoped`/`audited` insert, update and delete on a tracked table writes the next version of the row.

### signet-server: collab routes

- New `./http/collab`: `collabRoutes({ collab, userId })` mounts comments, the mention picker, the timeline, versions, diff, restore and undo in the request's tenant; 401 signed out, 404 across orgs. `mentionTemplates({ url })` is a `comment.mention` template (email and in-app, `mentions` category for preferences) and `notifyMentions(notifier)` sends it keyed by the mention, so nobody is told twice.

### signet-ui: collab screens

- New `./screens/collab-screens`: `CommentThreads`, `MentionTextarea` (an `@` member picker that stores mentions by id), `ActivityFeed` with Load more, and `VersionHistory` with `VersionDiff`, Restore and Undo. Showcase page `screens-collab.html`.

### signet-mcp: add-collab recipe

- `recipe("add-collab")`: comments, mentions, timeline and version history from the db and server READMEs.

### signet-server: real-time channels

- New `./realtime`: `createRealtime({ authorize, limits, heartbeatMs, timeoutMs, typingMs, idleMs })`, one hub for every runtime. Channels per resource live under the connection's org (from `authenticate`, never the client), so one org never receives another's events; `authorize` denies by default. Presence (one entry per user with a tab count, `joined` / `left`, `typing` that clears itself, `editing`), heartbeat timeouts, resume after reconnect from a per-channel history (`since` with epoch and seq, `reset` when the gap is too old), a last-writer-wins shared state per channel with versions and a `conflict` notice to a writer that replaced a newer write, inbound size and rate limits and a slow-consumer close for backpressure. `hub.publish`, `hub.disconnect`, `hub.sweep`, `hub.presence`, `hub.state`.
- `realtimeOutbox(publisher)` delivers signet-db outbox rows on `REALTIME_TOPIC` as change events, with the row id as the event id. `sessionAuth({ verify, cookieName, orgs })` authenticates from the session cookie plus org membership; `admit` checks the handshake's `Origin` (same host unless listed in `origins`).
- New `./realtime/bun` (`bunRealtime`, on `Bun.serve` WebSockets), `./realtime/node` (`attachRealtime`: a small RFC 6455 server on `http.Server`'s upgrade event, no dependency, since Node ships only a WebSocket client) and `./realtime/cloudflare` (`realtimeRoom` Durable Object class, one object per org; `connectRoom`, `roomPublisher`).

### signet-ui: real-time hooks and components

- New `./hooks/use-channel`: `createRealtimeClient` (reconnect with backoff and resume, heartbeat, duplicate-event drop, versioned state), `useChannel`, `usePresence`, `useRecordChanges`.
- New `./screens/realtime-screens`: `AvatarStack`, `EditingBadge`, `TypingIndicator` and `RecordChangedBanner`, with `DEFAULT_REALTIME_LABELS`. Showcase page `screens-realtime.html`.

### signet-mcp: add-realtime recipe

- New `add-realtime` recipe: transports, tenancy, outbox live updates, presence, shared state and the React hooks, cut from the server and ui READMEs.

### signet-db: offerings, customer timeline, identity merge and Customer Center

- New `./offerings`: `createOfferings(db, { tables, plans })`. Offerings are store and web products mapped to plans plus a remote paywall (title, subtitle, plans shown, highlighted plan, badge, trial text, button text); `publish` writes an immutable version (`key@version`, safe under concurrent publishes). Placements (`setPlacement`) serve an offering's latest or a pinned version, with audience overrides on country, platform and attributes (first match wins); `current(placement, audience)` resolves it. `plansFromProducts` builds entitlements' `billing.plans` from the products.
- New `./customers`: `createCustomers(db, { tables, entitlements, payments?, notify?, cancel?, retention? })`. `record(event)` puts signet-payments events on a per-customer timeline once (purchase, renewal, refund, cancellation, billing issue, grace period, expiration...); `timeline(subject)` adds the customer's payments and ledger totals. `anonymousId()` and `merge({ anonymousId, userId, orgId })` move an anonymous buyer's subscriptions, grants, payments, timeline and requests to the account once, refusing repeats into another account, other orgs, non-anonymous ids and non-members; `resolve(id)` follows merges. Customer Center: `overview` (plan, renewal date, manage link, retention offer), `cancel` (web gateways directly, stores by deep link), `acceptRetention` (once per customer), `requestRefund` (own payments only, once per payment) and `contactSupport`, both sent to the team through `notify`; `requests` and `setRequestStatus` for admins.
- `monetisationTables()` in `./columns/sqlite` and `./columns/pg`. `matchesRule` is exported from `./flags`.

### signet-payments: reassign a user's payments

- `PaymentsStore.reassignUser(from, to)` (optional on the type; implemented by `memoryStore` and `sqlStore`) moves every payment of one user to another, for identity merges.

### signet-server: monetisation routes

- New `./http/monetisation`: `monetisationRoutes` (offering per placement and audience, anonymous ids, merge into the signed-in user, Customer Center: overview, timeline, cancel, retention, refund request, support) and `monetisationAdminRoutes` (publish offerings, set placements, any customer's overview and timeline, list and close requests; deny by default).

### signet-ui: monetisation screens

- New `./screens/monetisation-screens`: `RemotePaywall` renders a server offering on the `Paywall` parts and hands the matching store or web product to your checkout (`plansFromOffering`); `CustomerCenter` (plan and renewal date, retention offer before cancel, store manage links, refund request, contact support); `CustomerTimeline` (admin history across App Store, Google Play and web, with ledger totals).

### signet-mcp: add-monetisation recipe

- New `add-monetisation` recipe: offerings and remote paywalls, customer timeline, identity merge, Customer Center and routes, cut from the db and server READMEs.

### signet-server: public API toolkit

- New `./http/openapi`: `openApiSpec(app, options)` builds OpenAPI 3.1 from the app's routes and their `zValidator` schemas (zod's `toJSONSchema`), with the error envelope as `#/components/responses/Error` on 400/401/default and `sessionCookie` / `apiKey` security schemes. `apiDoc({ summary, tags, response, responses, security })` adds per-route detail, `apiDoc(false)` hides a route. `serveOpenApi(app, options)` adds `GET /openapi.json` and `GET /docs` (`apiDocsHtml`: plain HTML, escaped, no script, no dependency).
- New `./http/cache`: `httpCache({ maxAge, private, vary, ... })` sets Cache-Control and Vary, adds an ETag and answers If-None-Match with a 304 that keeps the cache headers; `cachedResponse(c, { kv, freshSeconds, staleSeconds, varyBy }, render)` is a stale-while-revalidate response cache on any `KeyValue`; `cacheControlValue`, `mergeVary`, `etagMatches`.
- New `./http/webhooks`: `webhookRoutes({ webhooks, owner })`, admin routes for signet-db's outbound webhooks (endpoints, rotate secret, delivery log, redeliver).

### signet-db: outbound webhooks

- New `./webhooks`: `createWebhooks(db, { endpoints, deliveries })` with `webhookTables()` in `./columns/sqlite` and `./columns/pg`. Endpoints per user or org with their own secret (encrypted at rest with a db cipher), Standard Webhooks signatures, one outbox row per delivery so `drainOutbox` retries with backoff, a delivery log (status, attempts, response), `redeliver` with the same event id, and endpoints switched off after `disableAfter` failed attempts in a row. Endpoint urls must be https on a public host unless `allowPrivateUrls`; before each attempt the host is resolved (`node:dns/promises`, or a `resolveHost` override) and private, loopback, link-local, CGNAT, unique-local and IPv4-mapped addresses are refused. Redirects are never followed. `isPrivateAddress` is exported.

### signet-lib: webhook signatures

- New `./webhooks`: `signWebhook`, `verifyWebhook` and `generateWebhookSecret` for Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`), Web Crypto only; secret rotation and Svix headers supported.

### signet-ui: API screens

- New `./screens/api-screens`: `ApiReference` renders an OpenAPI document's endpoints on Signet tokens; `WebhookDeliveryLog` shows deliveries with status filter, response details and redeliver.

### signet-mcp: publish-an-api recipe

- New `publish-an-api` recipe: OpenAPI and docs, outbound webhooks, signatures and HTTP caching, cut from the server, db and lib READMEs.

### signet-server: org settings no longer take a custom domain

- `PATCH /current` in `orgRoutes` now answers 400 when the body has `domain`, instead of dropping it and returning 200. `tenant()` matches the custom domain first, so a member who could set any host would decide the tenant for every request to it. Set it with `orgs.update` from an operator or verified-DNS flow.
- signet-ui `OrgSettings`: the custom domain field is gone, along with `domain` in `OrgSettingsValue` and the `domain`, `domainHint` and `invalidDomain` labels. Migration: stop passing those labels and stop sending `domain` from `onSave`.

### signet-db: audit trail for org writes

- `createOrgs` writes an `auditLog()` entry for org create and settings changes, member add, role change, remove and leave, custom role create, change and delete, and invite create, accept and revoke: actor, action, and before/after snapshots carrying the `orgId`. Never the invite token or its hash. Skipped when the db has no audit table.

### signet-db: organisations and tenant scope

- New `./orgs`: `createOrgs` for organisations (slug, custom domain, theme, brand colour), memberships with roles, role → permission sets with per-org custom roles, invites with expiring single-use tokens, and no-escalation and last-owner checks. `DEFAULT_ORG_ROLES`, `ORG_PERMISSIONS`, `defineRoles`, `hasPermission`, `canGrant`, `OrgError`.
- `orgTables()` in `./columns/sqlite` and `./columns/pg`: `organizations`, `memberships`, `invitations`, `orgRoles`.
- `scoped(db, { orgId })` and `scoped(db, { userId, orgId })`: org-scoped reads and writes, deny-by-default for tables without `orgId` (`NOT_TENANT_TABLE`, `CROSS_ORG_WRITE`).
- `defineAdmin`: `ctx.orgId` limits the admin API to one org; `tenant: true` requires it.

### signet-server: organisations and tenants

- New `./http/orgs`: `tenant()` middleware resolves the org from the custom domain, subdomain, route param, `x-org` header or switch cookie; `orgGuards()` gives `requireMember`, `requireRole` and `requirePermission` (401 / 404 for outsiders / 403); `orgRoutes()` mounts org switching, settings, members and invites on signet-db's `createOrgs`. `currentTenant`, `currentMembership`, `grants`, `orgCookie`.

### create-signet-app: organisations in the full template

- Sign-up creates a personal org (owner). `tenant()` resolves the org from the switch cookie or `x-org` header, and from a custom domain or `<slug>.ORG_ROOT_DOMAIN` (new optional env). An org switcher in the app shell; `/org` settings and `/org/members` with roles and invite links; `/invite/$token` to accept (signed-out visitors sign in and come back). `/admin` stays the platform operator's view. Migration `0001_orgs`. API and browser tests cover a second org, an accepted invite, and 404 for another org.

### signet-ui: org screens

- New `./screens/org-screens`: `OrgSwitcher`, `MembersList`, `InviteDialog`, `AcceptInvitePage` and `OrgSettings` (name, custom domain, theme, brand colour with a live `buildTheme` preview), shaped like signet-server's `orgRoutes`. Showcase demo: `screens-orgs.html`.
- `InviteDialog` takes `askEmail={false}` for apps with no verified email to bind an invite to.

### signet-db: durable workflows

- New `./workflows`: `defineWorkflow(name, async (step, input) => ...)` and `createWorkflows(db, { tables, workflows })`. Steps: `step.run` (memoised, retries with backoff), `step.sleep` / `step.sleepUntil`, `step.waitForEvent(name, { timeout })`, `step.approval({ approvers, timeout })`. Engine: `start`, `tick` (lease-claimed, safe across concurrent runners), `poll`, `get`, `list`, `sendEvent`, `approve` / `reject`, `pendingApprovals`, `cancel`, `prune`. Runs resume from the database after a restart.
- New `workflowTables()` in `./columns/sqlite` and `./columns/pg`.
- New error codes `STEP_FAILED` and `NONDETERMINISTIC`.

### signet-server: workflow routes

- New `./http/workflows`: `workflowRoutes({ workflows, subject, isAdmin?, canStart? })` for signet-db's durable workflows: start, run status and step history, send event, approve/reject an approval step, cancel, an admin list of runs and the caller's approval inbox. Takes the engine structurally; no signet-db dependency.

### signet-ui: workflow screens

- New `./screens/workflow-screens`: `WorkflowRunTimeline` (status, what the run waits on, steps in order with retries and approval decisions, cancel) and `ApprovalInboxCard` (approve or reject with an optional reason), shaped like signet-db's workflow results. Demo: `screens-ops.html?screen=workflows` in the showcase.

### signet-mcp: workflows recipe

- New `add-workflows` recipe, cut from signet-db's "Workflows" and signet-server's "Workflow routes" sections.

### create-signet-app: full template uses the real admin and billing screens

The full-stack template's Admin page is now signet-ui's `AdminPanel` (nav, toolbar with search and filters, server-driven table, pager, record sheet) over the template's `/api/admin`, and its Billing page is `BillingScreen` with `plansFromEntitlements(plans, PLAN_DISPLAY)`. Plans move to `api/plans.ts`, shared by the API and the page; `GET /api/billing` now returns `{ subscription, usage }`. The Playwright smoke test checks that the admin table loads and that the plan picker marks the current plan before and after checkout.

### signet-ui: admin screen from the schema

- New `@dapplelight/signet-ui/screens/admin-screens`: `AdminScreen`, an admin
  panel generated from signet-db's `defineAdmin` metadata, served by
  signet-server's `adminRoutes`. Table list; server-side sort, typed filters
  (`{ column: { op: value } }` chips), text search and cursor pages; a
  soft-deleted toggle; a record panel whose form is built from the column
  types (enum, boolean, number, money, date, JSON, text) with server field
  errors on the fields; create, bulk delete, row actions with confirmation,
  and the audit trail from an `auditLog()` table.
- `createAdminApi({ baseUrl, fetch, headers })` implements `AdminApi` over
  fetch; failures become `AdminApiError` with `fieldErrors`.
- Parts are exported (`AdminPanel`, `AdminNav`, `AdminHeader`,
  `AdminToolbar`, `AdminFilterButton`, `AdminTable`, `AdminRowActions`,
  `AdminPager`, `AdminRecordSheet`, `AdminRecordForm`, `AdminAuditTrail`)
  with `useAdmin()`; every string is in `DEFAULT_ADMIN_LABELS` and the
  `labels` prop; `className` on every part, `classNames` on the screen,
  `render` swaps part elements, `renderCell` / `renderField` replace cells and
  fields; the open table and record are controlled or uncontrolled.
- signet-mcp indexes `screens/` exports for `compose_component`.

### signet-ui: billing and growth screens

- New `@dapplelight/signet-ui/screens/billing-screens`: `BillingScreen` and
  `Paywall`, plus `PlanPicker` (plan cards as one radio group, monthly /
  yearly with the saving, store builds hide web-only plans), `CurrentPlanCard`
  (status, `currentPeriodEnd`, source: App Store, Google Play or web),
  `RestorePurchasesButton`, `UsageMeters` (signet-db `Usage`, amber at 75%,
  red at 90%), `InvoiceList` (links to the GST HTML invoice) and `WalletCard`.
  `plansFromEntitlements` turns a `definePlans` object plus names and prices
  into the plan list; `formatMoney` formats minor units.
- New `@dapplelight/signet-ui/screens/growth-screens`: `WaitlistJoin` (place
  in line), `InviteAccept` (`acceptInvite` reasons in plain words),
  `ReferralCard` (code, copy, Web Share, stats), `OnboardingChecklist`
  (progress ring, next step), `FeedbackWidget` / `FeedbackForm` (kinds,
  optional stars) and `WhatsNew` (unseen count; opening marks seen).
- Same contract as the admin screen: theme tokens only, every string in
  `DEFAULT_BILLING_LABELS` / `DEFAULT_GROWTH_LABELS`, `className` on every
  part and `classNames` on composites, state as `data-*`, `render` to swap
  a part's element, controlled or uncontrolled selection and open state.
- Showcase: `screens-ops.html` demos every screen in every theme, with a bar
  to switch screen, theme and dark mode.

### create-signet-app: full-stack template, `--pm`, finance theme

- `--template full`: a web app and its Bun + Hono API in one project. Typed
  client (`createRpcClient(hc<AppType>)`), SQLite through signet-db with
  drizzle-kit migrations (users and roles, audit log, entitlements, growth,
  privacy, and a kv table for sessions, codes, API keys, inbox and rate
  limits), phone one-time-code sign-in with stored sessions, and pages wired
  to signet-ui's auth, account, notification and privacy screens, plus billing
  (plans, fake checkout in development, Razorpay webhooks to entitlements) and
  admin (`defineAdmin` over the schema, by role). Ships API tests, a Playwright
  smoke test (sign-in → admin → billing) and a first-day README.
- `--pm bun|npm|pnpm` (default: the one that ran it, else bun) sets CI's
  install and run commands, the printed next steps and the README; pnpm apps
  get a `pnpm-workspace.yaml` approving esbuild's and workerd's build scripts.
- `--theme finance`.

### signet-ui: chart on recharts 3

- `./components/chart` now targets recharts 3 (peer `>=3.8 <4`, the release that added the `useXAxisScale` / `useYAxisScale` hooks the bar shape uses), matching shadcn's current chart. Tooltip and legend content props are typed from recharts 3's `DefaultTooltipContentProps` and `DefaultLegendContentProps`; `ChartContainer` passes an `initialDimension` to `ResponsiveContainer`.
- Charts look exactly as on recharts 2 (before/after screenshots identical to the pixel in every theme, light and dark). `ChartContainer` gives each plain `<Bar>` a shape that keeps recharts 2's whole-pixel bar widths (recharts 3 rounds where 2 floored) and its full-precision corners, and styles recharts 3's axis tick labels with the theme's muted ink. Bars with their own `shape`, and charts with `barSize` / `maxBarSize`, are left to recharts.
- Migrating: upgrade the app's `recharts` to 3. Custom tooltip content that read `payload` or `label` from `TooltipProps` should take `TooltipContentProps`.

### signet-ui: admin screen from the schema

- New `@dapplelight/signet-ui/screens/admin-screens`: `AdminScreen`, an admin
  panel generated from signet-db's `defineAdmin` metadata, served by
  signet-server's `adminRoutes`. Table list; server-side sort, typed filters
  (`{ column: { op: value } }` chips), text search and cursor pages; a
  soft-deleted toggle; a record panel whose form is built from the column
  types (enum, boolean, number, money, date, JSON, text) with server field
  errors on the fields; create, bulk delete, row actions with confirmation,
  and the audit trail from an `auditLog()` table.
- `createAdminApi({ baseUrl, fetch, headers })` implements `AdminApi` over
  fetch; failures become `AdminApiError` with `fieldErrors`.
- Parts are exported (`AdminPanel`, `AdminNav`, `AdminHeader`,
  `AdminToolbar`, `AdminFilterButton`, `AdminTable`, `AdminRowActions`,
  `AdminPager`, `AdminRecordSheet`, `AdminRecordForm`, `AdminAuditTrail`)
  with `useAdmin()`; every string is in `DEFAULT_ADMIN_LABELS` and the
  `labels` prop; `className` on every part, `classNames` on the screen,
  `render` swaps part elements, `renderCell` / `renderField` replace cells and
  fields; the open table and record are controlled or uncontrolled.
- signet-mcp indexes `screens/` exports for `compose_component`.

### signet-test: new package (private until published)

- New `@dapplelight/signet-test`: fake providers with the real interfaces,
  each recording its calls. Nothing reaches the network.
- `fakeGateway("razorpay" | "stripe" | "payu")`: the real signet-payments
  adapter over an in-memory server in each gateway's own formats. Covers
  checkout, capture, refunds, customers, subscriptions (renewals, failed
  charges, cancels), payouts and settlements, with signed lifecycle webhooks.
  `UNSUPPORTED` only where the gateway has no such API (PayU subscriptions
  and payouts). Failure injection (`fail("decline" | "unavailable" |
  "timeout")`), idempotency keys that replay like the gateways' (scoped per
  endpoint, safe under concurrency, rejected on a different body), `reset()`.
- `fakeAppStore` / `fakeGooglePlay`: signed transactions and notifications
  from test-generated keys for the real `appstore()` / `googleplay()`, with
  lifecycle helpers (subscribe, renew, grace period, billing retry / account
  hold, cancel, expire, refund, revoke) that keep the store APIs in step.
- Tests drive the real ledger and entitlements through every failure:
  duplicate and concurrent webhooks, out-of-order and stale events, timeouts,
  5xx retries, declines. Grants and bookings happen once.
- `fakeSenders` with an outbox for `createNotifier` (failures are real
  `NotifyError`s, permanent or transient); `fakeNotifyStore`, an in-memory
  `NotifyStore` on the fake clock; `fakeModel` on the AI SDK mock;
  `fakeClock`; `fakeFetch`.
- `./playwright`: `signInAs`, `seed`, and `expectAcrossThemes(page, name)`,
  which compares screenshots across the 3 themes × light/dark against stored
  baselines. `@playwright/test` is an optional peer.
- `./overlay`: `DevOverlay`, a dev-only panel (user, plan, entitlements,
  flags, theme switcher, outbox). Production builds resolve a stub through
  the `production` export condition; it also loads without a bundler and
  takes an explicit `enabled`.
- `./demo`: `createDemo` wires every fake (gateways, payments, senders,
  notify store, model) on a fake clock with seed data and `/__signet/*`
  routes, so an app runs fully offline; `reset` restores all of it.
- CI: a separate job runs the Playwright suite in Chromium against stored
  Linux baselines.
- signet-mcp: new `add-tests` recipe.

### signet-tokens: green, amber and primary text reach 4.5:1 on cards

- Light `--accent-green` is a shade darker: editorial (and finance) `#12833c` → `#117e3a`, cinematic `#0c847a` → `#0b7e75`. Green text on cards (`stat-strip` deltas, `trend-chip`, `amount`'s credit tone through `--money-credit`) measured 4.19–4.25:1 on `--bg-surface`; it is now 4.53:1. Dark themes are unchanged.
- The contrast test now checks `--accent-green` on `--bg-surface` and `--card`, so it fails if green text drops below 4.5:1 again.
- Light `--accent-amber` is a shade darker too: editorial `#986908` → `#926508`, cinematic `#b16105` → `#aa5d05` (4.21–4.23 → 4.51:1). Editorial `--primary` and `--ring` go from `#12833c` to `#117e3a`, so `text-primary` on cards passes (4.53:1); buttons and the focus ring shift by the same shade, and white on primary is 5.16:1. The contrast test checks amber and primary on `--bg-surface` and `--card` as well.

### signet-ui: amount, kanban and four hooks

- New `./domain/amount`: `Amount` and `formatAmount`. Money in the locale's grouping (lakh/crore in Indian locales), the currency's own decimals, `minorUnits` (bigint-exact), `notation` "standard" | "whole" | "compact" (₹12.5L, ₹1.2Cr, $1.3M), Intl `signDisplay`, and `tone` "credit" | "debit" | "transfer" | "auto" from the theme's `--money-*` slots with status-accent fallbacks. A span with `data-part` and a `classNames` entry per part; `data-tone`, `data-sign`; `render` swaps the `<data>` element.
- New `./domain/kanban`: `Kanban`, `KanbanColumn`, `KanbanColumnHeader`, `KanbanColumnTitle`, `KanbanList`, `KanbanItem`, plus `moveItem` and `findItem`. Cards move between columns by native drag and drop or by keyboard (Space or Enter picks up, arrows move, Space or Enter drops, Escape cancels), each step announced in a live region with overridable `messages`. Controlled (`value` + `onValueChange`) or uncontrolled (`defaultValue`, children as a function of the board); `onItemMove` reports the single move. `data-over`, `data-lifted`, `data-dragging` for styling.
- New hooks, one subpath each: `./hooks/use-debounce`, `./hooks/use-local-storage` (JSON, SSR-safe via useSyncExternalStore, synced across tabs and components), `./hooks/use-copy`, `./hooks/use-intersection`.

### signet-tokens: theme builder and per-component density

- New `./theme` export: `buildTheme({ brand, base?, mode?, density? })` derives every colour token (primary, surfaces, text, borders, status accents, charts, focus, and money on `finance`) for light and dark from one brand colour, in OKLCH. Text tokens are guaranteed WCAG 4.5:1 on the surfaces they sit on (focus and charts 3:1); any token moved to get there is listed in `adjustments`.
- `toCss(theme)` writes a theme file that imports its base and overrides its colours; `toDesignTokens` / `fromDesignTokens` write and read W3C Design Tokens (DTCG 2025.10) JSON; `toFigmaVariables` gives the Figma Variables API body.
- Density: `data-density="compact" | "comfortable" | "spacious"` on any element, and `--density-<slot>` tokens (button, input, textarea, select-trigger, badge, card, tabs-list, dialog-content, sidebar) for one component everywhere. The themes' `--spacing` now carries two multipliers that default to 1, so every shipped theme looks exactly as before.

### signet-mcp: build_theme

- New `build_theme` tool: a theme from a brand colour as CSS, Design Tokens or Figma Variables, with its adjustments and a contrast re-check.

### signet-cli: signet theme

- `signet theme <hex> [--base] [--mode] [--density] [--format css|tokens|figma] [--out]`, and `--import tokens.json` to turn a token file back into CSS.

### signet-cli: backend modules and codemods

- `signet add auth | db | payments | notify | admin` copies a backend module into `src/server/` of an app made with `create-signet-app --template api`, adds its import and `.route(...)` to `src/app.ts`, its keys to `envSchema` in `src/env.ts` and to `.env.example` (once; lines without an anchor are printed), and installs its npm packages with the app's package manager (from the lockfile; `--no-install` prints the command). Module files upgrade and diff like any item.
- `signet upgrade` runs versioned codemods once per app: signet-ai 0.4 rewrites `generateObject` to `generateText` with `Output.object` and bumps `ai` to 7; signet-db `setPlan` and signet-server `registerIngest` call sites are listed with what changed. `--dry-run` prints the diffs. Needs `typescript` in the app.
- signet-mcp: new `add-backend-module` recipe.

### signet-lib, signet-server, signet-db, signet-ui: analytics sessions, identify, stored events, queries and answers

- signet-lib `./analytics`: events carry a random `anonymousId` and a `sessionId` (new after 30 minutes idle, `sessionTimeoutMs`). New `identify(userId, traits)` (sends only `traitKeys`, default none), `reset()`, `context`, `headers()`, `requireConsent` (nothing tracked before `optIn()`), `continueSession`, `ANALYTICS_HEADERS`. `optOut()` also forgets the ids; `optIn()` now stores "0".
- signet-server `./analytics`: `TrackedEvent` gains `anonymousId`, `sessionId`, `userId`. `registerIngest` keeps the visit ids, drops a client-sent `userId` unless given a `userId` resolver (or `trustClientUserId`). New `./analytics/session`: `analyticsContext(headers)`, `serverTracker(sink, ctx)` with `track` and `identify`. The Analytics Engine writer puts the ids first as `aid`/`sid`/`uid` blob pairs.
- signet-db: new `./analytics` with `createAnalyticsStore` (an `AnalyticsSink` on any dialect) and `analyticsEvents()` tables in `./columns/sqlite` and `./columns/pg`. Links anonymous events on `$identify`, keeps userIds only with DPDP consent when given `privacy`, `retentionDays` (default 395) with `prune()`. Typed, injection-safe queries: `count`, `uniques`, `series`, `breakdown`, `funnel`, `retention`, `trend`, `events`. Read-only `analyticsTools` (`list_events`, `query_analytics`).
- signet-ui: new `./components/metric-headline`: `MetricHeadline` turns `{ current, previous }` into one sentence, number and trend ("Signups up 18% this week"), with `copy`, `classNames`, `data-direction`/`data-tone`, exported parts, `goodWhen`/`flatWithin`/`format`, `metricTrend` and `metricSentence`, and privacy-mask support.
- signet-mcp: the `add-analytics` recipe covers sessions, stored events, queries and the headline.

### signet-server: MCP on by default — routes as tools, per-user tools, pending approvals

- `appTools(app)` (`./mcp`): every route validated with `zValidator` becomes an
  MCP tool — name from the method and path, description from `asTool` or the
  schema's `.describe()`, input from the json/query/param validators. GET is
  read-only; any other method asks first through `requireApproval`.
  `asTool({ ... })` names, describes or opts a route in; `asTool(false)` leaves
  it out; `appTools(app, { optIn: true })` takes only marked routes. A GET
  or DELETE with a json validator is skipped (its arguments go in the query).
- `routesAsTools` routes take `approval`, `query` and `visible`, and forward
  `cf-connecting-ip` / `x-forwarded-for` so route tools share the caller's
  rate-limit bucket.
- Tools take `visible(caller)`: a tool for some roles or plans is neither
  listed nor callable for anyone else. `createMcpServer` throws on one (it has
  no caller); serve through `resolveMcpServer` / `mcpHandler`.
- Pending approvals: `kvApprovals(kv, { ttlSeconds, onEvent })` on
  `createMcpServer({ approvals })`. A client that cannot ask gets
  `APPROVAL_PENDING` with the record's id; the person approves or denies it
  through `approvalRoutes` (`./http/routes`); the same call (tool, principal,
  arguments) then runs once. Records expire; requests, decisions and uses are
  events for an audit log, elicited answers included. A call with no
  principal opens no record (no one could decide it) and gets
  `APPROVAL_REQUIRED`. Without a store, behaviour is unchanged.
- `approvalGate`: `requireApproval` in the `approve` shape signet-db's and
  signet-payments' tool factories take, so their writes use the same step.

### signet-lib: `APPROVAL_PENDING` error code

- New code in `ERROR_CODES`, with default copy.

### create-signet-app: MCP for agents, chosen at scaffold time

- The api template asks "Add MCP for agents?" (default yes); `--mcp` /
  `--no-mcp` decide without a terminal (default `--mcp`). With MCP, `/mcp`
  serves every `zValidator` route as a tool (`appTools`), writes ask first,
  `MCP=off` turns it off, and `@modelcontextprotocol/server` is added. With
  `--no-mcp` there is no dependency, file or mention of it. Needs the
  signet-server release with `appTools`.

### signet-lib: typed client timeouts and streaming

- `createRpcClient` takes `timeoutMs`: each attempt's wait for response headers is bounded, and the request is aborted through its `AbortSignal` (raced too, so a custom `fetch` that ignores the signal still times out). `timeout(ms, init?)` passed as hc's `init` replaces it for one call; `timeout(0)` turns it off.
- New `TimeoutError` (and `isTimeoutError`): an `ApiError` with status 408 and code `TIMEOUT`, carrying `timeoutMs` and the request id. A timed-out GET or HEAD counts toward `retries`; other methods are never retried. A caller's own abort stays an abort.
- `ApiError.name` is now typed `string` rather than the literal `"ApiError"`, so subclasses can name themselves.
- New streaming readers in `./api`: `readText`, `readNdjson<T>`, `readSse` and `readSseJson<T>`, async iterators over any `Response`. `readSseJson` stops at `[DONE]` and reads signet-ai's `streamChat` response directly. Breaking out of a loop cancels the body.

### signet-ai: persistent caches and cost saved

- The cache key now covers the model: `createExtractor` adds its provider chain (`name/model` of each provider, in order) to the schema, instructions and input. `cacheKey` takes an optional fourth `model` argument; without it the key is unchanged. Existing cached entries miss once after upgrading.
- `kvCache` also takes a Cloudflare Workers KV namespace directly (`kvCache(env.AI_CACHE)`), writing with `expirationTtl` floored at KV's 60-second minimum; expiry is still checked on read.
- A cache hit is reported to `onUsage` with `cacheHit: true`, `costUsd: 0` and `savedUsd`, the original call's cost. `UsageReport` gains both optional fields, and `analyticsUsage` writes them as props.
- A cache that throws no longer fails the call: a failed read is a miss and a failed write is dropped, each emitting `ai.cache_error` to `onEvent`. Before, a failed write after a paid answer could fail over and pay again.

### signet-db: AI answer cache

- New `aiCache()` table in `./columns/sqlite` and `./columns/pg`, and `dbCache(db, table)` plus `pruneAiCache(db, table)` in the core: a persistent `Cache` for signet-ai's `createExtractor` on SQLite, D1 or Postgres. Expired or unreadable rows are misses; with a cipher on the db the entry is stored encrypted.

### signet-mcp: recipes

- The `add-api-client` recipe is found by "timeout", "streaming", "sse" and "ndjson"; `add-ai-extraction` includes signet-ai's "Persistent caches" section and `add-db` the "AI answer cache" section.

### signet-ui: user-facing screens (auth, account, notifications, privacy)

Ready screens under `@dapplelight/signet-ui/screens/*`, kept out of the main
barrel. Each takes plain data and callbacks shaped like the backend modules,
so an app wires them through `createRpcClient`:

- `screens/auth-screens`: `AuthScreen` (sign in / sign up with an email or
  phone one-time code, OAuth buttons), `VerifyCodeScreen`,
  `SessionExpiredScreen`, and their parts (`AuthCard`, `OAuthButtons`,
  `CodeRequestForm`, `VerifyCodeForm`…).
- `screens/account-screens`: `ProfileCard`, `SessionsList` (rows from
  signet-server's `sessionRoutes`, sign out one device or every other, with a
  confirm), `ApiKeysManager` (create shows the key once, then drops it;
  revoke confirms).
- `screens/notification-screens`: `NotificationInbox` (all / unread, mark
  read on open, mark all read, archive, load more, an all-caught-up state;
  `renderItem` turns rows into links) and `NotificationPreferences` (a switch
  per category and channel, required categories locked on, a failed save
  rolls back). Shapes match the notifier's `InboxItem` and `Prefs`.
- `screens/privacy-screens` (DPDP): `ConsentList` (one switch per purpose;
  withdrawing is as easy as giving, no confirm; shows the notice version and
  date) and `DataRequests` (export and erasure requests with status, erasure
  confirms, a pending request blocks a duplicate, completed exports
  download). Shapes match signet-db's `Consent` and `DataRequest`.

Every string is a prop (`labels`, spread from `DEFAULT_*_LABELS`), every part
takes `className` (composites also `classNames`) with state as `data-*`,
stateful parts are controlled or uncontrolled, and each file's `// Recipe:`
line lists its behaviours for signet-mcp's `compose_component` (which now
indexes `./screens/*`). Files import only signet-ui parts, so they copy in.

### signet-ui, signet-tokens: inactive tabs and destructive tints reach 4.5:1

- `TabsTrigger`: inactive text is `text-text-primary/65` (was `/60`) in light
  and `text-text-primary/55` (was `text-text-muted`) in dark. It measured
  4.3:1 on the tab list in editorial and finance light, editorial dark and
  cinematic dark.
- `cinematic.css` light: `--accent-red` is `#be123c` (was `#e11d48`). Red
  text on its own 10% tint (destructive `Badge`, `Button` and `Alert`)
  measured 3.7:1. `--destructive` and `--accent-red-subtle` are unchanged.
- The tokens contrast test now also checks text painted with an opacity
  modifier, reading the alphas from the component source, so a class or a
  token change that drops these below 4.5:1 fails.

### signet-cli: `signet add` and `signet upgrade` (own the code)

- New private package `@dapplelight/signet-cli` with a `signet` bin. `signet add <name>` copies a signet-ui item and the items it imports into the app as editable source (default `src/components/signet`), rewrites relative imports to the app's alias, records each copy's base hash in `signet.json` and prints the npm packages it still needs.
- `signet upgrade [name]` merges upstream changes into the copies: unedited files are replaced, edited ones get a 3-way `git merge-file`, and clashing lines keep conflict markers. `--dry-run` writes nothing. `signet diff <name>` shows what changed upstream since the copy; `signet list` shows every item and what is added, edited or out of date.
- `add` refuses to overwrite a file you edited when signet-ui also changed it, unless `--force`.
- The registry (files, internal deps, npm peers, content hashes) is generated from packages/ui by the package's `build`; nothing generated is committed.
- signet-mcp: new `add-component-source` recipe.

### signet-server, signet-lib: typed client

- signet-server `./http/validate`: `zValidator(target, schema)` for `json`,
  `query`, `param`, `header`, `cookie` and `form`. Hono's own validator on a Zod
  schema, so `c.req.valid()` and `hc` see the types; failures are the same 400
  `VALIDATION_FAILED` envelope as `parseBody`. No new dependency.
- signet-server: `SessionRoutes` type from `./auth/hono`; new `./http/routes`
  with `entitlementRoutes` (`GET /`, `GET /usage`) and `flagRoutes` (`GET /`),
  which take signet-db's stores structurally, plus their `EntitlementRoutes` and
  `FlagRoutes` types.
- signet-lib `./api`: `createRpcClient(hc<AppType>, options)`. The same options
  as `createApiClient` plus `retries` (GET/HEAD only, default 0) and `fetch`.
  Sends `x-request-id`, throws `AuthError` on 401 and `ApiError` from the
  envelope on any other failure, so `.json()` is the success type.
### signet-server: notifications

- New `./notify/notifier`: `createNotifier` with `notify(userId, event, data)`
  over zod-typed, per-locale, per-channel templates (`defineTemplates`);
  preferences per user × category × channel with required categories
  (security, otp, billing); timezone-aware quiet hours (default
  Asia/Kolkata, urgent bypasses); signed one-click unsubscribe (RFC 8058
  headers); in-app inbox (cursor list, unread count, mark read, archive);
  delivery records; suppression; WhatsApp opt-in; per-user per-channel rate
  limit; idempotent deliveries; `notifyJob` to send through `createJobs`;
  `exportUser` / `deleteUser`; `kvNotifyStore`; themed `emailLayout` with a
  plain-text fallback.
- New `./notify/channels`: fetch-only senders for Resend, Postmark, Twilio SMS,
  MSG91 SMS, the WhatsApp Cloud API, web push and Telegram; `devSender` (refuses
  production and staging); DLT refusal for `+91` SMS; `smsSenderFor` gives
  auth's OTP a real SMS sender.
- New `./notify/webhooks`: signature-verified handlers for Resend (Svix),
  Twilio and Meta, normalised into delivery events; hard bounce, complaint and
  STOP suppress the address; `unsubscribeRoute`.
- New `./notify/tools`: `list_my_notifications`, `notification_prefs`,
  `update_prefs`, and staff-only `send_notification` behind `requireApproval`.

### signet-ui (unreleased)

- New components on UI SDK behaviours, styled with theme tokens: `toast`
  (`<Toaster />` and a sonner-compatible `toast()`), `alert-dialog`, `field`
  (takes TanStack Form `errors`), `avatar` (with `initials()`), `radio-group`,
  `command` (with a ⌘K `CommandDialog`), `timeline`, `stepper`, `sidebar`
  (collapsible, a drawer on phones, ⌘B), `breadcrumb`, `spinner`.
- New `@dapplelight/signet-ui/behaviors`: `useShortcut`, `useShortcutLabel`,
  `useControllableState`, `matchScore`, with Signet's own types.
- New dependencies `@ui-sdk/core` and `@ui-sdk/react`, pinned to
  0.1.0-beta.2. They are internal: no UI SDK type or function is re-exported.
- Existing components are unchanged.

### signet-mcp (unreleased)

- New `compose_component` tool: from a need in words, the matching components
  with their behaviour recipe (each component's `// Recipe:` line), parts,
  token classes and example, plus the behaviours and the build guide.
  `get_component` now returns `summary` and `recipe`.

### Store purchases to plans (signet-db, signet-payments)

- signet-db `/entitlements`: `subject_plans` now holds one row per source
  (id `${gateway}|${subscriptionId}`; `manual` for `setPlan`), with a new
  `current_period_end` column. App Store, Google Play and web gateway
  subscriptions of one subject roll up into one entitlement per plan, active
  while any source is; `currentPeriodEnd` is the latest among active sources.
  `get` adds `currentPeriodEnd`, `source` and `entitlements`. Plans are
  declared lowest first; the last declared active plan wins, so `setPlan`
  no longer overrides a live subscription on a later plan.
- `billing.plans` keys may be prefixed with the gateway
  (`"appstore:pro.monthly"`); `planIdOf` falls back to the event's
  `productId`; new `billing.periodEndOf` (Stripe, Razorpay, Paddle defaults).
- `storeStateOf` reads App Store (`data.status`, `expiresDate`,
  `gracePeriodExpiresDate`) and Google Play (`subscriptionState`, `expiryTime`)
  state: renewals, expiry, refund or revoke, grace period, billing retry and
  account hold. App Store refunds of a subscription now apply.
- `applySubscription(sub, { subject })`: the restore path for a subscription
  read live. A subscription owned by another subject is refused
  (`reason: "other_subject"`, replacing `other_subscription`). Google Play
  tokens linked by `linkedPurchaseToken` keep their subject.
- `get_plan` shows entitlements and sources; `set_plan` sets the manual plan.
- signet-payments: `restorePurchases({ userId, purchases })` re-verifies App
  Store signed transactions and Google Play purchase tokens against the store
  and claims them under `verifyPurchase`'s rule; `paymentTools` takes
  `entitlements` to add `refresh_entitlement`.

### signet-payments: UPI intents and GST invoices

- New `./upi`: `upiIntent` builds `upi://pay` links from NPCI's linking
  parameters (amounts in paise), `isVpa`. No QR encoder ships.
- New `./gst`: `isValidGstin`/`parseGstin` (check character), `gstInvoice`
  (rule 46 checks, CGST + SGST or UTGST within a state, IGST across states
  or to an SEZ, per-line half-up rounding in integers), `renderGstInvoiceHtml`,
  `financialYear`, `invoiceNumber`, `amountInWords`, `formatInr`,
  `GST_STATES`. Reverse charge, exports, cess, place of supply 97 and
  e-invoicing are unsupported.

### signet-db: DPDP consent and data requests, sequences

- New `./privacy`: `createPrivacy` on `privacyTables()` (both dialects):
  append-only consent records per purpose and notice version, withdrawal,
  export and erasure requests fulfilled with `exportUser`/`deleteUser`,
  optional due dates, `overdue()`. `privacyTools` for an agent acting for
  one person; writes gated on `approve`.
- `nextSequence(db, sequences(), key)`: concurrent-safe named counters.

### signet-db: growth basics (waitlist, invites, referrals, onboarding, changelog, feedback)

- New `./growth`: `createGrowth(db, { tables })` on `growthTables()` (both
  dialects). Waitlist with idempotent join and position; invites whose token
  is returned once and stored as SHA-256, accepted once by a conditional
  update, with expiry, revocation and an optional email lock; referral codes,
  one referrer per person, convert and reward once; onboarding steps and
  changelog "last seen" on a `marks` table; feedback with kinds, rating and
  status.
- `growthTools(...)`: operator agent tools; writes gated on `approve`.
- Internal: the plain tool shape and approval gate moved to `tool-kit.ts`;
  `entitlementTools` is unchanged.
### signet-ai 0.4.0: AI SDK 7, usage hook, tool loops, streaming, embeddings, grounding

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
  default), and each subscription is tracked as its own source. The event type is a local
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

### Admin API from the schema

- signet-db: new `./admin` subpath. `defineAdmin(schema, { authorize })`
  gives list (cursor pages, allow-listed sort and typed filters, text search),
  get, create, update, delete (soft where the table has `deletedAt`), bulk
  delete, per-row actions and a `meta` description for admin UIs and agents.
  Deny by default (`roles()` for admin/staff/readonly); encrypted and
  secret-looking columns hidden; inputs validated with `toZod`; every write
  through `audited()` with the caller as actor; the audit table is read-only
  and its snapshots redacted. `handle()` serves it over HTTP, framework-free.
- signet-db: `adminTools(admin, { db, ctx, approve })`, admin MCP tools from
  the same definition; writes only after `approve` (signet-server's
  `requireApproval`) says yes, audited as the agent.
- signet-db: new error codes `FORBIDDEN`, `VALIDATION_FAILED`,
  `METHOD_NOT_ALLOWED`, `BAD_CONFIG`; `AdminError` carries an HTTP status.
- signet-server: new `./http/admin`, `adminRoutes(admin, { db, ctx })`, mounting
  it on Hono with the standard error envelope.

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
