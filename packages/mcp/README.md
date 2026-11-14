# @dapplelight/signet-mcp

An MCP server that gives an AI agent (Claude Code, Cursor, Claude Desktop, any
MCP client) everything in Signet: the docs, every export with its signature,
the components, the themes and their contract, scaffolding, convention checks,
recipes and migration notes. With it, an agent can build, check and fix a
Signet app without reading the repo.

Everything it answers comes from an index built from this repo when the
package is built, and that index ships inside the package. It makes no network
calls and cannot fall behind the version it was built with.

> Not on npm yet (`"private": true`). Until it is published, point your client
> at a clone: `node /path/to/signet/packages/mcp/dist/bin.js` after
> `bun install && bun run build:all` in the repo.

## Install

Claude Code:

```bash
claude mcp add signet -- bunx @dapplelight/signet-mcp
```

Cursor, in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "signet": { "command": "bunx", "args": ["@dapplelight/signet-mcp"] }
  }
}
```

Claude Desktop, in `claude_desktop_config.json` (Settings, Developer, Edit
Config). Desktop does not always see a shell's `PATH`, so `npx` is the safer
choice there:

```json
{
  "mcpServers": {
    "signet": { "command": "npx", "args": ["-y", "@dapplelight/signet-mcp"] }
  }
}
```

It runs on Node 20+ or Bun. Its peers, `@modelcontextprotocol/server` and
`zod`, are installed alongside it by npm and bun.

## Tools

All read-only.

| Tool | What it returns |
|---|---|
| `search_docs(query, limit?)` | Doc sections, exports, components and recipes that match, each with a ref to follow |
| `read_doc(name, section?)` | A doc, whole or one section; the same text as the `signet://docs/<name>` resource |
| `list_exports(package?)` | Every import path, its summary and its symbol names |
| `get_export(path, symbol)` | The symbol's declaration signature, its JSDoc, its source file, and every other path that exports it |
| `list_components()` | Each `@dapplelight/signet-ui` component, its import path and exports |
| `get_component(name)` | Props (parameter list and `…Props` types), cva variants and defaults, a usage example, the contract variables its classes read |
| `list_themes()` / `get_theme(name, include_css?)` | Shipped themes, how to import one, and the CSS to copy |
| `list_tokens(kind?)` | The theme contract: 78 required and 16 optional variables, grouped |
| `check_theme(css)` | Findings against `CONTRACT.md`: missing variables, optional slots not set in both modes, a repainted stock palette, `@source` in a theme, and WCAG contrast in light and dark |
| `scaffold_app({ name, template, theme })` | The exact `create-signet-app` command, the files it will create, and the next steps |
| `scaffold_files({ name, template, theme })` | Every file `create-signet-app` would write, with contents, for an agent without a shell |
| `check_app({ files } or { path })` | Findings with fixes: env read at module scope in a server module, rate limiting and its `trust`, `signet-doctor`'s Durable Object checks, CSRF, the error handler, the env schema against wrangler vars, Tailwind `@source` for the components, domain vocabulary in base packages |
| `recipe(task)` | Install line, the doc sections that do the job (with their code), and how to verify. Tasks: add-auth, add-rate-limit, add-csrf, add-error-envelope, add-env, add-api-client, add-web-push, add-ai-extraction, add-analytics, add-portability-adapters, add-mcp-tools, add-oauth, add-logging, add-theme |
| `migration(from, to?, package?)` | CHANGELOG entries in the range with the breaking bullets pulled out, the README's "Migrating from" notes, and current versions |

`check_app({ path })` reads a directory from disk, so it is offered only by the
stdio bin, which runs on your machine as you. A hosted HTTP server offers
`files` alone.

## Resources and prompts

Every doc is a resource at `signet://docs/<name>`: `signet` (the root README),
`api`, `conventions`, `migration`, `changelog`, `contributing`, `publishing`,
`repo-guide`, `contract`, `analytics`, and one per package README (`tokens`,
`ui`, `lib`, `server`, `ai`, `config`, `create-signet-app`, `mcp`, ...).

Prompts: `build-signet-app` (idea, template), `review-against-signet`
(target), `add-signet-feature` (feature, app).

## Host it over HTTP

On any fetch host (Workers, Bun, Deno):

```ts
import { signetMcpFetch } from "@dapplelight/signet-mcp"

export default { fetch: signetMcpFetch() }
```

Or as a route on a Hono app, with Signet's own MCP kit:

```ts
import { signetMcpOptions } from "@dapplelight/signet-mcp"
import { mountMcp } from "@dapplelight/signet-server/mcp/hono"

mountMcp(app, "/mcp", signetMcpOptions())
```

Both serve 2026-07-28 and 2025-era clients. `signetMcpOptions({ tools,
resources, prompts })` adds your own beside Signet's.

## How it is built

The server is built with Signet's own toolkit (`defineTool`,
`defineResource`, `definePrompt`, `createMcpServer` from
`@dapplelight/signet-server/mcp`), served over stdio by the SDK's
`serveStdio`.

`bun run gen` runs `scripts/build-index.ts`, which writes `src/generated/`:

- `index.ts`: the docs, every export path with symbol signatures and JSDoc
  (read from source, following barrels), components with their cva variants
  and the contract variables they use, themes, contract tokens, recipes cut from
  doc sections, and `create-signet-app`'s templates and package.json.
- `doctor-check.ts`, `contrast.ts`: verbatim copies of
  `packages/server/src/doctor/check.ts` and `packages/tokens/test/contrast.ts`,
  so `check_app` and `check_theme` run the repo's own logic.

`bun run test` fails if any of these differ from what the repo would generate
now. After changing a doc, an export or a component, run `bun run gen` in this
package and commit the result. A recipe whose doc heading was renamed fails
the generator.

## Test

```bash
bun run build && bun run test
```

The end-to-end test spawns the built bin under Node and speaks MCP over stdio
by hand (initialize, every tool, resources, prompts), then calls the HTTP
handler. The unit tests check `check_theme` and `check_app` against the
shipped themes and the scaffolder's own output, mutated to break each rule,
and check that `scaffold_files` matches running `create-signet-app` byte for
byte.

## License

MIT
