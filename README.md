<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/mark-paper.svg">
    <img src="docs/brand/mark-color.svg" width="96" height="96" alt="Signet">
  </picture>
</p>

# Signet

One component kit, many design systems.

Signet is a set of TypeScript packages for building web apps and their APIs:

- **UI**: 41 React components on Tailwind v4, in the shadcn style (you read the
  source, it is not a black box), plus hand-built extras such as a virtualised
  `data-table`, `combobox`, `stat-strip` and `responsive-sheet`.
- **Tokens and themes**: every visual decision (colour, radius, type, shadow,
  motion) is a CSS variable. A theme is one CSS file that defines the variables
  in the [theme contract](packages/tokens/CONTRACT.md). Swap the file and every
  component changes; no component is edited.
- **Server kit** for Cloudflare Workers and Hono: error envelope, request
  validation, auth helpers, rate limiting, logging, MCP and OAuth resource-server
  support.
- **Client lib** and **AI**: a typed API client that speaks the same envelope,
  formatters, forms, analytics, and structured LLM calls with budgets, caching
  and failover.

It is for people who build several small apps and want them to share a design
system and a backend baseline without copying files between repos. It is
opinionated (see [Conventions](#conventions)); if you want a neutral kit, use
shadcn/ui directly.

## Quick start

Needs [Bun](https://bun.sh) 1.3 or later.

The scaffolder is not on npm yet, so run it from a clone. The app it creates
installs the published `@dapplelight/*` packages and has no tie to the clone.

```bash
git clone https://github.com/dapplelight/signet.git
cd signet && bun install
bun run packages/create-signet-app/src/index.ts ../my-app --theme cinematic
cd ../my-app && bun install && bun dev
```

`--theme` is `editorial` (default) or `cinematic`; `--template api` scaffolds a
Hono Worker instead. Details in
[packages/create-signet-app](packages/create-signet-app/README.md).

To add Signet to an existing Vite + React + Tailwind v4 app:

```bash
bun add @dapplelight/signet-ui @dapplelight/signet-tokens
```

```css
/* app.css */
@import "tailwindcss";
@import "@dapplelight/signet-tokens/editorial.css";
@import "@dapplelight/signet-tokens/base.css";
/* Tailwind does not scan node_modules; the kit's class names must be seen. */
@source "../node_modules/@dapplelight/signet-ui/dist";
```

```tsx
import { Button, DataTable, EmptyState } from "@dapplelight/signet-ui"
// or one component at a time, to keep the module graph small:
import { Button } from "@dapplelight/signet-ui/components/button"
```

`@dapplelight/signet-ui` lists its peer dependencies (React 19, Base UI, Radix
primitives, TanStack Table and a few more); recharts, TanStack Hotkeys and the
Markdown stack are optional.

Run `bun run dev` in [apps/showcase](apps/showcase) to see the components under
every theme, light and dark.

## The theme contract

[CONTRACT.md](packages/tokens/CONTRACT.md) is the whole interface between
components and design. Any CSS file that defines the **78 required variables**
(colour roles, radius and spacing scale, type ramp, shadows, motion) is a valid
theme; **16 more are optional** named slots (chart colours, focus ring, brand
accents). `bun run test` in `packages/tokens` compiles every theme against the
real components to prove the utilities resolve differently.

Shipped themes: `editorial` (calm, light-first), `cinematic` (dark-first,
sharp radii, large type), and `finance`, an overlay that adds a spend-category
palette to editorial.

To make your own, copy `packages/tokens/src/themes/editorial.css`, change the
values and check it against the contract. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Packages

Every export path and symbol is listed on one page in [API.md](API.md).

| Package | What it is |
|---|---|
| `@dapplelight/signet-tokens` | Themes (`editorial`, `cinematic`, `finance`) and base styles |
| `@dapplelight/signet-ui` | 41 token-driven React components |
| `@dapplelight/signet-lib` | Client: API client and error envelope, format, form, analytics, crypto |
| `@dapplelight/signet-server` | Workers/Hono: auth, http, env, middleware, notify, MCP, OAuth resource server, observability |
| `@dapplelight/signet-ai` | Structured LLM calls: budget, cache, failover, a classifier adapter |
| `@dapplelight/signet-config` | Biome preset and tsconfig bases (`react`, `worker`) |
| `create-signet-app` | Scaffolder for a web app or a Worker API |

Each package has its own README with design notes.

## Conventions

The stack decisions are written down in [CONVENTIONS.md](CONVENTIONS.md):
TypeScript strict, Vite + React, Tailwind v4, Hono on Workers, Drizzle, sonner
for toasts, TanStack Form + zod, Biome for lint and format. The rule that runs
through all of it: where Signet owns a behaviour (an error message, a retry
policy, a guard failure) it ships a working default and an override point.

Two other rules worth knowing: server modules take config and never read env
at module scope (Workers have no `process.env` at import time), and a base
package carries no domain vocabulary.

## Status

Pre-1.0 (0.x versions, see [CHANGELOG.md](CHANGELOG.md)); expect minor
versions to break things. Signet was extracted from 23 of the author's own
apps and is used across them. The packages are published to npm under the
`@nimit9` scope; [PUBLISHING.md](PUBLISHING.md) explains how releases work.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests are welcome.

## License

[MIT](LICENSE)
