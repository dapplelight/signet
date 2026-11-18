# create-signet-app

Scaffold a Vite + React 19 + TypeScript + Tailwind v4 app wired to
`@dapplelight/signet-tokens`, `@dapplelight/signet-ui` and `@dapplelight/signet-lib`.

```bash
npx create-signet-app@latest my-app --starter full
cd my-app
npm install
npm run dev
```

With pnpm: `pnpm create signet-app my-app --starter full`. With bun:
`bunx create-signet-app my-app --starter full`. Then install and `run dev` with
the same manager. Open `http://localhost:5173`. A composed app needs
[Bun](https://bun.sh) 1.3+ installed: `run dev` is a Bun script, whichever
package manager installs the app.

`--theme` takes `editorial`, `cinematic` or `finance` (editorial plus the
spend-category and money tokens; default `editorial`).

`--pm bun|npm|pnpm|yarn|deno` sets the commands printed after scaffolding, in
the CI workflow (setup, frozen install, `<pm> run` or `deno task`) and in the
app's README. Default: the package manager that ran it (`npm create`, `pnpm
create`, `yarn create`, `bunx`, `deno run` say so in `npm_config_user_agent`),
else bun. With pnpm a `pnpm-workspace.yaml` approves esbuild's and workerd's
build scripts, which pnpm 10+ otherwise refuses to install without. With yarn
the app pins modern Yarn in `packageManager` (CI runs `corepack enable`), uses
a plain `node_modules` (`.yarnrc.yml`), and lists signet-ui's required peers,
which Yarn does not install on its own. Deno 2 installs and runs the
`package.json` scripts; `--platform cli` is refused with deno, as its build is
`bun build --compile`. Tests stay on `bun test`, so CI sets up Bun too.
`bun run test/scaffold-pm.ts` scaffolds the full starter and the web platform with each
manager installed on the machine, installs, typechecks and builds.

## Which platform

`--platform` defaults to `web`. `--template` is its old name and still works;
`--template full` is `--starter full` (below).

| Platform | Frontend | API | Database | Auth | MCP | Runs on |
|---|---|---|---|---|---|---|
| `web` | Vite + React + Signet UI, TanStack Router | none (a configured `createApiClient` for yours) | none | placeholder `/login` | no | any static host |
| `api` | none | Hono with the error envelope and request ids | none (add with `signet add db`) | none (add with `signet add auth`) | `/mcp`, default on | `--target` cloudflare, bun, node or vercel |
| `cli` | none | none | none | device-code login | no | one compiled Bun binary |
| `extension` | Chrome MV3: popup, options, service worker | none | none | PKCE via `chrome.identity` | no | Chrome |
| `desktop` | Tauri v2 window and menu-bar app | none | none | browser sign-in (PKCE, loopback) | no | macOS, Windows, Linux |

## Composed apps: parts, starters, `--ui` and `--api`

A web app and its API in one project, built from **parts**. Any of these flags
composes one (they do not mix with `--platform`):

```bash
bunx create-signet-app my-app --starter full               # every part, web + API
bunx create-signet-app my-app --with payments,notifications # those, plus what they need
bunx create-signet-app my-app --without admin,privacy       # the full starter without them
bunx create-signet-app my-api --api --with orgs             # the API half only
bunx create-signet-app my-ui --ui --with account            # the web half only
bunx create-signet-app my-app --starter blank               # no parts: shell, API, database
```

- **Surfaces.** Both halves by default. `--ui` writes the web half only: its
  client calls an API elsewhere (`VITE_API_URL`, else the same origin), untyped
  until you point `src/lib/api.ts` at that API's `AppType`. `--api` writes the
  API half only: no web files, no Vite. `--ui --api` together is an error (it
  is the default).
- **Starters** are named mixes of parts: `full` (every part; `--template full`
  is the same) and `blank` (none). `--with` adds to the starter, `--without`
  takes away; `--without` alone starts from `full`.
- **Needs** come along on their own and the output says so (`--with payments`
  prints `added auth for payments`). Leaving out a part another one needs is
  an error.
- **Runtime.** `--target bun|deno|node` picks what runs the API (default
  `bun`: Bun.serve and bun:sqlite, as before). `deno` (Deno 2) and `node`
  (22.18+) get node:sqlite under Drizzle and a node:http server instead, and
  their `dev`/`start` scripts run on that runtime with `.env` loaded. Tests stay
  on `bun test` (Bun runs node:sqlite too). `bun run test/scaffold-runtime.ts` serves the
  full starter on each runtime installed and checks `/api/health`, an MCP call
  and the built page.
- **MCP** is the `mcp` part. As before it is asked for on a terminal (default
  yes) unless `--mcp`, `--no-mcp`, `--with mcp` or `--without mcp` says.

| Part | What it adds | Needs |
|---|---|---|
| `auth` | phone one-time codes, stored sessions, `/login`, sign-out | |
| `account` | `/account`: profile, signed-in devices, API keys | auth |
| `orgs` | a personal org each, members, roles, invite links, `/org`, `/invite/$token`, tenant middleware | auth |
| `admin` | `/admin`: the operator's panel over every table, by platform role | auth, orgs |
| `notifications` | the in-app inbox and preferences, `/notifications` | auth |
| `privacy` | DPDP consent and data export / erasure requests, `/privacy` | auth |
| `payments` | plans (`api/plans.ts`), entitlements, `/billing`, gateway webhooks | auth |
| `paywalls` | remote paywalls: versioned offerings and placements with audience overrides (signet-db's `createOfferings`), `GET /api/paywall/:placement`; with `admin`, publishing under `/api/admin/paywalls` (API only) | payments |
| `growth` | waitlist, invites, referral codes, referrals, feedback and marks tables, with signet-db's `createGrowth` (API only) | |
| `ai` | AI spend caps per user and for the app (signet-db's `createAiSpend`, `requireAiSpend` on `/api/ai/*`), a sample `/api/ai/summary` on signet-ai's fake provider (no key needed); with `admin`, `/api/admin/ai-spend` (API only) | auth |
| `workflows` | durable workflows (signet-db's `createWorkflows`) at `/api/workflows`, a generic approval-request example, the runner in `api/server.ts`, `/approvals` | auth |
| `mcp` | the API's validated routes as tools at `/mcp` (API only) | |

### How parts are put together

`base/` is the app with no parts; `parts/<name>/` holds what one part adds,
with a small typed manifest (`part.ts`: needs, dependencies, env lines, its
tables). Both are split into halves, each laid over the app root: `shared/`
(always), `web/`, `api/`, and `both/` (with both surfaces). Code several parts
share (`api/app.ts`, the schema, `services.ts`, the shell and nav, the route
tree, the tests' helpers) lives in `base/` once, with each part's lines marked
`// <part>:begin` / `// <part>:end` (or a single line ending in `// @<part>`;
`!<part>` means without it; `web` and `api` are the surfaces). The composer
keeps the chosen lines and drops every marker, so an app has no trace of the
parts it left out. The migrations in `base/api/drizzle/` cover every table; the
composer keeps the statements and snapshot entries for the chosen parts' tables
(a table two parts list, like `usage_counters` for `payments` and `ai`, stays
with either), drops a migration left empty and moves the later ones up a
number, so `db:check` passes and `db:generate` finds nothing to do.

## AI-assisted planning: `--describe`

```bash
bunx create-signet-app my-app --describe "a team inbox with settings and pricing"
```

One sentence picks the platform (`web` or `api`) or the `full` starter and the
theme, splits the sentence into pages, asks signet-mcp's `plan_page` about each,
scaffolds the app, and writes `PLAN.md` (the pages, with blocks, components,
data and files for each) and `AGENTS.md` (the instructions an agent working in
the app should follow). It is deterministic and makes no LLM call: the same
sentence always gives the same files. Keyword lists choose between Signet's own
platforms and themes; a sentence that names none gets `web` and `editorial`.

An explicit `--platform` or `--theme` wins over what the sentence implies.
`--describe` applies to `web`, `api` and `full` only.

## `--starter full`: web app + API in one project

```bash
npx create-signet-app@latest my-app --starter full
cd my-app
npm install
npm run dev
```

Add `--theme finance` (or `cinematic`) to pick a theme.

One package, two halves: `src/` (the web template's Vite app) and `api/` (Hono
on Bun), with `api/server.ts` serving the API under `/api` and the built app
for every other path, so one process deploys it and the session cookie stays
same-origin. In dev, Vite proxies `/api` to it. What a fresh app has:

- **Typed client.** `src/lib/api.ts` is `createRpcClient(hc<AppType>)` over
  `import type { AppType } from "../../api/app.ts"`: paths, inputs
  (`zValidator`) and responses typed from the routes, with the envelope and
  401 redirect of the web template.
- **Database.** SQLite (bun:sqlite) through signet-db, the schema in
  `api/db/schema.ts`: users with roles, the audit log, idempotency keys,
  `entitlementTables()`, `growthTables()`, `privacyTables()`, and a `kv` table
  that backs signet-server's stores (stored sessions, phone codes, API keys,
  the notification inbox and prefs, rate limits). drizzle-kit migrations in
  `drizzle/`, applied on start; signet-payments' tables from `paymentsSchema`.
- **Sign-in.** Phone one-time codes (`requestPhoneOtp`/`verifyPhoneOtp`,
  rate-limited), stored sessions with fixation protection, sign-out. In
  development `devSmsSender` prints the code; it refuses staging and production.
  `ADMIN_PHONES` grants the admin role.
- **Screens wired to it.** `AuthScreen` (`/login`), `ProfileCard` +
  `SessionsList` + `ApiKeysManager` (`/account`), `NotificationInbox` +
  `NotificationPreferences` (`/notifications`, from `createNotifier`'s inbox),
  `ConsentList` + `DataRequests` (`/privacy`, signet-db privacy), billing
  (`/billing`: plans from `definePlans`, current plan from entitlements,
  `BILLING=fake` upgrades at once and is refused outside development; Razorpay
  webhooks go through signet-payments to `applyBillingEvent`), and admin
  (`/admin`, signet-db `defineAdmin` over the schema via `adminRoutes`, by
  role). Both pages use signet-ui's published `BillingScreen` and admin
  screens; nothing in them is a placeholder. What you still write is the
  product: your plans and limits (`api/plans.ts`), and a real gateway in
  place of `BILLING=fake`.
- **Organisations.** Sign-up creates a personal org; an org switcher in the
  header; `/org` (settings: name, theme, brand colour) and
  `/org/members` (roles, remove, invite links) on signet-ui's org screens;
  `/invite/$token` to accept. signet-server's `tenant()` resolves the org from
  the switch cookie or `x-org` header, and in production from a custom domain
  or `ORG_ROOT_DOMAIN` subdomain. `/admin` stays the platform operator's view
  across orgs.
- **Env.** `api/env.ts` (`createEnv`), and a generated, gitignored env file
  with fresh `SESSION_SECRET` / `OTP_SECRET`.
- **MCP** as in the api platform (`--mcp` / `--no-mcp`).
- **Tests.** One file per part under `test/` (`auth.test.ts`,
  `payments.test.ts`, …, sharing `test/helpers.ts`) drives sign-in, plans,
  inbox, admin roles, consent, API keys, orgs and sign-out against an in-memory
  database; `src/router.test.ts`
  resolves every page; `e2e/smoke.spec.ts` (Playwright, `test:e2e`) starts the
  server with a throwaway database, reads the code from its console and goes
  sign-in → admin → billing → inbox → account → privacy in headless Chromium,
  then a second org, an invite a second user accepts, and a 404 for an org
  they are not in.
- **README.md**, a first-day guide: run, orgs, become admin, try billing, add a
  table → route → page, check, deploy.

The API runs on Bun whichever package manager installs it.

## Why

This setup kept getting rebuilt by hand, and the same lint config kept getting
copied between repos as a block. Copy-paste is not configuration.

## What you get

- `dev` / `build` / `preview` / `lint` / `typecheck` / `test` — the script names
  already used across the existing repos, so muscle memory carries over
- **TanStack Router**, file-based, with `/` and a placeholder `/login`.
  `CONVENTIONS.md` does not pick a router; this follows app-a. Routes live in
  `src/routes`; the Vite plugin regenerates `src/routeTree.gen.ts` on every
  `dev` and `build` and splits each route into its own chunk. The generated file
  is committed so `tsc` passes before Vite has run, and Biome ignores it.
  `/login` renders a card and nothing else — wire it to your own auth; the
  template does not choose a provider
- **sonner** for toasts (the `CONVENTIONS.md` choice): `<Toaster />` in
  `main.tsx`, from `src/components/toaster.tsx`, which follows light/dark and
  draws on the theme's popover tokens. Call `toast()` from `"sonner"`
- `src/router.test.ts` (`bun test`), which checks `/` and `/login` each resolve
  to their route
- `.github/workflows/ci.yml`: `bun install --frozen-lockfile`, lint, typecheck,
  test, build. Commit `bun.lock`
- `tsconfig.json` with app/node project references, strict, path alias `@/*`
- Biome for lint and format (`biome check .`), replacing the copied eslint config (see below)
- `src/app.css` importing the chosen theme
- `main.tsx` with `ThemeProvider`, a `QueryClient` on Signet defaults, the
  router, and a single-redirect 401 handler. The redirect is a full page load to
  `/login` (built with `router.buildLocation`, so deleting the route fails
  typecheck): it drops the old session's cached queries and re-arms the
  one-shot handler. In production the host must fall back to `index.html` for
  unknown paths
- `index.html` with a blocking script that applies the stored theme before first
  paint — React mounts too late, and without it there is a visible flash
- `src/lib/api.ts` with a configured `createApiClient`

## `--platform api`: a Hono API on the runtime you pick

`bun create-signet-app my-api --platform api [--target cloudflare|bun|node|vercel]`
scaffolds a Hono API. Every target shares `src/app.ts`, `src/env.ts`, the tests
and CI; `--target` decides the entry and its config, and only that target's
files are written:

| `--target` | Entry | Config | Rate limit store |
|---|---|---|---|
| `cloudflare` (default) | `src/index.ts` (Worker) | `wrangler.jsonc` | `RateLimitCounter` Durable Object: exact across all instances |
| `bun` | `src/server.ts` (`Bun.serve`) | `Dockerfile` | in-process: exact for one process only |
| `node` | `src/server.ts` (`node:http`) | `engines.node >= 22.18` | in-process: exact for one process only |
| `vercel` | `index.ts` (default export) | `vercel.json` (Hono preset) | in-process: per function instance, so not exact |

**Rate limits are not equivalent across targets.** An in-process store is safe
for a single `bun` or `node` process. Run more than one instance (replicas,
serverless, a load balancer) and each keeps its own count, so the real limit is
the configured one times the number of instances. When the limit is an abuse or
security control, use `cloudflare`, or pass a shared `store` (Redis; Vercel KV is
[Upstash](https://vercel.com/docs/redis)) to `rateLimit`. Behind a proxy,
the client IP is trusted only as far as you say: on `bun` and `node` set
`TRUSTED_PROXY_HOPS` to the number of proxies in front, otherwise the socket
address is used; on Vercel one forwarded hop is trusted.

`node` runs `src/server.ts` as is through Node's type stripping (on by default
from 22.18), so relative imports in the template carry `.ts`. It bridges
`node:http` to Hono's `fetch` in a few lines instead of adding
`@hono/node-server`. `vercel` follows [Hono on
Vercel](https://vercel.com/docs/frameworks/backend/hono); Vercel overwrites
`x-forwarded-for` with the client IP, so one forwarded hop is trusted. On Vercel
the in-memory count is per instance; share it through Redis (Vercel KV is
[Upstash](https://vercel.com/docs/redis)) when it must be exact.

The `cloudflare` target is a Hono Worker with:

- `requestId`, `errorHandler` and `parseBody` from `@dapplelight/signet-server`, so
  every error is the envelope with a code and a request id
- exact per-IP rate limiting on `/api/*`: the `RateLimitCounter` Durable Object
  is exported from the entry, bound as `RATE_LIMIT` and created by the first
  migration in `wrangler.jsonc` — nothing to set up by hand
- `src/env.ts`: a zod schema through `createEnv` from
  `@dapplelight/signet-server/env`, validated lazily on first read (Cloudflare runs
  module scope with no secrets during deploy). `initRuntimeEnv` hands it the
  bindings on each request, and `env.APP_ENV` decides whether 500s hide their
  message — failing closed (hidden) if the env does not validate. Add a var to
  the schema, then read `env.KEY`
- `test/env.test.ts` (`bun test`) and `.github/workflows/ci.yml`: lint,
  typecheck, test and `wrangler deploy --dry-run`
- MCP for agents, asked at scaffold time ("Add MCP for agents?", default
  yes; `--mcp` / `--no-mcp` without a terminal, default `--mcp`). With it,
  `/mcp` serves every route validated with `zValidator` as a tool (`appTools`
  from `@dapplelight/signet-server/mcp`), run as the caller with their auth
  header and cookie. GET routes are read tools; any other method asks the
  person first (`requireApproval`), and without a way to ask does nothing.
  `asTool(false)` on a route leaves it out; `MCP=off` in the env turns the
  endpoint off (404). It adds `@modelcontextprotocol/server` and
  `test/mcp.test.ts`. With `--no-mcp` none of that is written

- on `bun` and `node`, `bun run start` serves the app; rate limiting is
  in-process, keyed by the socket address, or by `x-forwarded-for` when
  `TRUSTED_PROXY_HOPS` is set. `bun` adds a `Dockerfile`

Chose `--no-mcp` and want it later? `bun add @modelcontextprotocol/server`,
then at the end of `createApp` in `src/app.ts`, after the routes:

```ts
import { appTools } from "@dapplelight/signet-server/mcp"
import { mountMcp } from "@dapplelight/signet-server/mcp/hono"

mountMcp(app, "/mcp", { name: "api", version: "0.0.0", tools: appTools(app) })
```

Append migration tags; never edit one that has been deployed. A Worker entry
may export only handlers and classes (workerd: "Incorrect type for map entry").

Its test scaffolds each target outside the monorepo, installs, typechecks and
lints it. `cloudflare` is bundled with wrangler, then run under `wrangler dev`
to check the envelope and that exactly 60 requests pass before a 429. `bun` and
`node` are served under their runtime (the node check needs Node 22.18+ on
`PATH`) and must limit by socket address whatever `x-forwarded-for` says;
`vercel`'s default export is called in process, since a deploy needs an account. Removing the `RateLimitCounter`
export fails it: wrangler refuses to bundle a Worker whose Durable Object is
not exported.

## Two bugs this fixes in the copied setup

**`import.meta.env` did not typecheck.** The copied `tsconfig.app.json` omits
`"types": ["vite/client"]`, so `tsc -b` fails on any use of an env var.

**The copied eslint config is broken against current versions**, which is one
reason the scaffold ships Biome instead. The config in the
existing repos uses `reactHooks.configs.flat.recommended`, which was removed in
`eslint-plugin-react-hooks` 5.2. Installing fresh gives:

```
TypeError: Cannot read properties of undefined (reading 'recommended')
```

The template uses `reactHooks.configs["recommended-latest"]`. Existing repos
only still work because their lockfiles pin older versions — copying their
config into anything new produces a crash.

## Test

`bun run test/scaffold-parts.ts` scaffolds each part alone (plus what it needs), no
parts and every part, on each surface (`--ui`, `--api`, both), and checks each
app: no markers or placeholders left, only its surfaces' files, every
dependency imported (or a peer of one that is) and every import declared, lint,
typecheck, its tests, and the build (web) or `db:check` plus a `drizzle-kit
generate` that finds nothing to do (api). Every app's dependencies are
installed once, into one shared directory each app links to; the apps run in
parallel, and a step over files identical to an earlier app's runs once.
`bun run test/scaffold-parts.ts api payments` runs one.

`test/scaffold-full.ts` scaffolds the full starter outside the monorepo with
`--theme finance`, installs packs of every Signet package it uses, then lints,
typechecks, runs the app's tests, builds, checks the finance tokens reached the
CSS, and runs the app's Playwright smoke test headless. A `--no-mcp --pm pnpm`
app is then installed with pnpm, typechecked, tested and built, and `--pm npm`
is checked to rewrite CI.

All templates ship `_gitignore` and `_github`, renamed to `.gitignore` and
`.github` on scaffold: npm strips `.gitignore` from a package and may drop
dot-directories.

`bun run test` scaffolds a real app, installs, typechecks, runs its tests,
builds and lints it, checks the build emitted a `login-*.js` route chunk and
that `.github/workflows/ci.yml` exists and only calls scripts that exist, then asserts
the chosen theme reached the production CSS bundle (`.text-sm{font-size:1rem}`
and `.rounded-lg{border-radius:.1875rem}` for cinematic, not editorial's
`0.8125rem` / `.75rem`). Both bugs above were caught by that test on its first
run.

## Scaffolded apps work anywhere

Dependencies are real ranges (`^0.1.2`) against the published packages, so a
scaffolded app installs from npm and runs outside this repo. Inside the
monorepo bun still links the local copies, because the range matches the
workspace version — so development keeps using source with no extra step.

The packages are public, so no npm token is needed.
