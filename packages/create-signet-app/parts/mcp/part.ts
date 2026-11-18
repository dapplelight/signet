import type { Part } from "../../src/compose.js"

export default {
  description: "serve the API's validated routes to agents at /mcp",
  apiOnly: true,
  // signet-server's optional peer for /mcp.
  api: { deps: { "@modelcontextprotocol/server": "^2.4.0" } },
} satisfies Part
