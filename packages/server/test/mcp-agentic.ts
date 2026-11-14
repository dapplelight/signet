/**
 * Apps inside agents: per-user tool lists and list_changed, plain tool
 * objects, routes as tools, requireApproval, rate limit / timeout /
 * onToolCall, and the fetch-only client — all against an in-process server.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { Hono, type MiddlewareHandler } from "hono"
import { z } from "zod"
import {
  type AnyTool,
  defineTool,
  type PlainTool,
  requireApproval,
  routesAsTools,
  type ToolCallEvent,
} from "../src/mcp"
import { createMcpClient, McpClientError } from "../src/mcp/client"
import { createMcpChanges, mountMcp } from "../src/mcp/hono"
import { memoryStore } from "../src/middleware/rate-limit"
import type { VerifiedToken } from "../src/oauth-rs/verify"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean | undefined, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const MODERN = "2026-07-28"

/** Stands in for oauth-rs `requireToken`: `Bearer <sub>` becomes a verified token. */
const fakeAuth: MiddlewareHandler = async (c, next) => {
  const sub = c.req.header("authorization")?.replace(/^Bearer /, "")
  if (sub) {
    const token: VerifiedToken = {
      claims: { iss: "i", sub, aud: "a", exp: 0, client_id: "agent-app" },
      scopes: [],
    }
    c.set("token" as never, token as never)
  }
  await next()
}

async function connect(app: Hono, user?: string, opts: { elicitation?: boolean } = {}) {
  const client = new Client(
    { name: "t", version: "0" },
    {
      versionNegotiation: { mode: { pin: MODERN } },
      ...(opts.elicitation ? { capabilities: { elicitation: { form: {} } } } : {}),
    },
  )
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://t.local/mcp"), {
      fetch: async (u, i) => {
        const req = new Request(u, i)
        if (user) req.headers.set("authorization", `Bearer ${user}`)
        return app.fetch(req)
      },
    }),
  )
  return client
}
const text = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0]?.text
const structured = (r: unknown) =>
  (r as { structuredContent?: Record<string, unknown> }).structuredContent

// --- typing: a plain tool from another package needs no glue ---
{
  const plain: PlainTool = {
    name: "p",
    description: "p",
    inputSchema: { type: "object" },
    run: (input: { n: number }) => input.n,
  }
  const list: AnyTool[] = [plain, defineTool({ name: "d", description: "d", handler: () => 1 })]
  void list
}

// --- dynamic, per-user tools, and list_changed ---
const changes = createMcpChanges()
const common = defineTool({ name: "common", description: "Everyone", handler: () => "hi" })
const adminOnly = defineTool({ name: "admin_only", description: "Admins", handler: () => "root" })
const dynamicApp = new Hono()
mountMcp(dynamicApp, "/mcp", {
  name: "dynamic",
  version: "1",
  middleware: [fakeAuth],
  changes,
  tools: ({ token }) => (token?.claims.sub === "admin" ? [common, adminOnly] : [common]),
})

{
  const admin = await connect(dynamicApp, "admin")
  const user = await connect(dynamicApp, "user")
  const a = (await admin.listTools()).tools.map((t) => t.name)
  const u = (await user.listTools()).tools.map((t) => t.name)
  ok(
    "dynamic: the list differs by principal",
    a.join() === "common,admin_only" && u.join() === "common",
    { a, u },
  )
  const denied = await user.callTool({ name: "admin_only", arguments: {} }).catch((e: Error) => e)
  ok("dynamic: a tool not in your list is not callable", denied instanceof Error, denied)
  ok(
    "dynamic: listChanged is advertised",
    admin.getServerCapabilities()?.tools?.listChanged === true,
    admin.getServerCapabilities(),
  )
  await admin.close()
  await user.close()
}

