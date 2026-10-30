# Contributing

Thanks for looking. Signet is a Bun workspace: `packages/*` are the published
libraries, `apps/*` are apps built on them (`apps/showcase` is the demo).

## Setup

```bash
bun install
```

## Checks

Run these before opening a pull request:

```bash
bun run lint                          # Biome, whole repo
bun run format                        # Biome with --write
cd packages/<name>
bun run test                          # each package defines its own test script
bun run typecheck                     # tsc --noEmit (src and tests)
```

`bun run typecheck` at the root runs every workspace's typecheck. Suppress a
Biome rule only with a written reason.

If you change a package's `exports`, regenerate the reference page:

```bash
bun run gen:api                       # rewrites API.md
```

## Add a theme

1. Copy `packages/tokens/src/themes/editorial.css` to
   `packages/tokens/src/themes/<name>.css` and change the values.
2. Define every required variable in [CONTRACT.md](packages/tokens/CONTRACT.md)
   (inside `@theme inline { ... }`). Do not add product vocabulary such as
   category colours; those belong in an overlay like `finance.css`.
3. Add it to `exports` in `packages/tokens/package.json`, then `bun run gen:api`.
4. Add it to the theme list in `packages/tokens/test/themes.ts` and run
   `bun run test` there. The test compiles the theme against the real
   components and checks the utilities resolve to different values.
5. It appears in `apps/showcase` automatically (it reads the themes directory).

## Conventions

Read [CONVENTIONS.md](CONVENTIONS.md) first. The short version: where Signet
owns a behaviour it ships a default plus an override point; server modules take
config and never read env at import time; base packages carry no domain
vocabulary.

## Releases

Maintainers publish; see [PUBLISHING.md](PUBLISHING.md). Add a line to
[CHANGELOG.md](CHANGELOG.md) under "Unreleased" for any user-visible change.
