// A stdio MCP server, as app-a runs one: spawned by test/mcp.ts, which talks
// to it with the SDK's client in both protocol eras.
import { acceptedContent, inputRequired } from "@modelcontextprotocol/server"
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
    name: "deploy",
    description: "Asks the client to confirm, then acts",
    input: z.object({ env: z.string() }),
    handler: ({ env }, ctx) => {
      const confirm = z.object({ confirm: z.boolean() })
      const answer = acceptedContent(ctx.mcp.mcpReq.inputResponses, "confirm", confirm)
      if (!answer)
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: `Deploy to ${env}?`,
              requestedSchema: {
                type: "object",
                properties: { confirm: { type: "boolean" } },
                required: ["confirm"],
              },
            }),
          },
        })
      return answer.confirm ? `deployed to ${env}` : "cancelled"
    },
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