/** Open a 2026-07-28 listen stream as `user`; `next(ms)` reads one event or null. */
async function listen(user: string) {
  const abort = new AbortController()
  const res = await dynamicApp.request("/mcp", {
    method: "POST",
    signal: abort.signal,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MODERN,
      "mcp-method": "subscriptions/listen",
      authorization: `Bearer ${user}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "subscriptions/listen",
      params: {
        notifications: { toolsListChanged: true },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MODERN,
          "io.modelcontextprotocol/clientInfo": { name: "raw", version: "0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  })
  const reader = (res.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined
  async function next(ms: number): Promise<{ method?: string; params?: unknown } | null> {
    for (;;) {
      const end = buffer.indexOf("\n\n")
      if (end !== -1) {
        const chunk = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = chunk.split("\n").find((l) => l.startsWith("data: "))
        if (data) return JSON.parse(data.slice(6))
        continue // a keepalive comment
      }
      pending ??= reader.read()
      const got = await Promise.race([
        pending,
        new Promise<null>((r) => setTimeout(() => r(null), ms)),
      ])
      if (got === null) return null
      pending = undefined
      if (got.done) return null
      buffer += decoder.decode(got.value, { stream: true })
    }
  }
  return { next, close: () => abort.abort(), status: res.status }
}

{
  const admin = await listen("admin")
  const user = await listen("user")
  const ackA = await admin.next(1000)
  const ackU = await user.next(1000)
  ok(
    "list_changed: the listen stream is acknowledged with toolsListChanged honoured",
    ackA?.method === "notifications/subscriptions/acknowledged" &&
      (ackA.params as { notifications?: { toolsListChanged?: boolean } }).notifications
        ?.toolsListChanged === true &&
      ackU?.method === "notifications/subscriptions/acknowledged",
    { ackA, ackU },
  )
  changes.toolsChanged("admin")
  const gotA = await admin.next(1000)
  const gotU = await user.next(150)
  ok(
    "list_changed: reaches the principal it names",
    gotA?.method === "notifications/tools/list_changed",
    gotA,
  )
  ok("list_changed: does not reach another principal", gotU === null, gotU)
  changes.toolsChanged()
  const all = await user.next(1000)
  ok(
    "list_changed: no principal reaches every listener",
    all?.method === "notifications/tools/list_changed",
    all,
  )
  admin.close()
  user.close()
}

// --- static lists still advertise listChanged: false ---
{
  const app = new Hono()
  mountMcp(app, "/mcp", { name: "static", version: "1", tools: [common] })
  const client = await connect(app)
  ok(
    "static: listChanged stays false",
    client.getServerCapabilities()?.tools?.listChanged === false,
  )
  await client.close()
}

// --- plain tool objects, JSON Schema and zod ---
{
  const app = new Hono()
  const jsonTool = {
    name: "add",
    description: "Add two numbers",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
    annotations: { readOnlyHint: true },
    run(input: { a: number; b: number }) {
      return { sum: input.a + input.b }
    },
  }
  const zodTool = {
    name: "shout",
    description: "Upper-case",
    inputSchema: z.object({ s: z.string() }),
    run: (input: { s: string }, ctx: { tool: string }) => `${ctx.tool}:${input.s.toUpperCase()}`,
  }
  mountMcp(app, "/mcp", { name: "plain", version: "1", tools: [jsonTool, zodTool] })
  const client = await connect(app)
  const listed = (await client.listTools()).tools
  const add = listed.find((t) => t.name === "add")
  ok(
    "plain: JSON Schema is advertised as given, with annotations",
    (add?.inputSchema as { required?: string[] } | undefined)?.required?.join() === "a,b" &&
      add?.annotations?.readOnlyHint === true,
    add,
  )
  const r = await client.callTool({ name: "add", arguments: { a: 2, b: 3 } })
  ok("plain: run gets the input", text(r) === '{"sum":5}', r)
  const bad = await client.callTool({ name: "add", arguments: { a: "x" } }).catch((e: Error) => e)
  ok(
    "plain: JSON Schema input is validated before run",
    bad instanceof Error || (bad as { isError?: boolean }).isError === true,
    bad,
  )
  const s = await client.callTool({ name: "shout", arguments: { s: "hey" } })
  ok("plain: a zod inputSchema works too, with ctx", text(s) === "shout:HEY", s)
  await client.close()
}

// --- routes as tools: in-process, with the caller's auth ---
{
  const app = new Hono()
  app.get("/api/whoami", (c) => {
    const auth = c.req.header("authorization")
    if (!auth) return c.json({ success: false, error: "Sign in", code: "UNAUTHORIZED" }, 401)
    return c.json({ user: auth.replace(/^Bearer /, ""), verbose: c.req.query("verbose") })
  })
  app.post("/api/orders/:id/refund", async (c) => {
    const body = (await c.req.json()) as { amount: number }
    if (c.req.header("authorization") !== "Bearer admin")
      return c.json({ success: false, error: "Admins only", code: "FORBIDDEN_ROLE" }, 403)
    return c.json({ id: c.req.param("id"), refunded: body.amount })
  })
  app.get("/api/secret", (c) => c.text("never exposed"))
  const tools = routesAsTools(app, [
    {
      name: "whoami",
      description: "Who am I",
      method: "GET",
      path: "/api/whoami",
      input: z.object({ verbose: z.boolean().optional() }),
    },
    {
      name: "refund_order",
      description: "Refund an order",
      method: "POST",
      path: "/api/orders/:id/refund",
      input: z.object({ id: z.string(), amount: z.number() }),
      annotations: { destructiveHint: true },
    },
  ])
  mountMcp(app, "/mcp", { name: "routes", version: "1", tools })
  const admin = await connect(app, "admin")
  const listed = (await admin.listTools()).tools
  ok(
    "routes: only the chosen routes become tools, with method hints",
    listed.map((t) => t.name).join() === "whoami,refund_order" &&
      listed[0]?.annotations?.readOnlyHint === true &&
      listed[1]?.annotations?.destructiveHint === true,
    listed,
  )
  const me = await admin.callTool({ name: "whoami", arguments: { verbose: true } })
  ok(
    "routes: the caller's Authorization reaches the route",
    text(me) === '{"user":"admin","verbose":"true"}',
    me,
  )
  const refund = await admin.callTool({ name: "refund_order", arguments: { id: "o1", amount: 40 } })
  ok("routes: path params and JSON body", text(refund) === '{"id":"o1","refunded":40}', refund)
  const user = await connect(app, "user")
  const denied = await user.callTool({ name: "refund_order", arguments: { id: "o1", amount: 40 } })
  ok(
    "routes: a refusal keeps the route's envelope code",
    (denied as { isError?: boolean }).isError === true &&
      structured(denied)?.code === "FORBIDDEN_ROLE",
    denied,
  )
  const anon = await connect(app)
  const nobody = await anon.callTool({ name: "whoami", arguments: {} })
  ok(
    "routes: no auth means the route's own 401",
    structured(nobody)?.code === "UNAUTHORIZED",
    nobody,
  )
  await Promise.all([admin.close(), user.close(), anon.close()])
}

// --- requireApproval ---
let refunded = 0
const approvalApp = new Hono()
mountMcp(approvalApp, "/mcp", {
  name: "approval",
  version: "1",
  confirm: { key: "k".repeat(32) },
  tools: [
    defineTool({
      name: "refund",
      description: "Refund money",
      annotations: { destructiveHint: true },
      input: z.object({ amount: z.number() }),
      handler: async (input, ctx) => {
        const gate = await requireApproval(ctx, {
          summary: `Refund ${input.amount}`,
          details: { amount: input.amount, to: "order 1042" },
          args: input,
        })
        if (gate) return gate
        refunded += input.amount
        return "Refunded."
      },
    }),
  ],
})
{
  const client = await connect(approvalApp, undefined, { elicitation: true })
  let asked = ""
  client.setRequestHandler("elicitation/create", async (req) => {
    asked = (req.params as { message: string }).message
    return { action: "accept", content: { confirm: true } }
  })
  const r = await client.callTool({ name: "refund", arguments: { amount: 40 } })
  ok("approval: approved acts", text(r) === "Refunded." && refunded === 40, r)
  ok(
    "approval: summary and details reach the person",
    asked === "Refund 40\n\namount: 40\nto: order 1042",
    asked,
  )
  await client.close()
}
{
  const client = await connect(approvalApp, undefined, { elicitation: true })
  client.setRequestHandler("elicitation/create", async () => ({ action: "decline" }))
  const r = await client.callTool({ name: "refund", arguments: { amount: 5 } })
  ok(
    "approval: declined does not act and says so",
    refunded === 40 && structured(r)?.code === "APPROVAL_DECLINED",
    r,
  )
  await client.close()
}
{
  const client = await connect(approvalApp) // no elicitation
  const r = await client.callTool({ name: "refund", arguments: { amount: 7 } })
  const approval = structured(r)?.approval as
    | { summary?: string; details?: { amount?: number } }
    | undefined
  ok(
    "approval: without elicitation, a structured needs-approval result and no action",
    refunded === 40 &&
      (r as { isError?: boolean }).isError === true &&
      structured(r)?.code === "APPROVAL_REQUIRED" &&
      approval?.summary === "Refund 7" &&
      approval.details?.amount === 7,
    r,
  )
  await client.close()
}

// --- guardrails: rate limit, timeout, onToolCall ---
{
  const events: ToolCallEvent[] = []
  let sawAbort = false
  const app = new Hono()
  mountMcp(app, "/mcp", {
    name: "guarded",
    version: "1",
    middleware: [fakeAuth],
    rateLimit: { store: memoryStore() },
    timeoutMs: 1000,
    onToolCall: (e) => {
      events.push(e)
    },
    tools: [
      defineTool({
        name: "limited",
        description: "",
        rateLimit: { max: 2, windowSeconds: 60 },
        handler: () => "ok",
      }),
      defineTool({
        name: "slow",
        description: "",
        timeoutMs: 30,
        handler: (_i, ctx) =>
          new Promise((resolve) => {
            ctx.signal.addEventListener("abort", () => {
              sawAbort = true
            })
            setTimeout(() => resolve("late"), 300)
          }),
      }),
      defineTool({
        name: "boom",
        description: "",
        handler: () => {
          throw new Error("db down")
        },
      }),
    ],
  })
  const a = await connect(app, "alice")
  const b = await connect(app, "bob")
  const r1 = await a.callTool({ name: "limited", arguments: {} })
  await a.callTool({ name: "limited", arguments: {} })
  const r3 = await a.callTool({ name: "limited", arguments: {} })
  ok("rate limit: under the limit runs", text(r1) === "ok")
  ok("rate limit: over it is RATE_LIMITED", structured(r3)?.code === "RATE_LIMITED", r3)
  const rb = await b.callTool({ name: "limited", arguments: {} })
  ok("rate limit: per principal", text(rb) === "ok", rb)
  const started = Date.now()
  const slow = await a.callTool({ name: "slow", arguments: {} })
  ok(
    "timeout: answers TIMEOUT without waiting",
    structured(slow)?.code === "TIMEOUT" && Date.now() - started < 250,
    slow,
  )
  ok("timeout: ctx.signal aborts", sawAbort)
  await a.callTool({ name: "boom", arguments: {} })
  const limitedOk = events.find((e) => e.tool === "limited" && e.ok)
  const limitedNo = events.find((e) => e.tool === "limited" && !e.ok)
  const boom = events.find((e) => e.tool === "boom")
  ok(
    "onToolCall: name, principal, actor and duration",
    limitedOk?.principal === "alice" &&
      limitedOk.actor?.clientId === "agent-app" &&
      typeof limitedOk.durationMs === "number",
    limitedOk,
  )
  ok("onToolCall: error results carry their code", limitedNo?.code === "RATE_LIMITED", limitedNo)
  ok(
    "onToolCall: a thrown error is passed along",
    boom?.ok === false &&
      boom.code === "INTERNAL_ERROR" &&
      (boom.error as Error)?.message === "db down",
    boom,
  )
  ok("onToolCall: once per call", events.length === 6, events.length)
  await a.close()
  await b.close()
}

// --- the fetch-only client, both eras ---
{
  const app = new Hono()
  mountMcp(app, "/mcp", {
    name: "remote",
    version: "1",
    middleware: [fakeAuth],
    tools: [
      defineTool({
        name: "whoami",
        description: "Who is calling",
        output: z.object({ sub: z.string() }),
        handler: (_i, { token }) => ({ sub: token?.claims.sub ?? "nobody" }),
      }),
    ],
  })
  for (const era of ["legacy", "modern"] as const) {
    const client = createMcpClient({
      url: "http://t.local/mcp",
      token: () => "carol",
      era,
      fetch: (req) => Promise.resolve(app.fetch(req)),
    })
    const tools = await client.listTools()
    ok(`client [${era}]: lists tools`, tools.length === 1 && tools[0]?.name === "whoami", tools)
    const r = await client.callTool<{ sub: string }>("whoami")
    const sub: string | undefined = r.structuredContent?.sub // typed
    ok(`client [${era}]: the bearer token reaches the tool, typed result`, sub === "carol", r)
    const err = await client.callTool("nope").catch((e) => e)
    ok(
      `client [${era}]: a JSON-RPC error throws McpClientError`,
      err instanceof McpClientError && err.code === -32602,
      err,
    )
    await client.close()
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) throw new Error(`${fail} failed`)
