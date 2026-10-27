import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import {
  acceptedContent,
  inputRequired,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { ApiException } from "../src/http/errors"
import {
  createMcpServer,
  defineTool,
  describeToolError,
  type McpTool,
  type ToolContext,
  toolResult,
} from "../src/mcp"
import { mcpHandler, mountMcp } from "../src/mcp/hono"
import { requireToken } from "../src/oauth-rs/hono"
import { createJwksCache } from "../src/oauth-rs/jwks"
import { createTokenVerifier } from "../src/oauth-rs/verify"
import { MANY_TOOLS } from "./fixtures/mcp-many-tools"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean | undefined, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

// --- typing: compile-time assertions, checked by `bun run typecheck` ---

defineTool({
  name: "typed",
  description: "typed",
  input: z.object({
    n: z.number().default(3),
    s: z.string(),
    when: z.string().transform(Date.parse),
  }),
  handler: (input) => {
    const n: number = input.n // default applied: number, not number | undefined
    const when: number = input.when // transform output, not input
    input.s.toUpperCase()
    // @ts-expect-error — not in the schema
    input.missing
    // @ts-expect-error — s is a string
    input.s.toFixed()
    return n + when
  },
})
defineTool({
  name: "bad_schema",
  description: "input must be an object schema",
  // @ts-expect-error — a tool's arguments are an object
  input: z.string(),
  handler: () => null,
})
defineTool({
  name: "ctx",
  description: "ctx",
  handler: (_input, ctx) => {
    const signal: AbortSignal = ctx.signal
    const sub: string | undefined = ctx.token?.claims.sub
    const req: Request | undefined = ctx.mcp.http?.req // the SDK's own context
    return [signal, sub, req]
  },
})

// output: the handler returns z.input of the schema, a toolResult, or a promise of either.
const Dashboard = z.object({ total: z.number(), currency: z.string().default("INR") })
defineTool({
  name: "typed_output",
  description: "returns the output shape",
  output: Dashboard,
  handler: () => ({ total: 1 }), // z.input: the defaulted field may be omitted
})
defineTool({
  name: "typed_output_async",
  description: "a promise of the output shape",
  input: z.object({ n: z.number() }),
  output: Dashboard,
  handler: async ({ n }) => ({ total: n, currency: "USD" }),
})
defineTool({
  name: "typed_output_raw",
  description: "an explicit toolResult still type-checks",
  output: Dashboard,
  handler: () => toolResult({ content: [{ type: "text", text: "x" }], isError: true }),
})
defineTool({
  name: "typed_output_wrong",
  description: "the wrong shape",
  output: Dashboard,
  // @ts-expect-error — total must be a number
  handler: () => ({ total: "1" }),
})
defineTool({
  name: "typed_output_missing",
  description: "a required field left out",
  output: Dashboard,
  // @ts-expect-error — total is required
  handler: async () => ({ currency: "INR" }),
})
defineTool({
  name: "typed_output_string",
  description: "a bare string is not the output shape",
  output: Dashboard,
  // @ts-expect-error — a string is not { total, currency }
  handler: () => "hello",
})
defineTool({
  name: "bad_output_schema",
  description: "output must be an object schema",
  // @ts-expect-error — structuredContent is an object
  output: z.string(),
  handler: () => "x",
})
{
  // Without output the return stays unknown: anything goes, as before.
  const t: McpTool = defineTool({ name: "untyped", description: "u", handler: () => 42 })
  const o: z.ZodType<Record<string, unknown>> | undefined = t.output
  void o
}

// --- a raw JSON-RPC client over app.request, speaking either era ---
const DASHBOARD = { month: "2026-09", spent: 1234.5, categories: [{ name: "food", amount: 400 }] }

type Era = "legacy" | "modern"
const LEGACY_VERSION = "2025-11-25"
const MODERN_VERSION = "2026-07-28"
const BASE_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
}
/**
 * A 2025-era request is bare JSON-RPC with a version header. A 2026-07-28 one
 * carries its version, client info and capabilities in `_meta` on every
 * request, and mirrors the method and name into Mcp-Method / Mcp-Name.
 */
