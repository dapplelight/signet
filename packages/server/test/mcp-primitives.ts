/**
 * Resources and prompts through createMcpServer: listing, reads in every
 * return shape, templates, prompt arguments, scopes, and the error mapping.
 * Raw JSON-RPC in both protocol eras, plus the SDK's own client.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { ApiException } from "../src/http/errors"
import {
  definePrompt,
  defineResource,
  defineTool,
  type PromptContext,
  type ResourceContext,
  resourceResult,
} from "../src/mcp"
import { mountMcp } from "../src/mcp/hono"
import type { VerifiedToken } from "../src/oauth-rs/verify"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean | undefined, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

// --- typing: checked by `bun run typecheck` ---
definePrompt({
  name: "typed",
  args: z.object({ month: z.string(), note: z.string().optional() }),
  render: (args, ctx) => {
    const m: string = args.month
    const n: string | undefined = args.note
    const p: string = ctx.prompt
    // @ts-expect-error — not in the schema
    args.missing
    return `${m}${n ?? ""}${p}`
  },
})
definePrompt({
  name: "no_args",
  render: (args) => {
    // @ts-expect-error — no args schema, no args
    args.anything
    return [{ role: "assistant", content: "hi" }, "and a user line"]
  },
})
defineResource({
  name: "typed_template",
  template: "t://{id}",
  read: ({ uri, variables }, ctx) => {
    const id: string | undefined = variables.id
    const u: URL = uri
    const r: string = ctx.resource
    return { id, u: u.href, r }
  },
})
// @ts-expect-error — a fixed uri has no list
defineResource({ name: "typed_static", uri: "t://x", read: ({ uri }) => uri.href, list: () => [] })

// --- fixtures ---
const reported: Array<{ err: unknown; meta: unknown }> = []
const seen: { rctx?: ResourceContext; pctx?: PromptContext } = {}

const resources = [
  defineResource({
    name: "categories",
    uri: "app://categories",
    title: "Categories",
    description: "The category tree",
    read: (_req, ctx) => {
      seen.rctx = ctx
      return { data: [{ id: 1, name: "Food" }] }
    },
  }),
  defineResource({ name: "readme", uri: "app://readme", read: () => "# Hello" }),
  defineResource({
    name: "csv",
    uri: "app://export.csv",
    mimeType: "text/csv",
    read: () => "a,b\n1,2",
  }),
  defineResource({
    name: "logo",
    uri: "app://logo",
    mimeType: "image/png",
    read: () => new Uint8Array([137, 80, 78, 71]),
  }),
  defineResource({
    name: "raw",
    uri: "app://raw",
    read: ({ uri }) =>
      resourceResult({ contents: [{ uri: uri.href, text: "exact", mimeType: "text/x-raw" }] }),
  }),
  defineResource({
    name: "transaction",
    template: "app://transactions/{id}",
    description: "One transaction",
    list: () => [{ uri: "app://transactions/t1", name: "t1" }],
    read: ({ variables }) => (variables.id === "t1" ? { id: "t1", amount: 5 } : null),
  }),
  defineResource({
    name: "unlisted_template",
    template: "app://notes/{id}",
    read: ({ variables }) => `note ${variables.id}`,
  }),
  defineResource({
    name: "http404",
    uri: "app://err/404",
    read: () => {
      throw new HTTPException(404, { message: "No such category" })
    },
  }),
  defineResource({
    name: "api503",
    uri: "app://err/503",
    read: () => {
      throw new ApiException(503, "The bank API is down", "UPSTREAM_DOWN")
    },
  }),
  defineResource({
    name: "zod",
    uri: "app://err/zod",
    read: () => z.object({ n: z.number() }).parse({ n: "x" }),
  }),
  defineResource({
    name: "secret",
    uri: "app://err/secret",
    read: () => {
      throw new Error("db password is hunter2")
    },
  }),
  defineResource({
    name: "mapped",
    uri: "app://err/mapped",
    read: () => {
      throw Object.assign(new Error("teapot"), { appCode: "TEAPOT" })
    },
  }),
  defineResource({
    name: "scoped",
    uri: "app://scoped",
    scopes: ["finance:read"],
    read: () => "scoped data",
  }),
  defineResource({
    name: "scoped_template",
    template: "app://scoped/{id}",
    scopes: ["finance:read"],
    list: () => [{ uri: "app://scoped/1", name: "one" }],
    read: ({ variables }) => `scoped ${variables.id}`,
  }),
]

const prompts = [
  definePrompt({
    name: "monthly_review",
    title: "Monthly review",
    description: "Review a month",
    args: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), focus: z.string().optional() }),
    render: ({ month, focus }, ctx) => {
      seen.pctx = ctx
      return `Review ${month}${focus ? ` focusing on ${focus}` : ""}.`
    },
  }),
  definePrompt({
    name: "chat",
    render: () => [
      "first",
      { role: "assistant", content: "second" },
      { role: "user", content: { type: "text", text: "third" } },
    ],
  }),
  definePrompt({
    name: "full",
    render: () => ({
      description: "custom",
      messages: [{ role: "user", content: { type: "text", text: "whole" } }],
    }),
  }),
  definePrompt({
    name: "prompt_secret",
    render: () => {
      throw new Error("api key sk-live-123")
    },
  }),
  definePrompt({
    name: "prompt_scoped",
    scopes: ["finance:write"],
    render: () => "writes",
  }),
]

const tools = [defineTool({ name: "ping", description: "ping", handler: () => "pong" })]

function makeApp(opts: { scopes?: string[]; withPrimitives?: boolean } = {}) {
  const app = new Hono()
  mountMcp(app, "/mcp", {
    name: "prim-test",
    version: "1.0.0",
    tools,
    ...(opts.withPrimitives === false ? {} : { resources, prompts }),
    mapError: (err) =>
      (err as { appCode?: string }).appCode === "TEAPOT"
        ? { code: "TEAPOT", message: "I am a teapot" }
        : undefined,
    onError: (err, meta) => {
      reported.push({ err, meta })
    },
    middleware: opts.scopes
      ? [
          async (c, next) => {
            c.set(
              "token" as never,
              {
                scopes: opts.scopes,
                claims: { sub: "u1" },
              } as unknown as VerifiedToken as never,
            )
            await next()
          },
        ]
      : [],
  })
  return app
}

// --- raw JSON-RPC in either era ---
type Era = "legacy" | "modern"
const MODERN = "2026-07-28"
let nextId = 1
type Rpc = {
  result?: Record<string, any>
  error?: { code: number; message: string; data?: any }
}
async function rpc(app: Hono, era: Era, method: string, params: Record<string, unknown> = {}) {
  const base = { "content-type": "application/json", accept: "application/json, text/event-stream" }
  const headers =
    era === "legacy"
      ? { ...base, "mcp-protocol-version": "2025-11-25" }
      : {
          ...base,
          "mcp-protocol-version": MODERN,
          "mcp-method": method,
          // Mcp-Name mirrors the tool/prompt name, or a resource's URI.
          ...(typeof (params.name ?? params.uri) === "string"
            ? { "mcp-name": String(params.name ?? params.uri) }
            : {}),
        }
  const body =
    era === "legacy"
      ? params
      : {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MODERN,
            "io.modelcontextprotocol/clientInfo": { name: "raw", version: "0" },
            "io.modelcontextprotocol/clientCapabilities": {},
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

const app = makeApp()
const read = (era: Era, uri: string, a = app) => rpc(a, era, "resources/read", { uri })
const getPrompt = (era: Era, name: string, args?: Record<string, string>, a = app) =>
  rpc(a, era, "prompts/get", { name, ...(args ? { arguments: args } : {}) })

for (const era of ["legacy", "modern"] as const) {
  const E = `[${era}]`

  // listing
  const list = await rpc(app, era, "resources/list")
  const listed = (list.result?.resources ?? []) as Array<Record<string, string>>
  const cat = listed.find((r) => r.name === "categories")
  ok(`${E} resources/list: static resources listed`, cat?.uri === "app://categories", list)
  ok(
    `${E} resources/list: title and description`,
    cat?.title === "Categories" && cat?.description === "The category tree",
  )
  ok(
    `${E} resources/list: declared mimeType advertised`,
    listed.find((r) => r.name === "csv")?.mimeType === "text/csv",
  )
  ok(
    `${E} resources/list: a template's list adds its instances`,
    listed.some((r) => r.uri === "app://transactions/t1"),
  )
  const templates = await rpc(app, era, "resources/templates/list")
  const tnames = (
    (templates.result?.resourceTemplates ?? []) as Array<{ name: string; uriTemplate: string }>
  ).map((t) => `${t.name}=${t.uriTemplate}`)
  ok(
    `${E} resources/templates/list: both templates`,
    tnames.includes("transaction=app://transactions/{id}") &&
      tnames.includes("unlisted_template=app://notes/{id}"),
    tnames,
  )

  // reads, in every return shape
  const j = await read(era, "app://categories")
  const jc = j.result?.contents?.[0]
  ok(
    `${E} read: an object is JSON`,
    jc?.mimeType === "application/json" &&
      JSON.parse(jc.text).data[0].name === "Food" &&
      jc.uri === "app://categories",
    j,
  )
  const t = (await read(era, "app://readme")).result?.contents?.[0]
  ok(`${E} read: a string is text/plain`, t?.mimeType === "text/plain" && t?.text === "# Hello")
  const csv = (await read(era, "app://export.csv")).result?.contents?.[0]
  ok(
    `${E} read: mimeType applies to a string`,
    csv?.mimeType === "text/csv" && csv?.text === "a,b\n1,2",
  )
  const blob = (await read(era, "app://logo")).result?.contents?.[0]
  ok(
    `${E} read: bytes are a base64 blob`,
    blob?.mimeType === "image/png" && blob?.blob === btoa("\x89PNG"),
    blob,
  )
  const raw = (await read(era, "app://raw")).result?.contents?.[0]
  ok(
    `${E} read: resourceResult is sent as-is`,
    raw?.text === "exact" && raw?.mimeType === "text/x-raw",
  )

  // templates
  const tx = (await read(era, "app://transactions/t1")).result?.contents?.[0]
  ok(`${E} template read: variables reach read`, tx && JSON.parse(tx.text).amount === 5, tx)
  const note = (await read(era, "app://notes/42")).result?.contents?.[0]
  ok(`${E} template without list: still readable`, note?.text === "note 42")
  const missing = await read(era, "app://transactions/nope")
  ok(
    `${E} read returning null is resource-not-found (-32602 with data.uri)`,
    missing.error?.code === -32602 && missing.error?.data?.uri === "app://transactions/nope",
    missing,
  )

  // errors
  const e404 = await read(era, "app://err/404")
  ok(
    `${E} HTTPException 404: -32602, CODE: message, envelope in data`,
    e404.error?.code === -32602 &&
      e404.error.message === "NOT_FOUND: No such category" &&
      e404.error.data?.code === "NOT_FOUND" &&
      e404.error.data?.success === false,
    e404,
  )
  const e503 = await read(era, "app://err/503")
  ok(
    `${E} ApiException 503: -32603 with its own code`,
    e503.error?.code === -32603 &&
      e503.error.data?.code === "UPSTREAM_DOWN" &&
      e503.error.message.includes("bank API"),
    e503,
  )
  const ez = await read(era, "app://err/zod")
  ok(
    `${E} ZodError: VALIDATION_FAILED with field details`,
    ez.error?.code === -32602 &&
      ez.error.data?.code === "VALIDATION_FAILED" &&
      !!ez.error.data?.details?.fieldErrors?.n,
    ez,
  )
  reported.length = 0
  const es = await read(era, "app://err/secret")
  ok(
    `${E} unexpected error: "Internal error", nothing leaked`,
    es.error?.code === -32603 &&
      es.error.message === "Internal error" &&
      !JSON.stringify(es).includes("hunter2"),
    es,
  )
  ok(
    `${E} unexpected error: onError hears it, marked as a resource`,
    reported.length === 1 &&
      JSON.stringify(reported[0]?.meta) === JSON.stringify({ tool: "secret", kind: "resource" }) &&
      String((reported[0]?.err as Error | undefined)?.message).includes("hunter2"),
    reported,
  )
  const em = await read(era, "app://err/mapped")
  ok(
    `${E} mapError runs for resources`,
    em.error?.data?.code === "TEAPOT" && em.error.message === "TEAPOT: I am a teapot",
    em,
  )
  ok(`${E} a deliberate error is not reported`, reported.length === 1)

  // scopes
  const noTok = await read(era, "app://scoped")
  ok(
    `${E} scoped resource without a token: insufficient_scope`,
    noTok.error?.data?.code === "insufficient_scope" &&
      !JSON.stringify(noTok).includes("scoped data"),
    noTok,
  )
  const withTok = (await read(era, "app://scoped", makeApp({ scopes: ["finance:read"] }))).result
    ?.contents?.[0]
  ok(`${E} scoped resource with the scope: served`, withTok?.text === "scoped data")
  const wrongTok = await read(era, "app://scoped/1", makeApp({ scopes: ["other"] }))
  ok(
    `${E} scoped template with the wrong scope: refused`,
    wrongTok.error?.data?.code === "insufficient_scope",
    wrongTok,
  )
  const hidden = await rpc(app, era, "resources/list")
  ok(
    `${E} a scoped template lists nothing without the scope`,
    !((hidden.result?.resources ?? []) as Array<{ uri: string }>).some(
      (r) => r.uri === "app://scoped/1",
    ),
  )
  const shown = await rpc(makeApp({ scopes: ["finance:read"] }), era, "resources/list")
  ok(
    `${E} and lists its instances with it`,
    ((shown.result?.resources ?? []) as Array<{ uri: string }>).some(
      (r) => r.uri === "app://scoped/1",
    ),
  )

  // prompts
  const plist = await rpc(app, era, "prompts/list")
  const mr = ((plist.result?.prompts ?? []) as Array<Record<string, any>>).find(
    (p) => p.name === "monthly_review",
  )
  ok(
    `${E} prompts/list: title, description and arguments from the schema`,
    mr?.title === "Monthly review" &&
      mr?.description === "Review a month" &&
      JSON.stringify(
        mr?.arguments?.map((a: { name: string; required?: boolean }) => [a.name, !!a.required]),
      ) ===
        JSON.stringify([
          ["month", true],
          ["focus", false],
        ]),
    mr,
  )
  const g = await getPrompt(era, "monthly_review", { month: "2026-09", focus: "food" })
  ok(
    `${E} prompts/get: a string is one user text message`,
    g.result?.messages?.length === 1 &&
      g.result.messages[0].role === "user" &&
      g.result.messages[0].content.text === "Review 2026-09 focusing on food.",
    g,
  )
  const bad = await getPrompt(era, "monthly_review", { month: "Sept" })
  ok(`${E} prompts/get: arguments are validated by the schema`, bad.error?.code === -32602, bad)
  const chat = await getPrompt(era, "chat")
  ok(
    `${E} prompts/get: a list mixes strings and messages`,
    JSON.stringify(
      chat.result?.messages?.map((m: { role: string; content: { text: string } }) => [
        m.role,
        m.content.text,
      ]),
    ) ===
      JSON.stringify([
        ["user", "first"],
        ["assistant", "second"],
        ["user", "third"],
      ]),
    chat,
  )
  const full = await getPrompt(era, "full")
  ok(
    `${E} prompts/get: a whole result is sent as-is`,
    full.result?.description === "custom" && full.result.messages[0].content.text === "whole",
  )
  reported.length = 0
  const ps = await getPrompt(era, "prompt_secret")
  ok(
    `${E} prompt error: "Internal error", nothing leaked, reported as a prompt`,
    ps.error?.message === "Internal error" &&
      !JSON.stringify(ps).includes("sk-live") &&
      JSON.stringify(reported[0]?.meta) ===
        JSON.stringify({ tool: "prompt_secret", kind: "prompt" }),
    ps,
  )
  const pscope = await getPrompt(
    era,
    "prompt_scoped",
    undefined,
    makeApp({ scopes: ["finance:read"] }),
  )
  ok(
    `${E} scoped prompt with the wrong scope: refused`,
    pscope.error?.data?.code === "insufficient_scope",
    pscope,
  )
  const pscopeOk = await getPrompt(
    era,
    "prompt_scoped",
    undefined,
    makeApp({ scopes: ["finance:write"] }),
  )
  ok(
    `${E} scoped prompt with the scope: rendered`,
    pscopeOk.result?.messages?.[0]?.content?.text === "writes",
  )

  // tools unchanged beside them
  const ping = await rpc(app, era, "tools/call", { name: "ping", arguments: {} })
  ok(`${E} tools still work alongside`, ping.result?.content?.[0]?.text === "pong", ping)
}

// --- handler context ---
seen.rctx = undefined
await read("legacy", "app://categories", makeApp({ scopes: ["a"] }))
const rctx = seen.rctx as ResourceContext | undefined // assigned inside read, which tsc cannot see
ok(
  "ResourceContext: resource name, signal, token",
  rctx?.resource === "categories" &&
    rctx.signal instanceof AbortSignal &&
    rctx.token?.scopes[0] === "a",
)
ok("ResourceContext: the Hono context", typeof rctx?.c?.req?.url === "string")
await getPrompt("legacy", "monthly_review", { month: "2026-01" })
ok(
  "PromptContext: prompt name and signal",
  seen.pctx?.prompt === "monthly_review" && seen.pctx.signal instanceof AbortSignal,
)

// --- capabilities: declared only when present, and fixed ---
const client = new Client(
  { name: "t", version: "0" },
  { versionNegotiation: { mode: { pin: MODERN } } },
)
await client.connect(
  new StreamableHTTPClientTransport(new URL("http://t.local/mcp"), {
    fetch: async (url, init) => app.fetch(new Request(url, init)),
  }),
)
const caps = client.getServerCapabilities()
ok(
  "capabilities: resources and prompts declared with listChanged: false",
  caps?.resources?.listChanged === false &&
    caps?.prompts?.listChanged === false &&
    caps?.tools?.listChanged === false,
  caps,
)
const viaClient = await client.readResource({ uri: "app://readme" })
ok("SDK client: readResource", (viaClient.contents[0] as { text?: string }).text === "# Hello")
const promptViaClient = await client.getPrompt({
  name: "monthly_review",
  arguments: { month: "2026-02" },
})
ok(
  "SDK client: getPrompt",
  (promptViaClient.messages[0]?.content as { text?: string } | undefined)?.text ===
    "Review 2026-02.",
)
let clientErr: unknown
try {
  await client.readResource({ uri: "app://err/secret" })
} catch (e) {
  clientErr = e
}
ok(
  "SDK client: a failed read rejects with Internal error",
  String((clientErr as Error)?.message).includes("Internal error"),
  clientErr,
)
await client.close()

const plain = new Client(
  { name: "t", version: "0" },
  { versionNegotiation: { mode: { pin: MODERN } } },
)
await plain.connect(
  new StreamableHTTPClientTransport(new URL("http://t.local/mcp"), {
    fetch: async (url, init) => makeApp({ withPrimitives: false }).fetch(new Request(url, init)),
  }),
)
const plainCaps = plain.getServerCapabilities()
ok(
  "capabilities: a tools-only server declares no resources or prompts",
  !plainCaps?.resources && !plainCaps?.prompts && plainCaps?.tools?.listChanged === false,
  plainCaps,
)
await plain.close()

// --- unlisted tools still hidden when resources and prompts are present ---
{
  const a = new Hono()
  mountMcp(a, "/mcp", {
    name: "u",
    version: "1",
    tools: [
      ...tools,
      defineTool({ name: "alias", description: "old", listed: false, handler: () => "a" }),
    ],
    resources: [resources[1]!],
    prompts: [prompts[1]!],
  })
  const names = ((await rpc(a, "legacy", "tools/list")).result?.tools ?? []).map(
    (t: { name: string }) => t.name,
  )
  ok("unlisted tools stay hidden with resources and prompts", names.join() === "ping", names)
  const r = (await read("legacy", "app://readme", a)).result?.contents?.[0]
  const p = await getPrompt("legacy", "chat", undefined, a)
  ok(
    "and resources and prompts still serve",
    r?.text === "# Hello" && p.result?.messages?.length === 3,
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) throw new Error(`${fail} failed`)
