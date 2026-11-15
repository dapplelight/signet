import { expect, test } from "bun:test"

test("MCP=off answers /mcp with a 404", () => {
  // The env is validated once per process, so the app runs in its own here.
  const code = `
    const { createApp } = await import("./src/app.ts")
    const { memoryStore } = await import("@dapplelight/signet-server/middleware/rate-limit")
    const app = createApp({ store: memoryStore(), trust: "none" })
    const res = await app.request("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    console.log(res.status)`
  const run = Bun.spawnSync(["bun", "-e", code], { env: { ...Bun.env, MCP: "off" } })
  expect(run.stdout.toString().trim()).toBe("404")
})
