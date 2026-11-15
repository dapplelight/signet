import { expect, test } from "bun:test"

// The MCP endpoint at /mcp: every zValidator route is a tool that runs as the
// caller, and a write asks the person first.
// The same values as api.test.ts: bun test runs both in one process, and the
// env is validated once.
Object.assign(process.env, {
  APP_ENV: "development",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  OTP_SECRET: "test-otp-secret-0123456789abcdef0123",
  ADMIN_PHONES: "+919000000001",
  BILLING: "fake",
})
const { createApp } = await import("../api/app.ts")
const { openDb } = await import("../api/db/open.ts")
const { sqlKv } = await import("../api/db/kv.ts")

const { db, query } = openDb(":memory:")
const app = createApp({ db, query, kv: sqlKv(db.orm) })

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