function wire(era: Era, method: string, params: Record<string, unknown>) {
  if (era === "legacy") {
    return { headers: { ...BASE_HEADERS, "mcp-protocol-version": LEGACY_VERSION }, params }
  }
  const name = typeof params.name === "string" ? params.name : undefined
  return {
    headers: {
      ...BASE_HEADERS,
      "mcp-protocol-version": MODERN_VERSION,
      "mcp-method": method,
      ...(name ? { "mcp-name": name } : {}),
    },
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MODERN_VERSION,
        "io.modelcontextprotocol/clientInfo": { name: "raw-test", version: "0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  }
}

type RpcResponse = {
  result?: {
    content?: Array<{ type: string; text: string }>
    isError?: boolean
    structuredContent?: Record<string, unknown>
    tools?: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>
    serverInfo?: { name: string; version: string }
    protocolVersion?: string
    instructions?: string
    resultType?: string
    _meta?: Record<string, unknown>
  }
  error?: { code: number; message: string }
}
let nextId = 1
type Extra = {
  headers?: Record<string, string>
  execCtx?: unknown
  env?: unknown
  era?: Era
  id?: number
}
async function rpc(
  app: Hono<any>,
  method: string,
  params: Record<string, unknown> = {},
  extra: Extra = {},
): Promise<{ status: number; body: RpcResponse; res: Response; text: string }> {
  const w = wire(extra.era ?? "legacy", method, params)
  const res = await app.request(
    "/mcp",
    {
      method: "POST",
      headers: { ...w.headers, ...extra.headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: extra.id ?? nextId++, method, params: w.params }),
    },
    extra.env as never,
    extra.execCtx as never,
  )
  const text = await res.text()
  let body: RpcResponse = {}
  try {
    body = JSON.parse(text)
  } catch {
    // SSE: take the last data line
    const data = text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .pop()
    if (data) body = JSON.parse(data.slice(6))
  }
  return { status: res.status, body, res, text }
}
const call = (app: Hono<any>, name: string, args?: unknown, extra?: Extra) =>
  rpc(app, "tools/call", { name, ...(args === undefined ? {} : { arguments: args }) }, extra)

// --- tools ---

const seen: unknown[] = []
const reported: Array<{ err: unknown; tool: string }> = []
class UpstreamError extends Error {
  constructor(readonly upstreamCode: string) {
    super("upstream said no")
  }
}

const tools: McpTool[] = [
  defineTool({
    name: "add",
    description: "Add two numbers",
    annotations: { readOnlyHint: true },
    input: z.object({ a: z.number(), b: z.number().default(10) }),
    handler: (input) => {
      seen.push(input)
      return { sum: input.a + input.b }
    },
  }),
  defineTool({
    name: "echo_text",
    description: "Return a string as-is",
    input: z.object({ text: z.string() }),
    handler: ({ text }) => text,
  }),
  defineTool({
    name: "no_args",
    description: "Takes nothing",
    handler: (input, ctx) => ({
      input,
      tool: ctx.tool,
      hasSignal: ctx.signal instanceof AbortSignal,
      hasSdkCtx: typeof ctx.mcp?.mcpReq?.id !== "undefined",
      // The public envelope type is opaque; the keys are the SDK's *_META_KEY constants.
      envelopeVersion:
        (ctx.mcp.mcpReq.envelope as Record<string, unknown> | undefined)?.[
          PROTOCOL_VERSION_META_KEY
        ] ?? null,
    }),
  }),
  defineTool({
    name: "raw",
    description: "Returns an exact CallToolResult",
    handler: () =>
      toolResult({ content: [{ type: "text", text: "raw!" }], structuredContent: { n: 1 } }),
  }),
  defineTool({
    name: "not_found",
    description: "Throws ApiException",
    handler: () => {
      throw new ApiException(404, "Order not found", "ORDER_NOT_FOUND")
    },
  }),
  defineTool({
    name: "api_details",
    description: "ApiException with details and no code",
    handler: () => {
      throw new ApiException(422, "Bad amount", undefined, {
        formErrors: [],
        fieldErrors: { amount: ["must be positive"] },
      })
    },
  }),
  defineTool({
    name: "http_403",
    description: "Plain HTTPException",
    handler: () => {
      throw new HTTPException(403, { message: "Nope" })
    },
  }),
  defineTool({
    name: "zod_inside",
    description: "A zod error from parsing inside the handler",
    handler: () => z.object({ price: z.number() }).parse({ price: "12" }),
  }),
  defineTool({
    name: "crash",
    description: "Leaks a secret if mapped naively",
    handler: () => {
      throw new Error("connect postgres://admin:hunter2@db.internal:5432 failed")
    },
  }),
  defineTool({
    name: "crash_string",
    description: "Throws a non-Error",
    handler: () => {
      throw "a string"
    },
  }),
  defineTool({
    name: "upstream",
    description: "App error mapped by mapError",
    handler: () => {
      throw new UpstreamError("QUOTA_SPENT")
    },
  }),
  defineTool({
    name: "who",
    description: "Needs the read scope",
    scopes: ["read"],
    handler: (_i, ctx: ToolContext) => ({
      sub: ctx.token?.claims.sub,
      scopes: ctx.token?.scopes,
      envFlag: (ctx.c?.env as { FLAG?: string } | undefined)?.FLAG ?? null,
    }),
  }),
  defineTool({
    name: "admin",
    description: "Needs the admin scope",
    scopes: ["admin"],
    handler: () => "should not run",
  }),
  defineTool({
    name: "dashboard",
    title: "Dashboard",
    description: "Typed structured output",
    annotations: { readOnlyHint: true },
    input: z.object({ month: z.string() }),
    output: z.object({
      month: z.string(),
      spent: z.number(),
      categories: z.array(z.object({ name: z.string(), amount: z.number() })),
    }),
    handler: async ({ month }) => ({
      month,
      spent: 1234.5,
      categories: [{ name: "food", amount: 400 }],
    }),
  }),
  defineTool({
    name: "dashboard_raw",
    description: "An output tool returning an explicit toolResult",
    output: z.object({ n: z.number() }),
    handler: () =>
      toolResult({ content: [{ type: "text", text: "exact" }], structuredContent: { n: 7 } }),
  }),
  defineTool({
    name: "dashboard_throws",
    description: "An output tool that throws",
    output: z.object({ n: z.number() }),
    handler: () => {
      throw new ApiException(404, "No data", "NO_DATA")
    },
  }),
  defineTool({
    name: "dashboard_lies",
    description: "An output tool whose value does not match its schema",
    output: z.object({ n: z.number() }),
    // Only a cast gets past the types; the SDK catches it at runtime.
    handler: () => ({ n: "seven" }) as unknown as { n: number },
  }),
  defineTool({
    name: "slow",
    description: "Resolves after a tick",
    input: z.object({ id: z.number() }),
    handler: async ({ id }) => {
      await new Promise((r) => setTimeout(r, 5 + (id % 3) * 5))
      return { id }
    },
  }),
]

const serverOptions = {
  name: "test-mcp",
  version: "1.2.3",
  instructions: "Use add to add.",
  tools,
  mapError: (err: unknown) =>
    err instanceof UpstreamError ? { code: err.upstreamCode, message: err.message } : undefined,
  onError: (err: unknown, meta: { tool: string }) => {
    reported.push({ err, tool: meta.tool })
  },
}

const app = new Hono()
mountMcp(app, "/mcp", serverOptions)

// --- a 2026-07-28 client: the SDK's own, over app.fetch in-process ---
const recorded: Array<{ method: string; headers: Headers; body: string; resBody: string }> = []
/** The support guide's in-process wiring: the URL is never dialed. */
function fetchVia(a: Hono<any>, env?: unknown, headers?: Record<string, string>) {
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(url, init)
    for (const [k, v] of Object.entries(headers ?? {})) req.headers.set(k, v)
    const body = req.method === "POST" ? await req.clone().text() : ""
    const res = await a.fetch(req, env as never)
    recorded.push({
      method: req.method,
      headers: req.headers,
      body,
      resBody: await res.clone().text(),
    })
    return res
  }
}
async function connect(
  a: Hono<any>,
  era: Era,
  opts: { env?: unknown; headers?: Record<string, string>; elicitation?: boolean } = {},
) {
  const client = new Client(
    { name: "signet-test", version: "0" },
    {
      ...(era === "modern" ? { versionNegotiation: { mode: { pin: MODERN_VERSION } } } : {}),
      ...(opts.elicitation ? { capabilities: { elicitation: { form: {} } } } : {}),
    },
  )
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: fetchVia(a, opts.env, opts.headers),
  })
  await client.connect(transport)
  return client
}

