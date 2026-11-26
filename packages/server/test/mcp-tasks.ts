/**
 * The Tasks extension through mountMcp: a task tool answers a client that
 * declared the extension with a task handle, polls to a result, cancels, and is
 * private to the user that made it. Raw JSON-RPC in both protocol eras.
 */
import { Hono } from "hono"
import { z } from "zod"
import { createMcpServer, defineTool, memoryTaskStore, TASKS_EXTENSION_ID } from "../src/mcp"
import { mountMcp } from "../src/mcp/hono"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean | undefined, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

type Rpc = { result?: any; error?: { code: number; message: string; data?: any } }
const MODERN = "2026-07-28"
let nextId = 1

async function rpc(
  app: Hono,
  method: string,
  params: Record<string, unknown> = {},
  opts: { tasks?: boolean; user?: string; era?: "legacy" | "modern" } = {},
): Promise<Rpc> {
  const { tasks = true, user, era = "modern" } = opts
  const base = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(user ? { "x-user": user } : {}),
  }
  const name = params.name ?? params.taskId
  const headers =
    era === "legacy"
      ? { ...base, "mcp-protocol-version": "2025-11-25" }
      : {
          ...base,
          "mcp-protocol-version": MODERN,
          "mcp-method": method,
          ...(typeof name === "string" ? { "mcp-name": name } : {}),
        }
  const body =
    era === "legacy"
      ? params
      : {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MODERN,
            "io.modelcontextprotocol/clientInfo": { name: "raw", version: "0" },
            "io.modelcontextprotocol/clientCapabilities": tasks
              ? { extensions: { [TASKS_EXTENSION_ID]: {} } }
              : {},
          },
        }
  const res = await app.request("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params: body }),
  })
  const text = await res.text()
  try {
    return JSON.parse(text) as Rpc
  } catch {
    const data = text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .pop()
    return (data ? JSON.parse(data.slice(6)) : {}) as Rpc
  }
}

/** Poll `tasks/get` until the task is no longer working. */
async function settled(app: Hono, taskId: string, user?: string): Promise<Rpc> {
  for (let i = 0; i < 100; i++) {
    const r = await rpc(app, "tasks/get", { taskId }, { user })
    if (r.result && r.result.status !== "working") return r
    await new Promise((res) => setTimeout(res, 5))
  }
  throw new Error("task never settled")
}

// A tool that waits for the test to let it finish, so each state can be observed.
const gates: (() => void)[] = []
const aborted: boolean[] = []
const store = memoryTaskStore()
const tools = [
  defineTool({
    name: "slow",
    description: "waits until released",
    task: true,
    handler: async (_i, ctx) => {
      const idx = aborted.push(false) - 1
      ctx.signal.addEventListener("abort", () => {
        aborted[idx] = true
      })
      await new Promise<void>((r) => gates.push(r))
      return "done"
    },
  }),
  defineTool({
    name: "boom",
    description: "throws",
    task: { ttlMs: 60_000, pollIntervalMs: 250 },
    input: z.object({}),
    handler: () => {
      throw new Error("kaput")
    },
  }),
  defineTool({ name: "plain", description: "not a task tool", handler: () => "plain" }),
]
const app = new Hono()
mountMcp(app, "/mcp", {
  name: "t",
  version: "1",
  tools,
  tasks: { store },
  principal: (caller) => caller.c?.req.header("x-user"),
})
const release = () => gates.shift()?.()
const text = (r: Rpc) => r.result?.content?.[0]?.text

// --- the extension is declared ---
{
  const d = await rpc(app, "server/discover")
  ok(
    "server/discover declares the tasks extension",
    d.result?.capabilities?.extensions?.[TASKS_EXTENSION_ID] !== undefined,
    d.result?.capabilities,
  )
}

// --- a task tool answers a task-capable client with a handle, then a result ---
{
  const made = await rpc(app, "tools/call", { name: "slow", arguments: {} })
  const t = made.result
  ok(
    "tools/call answers with a task handle",
    t?.resultType === "task" && typeof t?.taskId === "string" && t?.status === "working",
    made,
  )
  ok(
    "the handle carries the default ttl and poll interval",
    t?.ttlMs === 3_600_000 && t?.pollIntervalMs === 5000 && !!t?.createdAt && !!t?.lastUpdatedAt,
    t,
  )
  const working = await rpc(app, "tasks/get", { taskId: t.taskId })
  ok(
    "tasks/get while the tool runs: working, no result yet",
    working.result?.resultType === "complete" &&
      working.result?.status === "working" &&
      working.result?.result === undefined,
    working,
  )
  release()
  const done = await settled(app, t.taskId)
  ok(
    "tasks/get after it finishes: completed with the tool result inline",
    done.result?.status === "completed" &&
      done.result?.result?.content?.[0]?.text === "done" &&
      done.result?.resultType === "complete",
    done,
  )
}

