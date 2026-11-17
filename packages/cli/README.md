# @dapplelight/signet-cli

`signet add` copies signet-ui components into your app as source you own and
edit. `signet upgrade` brings later signet-ui changes into those copies with a
3-way merge, so your edits survive. This is the last customisation level:
when tokens, props, `className` and parts are not enough, own the code.

Not on npm yet. Inside the Signet repo, run it with
`bun packages/cli/src/index.ts <command> --cwd <app>` after
`bun run build` in `packages/cli`.

## Add a component

```bash
signet add dialog
```

This copies `dialog` and what it imports from signet-ui (`button`, `utils`)
into `src/components/signet/`, keeping signet-ui's layout
(`components/ui/dialog.tsx`, `lib/utils.ts`), and rewrites relative imports
to your alias:

```ts
import { cn } from "@/components/signet/lib/utils"
```

Then import from your copy instead of the package:

```ts
import { Dialog } from "@/components/signet/components/ui/dialog"
```

It prints the npm packages the copies need that your `package.json` lacks, as
a `bun add` line. Run `signet list` for every item name; any subpath of
signet-ui's exports map is an item (`button`, `data-table`, `utils`,
`behaviors`, `trend-chip`).

`add` never overwrites a file you have edited when signet-ui also changed it:
it writes nothing, lists the files, and points you to `signet upgrade`.
`--force` overwrites them. An edited file that signet-ui did not change is
left alone.

## Add a backend module

```bash
signet add auth payments
```

Five modules wire Signet's server packages into an app made with
`create-signet-app --template api`:

| Module | Files | Wires |
|---|---|---|
| `auth` | `src/server/auth.ts` | stored sessions: `signIn`, `requireAuth`, `/api/sessions`; `SESSION_SECRET` |
| `db` | `src/server/db.ts`, `schema.ts` | signet-db on D1 (binding `DB`): `dbFor`, a table, the audit log |
| `admin` | `src/server/admin.ts` | `/api/admin` over the schema, deny by default; adds `auth` and `db` |
| `payments` | `src/server/payments.ts` | Razorpay and Stripe, the webhook inbox at `/webhooks/:gateway`; their keys |
| `notify` | `src/server/notify.ts` | a notifier with one template, unsubscribe and Resend webhook at `/notify` (outside `/api`, so CSRF does not block one-click unsubscribe); `API_URL`, `EMAIL_FROM`, `NOTIFY_SECRET`, Resend keys |

Each adds an import and a `.route(...)` line to `src/app.ts` (before
`.onError(`), its keys to `envSchema` in `src/env.ts`, and entries to
`.env.example`. Running it again adds nothing twice. Where the anchor is
missing (an app not made from the template), it prints the lines to add by
hand.

It then installs the npm packages the module needs with the app's package
manager, read from its lockfile (`bun.lock`, `pnpm-lock.yaml`,
`package-lock.json`; bun without one). `--no-install` prints the command
instead.

Module files are items like any other: `signet upgrade` merges upstream
changes into your edited copies, and `signet diff auth` shows them.

## Codemods

`signet upgrade` also migrates your own code when a Signet package you have
installed needs it, once per app (recorded in `signet.json`):

- signet-ai 0.4: `generateObject` from `ai` becomes
  `generateText({ output: Output.object({ schema }) })`, reads of
  `result.object` become `result.output`, and `ai` goes to `^7.0.0`.
- signet-db: each `setPlan(` call is listed, since it no longer overrides a
  live subscription on a later plan.
- signet-server after 0.4.0: each `registerIngest(` without a `userId`
  resolver or `trustClientUserId` is listed, since a client-sent userId is
  now dropped.

`--dry-run` prints the diffs and writes nothing. Codemods read your source
with the TypeScript in your app's `node_modules`; without it they are
reported and skipped.

## Configuration

`signet.json` at the app root. `add` creates it on first use:

```json
{
  "dir": "src/components/signet",
  "alias": "@/components/signet",
  "items": { "dialog": { "version": "0.2.2", "hash": "…" } },
  "files": { "components/ui/dialog.tsx": "…" }
}
```

- `dir`: where copies go. `--dir` on `add` sets it.
- `alias`: the import prefix that points at `dir` (create-signet-app's `@/`
  maps to `src/`). `--alias ""` keeps signet-ui's relative imports.