{
  recorded.length = 0
  const client = await connect(app, "modern")
  ok("2026 client: modern era negotiated", client.getProtocolEra() === "modern")
  ok(
    "2026 client: protocol version",
    client.getNegotiatedProtocolVersion() === MODERN_VERSION,
    client.getNegotiatedProtocolVersion(),
  )
  ok(
    "2026 client: no initialize on the wire, server/discover instead",
    recorded.some((r) => r.body.includes('"server/discover"')) &&
      !recorded.some((r) => r.body.includes('"initialize"')),
    recorded.map((r) => r.body.slice(0, 80)),
  )
  const disc = await client.discover()
  ok(
    "server/discover: advertises 2026-07-28 and tools",
    JSON.stringify(disc).includes(MODERN_VERSION) && !!disc.capabilities?.tools,
    disc,
  )
  ok(
    "server/discover: tool list is fixed (listChanged: false)",
    disc.capabilities?.tools?.listChanged === false,
    disc.capabilities,
  )
  ok("server/discover: instructions sent", disc.instructions === "Use add to add.", disc)
  ok(
    "server/discover: server identity in _meta",
    client.getServerVersion()?.name === "test-mcp" &&
      client.getServerVersion()?.version === "1.2.3",
    client.getServerVersion(),
  )
  const listed = await client.listTools()
  ok("2026 client: tools/list", listed.tools.length === tools.length, listed.tools.length)
  ok(
    "2026 client: tool order preserved",
    JSON.stringify(listed.tools.map((t) => t.name)) === JSON.stringify(tools.map((t) => t.name)),
  )
  const dashDef = listed.tools.find((t) => t.name === "dashboard")
  ok(
    "2026 client: outputSchema listed",
    (dashDef?.outputSchema as { properties?: Record<string, unknown> })?.properties?.spent !==
      undefined && dashDef?.title === "Dashboard",
    dashDef,
  )
  const res = await client.callTool({ name: "add", arguments: { a: 2 } })
  ok(
    "2026 client: tools/call",
    (res.content as Array<{ text: string }>)[0]?.text === '{"sum":12}',
    res,
  )
  const na = await client.callTool({ name: "no_args" })
  const naBody = JSON.parse((na.content as Array<{ text: string }>)[0]?.text ?? "{}")
  ok(
    "2026 client: a handler reads the per-request envelope via ctx.mcp",
    naBody.envelopeVersion === MODERN_VERSION && naBody.hasSdkCtx === true,
    naBody,
  )
  const posts = recorded.filter((r) => r.method === "POST")
  const listPost = posts.find((r) => r.body.includes('"tools/list"'))
  const callPost = posts.find((r) => r.body.includes('"tools/call"'))
  ok(
    "2026 wire: resultType on tools/list",
    /"resultType":"complete"/.test(listPost?.resBody ?? ""),
    listPost?.resBody.slice(0, 200),
  )
  ok(
    "2026 wire: resultType on tools/call",
    /"resultType":"complete"/.test(callPost?.resBody ?? ""),
    callPost?.resBody.slice(0, 200),
  )
  ok(
    "2026 wire: resultType on server/discover",
    /"resultType":"complete"/.test(
      posts.find((r) => r.body.includes('"server/discover"'))?.resBody ?? "",
    ),
  )
  ok(
    "2026 wire: the client sent Mcp-Method and Mcp-Name",
    callPost?.headers.get("mcp-method") === "tools/call" &&
      callPost?.headers.get("mcp-name") === "add",
    callPost && Object.fromEntries(callPost.headers),
  )
  ok(
    "2026 wire: _meta envelope on every request",
    posts.every((r) => r.body.includes("io.modelcontextprotocol/protocolVersion")),
  )
  const dash = await client.callTool({ name: "dashboard", arguments: { month: "2026-09" } })
  ok(
    "2026 client: structuredContent plus JSON text",
    JSON.stringify(dash.structuredContent) === JSON.stringify(DASHBOARD) &&
      (dash.content as Array<{ text: string }>)[0]?.text === JSON.stringify(DASHBOARD) &&
      !dash.isError,
    dash,
  )
  let unknownErr: unknown
  try {
    await client.callTool({ name: "nope", arguments: {} })
  } catch (e) {
    unknownErr = e
  }
  ok(
    "2026 client: unknown tool is a -32602 rejection (SDK v2)",
    (unknownErr as { code?: number })?.code === -32602 &&
      /nope/.test((unknownErr as Error)?.message ?? ""),
    unknownErr,
  )
  await client.close()
}

// --- a 2025-11-25 client against the same endpoint: legacy, stateless ---
{
  recorded.length = 0
  const client = await connect(app, "legacy")
  ok("2025 client: legacy era", client.getProtocolEra() === "legacy", client.getProtocolEra())
  ok(
    "2025 client: initialize negotiated 2025-11-25",
    client.getNegotiatedProtocolVersion() === LEGACY_VERSION,
    client.getNegotiatedProtocolVersion(),
  )
  ok("2025 client: instructions from initialize", client.getInstructions() === "Use add to add.")
  ok("2025 client: server name", client.getServerVersion()?.name === "test-mcp")
  const listed = await client.listTools()
  ok("2025 client: tools/list", listed.tools.length === tools.length)
  ok(
    "2025 client: tool order preserved",
    JSON.stringify(listed.tools.map((t) => t.name)) === JSON.stringify(tools.map((t) => t.name)),
  )
  ok(
    "2025 client: outputSchema listed",
    (listed.tools.find((t) => t.name === "dashboard")?.outputSchema as { type?: string })?.type ===
      "object",
  )
  const dash = await client.callTool({ name: "dashboard", arguments: { month: "2026-09" } })
  ok(
    "2025 client: structuredContent plus JSON text",
    JSON.stringify(dash.structuredContent) === JSON.stringify(DASHBOARD) &&
      (dash.content as Array<{ text: string }>)[0]?.text === JSON.stringify(DASHBOARD),
    dash,
  )
  const res = await client.callTool({ name: "add", arguments: { a: 5, b: 5 } })
  ok("2025 client: tools/call", (res.content as Array<{ text: string }>)[0]?.text === '{"sum":10}')
  const na = await client.callTool({ name: "no_args" })
  const naBody = JSON.parse((na.content as Array<{ text: string }>)[0]?.text ?? "{}")
  ok("2025 client: no envelope on a legacy call", naBody.envelopeVersion === null, naBody)
  ok(
    "2025 wire: no resultType",
    !recorded.some((r) => r.resBody.includes("resultType")),
    recorded.map((r) => r.resBody.slice(0, 120)),
  )
  ok("stateless: no session id issued", !recorded.some((r) => r.headers.get("mcp-session-id")))
  await client.close()
}

