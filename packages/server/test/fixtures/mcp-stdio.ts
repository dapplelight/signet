// A stdio MCP server, as app-a runs one: spawned by test/mcp.ts, which talks
// to it with the SDK's client in both protocol eras.
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { z } from "zod"
import { createMcpServer, defineTool } from "../../src/mcp"

const tools = [
  defineTool({
    name: "add",
    description: "Add two numbers",
    input: z.object({ a: z.number(), b: z.number() }),
    handler: ({ a, b }) => ({ sum: a + b }),
  }),
  defineTool({
    name: "crash",
    description: "Throws",
    handler: () => {
      throw new Error("secret")
    },
  }),
]

serveStdio(() => createMcpServer({ name: "stdio", version: "0", tools }))
