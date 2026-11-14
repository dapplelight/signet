/**
 * An MCP server that gives agents everything Signet has: docs, exports,
 * components, themes, scaffolding, convention checks, recipes and migration
 * notes, from an index built from the repo at release time.
 */

import {
  type AnyTool,
  type CreateMcpServerOptions,
  createMcpServer,
  type McpCaller,
  type McpPrompt,
  type McpResource,
  type PlainTool,
  type ResolveMcpServerOptions,
} from "@dapplelight/signet-server/mcp"
import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server"
import { INDEX } from "./generated/index.js"
import {
  INSTRUCTIONS,
  mapError,
  signetPrompts,
  signetResources,
  signetTools,
  type ToolOptions,
} from "./tools.js"

export { type CheckResult, checkApp, checkTheme, type Finding } from "./checks.js"
export { INDEX } from "./generated/index.js"
export {
  INSTRUCTIONS,
  SignetMcpError,
  signetPrompts,
  signetResources,
  signetTools,
} from "./tools.js"
export type { SignetIndex } from "./types.js"

/** This package's version, from its package.json via the index. */
export const VERSION =
  INDEX.packages.find((p) => p.name === "@dapplelight/signet-mcp")?.version ?? "0.0.0"

/**
 * A signet-db instance and the tables an agent may reach. `agentTools` is
 * `agentTools` from `@dapplelight/signet-db/agent`, passed in because signet-db
 * is not a dependency of this package.
 */
export type DbToolsOptions<D, T> = {
  db: D
  agentTools: (
    db: D,
    options: { tables: T; userId: string; allowWrites?: boolean; maxRows?: number },
  ) => readonly PlainTool[]
  /** Tables to expose, as a list or a schema module. Each needs a `userId` column. */
  tables: T
  /** Whose rows the tools reach. Default: the verified token's `sub`; with none, no db tools. */
  userId?: (caller: McpCaller) => string | undefined
  /** Add `<table>_insert` and `<table>_update`. Default false. */
  allowWrites?: boolean
  /** Most rows any call returns. Default 100. */
  maxRows?: number
  /**
   * Scopes a token must carry to call the db tools: `read` for tools annotated
   * `readOnlyHint` (the selects), `write` for the rest (`_insert`, `_update`).
   * Without them no scope is checked: any caller with a verified `sub` gets every db tool.
   */
  scopes?: { read?: string[]; write?: string[] }
}

export type SignetMcpOptions<D = unknown, T = unknown> = ToolOptions & {
  /** More tools, resources or prompts to serve beside Signet's (e.g. an app's own). */
  tools?: readonly AnyTool[]
  resources?: readonly McpResource[]
  prompts?: readonly McpPrompt[]
  /**
   * Serve the caller's rows through signet-db's agent tools, after Signet's
   * own tools. Built per request for the caller, so host it with `mountMcp`
   * or `resolveMcpServer` and a verified token, not `signetMcpFetch`.
   */
  db?: DbToolsOptions<D, T>
}

type StaticOptions = Omit<SignetMcpOptions, "db">

/**
 * Options for signet-server's `createMcpServer`, or for `mountMcp(app, "/mcp", ...)`
 * from `@dapplelight/signet-server/mcp/hono` to host it on a Hono app. With
 * `db` the tool list is a function of the caller: pass it to `mountMcp` or
 * `resolveMcpServer`.
 */
export function signetMcpOptions(options?: StaticOptions): CreateMcpServerOptions
export function signetMcpOptions<D, T>(
  options: SignetMcpOptions<D, T> & { db: DbToolsOptions<D, T> },
): ResolveMcpServerOptions
export function signetMcpOptions<D, T>(
  options: SignetMcpOptions<D, T> = {},
): CreateMcpServerOptions | ResolveMcpServerOptions {
  const base = {
    name: "signet",
    version: VERSION,
    instructions: INSTRUCTIONS,
    resources: [...signetResources(), ...(options.resources ?? [])],
    prompts: [...signetPrompts(), ...(options.prompts ?? [])],
    mapError,
  }
  const own = signetTools(options)
  const mine = options.tools ?? []
  const { db } = options
  if (!db) return { ...base, tools: [...own, ...mine] }
  const { agentTools, tables, allowWrites = false, maxRows } = db
  const forUser = (userId: string) =>
    agentTools(db.db, { tables, userId, allowWrites, ...(maxRows ? { maxRows } : {}) }).map(
      (tool): PlainTool => {
        const scopes = tool.annotations?.readOnlyHint ? db.scopes?.read : db.scopes?.write
        return scopes?.length ? { ...tool, scopes } : tool
      },
    )
  forUser("setup-check") // a table with no userId column throws here, not on a tool call
  const who = db.userId ?? ((c: McpCaller) => c.token?.claims.sub)
  return {
    ...base,
    tools: (caller: McpCaller) => {
      const userId = who(caller)
      return [...own, ...(userId ? forUser(userId) : []), ...mine]
    },
  }
}

/** A new McpServer with every Signet tool, resource and prompt. Cheap; one per connection or request. */
export function createSignetMcpServer(options: StaticOptions = {}): McpServer {
  return createMcpServer(signetMcpOptions(options))
}

/**
 * A fetch handler serving the server over streamable HTTP (2026-07-28 and
 * 2025-era clients), for Workers, Bun.serve, Deno or any fetch host:
 * `export default { fetch: signetMcpFetch() }`. File-system access is off.
 */
export function signetMcpFetch(
  options: Omit<StaticOptions, "fs"> = {},
): (req: Request) => Promise<Response> {
  const handler = createMcpHandler(() => createSignetMcpServer({ ...options, fs: false }))
  return (req) => handler.fetch(req)
}