// --- the whole suite, in both eras, over raw JSON-RPC ---
for (const era of ["legacy", "modern"] as const) {
  const e = { era }
  const p = `[${era}]`
  const list = await rpc(app, "tools/list", {}, e)
  const listed = list.body.result?.tools ?? []
  ok(
    `${p} tools/list: every tool`,
    listed.length === tools.length,
    listed.map((t) => t.name),
  )
  ok(
    `${p} resultType ${era === "modern" ? "present" : "absent"}`,
    era === "modern" ? list.body.result?.resultType === "complete" : !list.body.result?.resultType,
  )
  const add = listed.find((t) => t.name === "add")
  const addSchema = add?.inputSchema as {
    type?: string
    properties?: Record<string, { type?: string }>
    required?: string[]
  }
  ok(
    `${p} tools/list: input schema is JSON Schema from zod`,
    addSchema?.type === "object" && addSchema.properties?.a?.type === "number",
    add,
  )
  ok(
    `${p} tools/list: a defaulted field is not required`,
    JSON.stringify(addSchema?.required) === '["a"]',
    addSchema?.required,
  )
  ok(
    `${p} tools/list: annotations carried`,
    (add as { annotations?: { readOnlyHint?: boolean } })?.annotations?.readOnlyHint === true,
  )
  ok(
    `${p} tools/list: order is the tools array's`,
    JSON.stringify(listed.map((t) => t.name)) === JSON.stringify(tools.map((t) => t.name)),
    listed.map((t) => t.name),
  )
  type Listed = {
    title?: string
    outputSchema?: {
      type?: string
      properties?: Record<string, { type?: string }>
      required?: string[]
    }
  }
  const dashDef = listed.find((t) => t.name === "dashboard") as Listed | undefined
  ok(
    `${p} tools/list: outputSchema is JSON Schema from zod`,
    dashDef?.outputSchema?.type === "object" &&
      dashDef.outputSchema.properties?.spent?.type === "number" &&
      dashDef.outputSchema.properties?.categories?.type === "array" &&
      JSON.stringify(dashDef.outputSchema.required) === '["month","spent","categories"]',
    dashDef,
  )
  ok(`${p} tools/list: title carried`, dashDef?.title === "Dashboard", dashDef)
  ok(
    `${p} tools/list: no outputSchema without output`,
    listed
      .filter((t) => !t.name.startsWith("dashboard"))
      .every((t) => (t as Listed).outputSchema === undefined),
  )
  const noArgs = listed.find((t) => t.name === "no_args")
  ok(
    `${p} tools/list: a tool without input lists an object schema`,
    (noArgs?.inputSchema as { type?: string })?.type === "object",
    noArgs,
  )

  // --- tools/call: the happy path ---
  const dash = await call(app, "dashboard", { month: "2026-09" }, e)
  ok(
    `${p} call: output tool sends structuredContent`,
    JSON.stringify(dash.body.result?.structuredContent) === JSON.stringify(DASHBOARD) &&
      !dash.body.result?.isError,
    dash.body,
  )
  ok(
    `${p} call: output tool also sends the JSON as one text block`,
    dash.body.result?.content?.length === 1 &&
      dash.body.result.content[0]?.type === "text" &&
      dash.body.result.content[0]?.text === JSON.stringify(DASHBOARD),
    dash.body,
  )
  const dashRaw = await call(app, "dashboard_raw", undefined, e)
  ok(
    `${p} call: toolResult on an output tool passes through untouched`,
    dashRaw.body.result?.content?.[0]?.text === "exact" &&
      JSON.stringify(dashRaw.body.result?.structuredContent) === '{"n":7}',
    dashRaw.body,
  )
  const dashErr = await call(app, "dashboard_throws", undefined, e)
  ok(
    `${p} call: an output tool's error is the envelope, not an output-validation error`,
    dashErr.body.result?.isError === true &&
      dashErr.body.result.content?.[0]?.text === "NO_DATA: No data" &&
      dashErr.body.result.structuredContent?.code === "NO_DATA",
    dashErr.body,
  )
  const dashLies = await call(app, "dashboard_lies", undefined, e)
  ok(
    `${p} call: the SDK validates structuredContent against outputSchema`,
    dashLies.body.result?.isError === true &&
      /^Output validation error/.test(dashLies.body.result.content?.[0]?.text ?? "") &&
      dashLies.body.result.structuredContent === undefined,
    dashLies.body,
  )
  const sum = await call(app, "add", { a: 1 }, e)
  ok(
    `${p} call: parsed input reaches the handler, default applied`,
    JSON.stringify(seen.at(-1)) === '{"a":1,"b":10}',
    seen,
  )
  ok(
    `${p} call: value returned as JSON text`,
    sum.body.result?.content?.[0]?.text === '{"sum":11}',
    sum.body,
  )
  ok(`${p} call: success is not an error`, !sum.body.result?.isError)
  ok(
    `${p} call: a tool without output sends no structuredContent`,
    sum.body.result?.structuredContent === undefined && sum.body.result?.content?.length === 1,
    sum.body,
  )
  const extraKey = await call(app, "add", { a: 1, b: 2, sneaky: true }, e)
  ok(
    `${p} call: unknown keys stripped by the schema`,
    JSON.stringify(seen.at(-1)) === '{"a":1,"b":2}' && !extraKey.body.result?.isError,
  )
  const echo = await call(app, "echo_text", { text: "hello" }, e)
  ok(`${p} call: a string is sent as-is`, echo.body.result?.content?.[0]?.text === "hello")
  const na = await call(app, "no_args", undefined, e)
  const naBody = JSON.parse(na.body.result?.content?.[0]?.text ?? "{}")
  ok(
    `${p} call: no-input tool gets {} and a context`,
    JSON.stringify(naBody.input) === "{}" &&
      naBody.tool === "no_args" &&
      naBody.hasSignal === true &&
      naBody.hasSdkCtx === true,
    naBody,
  )
  const raw = await call(app, "raw", undefined, e)
  ok(
    `${p} call: toolResult passes through`,
    raw.body.result?.content?.[0]?.text === "raw!" && raw.body.result?.structuredContent?.n === 1,
    raw.body,
  )

  // --- validation: bad input is an error result, and the handler never runs ---
  const before = seen.length
  const bad = await call(app, "add", { a: "one" }, e)
  ok(
    `${p} bad input: an error result, not a JSON-RPC error`,
    bad.body.result?.isError === true && !bad.body.error,
    bad.body,
  )
  ok(
    `${p} bad input: says which field`,
    /Input validation error/.test(bad.body.result?.content?.[0]?.text ?? "") &&
      /\ba\b/.test(bad.body.result?.content?.[0]?.text ?? ""),
    bad.body.result?.content,
  )
  ok(`${p} bad input: handler not called`, seen.length === before)
  const missing = await call(app, "add", {}, e)
  ok(`${p} missing required field: error result`, missing.body.result?.isError === true)
  const unknownTool = await call(app, "nope", {}, e)
  ok(
    `${p} unknown tool: a -32602 JSON-RPC error naming it (SDK v2)`,
    unknownTool.body.error?.code === -32602 && /nope/.test(unknownTool.body.error?.message ?? ""),
    unknownTool.body,
  )

  // --- error mapping ---
  const nf = await call(app, "not_found", undefined, e)
  ok(`${p} ApiException: isError`, nf.body.result?.isError === true)
  ok(
    `${p} ApiException: code and message in the text`,
    nf.body.result?.content?.[0]?.text === "ORDER_NOT_FOUND: Order not found",
    nf.body.result?.content,
  )
  ok(
    `${p} ApiException: envelope as structured content`,
    JSON.stringify(nf.body.result?.structuredContent) ===
      JSON.stringify({ success: false, error: "Order not found", code: "ORDER_NOT_FOUND" }),
    nf.body.result?.structuredContent,
  )
  const det = await call(app, "api_details", undefined, e)
  const detSc = det.body.result?.structuredContent as {
    code?: string
    details?: { fieldErrors?: Record<string, string[]> }
  }
  ok(
    `${p} ApiException without a code: code from the status`,
    detSc?.code === "UNPROCESSABLE",
    detSc,
  )
  ok(
    `${p} ApiException: details carried`,
    detSc?.details?.fieldErrors?.amount?.[0] === "must be positive",
  )
  const h403 = await call(app, "http_403", undefined, e)
  ok(
    `${p} HTTPException: STATUS_CODES code`,
    h403.body.result?.content?.[0]?.text === "FORBIDDEN: Nope",
    h403.body.result,
  )
  const zi = await call(app, "zod_inside", undefined, e)
  const ziSc = zi.body.result?.structuredContent as {
    code?: string
    details?: { fieldErrors?: Record<string, string[]> }
  }
  ok(
    `${p} zod error: VALIDATION_FAILED with field errors`,
    zi.body.result?.isError === true &&
      ziSc?.code === "VALIDATION_FAILED" &&
      Array.isArray(ziSc.details?.fieldErrors?.price),
    zi.body.result,
  )
  ok(`${p} zod error: not reported as unexpected`, !reported.some((r) => r.tool === "zod_inside"))

  reported.length = 0
  const crash = await call(app, "crash", undefined, e)
  const crashText = JSON.stringify(crash.body)
  ok(
    `${p} unknown error: generic Internal error`,
    crash.body.result?.content?.[0]?.text === "INTERNAL_ERROR: Internal error",
    crash.body.result,
  )
  ok(
    `${p} unknown error: message not leaked`,
    !crashText.includes("hunter2") && !crashText.includes("postgres"),
  )
  ok(`${p} unknown error: no stack leaked`, !/\bat .*\(|\.ts:\d+/.test(crashText))
  ok(
    `${p} unknown error: reported to onError with the tool`,
    reported.some((r) => r.tool === "crash" && (r.err as Error).message.includes("hunter2")),
  )
  const cs = await call(app, "crash_string", undefined, e)
  ok(
    `${p} a thrown non-Error: Internal error, reported`,
    cs.body.result?.content?.[0]?.text === "INTERNAL_ERROR: Internal error" &&
      reported.some((r) => r.err === "a string"),
  )
  const up = await call(app, "upstream", undefined, e)
  ok(
    `${p} mapError: the app's own code`,
    up.body.result?.content?.[0]?.text === "QUOTA_SPENT: upstream said no" &&
      !reported.some((r) => r.tool === "upstream"),
    up.body.result,
  )
  ok(
    `${p} mapError: defaults still apply after it`,
    (await call(app, "not_found", undefined, e)).body.result?.content?.[0]?.text?.startsWith(
      "ORDER_NOT_FOUND",
    ),
  )

  // --- scopes without oauth-rs: refused, not allowed ---
  const noTok = await call(app, "who", undefined, e)
  ok(
    `${p} scoped tool with no token: insufficient_scope`,
    (noTok.body.result?.structuredContent as { code?: string })?.code === "insufficient_scope",
    noTok.body.result,
  )
}

ok("describeToolError: unknown is undefined", describeToolError(new Error("x")) === undefined)
ok(
  "describeToolError: zod by shape, not instanceof",
  describeToolError(
    Object.assign(new Error("z"), { name: "ZodError", issues: [{ path: [], message: "bad" }] }),
  )?.details?.formErrors[0] === "bad",
)

// --- duck-typed HTTPException: /mcp does not import hono ---
ok(
  "describeToolError: an HTTPException from another copy, by shape",
  describeToolError(
    Object.assign(new Error("Gone away"), { status: 410, getResponse: () => new Response() }),
  )?.code === "GONE",
)
ok(
  "describeToolError: by name, with a code",
  describeToolError(
    Object.assign(new Error("m"), { name: "HTTPException", status: 404, code: "X" }),
  )?.code === "X",
)
ok(
  "describeToolError: a status alone is not an HTTPException",
  describeToolError(Object.assign(new Error("m"), { status: 404 })) === undefined,
)
ok(
  "describeToolError: a non-numeric status is not an HTTPException",
  describeToolError(Object.assign(new Error("m"), { status: "404", getResponse() {} })) ===
    undefined,
)

// --- errorResult: the app's own error shape (app-a) ---
{
  const LONG = `Transaction 42 not found. ${'This message is long, has "quotes", a tab\t, a newline\n and unicode ₹ 🧾. '.repeat(80)}`
  const thrower = (msg: string) => () => {
    throw new Error(msg)
  }
  const appATools: McpTool[] = [
    defineTool({ name: "long", description: "", handler: thrower(LONG) }),
    defineTool({
      name: "not_found",
      description: "",
      handler: () => {
        throw new ApiException(404, "Order not found", "ORDER_NOT_FOUND")
      },
    }),
    defineTool({
      name: "typed_input",
      description: "",
      input: z.object({ n: z.number() }),
      handler: thrower("typed failed"),
    }),
    defineTool({ name: "scoped", description: "", scopes: ["admin"], handler: () => "no" }),
    defineTool({
      name: "undef",
      description: "",
      handler: () => {
        throw new UpstreamError("FALLS_THROUGH")
      },
    }),
    defineTool({ name: "crash", description: "", handler: thrower("secret") }),
    defineTool({ name: "ok", description: "", handler: () => "fine" }),
  ]
  const appAReported: Array<{ err: unknown; tool: string }> = []
  const metaTools: string[] = []
  const appAErrorResult = (err: unknown) =>
    toolResult({
      isError: true,
      content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
    })
  const pa = new Hono()
  mountMcp(pa, "/mcp", {
    name: "app-a",
    version: "0",
    tools: appATools,
    errorResult: (err, meta) => {
      metaTools.push(meta.tool)
      return err instanceof UpstreamError ? undefined : appAErrorResult(err)
    },
    onError: (err, meta) => {
      appAReported.push({ err, tool: meta.tool })
    },
  })

  // Baseline: what app-a sends today, straight through the SDK. Same name,
  // version and capabilities, so the 2026 serverInfo stamp matches too.
  const base = new Hono()
  base.post(
    "/mcp",
    mcpHandler({
      server: () => {
        const s = new McpServer(
          { name: "app-a", version: "0" },
          { capabilities: { tools: { listChanged: false } } },
        )
        s.registerTool("long", { description: "" }, async () => {
          try {
            throw new Error(LONG)
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: (err as Error).message }],
              isError: true,
            }
          }
        })
        return s
      },
    }),
  )
  for (const era of ["legacy", "modern"] as const) {
    const mine = (await call(pa, "long", undefined, { era, id: 777 })).text
    const theirs = (await call(base, "long", undefined, { era, id: 777 })).text
    ok(
      `[${era}] errorResult: app-a's shape is byte-identical to the raw SDK result`,
      mine === theirs && mine.includes("Transaction 42 not found") && mine.length > 5000,
      { mine: mine.slice(0, 300), theirs: theirs.slice(0, 300) },
    )
    ok(
      `[${era}] errorResult: no code prefix, no structuredContent`,
      !mine.includes("INTERNAL_ERROR") && !mine.includes("structuredContent"),
    )
  }
  ok("errorResult: meta names the tool", metaTools.includes("long"), metaTools)
  ok(
    "errorResult: an unknown error is still reported to onError",
    appAReported.some((r) => r.tool === "long" && (r.err as Error).message === LONG),
    appAReported,
  )
  for (const era of ["legacy", "modern"] as const) {
    const e = { era }
    const p = `[${era}]`
    const nf2 = await call(pa, "not_found", undefined, e)
    ok(
      `${p} errorResult: runs before the defaults (ApiException gets the app's shape)`,
      nf2.body.result?.content?.[0]?.text === "Order not found" &&
        nf2.body.result?.isError === true &&
        !nf2.body.result?.structuredContent,
      nf2.body.result,
    )
    ok(
      `${p} errorResult: a deliberate error is not reported`,
      !appAReported.some((r) => r.tool === "not_found"),
    )
    const und = await call(pa, "undef", undefined, e)
    ok(
      `${p} errorResult: undefined falls through to the default result`,
      und.body.result?.content?.[0]?.text === "INTERNAL_ERROR: Internal error" &&
        (und.body.result?.structuredContent as { code?: string })?.code === "INTERNAL_ERROR",
      und.body.result,
    )
    ok(
      `${p} errorResult: fall-through still reports`,
      appAReported.some((r) => r.tool === "undef"),
    )
    const sc = await call(pa, "scoped", undefined, e)
    ok(
      `${p} errorResult: the scope check keeps its own result`,
      (sc.body.result?.structuredContent as { code?: string })?.code === "insufficient_scope",
      sc.body.result,
    )
    const badIn = await call(pa, "typed_input", { n: "x" }, e)
    ok(
      `${p} errorResult: SDK input validation keeps its own result`,
      /Input validation error/.test(badIn.body.result?.content?.[0]?.text ?? "") &&
        badIn.body.result?.isError === true,
      badIn.body.result,
    )
    const goodIn = await call(pa, "typed_input", { n: 1 }, e)
    ok(
      `${p} errorResult: valid input that then throws gets the app's shape`,
      goodIn.body.result?.content?.[0]?.text === "typed failed",
      goodIn.body.result,
    )
    ok(
      `${p} errorResult: success untouched`,
      (await call(pa, "ok", undefined, e)).body.result?.content?.[0]?.text === "fine",
    )
  }

  // With mapError too: errorResult wins; mapError still decides what is reported.
  const both = new Hono()
  const bothReported: string[] = []
  mountMcp(both, "/mcp", {
    name: "b",
    version: "0",
    tools: appATools,
    errorResult: (err) => (err instanceof UpstreamError ? undefined : appAErrorResult(err)),
    mapError: (err) =>
      err instanceof UpstreamError ? { code: err.upstreamCode, message: err.message } : undefined,
    onError: (_e, m) => {
      bothReported.push(m.tool)
    },
  })
  const u2 = await call(both, "undef")
  ok(
    "errorResult undefined, then mapError",
    u2.body.result?.content?.[0]?.text === "FALLS_THROUGH: upstream said no" &&
      !bothReported.includes("undef"),
    u2.body.result,
  )

  // A throwing errorResult falls back to the default.
  const broken = new Hono()
  const brokenReported: string[] = []
  mountMcp(broken, "/mcp", {
    name: "x",
    version: "0",
    tools: appATools,
    errorResult: () => {
      throw new Error("formatter bug")
    },
    onError: (_e, m) => {
      brokenReported.push(m.tool)
    },
  })
  const br = await call(broken, "crash", undefined, { era: "modern" })
  ok(
    "errorResult that throws: default Internal error, original reported",
    br.body.result?.content?.[0]?.text === "INTERNAL_ERROR: Internal error" &&
      brokenReported.includes("crash"),
    br.body.result,
  )
}

