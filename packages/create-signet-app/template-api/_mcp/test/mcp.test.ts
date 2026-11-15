import { expect, test } from "bun:test"
import { memoryStore } from "@dapplelight/signet-server/middleware/rate-limit"
import { createApp } from "../src/app"

// The MCP endpoint at /mcp, over plain JSON-RPC (stateless HTTP, so each call
// stands alone). MCP=off is checked in mcp-off.test.ts: env is read once per process.
const app = () => createApp<Record<string, never>>({ store: memoryStore(), trust: "none" })

const rpc = async (api: ReturnType<typeof app>, method: string, params = {}, env = {}) => {
  const res = await api.request(
    "/mcp",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    env,
  )
  const text = await res.text()
  const data = text.startsWith("{")
    ? text
    : (
        text
          .split("\n")
          .filter((l) => l.startsWith("data: "))
          .pop() ?? ""
      ).slice(6)
  return { status: res.status, body: data ? JSON.parse(data) : null }
}

test("validated routes are MCP tools", async () => {
  const { body } = await rpc(app(), "tools/list")
  const echo = body.result.tools.find((t: { name: string }) => t.name === "post_api_echo")
  expect(echo.description).toBe("Echo a message back")
  expect(echo.inputSchema.properties.message).toBeDefined()
})

test("a write tool asks for approval first, and does nothing without it", async () => {
  const { body } = await rpc(app(), "tools/call", {
    name: "post_api_echo",
    arguments: { message: "hi" },
  })
  expect(body.result.isError).toBe(true)
  expect(body.result.structuredContent.code).toBe("APPROVAL_REQUIRED")
})
