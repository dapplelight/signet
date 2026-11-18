import { expect, test } from "bun:test"
import { app } from "./helpers.ts"

// The MCP endpoint at /mcp: every zValidator route is a tool that runs as the
// caller, and a write asks the person first.
const rpc = async (method: string, params = {}) => {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const text = await res.text()
  const data = text.startsWith("{")
    ? text
    : (
        text
          .split("\n")
          .filter((l) => l.startsWith("data: "))
          .pop() ?? ""
      ).slice(6)
  return data ? JSON.parse(data) : null
}

// payments:begin
test("validated routes are MCP tools", async () => {
  const names = (await rpc("tools/list")).result.tools.map((t: { name: string }) => t.name)
  expect(names).toContain("post_api_billing_checkout")
})

test("a write tool asks for approval first, and does nothing without it", async () => {
  const body = await rpc("tools/call", {
    name: "post_api_billing_checkout",
    arguments: { plan: "pro" },
  })
  expect(body.result.isError).toBe(true)
  expect(body.result.structuredContent.code).toBe("APPROVAL_REQUIRED")
})
// payments:end
// !payments:begin
// auth:begin
test("validated routes are MCP tools", async () => {
  const names = (await rpc("tools/list")).result.tools.map((t: { name: string }) => t.name)
  expect(names).toContain("post_api_auth_otp")
})

test("a write tool asks for approval first, and does nothing without it", async () => {
  const body = await rpc("tools/call", {
    name: "post_api_auth_otp",
    arguments: { phone: "+919000000099" },
  })
  expect(body.result.isError).toBe(true)
  expect(body.result.structuredContent.code).toBe("APPROVAL_REQUIRED")
})
// auth:end
// !auth:begin
test("/mcp answers tools/list; each zValidator route you add shows up here", async () => {
  expect(Array.isArray((await rpc("tools/list")).result.tools)).toBe(true)
})
// !auth:end
// !payments:end