// --- onError: throwing reporter, and waitUntil on Workers ---
for (const era of ["legacy", "modern"] as const) {
  const waited: Promise<unknown>[] = []
  const a = new Hono()
  mountMcp(a, "/mcp", {
    name: "x",
    version: "0",
    tools,
    onError: () => Promise.resolve("sent"),
  })
  const execCtx = {
    waitUntil: (p: Promise<unknown>) => waited.push(p),
    passThroughOnException() {},
    props: {},
  }
  const r = await call(a, "crash", undefined, { execCtx, era })
  ok(`[${era}] onError promise: handed to waitUntil`, waited.length === 1, waited)
  ok(
    `[${era}] onError promise: response unaffected`,
    r.body.result?.content?.[0]?.text === "INTERNAL_ERROR: Internal error",
  )

  const b = new Hono()
  mountMcp(b, "/mcp", {
    name: "x",
    version: "0",
    tools,
    onError: () => {
      throw new Error("reporter down")
    },
  })
  const r2 = await call(b, "crash", undefined, { era })
  ok(
    `[${era}] onError that throws: still Internal error`,
    r2.body.result?.content?.[0]?.text === "INTERNAL_ERROR: Internal error",
    r2.body,
  )
  const r3 = await call(b, "crash", undefined, { era })
  ok(`[${era}] onError that throws: server keeps serving`, r3.status === 200)
}

