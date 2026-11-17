# create-signet-app

Scaffold a Vite + React 19 + TypeScript + Tailwind v4 app wired to
`@dapplelight/signet-tokens`, `@dapplelight/signet-ui` and `@dapplelight/signet-lib`.

```bash
npx create-signet-app@latest my-app --template full
cd my-app
npm install
npm run dev
```

With pnpm: `pnpm create signet-app my-app --template full`. With bun:
`bunx create-signet-app my-app --template full`. Then install and `run dev` with
the same manager. Open `http://localhost:5173`. `full` needs
[Bun](https://bun.sh) 1.3+ installed: `run dev` is a Bun script, whichever
package manager installs the app.

`--theme` takes `editorial`, `cinematic` or `finance` (editorial plus the
spend-category and money tokens; default `editorial`).

`--pm bun|npm|pnpm` sets the commands printed after scaffolding, in the CI
workflow (setup, frozen install, `<pm> run`) and in the full template's README.
Default: the package manager that ran it (`npm create` / `pnpm create` say so
in `npm_config_user_agent`), else bun. With pnpm a `pnpm-workspace.yaml`
approves esbuild's and workerd's build scripts, which pnpm 10+ otherwise refuses
to install without. Tests stay on `bun test`, so CI sets up Bun too.

## `--template full`: web app + API in one project

```bash
npx create-signet-app@latest my-app --template full
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
  role). Billing and admin are interim pages marked `TODO(billing-screen)` /
  `TODO(admin-screen)` until signet-ui's billing and admin screens are
  published.
- **Organisations.** Sign-up creates a personal org; an org switcher in the
  header; `/org` (settings: name, theme, brand colour) and
  `/org/members` (roles, remove, invite links) on signet-ui's org screens;
  `/invite/$token` to accept. signet-server's `tenant()` resolves the org from
  the switch cookie or `x-org` header, and in production from a custom domain
  or `ORG_ROOT_DOMAIN` subdomain. `/admin` stays the platform operator's view
  across orgs.
- **Env.** `api/env.ts` (`createEnv`), and a generated, gitignored env file
  with fresh `SESSION_SECRET` / `OTP_SECRET`.
- **MCP** as in the api template (`--mcp` / `--no-mcp`).
- **Tests.** `test/api.test.ts` drives sign-in, plans, inbox, admin roles,
  consent and sign-out against an in-memory database; `src/router.test.ts`
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

## `--template api`: a Hono API on the runtime you pick

`bun create-signet-app my-api --template api [--target cloudflare|bun|node|vercel]`
scaffolds a Hono API. Every target shares `src/app.ts`, `src/env.ts`, the tests
and CI; `--target` decides the entry and its config, and only that target's
files are written:

| `--target` | Entry | Config | Rate limit store |
|---|---|---|---|
| `cloudflare` (default) | `src/index.ts` (Worker) | `wrangler.jsonc` | `RateLimitCounter` Durable Object: exact |
| `bun` | `src/server.ts` (`Bun.serve`) | `Dockerfile` | in-process: exact for one process |
| `node` | `src/server.ts` (`node:http`) | `engines.node >= 22.18` | in-process: exact for one process |
| `vercel` | `index.ts` (default export) | `vercel.json` (Hono preset) | in-process: per function instance |

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

`test/scaffold-full.ts` scaffolds the full template outside the monorepo with
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
