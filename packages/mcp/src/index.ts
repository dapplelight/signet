/**
 * An MCP server that gives agents everything Signet has: docs, exports,
 * components, themes, scaffolding, convention checks, recipes and migration
 * notes, from an index built from the repo at release time.
 */

import {
  type CreateMcpServerOptions,
  createMcpServer,
  type McpPrompt,
  type McpResource,
  type McpTool,
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

export type SignetMcpOptions = ToolOptions & {
  /** More tools, resources or prompts to serve beside Signet's (e.g. an app's own). */
  tools?: readonly McpTool[]
  resources?: readonly McpResource[]
  prompts?: readonly McpPrompt[]
}

/**
 * Options for signet-server's `createMcpServer`, or for `mountMcp(app, "/mcp", ...)`
 * from `@dapplelight/signet-server/mcp/hono` to host it on a Hono app.
 */
export function signetMcpOptions(options: SignetMcpOptions = {}): CreateMcpServerOptions {
  return {
    name: "signet",
    version: VERSION,
    instructions: INSTRUCTIONS,
    tools: [...signetTools(options), ...(options.tools ?? [])],
    resources: [...signetResources(), ...(options.resources ?? [])],
    prompts: [...signetPrompts(), ...(options.prompts ?? [])],
    mapError,
  }
}

/** A new McpServer with every Signet tool, resource and prompt. Cheap; one per connection or request. */
export function createSignetMcpServer(options: SignetMcpOptions = {}): McpServer {
  return createMcpServer(signetMcpOptions(options))
}

/**
 * A fetch handler serving the server over streamable HTTP (2026-07-28 and
 * 2025-era clients), for Workers, Bun.serve, Deno or any fetch host:
 * `export default { fetch: signetMcpFetch() }`. File-system access is off.
 */
export function signetMcpFetch(
  options: Omit<SignetMcpOptions, "fs"> = {},
): (req: Request) => Promise<Response> {
  const handler = createMcpHandler(() => createSignetMcpServer({ ...options, fs: false }))
  return (req) => handler.fetch(req)
}