// --- composed with oauth-rs requireToken, with real signed tokens ---
const ISS = "https://auth.example.com"
const AUD = "https://mcp.example.com"
const META = `${AUD}/.well-known/oauth-protected-resource`
const b64url = (b: Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b
  let s = ""
  for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}
const pair = (await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair
const jwk = {
  ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
  kid: "k1",
  use: "sig",
  alg: "RS256",
}
const jwks = createJwksCache({
  jwksUri: `${ISS}/jwks`,
  fetchImpl: (async () => new Response(JSON.stringify({ keys: [jwk] }))) as unknown as typeof fetch,
})
const verifier = createTokenVerifier({ issuer: ISS, audience: AUD, jwksUri: `${ISS}/jwks`, jwks })
async function mint(scope: string, sub = "user-1") {
  const now = Math.floor(Date.now() / 1000)
  const h = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" }))
  const p = b64url(JSON.stringify({ iss: ISS, aud: AUD, sub, exp: now + 600, iat: now, scope }))
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${h}.${p}`),
  )
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`
}

const secured = new Hono<{ Bindings: { FLAG: string } }>()
mountMcp(secured, "/mcp", {
  ...serverOptions,
  middleware: [requireToken({ verifier, resourceMetadataUrl: META })],
})
const env = { FLAG: "on" }
const sreq = (init: RequestInit) => secured.request("/mcp", init, env)
const readTok = await mint("read")
const authHeaders = { authorization: `Bearer ${readTok}` }

for (const era of ["legacy", "modern"] as const) {
  const p = `[${era}]`
  const w = wire(era, "tools/list", {})
  const unauth = await sreq({
    method: "POST",
    headers: w.headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: w.params }),
  })
  ok(`${p} requireToken: no token is a 401 before MCP runs`, unauth.status === 401)
  ok(
    `${p} requireToken: 401 points at the metadata`,
    (unauth.headers.get("www-authenticate") ?? "").includes(META),
  )
  const authed = { headers: authHeaders, env, era }
  const who = await call(secured, "who", undefined, authed)
  const whoBody = JSON.parse(who.body.result?.content?.[0]?.text ?? "{}")
  ok(`${p} requireToken: the tool sees the verified subject`, whoBody.sub === "user-1", who.body)
  ok(`${p} requireToken: and the scopes`, JSON.stringify(whoBody.scopes) === '["read"]')
  ok(`${p} ctx.c: bindings reachable`, whoBody.envFlag === "on", whoBody)
  ok(
    `${p} ctx.token: raw token never reaches a tool`,
    !JSON.stringify(who.body).includes(readTok.slice(0, 20)),
  )
  const adm = await call(secured, "admin", undefined, authed)
  ok(
    `${p} scopes: missing scope is an error result naming it`,
    adm.body.result?.isError === true && /admin/.test(adm.body.result?.content?.[0]?.text ?? ""),
    adm.body.result,
  )
  const otherUser = await call(secured, "who", undefined, {
    era,
    headers: { authorization: `Bearer ${await mint("read", "user-2")}` },
  })
  ok(
    `${p} per request: the next caller sees only their own subject`,
    JSON.parse(otherUser.body.result?.content?.[0]?.text ?? "{}").sub === "user-2",
  )
}
{
  // The SDK's client, 2026-07-28, through requireToken.
  const client = await connect(secured, "modern", { env, headers: authHeaders })
  const r = await client.callTool({ name: "who" })
  ok(
    "2026 client through requireToken: ctx.token and ctx.c",
    (r.content as Array<{ text: string }>)[0]?.text ===
      JSON.stringify({ sub: "user-1", scopes: ["read"], envFlag: "on" }),
    r,
  )
  await client.close()
}
const getNoTok = await sreq({ method: "GET", headers: BASE_HEADERS })
ok("GET without a token: 401, not 405 (auth runs first)", getNoTok.status === 401)
const getTok = await sreq({ method: "GET", headers: { ...BASE_HEADERS, ...authHeaders } })
ok("GET: the SDK's 405, not a hanging stream", getTok.status === 405, getTok.status)
const delTok = await sreq({ method: "DELETE", headers: { ...BASE_HEADERS, ...authHeaders } })
ok("DELETE: 405", delTok.status === 405)

