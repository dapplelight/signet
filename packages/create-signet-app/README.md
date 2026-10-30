# create-signet-app

Scaffold a Vite + React 19 + TypeScript + Tailwind v4 app wired to
`@dapplelight/signet-tokens`, `@dapplelight/signet-ui` and `@dapplelight/signet-lib`.

```bash
bunx create-signet-app my-app --theme cinematic
cd my-app && bun install && bun dev
```

`--theme` takes `editorial` or `cinematic` (default `editorial`).

## Why

The audit found this exact setup rebuilt by hand 13 times across 23 products,
and the five-package eslint config copied as a block into **exactly 8 of 23**
repos — the identical count for all five packages is the signature of
copy-paste, not configuration.

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

## `--template api`: a Worker API

`bun create-signet-app my-api --template api` scaffolds a Hono Worker with:

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

Append migration tags; never edit one that has been deployed. A Worker entry
may export only handlers and classes (workerd: "Incorrect type for map entry").

Its test scaffolds outside the monorepo, installs, typechecks, lints, bundles
with wrangler, then runs it under `wrangler dev` and checks the envelope and
that exactly 60 requests pass before a 429. Removing the `RateLimitCounter`
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

Both templates ship `_gitignore` and `_github`, renamed to `.gitignore` and
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
