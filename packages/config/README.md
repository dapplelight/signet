# @dapplelight/signet-config

Signet's house Biome preset and TypeScript bases, so an app extends one config
instead of carrying a hand-copied one that drifts.

```bash
bun add -d @dapplelight/signet-config @biomejs/biome typescript
```

## Biome

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.14/schema.json",
  "extends": ["@dapplelight/signet-config/biome"],
  "files": { "includes": ["**", "!**/dist"] }
}
```

Needs Biome 2. The preset is the same config `create-signet-app` scaffolds and
Signet lints itself with: 2-space indent, 100 columns, double quotes, **no
semicolons** (`asNeeded`), organize imports on, `useHookAtTopLevel` as an error,
`noExplicitAny` as a warning, Tailwind directives parsed in CSS. It turns on
`vcs.useIgnoreFile`, so the repo needs a `.gitignore`.

Keep `files`, `overrides` and anything product-specific in your own
`biome.json`; your settings win over the preset's.

The preset carries `"root": false`. That is for Signet's own repo, where the
file sits in a subdirectory and would otherwise be rejected as a second root
config. Biome does not inherit `root` through `extends`, so your config stays a
root config (the test checks this).

## TypeScript

```json
{
  "extends": "@dapplelight/signet-config/tsconfig/react.json",
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] },
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

| File | For | Adds to base |
|---|---|---|
| `tsconfig/base.json` | scripts, shared packages | — |
| `tsconfig/react.json` | Vite + React SPA | DOM libs, `jsx: react-jsx` |
| `tsconfig/worker.json` | Cloudflare Workers | no DOM (a Worker has no `document`) |

`base.json`: `strict`, `moduleResolution: "bundler"`, `module: "ESNext"`,
target and lib ES2022, `isolatedModules`, `moduleDetection: "force"`,
`resolveJsonModule`, `noFallthroughCasesInSwitch`, `skipLibCheck`, `noEmit`,
and `types: []`.

- **No `baseUrl`.** TypeScript 7 removed it. `paths` resolve relative to the
  tsconfig that declares them, so declare `paths` in your own file.
- **`types` is empty.** List what you use: `["vite/client"]`, `["bun"]`,
  `["node"]`. A `types` you set replaces the base's; it does not add to it.
- **Workers need runtime types.** `worker.json` deliberately has no DOM lib.
  Add `"types": ["@cloudflare/workers-types"]`, or run `wrangler types` and add
  the generated `worker-configuration.d.ts` to `include`.
- **Emitting?** The bases set `noEmit`. A build config sets `noEmit: false` and
  its own `outDir`, `declaration`, and so on.

## Reusable CI

Signet also ships `.github/workflows/ci-bun.yml`, a `workflow_call` workflow:
checkout, setup-bun, install, lint, typecheck, test, and an optional build.

```yaml
jobs:
  ci:
    uses: dapplelight/signet/.github/workflows/ci-bun.yml@main
    with:
      bun-version: 1.3.11 # default: latest
      working-directory: . # default
      fetch-depth: 0 # default 1; 0 for scripts that diff against the base branch
      build: true # default false; runs build-command
      test: bun test # every command is overridable; "" skips the step
```

**The Signet repo is private, so this needs a one-off setting.** On GitHub, open
`dapplelight/signet` → Settings → Actions → General → **Access**, and choose
"Accessible from repositories owned by the user 'dapplelight'". Until then a caller
fails with "workflow was not found". The calling repos must be owned by the same
account.

It covers what every repo repeats. Repo-specific jobs stay in the repo:
app-a's e2e, type-ramp and app-a-rules checks, app-b's `slop:ci`,
`dup`, Neon integration and PR risk label. (For app-b, `slop:ci` and
`dup` can ride along: `lint: bun run lint && bun run slop:ci && bun run dup`.)

There is no shared deploy workflow: app-a deploys from `deploy.yml` (wrangler
for the API Worker, Pages for four frontends), and app-b has no deploy
workflow at all; it deploys with `bun run api:deploy` / `web:deploy`.

## How app-a and app-b differ today

Surveyed 2026-09-24, read-only. Adopting the preset means deciding each row.

### Biome

| | Preset (house) | app-a | app-b |
|---|---|---|---|
| Biome schema | 2.5.14 | 2.4.10 | 2.5.14 |
| Semicolons | `asNeeded` | `asNeeded` | **`always`** |
| Quotes, indent, width | double, 2 spaces, 100 | same | same |
| Trailing commas | default (`all`) | `all` (explicit) | `all` (explicit) |
| Recommended rules | default (on) | `recommended: true` | `preset: "recommended"` |
| Unused imports | default | `warn` | **`error`**, unused variables `error` too |
| `useHookAtTopLevel` | `error` | default | default |
| Organize imports | on | not set | on |
| CSS | Tailwind directives parsed | CSS lint + format **off**, `*.css` excluded | Tailwind directives parsed, `noImportantStyles` off |
| Extras | — | `noArrayIndexKey`, `noNonNullAssertion`, `noAutofocus`, `useButtonType` warn; four a11y rules off; `useNodejsImportProtocol` off; `globals: ["process"]` | `noConsole` off, but `error` in `apps/api` |

**app-b on semicolons:** extending the preset reformats every file.
Either run `biome check --write` once in its own commit, or keep
`"javascript": { "formatter": { "semicolons": "always" } }` in its biome.json.

### TypeScript

| | Preset | app-a | app-b |
|---|---|---|---|
| Shape | base + react + worker | root base for packages; web and admin standalone; Astro apps extend `astro/tsconfigs/strict` | one root config; web extends it for Next |
| `module` | `ESNext` | `ESNext` | `Preserve` |
| `jsx` | `react-jsx` (react.json) | `react-jsx` | `preserve` (Next) |
| Emit | `noEmit` | root emits declarations, source maps, `incremental` | `noEmit` |
| `types` | `[]` | per app (`vite/client`, `node`, `bun`) | `["bun"]` at the root |
| Other | `moduleDetection: force`, `noFallthroughCasesInSwitch` | `esModuleInterop`, `forceConsistentCasingInFileNames` | — |

Both are `strict` with `moduleResolution: "bundler"` and no `baseUrl`. A Next app
extends `react.json` and sets `"jsx": "preserve"` plus the `next` plugin.

### CI

| | app-a | app-b |
|---|---|---|
| Trigger | pull requests to main | push to main and every PR |
| Bun | pinned 1.3.11 | `latest` |
| Shape | parallel jobs: lint (full history), typecheck, web test, API test, build, e2e | one job: typecheck, lint, `slop:ci`, `dup`, test |
| Also | `deploy.yml` | `neon-integration.yml`, `pr-risk.yml` |
