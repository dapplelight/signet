#!/usr/bin/env node
/**
 * signet-mcp: the Signet MCP server over stdio.
 *
 *   claude mcp add signet -- bunx @dapplelight/signet-mcp
 *
 * stdout carries only JSON-RPC; nothing here logs to it.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { createSignetMcpServer } from "./index.js"

serveStdio(() => createSignetMcpServer({ fs: true }), {
  onerror: (err) => process.stderr.write(`signet-mcp: ${err.message}\n`),
})
