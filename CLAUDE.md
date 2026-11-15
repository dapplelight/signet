# Signet

Shared design system and backend kit. Extracted from 23 products.

## Layout
```
packages/tokens             themes + CONTRACT.md (78 required + 16 optional vars)
packages/ui                 40 token-driven React components
packages/lib                api client, format, analytics, form   (client)
packages/server             auth, http, env, middleware, notify,
                            observability, analytics, oauth-rs     (server)
packages/ai                 structured LLM calls: budget, cache, failover
packages/db                 Drizzle helpers: scoping, money, encrypted fields, audit (private)
packages/config             Biome preset + tsconfig bases; ci-bun.yml is the CI half
packages/create-signet-app  scaffolder
packages/mcp                MCP server for agents; its src/generated/ index is
                            gitignored and rebuilt by build/test/typecheck
apps/showcase               theme switcher demo (other apps/* are gitignored)
```

## Finding things

`API.md` lists every export path and symbol on one page. Read it instead of
crawling. It is regenerated on main after each merge; a PR never edits it.

## Rules
- **Run the tests.** `bun run test` in each touched package, plus `tsc --noEmit`,
  and `bun run lint` (Biome) at the root. Suppress a rule only with a reason.
  Every assertion exists because something that read as correct
  turned out not to be when compiled.
- **No domain vocabulary in a base package.** app-a's finance categories live in
  `tokens/src/themes/finance.css`, not `editorial.css`. `trend-chip` is under
  `ui/domain/`, not the barrel. Badge's default must stay `bg-primary`.
- **Server modules take config, never read env at module scope.** Workers do not
  populate `process.env` at import time.
- **Adding a theme?** It must satisfy `CONTRACT.md`, and `tokens`' test compiles
  every theme against the real components to prove utilities resolve differently.
- **A PR touches only its own source files.** Never edit or commit API.md,
  CHANGELOG.md or packages/mcp/src/generated/; parallel PRs conflicted on
  them. A user-visible change adds `.changes/<short-name>.md` (a CHANGELOG
  entry starting `### package: title`); the post-merge workflow folds it in
  and regenerates API.md.
- Conventions: `CONVENTIONS.md`. Migrations: `MIGRATION.md`.