// --- a client that did not declare the extension gets the plain result ---
{
  const pending = rpc(app, "tools/call", { name: "slow", arguments: {} }, { tasks: false })
  await new Promise((r) => setTimeout(r, 10))
  release()
  const r = await pending
  ok(
    "without the extension the tool runs synchronously",
    text(r) === "done" && r.result?.resultType !== "task",
    r,
  )
  const g = await rpc(app, "tasks/get", { taskId: "x" }, { tasks: false })
  ok(
    "tasks/get without the extension is -32021 naming the extension",
    g.error?.code === -32021 &&
      g.error?.data?.requiredCapabilities?.extensions?.[TASKS_EXTENSION_ID] !== undefined,
    g,
  )
  const plain = await rpc(app, "tools/call", { name: "plain", arguments: {} })
  ok("a tool without `task` is unchanged", text(plain) === "plain", plain)
}

// --- the 2025 era cannot declare the extension: sync result, no task methods ---
{
  const pending = rpc(app, "tools/call", { name: "slow", arguments: {} }, { era: "legacy" })
  await new Promise((r) => setTimeout(r, 10))
  release()
  const r = await pending
  ok(
    "a 2025-era client gets the plain result",
    text(r) === "done" && r.result?.resultType !== "task",
    r,
  )
  const g = await rpc(app, "tasks/get", { taskId: "x" }, { era: "legacy" })
  ok("a 2025-era client cannot use tasks/get", g.error !== undefined, g)
}

// --- unknown ids, and tasks are private to the user that made them ---
{
  const missing = await rpc(app, "tasks/get", { taskId: "no-such-task" })
  ok("an unknown task is -32602", missing.error?.code === -32602, missing)
  const made = await rpc(app, "tools/call", { name: "slow", arguments: {} }, { user: "ann" })
  const id = made.result?.taskId
  const theirs = await rpc(app, "tasks/get", { taskId: id }, { user: "bob" })
  ok("another user's task reads as not found", theirs.error?.code === -32602, theirs)
  const cancelTheirs = await rpc(app, "tasks/cancel", { taskId: id }, { user: "bob" })
  ok("another user cannot cancel it either", cancelTheirs.error?.code === -32602, cancelTheirs)
  const mine = await rpc(app, "tasks/get", { taskId: id }, { user: "ann" })
  ok("the owner reads it", mine.result?.status === "working", mine)
  release()
  await settled(app, id, "ann")
}

// --- cancel: acknowledged, status cancelled, the work is told, a late finish changes nothing ---
{
  const made = await rpc(app, "tools/call", { name: "slow", arguments: {} })
  const id = made.result?.taskId
  const idx = aborted.length - 1
  const ack = await rpc(app, "tasks/cancel", { taskId: id })
  ok("tasks/cancel is acknowledged", ack.result?.resultType === "complete" && !ack.error, ack)
  const g = await rpc(app, "tasks/get", { taskId: id })
  ok("the task reads as cancelled", g.result?.status === "cancelled", g)
  ok("the running tool's signal aborted", aborted[idx] === true, aborted)
  release() // the handler finishes after the cancel
  await new Promise((r) => setTimeout(r, 20))
  const after = await rpc(app, "tasks/get", { taskId: id })
  ok(
    "a late finish does not overwrite the cancel",
    after.result?.status === "cancelled" && after.result?.result === undefined,
    after,
  )
}

// --- a tool error is a completed task with isError, and per-tool ttl/poll apply ---
{
  const made = await rpc(app, "tools/call", { name: "boom", arguments: {} })
  ok(
    "per-tool ttlMs and pollIntervalMs",
    made.result?.ttlMs === 60_000 && made.result?.pollIntervalMs === 250,
    made,
  )
  const done = await settled(app, made.result.taskId)
  ok(
    "a tool that throws ends completed with an isError result, not failed",
    done.result?.status === "completed" && done.result?.result?.isError === true,
    done,
  )
}

// --- tasks/update acknowledges (tasks never wait on input here) ---
{
  const made = await rpc(app, "tools/call", { name: "slow", arguments: {} })
  const up = await rpc(app, "tasks/update", {
    taskId: made.result.taskId,
    inputResponses: { nothing: { action: "accept" } },
  })
  ok("tasks/update acknowledges and ignores unknown keys", up.result?.resultType === "complete", up)
  release()
  await settled(app, made.result.taskId)
}

// --- the store: ttl expiry and first-settle-wins ---
{
  let t = 1_000_000
  const s = memoryTaskStore(() => t)
  const rec = {
    taskId: "a",
    owner: "",
    status: "working" as const,
    createdAt: new Date(t).toISOString(),
    lastUpdatedAt: new Date(t).toISOString(),
    ttlMs: 1000,
  }
  await s.create(rec)
  const first = await s.settle("a", { status: "cancelled" })
  const second = await s.settle("a", {
    status: "completed",
    result: { content: [{ type: "text", text: "x" }] },
  })
  ok("settle: the first one wins", first?.status === "cancelled" && second === undefined, [
    first,
    second,
  ])
  t += 2000
  ok("a task past its ttlMs is gone", (await s.get("a")) === undefined)
  await s.create({ ...rec, taskId: "b", ttlMs: null, createdAt: new Date(t).toISOString() })
  t += 10 ** 9
  ok("ttlMs null keeps the task", (await s.get("b")) !== undefined)
}

// --- a task tool without a store is a build-time error ---
{
  let msg = ""
  try {
    createMcpServer({ name: "x", version: "1", tools })
  } catch (e) {
    msg = (e as Error).message
  }
  ok("task tool without `tasks` throws", /tasks: \{ store \}/.test(msg), msg)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