// --- the SDK enforces the 2026 HTTP rules for us ---
{
  const w = wire("modern", "tools/call", { name: "add", arguments: { a: 1 } })
  const noMethod: Record<string, string> = { ...w.headers }
  delete noMethod["mcp-method"]
  const r = await app.request("/mcp", {
    method: "POST",
    headers: noMethod,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: w.params }),
  })
  ok("2026: a POST without Mcp-Method is refused (400)", r.status === 400, r.status)
  const wrongName = await call(
    app,
    "add",
    { a: 1 },
    { era: "modern", headers: { "mcp-name": "echo_text" } },
  )
  ok(
    "2026: an Mcp-Name that disagrees with the body is refused (-32020)",
    wrongName.status === 400 && wrongName.body.error?.code === -32020,
    wrongName.body,
  )
}

// --- per request: concurrency, and the server factory ---
for (const era of ["legacy", "modern"] as const) {
  const many = await Promise.all(
    Array.from({ length: 12 }, (_, id) => call(app, "slow", { id }, { era })),
  )
  ok(
    `[${era}] concurrent calls: each gets its own answer`,
    many.every((r, id) => r.body.result?.content?.[0]?.text === JSON.stringify({ id })),
    many.map((r) => r.body),
  )
}
{
  const built: string[] = []
  const f = new Hono()
  f.post(
    "/mcp",
    mcpHandler({
      server: (c, req) => {
        built.push(req.era)
        return createMcpServer({
          name: "factory",
          version: "9",
          tools: [defineTool({ name: "path", description: "", handler: () => c.req.path })],
        })
      },
    }),
  )
  const r1 = await call(f, "path")
  const r2 = await call(f, "path", undefined, { era: "modern" })
  ok(
    "server factory: used per request, told the era",
    r1.body.result?.content?.[0]?.text === "/mcp" &&
      r2.body.result?.content?.[0]?.text === "/mcp" &&
      JSON.stringify(built) === '["legacy","modern"]',
    { built, r1: r1.body },
  )
}

// --- response shape ---
{
  const legacy = await call(app, "add", { a: 1 })
  ok(
    "legacy: the SDK's stateless fallback answers as SSE",
    legacy.res.headers.get("content-type")?.includes("text/event-stream"),
  )
  const modern = await call(app, "add", { a: 1 }, { era: "modern" })
  ok(
    "modern: one JSON body by default (responseMode auto)",
    modern.res.headers.get("content-type")?.includes("application/json"),
  )
  const s = new Hono()
  mountMcp(s, "/mcp", { name: "sse", version: "0", tools, http: { responseMode: "sse" } })
  const r = await call(s, "add", { a: 2, b: 3 }, { era: "modern" })
  ok(
    "http.responseMode: 'sse' streams",
    r.res.headers.get("content-type")?.includes("text/event-stream"),
  )
  ok(
    "http.responseMode: 'sse' still answers",
    r.body.result?.content?.[0]?.text === '{"sum":5}',
    r.body,
  )
  const strict = new Hono()
  mountMcp(strict, "/mcp", { name: "strict", version: "0", tools, http: { legacy: "reject" } })
  const rej = await call(strict, "add", { a: 1 })
  ok(
    "http.legacy: 'reject' refuses a 2025 client",
    rej.status === 400 && rej.body.error?.code === -32022,
    { status: rej.status, body: rej.body },
  )
  ok(
    "http.legacy: 'reject' still serves 2026",
    (await call(strict, "add", { a: 1 }, { era: "modern" })).body.result?.content?.[0]?.text ===
      '{"sum":11}',
  )
}

// --- multi round-trip: a handler returns inputRequired(...) ---
{
  const confirm = z.object({ confirm: z.boolean() })
  const m = new Hono()
  mountMcp(m, "/mcp", {
    name: "mrtr",
    version: "0",
    tools: [
      defineTool({
        name: "deploy",
        description: "Asks first",
        input: z.object({ env: z.string() }),
        handler: ({ env }, ctx) => {
          const answer = acceptedContent(ctx.mcp.mcpReq.inputResponses, "confirm", confirm)
          if (!answer) {
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
          }
          return answer.confirm ? `deployed to ${env}` : "cancelled"
        },
      }),
    ],
  })
  const client = await connect(m, "modern", { elicitation: true })
  let asked = ""
  client.setRequestHandler("elicitation/create", async (req) => {
    asked = (req.params as { message?: string }).message ?? ""
    return { action: "accept", content: { confirm: true } }
  })
  const r = await client.callTool({ name: "deploy", arguments: { env: "prod" } })
  ok(
    "MRTR: inputRequired passes through; the client answers and the retry completes",
    (r.content as Array<{ text: string }>)[0]?.text === "deployed to prod" &&
      asked === "Deploy to prod?",
    { r, asked },
  )
  await client.close()
}

// --- stdio: serveStdio in a child process, both eras ---
{
  const fixture = new URL("./fixtures/mcp-stdio.ts", import.meta.url).pathname
  for (const era of ["legacy", "modern"] as const) {
    const client = new Client(
      { name: "stdio-test", version: "0" },
      era === "modern" ? { versionNegotiation: { mode: { pin: MODERN_VERSION } } } : {},
    )
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fixture] }))
    const listed = await client.listTools()
    const r = await client.callTool({ name: "add", arguments: { a: 40, b: 2 } })
    ok(
      `[${era}] stdio: serveStdio(() => createMcpServer(...)) serves the ${era} era`,
      client.getProtocolEra() === era &&
        listed.tools.length === 2 &&
        (r.content as Array<{ text: string }>)[0]?.text === '{"sum":42}',
      { era: client.getProtocolEra(), r },
    )
    const crash = await client.callTool({ name: "crash" })
    ok(
      `[${era}] stdio: the error mapping applies`,
      (crash.content as Array<{ text: string }>)[0]?.text === "INTERNAL_ERROR: Internal error",
      crash,
    )
    await client.close()
  }
}