- `items` and `files`: written by the CLI, the signet-ui version and content
  hash each copy started from.

`.signet/base/` holds the copies exactly as they were written. Upgrades merge
against them, so commit both `signet.json` and `.signet/`.

## Upgrade

```bash
signet diff dialog          # what changed in signet-ui since you copied it
signet upgrade --dry-run    # what an upgrade would do, writing nothing
signet upgrade dialog       # or no name: every added item
```

Per file: a copy you never edited is replaced; one only you changed is kept; one
both sides changed gets `git merge-file` (base, upstream, yours). Where the same
lines changed on both sides, the file keeps git conflict markers: your lines
under a seven-`<` line labelled `app`, signet-ui's under a seven-`=` line, closed
by a seven-`>` line labelled `signet-ui <version>`.

Resolve them and run your checks. The command exits 1 when any file has
conflicts or could not be merged. Without git on the machine, edited files
are reported as `needs-merge` and left untouched; `signet diff` shows the
upstream change to apply by hand. A dependency signet-ui added to an item is
copied in on upgrade.

## Check: the verify loop

```bash
signet check --api http://localhost:8787 --pages /dashboard
```

Run it from the app root, after you or an agent changed code. It runs five steps
and prints one line for each: `typecheck` (`tsc --noEmit`), `lint` (Biome),
`conventions`, `conformance` and `pages`. The last two are skipped unless you
pass `--api` or `--pages`. It exits 1 when any finding is an error, otherwise 0,
so it can gate CI.

`conventions` reads your source for three rules: `env-module-scope` (server code
reads `process.env` at import time), `error-handler` (a Hono app without
Signet's `errorHandler`, a warning) and `raw-colour` (a hex, `rgb()` or stock
Tailwind colour where a theme token belongs).

`pages` opens each page at 390 and 1280 px, saves a screenshot to
`.signet/check/` and runs axe; every violation is an error `axe/<id>`. It uses
the app's own `@playwright/test` and `axe-core` (add both as dev dependencies,
run `bunx playwright install chromium` once) and needs the dev server running.

| Flag | What it does |
|---|---|
| `--api <url>` | Also run the conformance suite against this backend (takes the `conformance` flags) |
| `--pages <path...>` | Screenshots and axe for these pages |
| `--web <url>` | The dev server that serves `--pages` (default `http://localhost:5173`) |

A tool that cannot run (no `tsc`, no browser, an API that is down) is reported
as a finding, never a crash. With `--json` the output has the shape of the MCP
`check_app` tool plus screenshot paths. Limits: `conventions` is three rules,
not a full audit, and `typecheck` and `lint` are skipped when `tsconfig.json`
or Biome is missing.

## Conformance

```bash
signet conformance http://localhost:3000 --json-path /api/json
```

Runs the cases from signet-spec against a live backend: one line per case,
`pass` or `fail` with the reason. Exits 1 when any case fails. It needs no
registry or app directory.

| Flag | What it does |
|---|---|
| `--auth-prefix <path>` | Where client-login routes are mounted (default `/api/auth`) |
| `--ingest <path>` | The analytics ingest route (default `/api/analytics`) |
| `--sessions <path>` | Where session routes are mounted (default `/api/sessions`) |
| `--json-path <path>` | A route that parses a JSON body; without it `invalid-json-400` is reported as `not run` |

## Theme

`signet theme <hex> [--base editorial|cinematic|finance] [--out <file>]`
generates a whole theme from one brand colour; `signet theme --help` lists the
rest.

## Commands

```
signet add <name...>      [--force] [--dir <path>] [--alias <prefix>] [--no-install]
signet upgrade [name...]  [--dry-run]
signet diff <name>
signet list
signet theme <hex>        [--base <theme>] [--out <file>]
signet conformance <url>  [--auth-prefix <path>] [--ingest <path>] [--sessions <path>] [--json-path <path>]
signet check              [--api <url>] [--pages <path...>] [--web <url>]
```

Every command takes `--cwd <app>` and `--json`.

## The registry

`bun run build` reads `packages/ui` and writes `dist/registry.json`: each
item's files and contents, the items it depends on, the npm packages it
imports with signet-ui's range, and a content hash. It is generated, not
committed, and ships in the published package.