// --- listed: false — callable, absent from tools/list ---
{
  const Sum = z.object({ sum: z.number() })
  const hidden: McpTool[] = [
    defineTool({ name: "first", description: "default: listed", handler: () => "first" }),
    defineTool({
      name: "old_add",
      description: "deprecated alias of add",
      listed: false,
      input: z.object({ a: z.number(), b: z.number().default(10) }),
      output: Sum,
      handler: ({ a, b }) => ({ sum: a + b }),
    }),
    defineTool({ name: "middle", description: "explicit", listed: true, handler: () => "m" }),
    defineTool({
      name: "old_admin",
      description: "deprecated, needs admin",
      listed: false,
      scopes: ["admin"],
      handler: () => "should not run",
    }),
    defineTool({
      name: "old_who",
      description: "deprecated, needs read",
      listed: false,
      scopes: ["read"],
      handler: (_i, ctx) => ({ sub: ctx.token?.claims.sub }),
    }),
    defineTool({
      name: "old_upstream",
      description: "deprecated, mapped error",
      listed: false,
      handler: () => {
        throw new UpstreamError("QUOTA_SPENT")
      },
    }),
    defineTool({
      name: "old_not_found",
      description: "deprecated, default error mapping",
      listed: false,
      handler: () => {
        throw new ApiException(404, "Order not found", "ORDER_NOT_FOUND")
      },
    }),
    defineTool({
      name: "old_crash",
      description: "deprecated, unexpected error",
      listed: false,
      handler: () => {
        throw new Error("secret")
      },
    }),
    defineTool({ name: "last", description: "default: listed", handler: () => "last" }),
  ]
  const visible = hidden.filter((t) => t.listed !== false)
  const opts = {
    ...serverOptions,
    middleware: [requireToken({ verifier, resourceMetadataUrl: META })],
  }
  const hideApp = new Hono()
  mountMcp(hideApp, "/mcp", { ...opts, tools: hidden })
  // The same listed tools with nothing unlisted: the unpatched SDK path.
  const plainApp = new Hono()
  mountMcp(plainApp, "/mcp", { ...opts, tools: visible })
  const auth = { authorization: `Bearer ${readTok}` }
  type CacheFields = { ttlMs?: unknown; cacheScope?: unknown; resultType?: unknown }
  const without = (r: Record<string, unknown> | undefined) => {
    const { _meta, ...rest } = r ?? {}
    return rest
  }

  for (const era of ["legacy", "modern"] as const) {
    const p = `[${era}] listed:false`
    const e = { era, headers: auth }
    const list = await rpc(hideApp, "tools/list", {}, e)
    const names = (list.body.result?.tools ?? []).map((t) => t.name)
    ok(
      `${p}: unlisted tools absent, listed keep their order`,
      JSON.stringify(names) === '["first","middle","last"]',
      names,
    )
    const plain = await rpc(plainApp, "tools/list", {}, e)
    ok(
      `${p}: the list is the SDK's own, byte for byte, minus the unlisted`,
      JSON.stringify(without(list.body.result)) === JSON.stringify(without(plain.body.result)),
      { list: list.body.result, plain: plain.body.result },
    )
    const r = list.body.result as CacheFields | undefined
    if (era === "modern") {
      ok(
        `${p}: 2026 list keeps resultType and the cache fields`,
        r?.resultType === "complete" &&
          typeof r.ttlMs === "number" &&
          (r.cacheScope === "public" || r.cacheScope === "private"),
        r,
      )
    } else {
      ok(
        `${p}: 2025 list has no resultType or cache fields`,
        r?.resultType === undefined && r?.ttlMs === undefined && r?.cacheScope === undefined,
        r,
      )
    }

    const add = await call(hideApp, "old_add", { a: 2 }, e)
    ok(
      `${p}: still callable, with defaults and structuredContent`,
      JSON.stringify(add.body.result?.structuredContent) === '{"sum":12}' &&
        add.body.result?.content?.[0]?.text === '{"sum":12}' &&
        !add.body.result?.isError,
      add.body,
    )
    const bad = await call(hideApp, "old_add", { a: "x" }, e)
    ok(
      `${p}: the SDK still validates its input`,
      JSON.stringify(bad.body).includes("Input validation error"),
      bad.body,
    )
    const adm = await call(hideApp, "old_admin", undefined, e)
    ok(
      `${p}: scopes still checked`,
      (adm.body.result?.structuredContent as { code?: string })?.code === "insufficient_scope",
      adm.body,
    )
    const who = await call(hideApp, "old_who", undefined, e)
    ok(
      `${p}: a held scope passes, ctx.token reaches it`,
      who.body.result?.content?.[0]?.text === '{"sub":"user-1"}',
      who.body,
    )
    const up = await call(hideApp, "old_upstream", undefined, e)
    ok(
      `${p}: mapError applies`,
      up.body.result?.content?.[0]?.text === "QUOTA_SPENT: upstream said no",
      up.body,
    )
    const nf = await call(hideApp, "old_not_found", undefined, e)
    ok(
      `${p}: default error mapping applies`,
      nf.body.result?.content?.[0]?.text?.startsWith("ORDER_NOT_FOUND") === true,
      nf.body,
    )
    reported.length = 0
    const crash = await call(hideApp, "old_crash", undefined, e)
    ok(
      `${p}: an unexpected error is Internal error, and reported`,
      crash.body.result?.content?.[0]?.text === "INTERNAL_ERROR: Internal error" &&
        reported.some((x) => x.tool === "old_crash"),
      crash.body,
    )
    const listedCall = await call(hideApp, "middle", undefined, e)
    ok(`${p}: listed: true behaves as before`, listedCall.body.result?.content?.[0]?.text === "m")
    const unknown = await call(hideApp, "never_defined", undefined, e)
    ok(
      `${p}: an unknown tool is still unknown`,
      unknown.body.error?.message === "Tool never_defined not found",
      unknown.body,
    )

    // The SDK's own client, in this era.
    const client = await connect(hideApp, era, { headers: auth })
    const cl = await client.listTools()
    ok(
      `${p}: SDK client lists only the listed tools`,
      JSON.stringify(cl.tools.map((t) => t.name)) === '["first","middle","last"]',
      cl.tools.map((t) => t.name),
    )
    const cr = await client.callTool({ name: "old_add", arguments: { a: 40, b: 2 } })
    ok(
      `${p}: SDK client calls an unlisted tool`,
      JSON.stringify(cr.structuredContent) === '{"sum":42}',
      cr,
    )
    await client.close()
  }

  // Everything unlisted: an empty list, every tool still callable.
  const allHidden = new Hono()
  mountMcp(allHidden, "/mcp", {
    name: "h",
    version: "0",
    tools: [defineTool({ name: "ghost", description: "", listed: false, handler: () => "boo" })],
  })
  for (const era of ["legacy", "modern"] as const) {
    const l = await rpc(allHidden, "tools/list", {}, { era })
    const g = await call(allHidden, "ghost", undefined, { era })
    ok(
      `[${era}] all unlisted: empty list, still callable`,
      l.body.result?.tools?.length === 0 && g.body.result?.content?.[0]?.text === "boo",
      { l: l.body, g: g.body },
    )
  }

  // The interception is gone once the server is built.
  const built = createMcpServer({ name: "h", version: "0", tools: hidden })
  ok(
    "listed:false: setRequestHandler is the SDK's own again after build",
    !Object.hasOwn(built.server, "setRequestHandler"),
  )
  ok(
    "listed:false: tools capability still says listChanged: false",
    built.server.getCapabilities().tools?.listChanged === false,
    built.server.getCapabilities(),
  )
}

// --- scale ---
for (const era of ["legacy", "modern"] as const) {
  const big = new Hono()
  mountMcp(big, "/mcp", { name: "big", version: "0", tools: MANY_TOOLS })
  const t0 = performance.now()
  const l = await rpc(big, "tools/list", {}, { era })
  const ms = performance.now() - t0
  ok(
    `[${era}] ${MANY_TOOLS.length} tools: all listed`,
    l.body.result?.tools?.length === MANY_TOOLS.length,
  )
  const r = await call(big, "tool_1", { f1_1: 7, f4_1: ["x"], f7_1: "abcd" }, { era })
  ok(
    `[${era}] ${MANY_TOOLS.length} tools: a call parses defaults and transforms`,
    r.body.result?.content?.[0]?.text ===
      JSON.stringify({ tool: 1, input: { f1_1: 7, f4_1: ["x"], f7_1: 4 } }),
    r.body,
  )
  console.log(
    `  ([${era}] tools/list for ${MANY_TOOLS.length} tools, handler + server built per request: ${ms.toFixed(1)}ms)`,
  )
}

// --- duplicate names fail at build, not at call ---
let dup: unknown
try {
  createMcpServer({ name: "d", version: "0", tools: [tools[0] as McpTool, tools[0] as McpTool] })
} catch (e) {
  dup = e
}
ok("duplicate tool names throw", dup instanceof Error && /already registered/.test(dup.message))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
