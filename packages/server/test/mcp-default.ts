/**
 * MCP on by default: routes as tools (`appTools`), per-user tool lists
 * (`visible`), and pending approvals (`kvApprovals`, `approvalRoutes`,
 * `approvalGate`) — against an in-process server.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { Hono, type MiddlewareHandler } from "hono"
import { z } from "zod"
import { memoryKv } from "../src/adapters"
import { errorHandler } from "../src/http/errors"
import { approvalRoutes } from "../src/http/routes"
import { zValidator } from "../src/http/validate"
import {
  type AnyTool,
  type ApprovalEvent,
  approvalGate,
  appTools,
  asTool,
  createMcpServer,
  defineTool,
  kvApprovals,
  routeToolName,
} from "../src/mcp"
import { mountMcp } from "../src/mcp/hono"
import type { VerifiedToken } from "../src/oauth-rs/verify"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean | undefined, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

/** Stands in for oauth-rs `requireToken`: `Bearer <sub>` becomes a verified token. */
const fakeAuth: MiddlewareHandler = async (c, next) => {
  const sub = c.req.header("authorization")?.replace(/^Bearer /, "")
  if (sub) {
    const token: VerifiedToken = {
      claims: { iss: "i", sub, aud: "a", exp: 0 },
      scopes: [],
    }
    c.set("token" as never, token as never)
  }
  await next()
}

async function connect(app: Hono, user?: string, answer?: "accept" | "decline") {
  const client = new Client(
    { name: "t", version: "0" },
    {
      versionNegotiation: { mode: { pin: "2026-07-28" } },
      ...(answer ? { capabilities: { elicitation: { form: {} } } } : {}),
    },
  )
  if (answer)
    client.setRequestHandler("elicitation/create", async () =>
      answer === "accept"
        ? { action: "accept", content: { confirm: true } }
        : { action: "decline" },
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

type Result = { isError?: boolean; content?: Array<{ text?: string }>; structuredContent?: unknown }
const structured = (r: unknown) =>
  (r as Result).structuredContent as
    | { code?: string; approval?: { id?: string; summary?: string; details?: unknown } }
    | undefined
const props = (t: { inputSchema?: unknown } | undefined) =>
  (t?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
const json = (r: unknown) => JSON.parse((r as Result).content?.[0]?.text ?? "null")

// --- the app: plain Hono routes, validated as usual ---
const notes: Array<{ id: string; owner: string; text: string }> = []
const userOf = (c: { req: { header(n: string): string | undefined } }) =>
  c.req.header("authorization")?.replace(/^Bearer /, "")

const sub = new Hono()
  .onError((_e, c) => c.json({ sub: true }, 500))
  .post("/archive", zValidator("json", z.object({ before: z.string() })), (c) =>
    c.json({ archived: c.req.valid("json").before }),
  )

const app = new Hono()
  .get(
    "/api/notes",
    zValidator(
      "query",
      z.object({ q: z.string().optional() }).describe("Search the signed-in user's notes"),
    ),
    (c) => {
      const owner = userOf(c)
      const q = c.req.valid("query").q ?? ""
      return c.json(notes.filter((n) => n.owner === owner && n.text.includes(q)))
    },
  )
  .get("/api/notes/:id", zValidator("param", z.object({ id: z.string() })), (c) => {
    const n = notes.find((x) => x.id === c.req.valid("param").id && x.owner === userOf(c))
    return n ? c.json(n) : c.json({ success: false, error: "Not found", code: "NOT_FOUND" }, 404)
  })
  .post(
    "/api/notes",
    asTool({ description: "Save a note for the signed-in user" }),
    zValidator("json", z.object({ text: z.string().min(1) })),
    (c) => {
      const owner = userOf(c)
      if (!owner) return c.json({ success: false, error: "Sign in", code: "UNAUTHORIZED" }, 401)
      const n = { id: String(notes.length + 1), owner, text: c.req.valid("json").text }
      notes.push(n)
      return c.json(n)
    },
  )
  .post(
    "/api/tag",
    asTool({ approval: false }),
    zValidator("query", z.object({ dry: z.string().optional() })),
    zValidator("json", z.object({ tag: z.string() })),
    (c) => c.json({ tag: c.req.valid("json").tag, dry: c.req.valid("query").dry ?? null }),
  )
  .post("/api/webhook", asTool(false), zValidator("json", z.object({ e: z.string() })), (c) =>
    c.json({}),
  )
  .get("/api/me", asTool({ name: "whoami", description: "Who is signed in" }), (c) =>
    c.json({ user: userOf(c) ?? null }),
  )
  .get("/api/plain", (c) => c.json({}))
  .post("/api/form", zValidator("form", z.object({ a: z.string() })), (c) => c.json({}))
  .route("/api/sub", sub)
  .onError(errorHandler({ isProduction: () => false }))

const tools = appTools(app)
const byName = new Map(tools.map((t) => [t.name, t]))

ok("routeToolName", routeToolName("GET", "/api/notes/:id") === "get_api_notes_by_id")
ok(
  "appTools: validated and marked routes, not opted-out, plain or form ones",
  [
    "get_api_notes",
    "get_api_notes_by_id",
    "post_api_notes",
    "post_api_tag",
    "whoami",
    "post_api_sub_archive",
  ].every((n) => byName.has(n)) &&
    !byName.has("post_api_webhook") &&
    !byName.has("get_api_plain") &&
    !byName.has("post_api_form") &&
    tools.length === 6,
  [...byName.keys()],
)
ok(
  "appTools: description from asTool, then the schema, then METHOD /path",
  byName.get("post_api_notes")?.description === "Save a note for the signed-in user" &&
    byName.get("get_api_notes")?.description === "Search the signed-in user's notes" &&
    byName.get("get_api_notes_by_id")?.description === "GET /api/notes/:id",
)
ok(
  "appTools: GET is read-only, others are not",
  byName.get("get_api_notes")?.annotations?.readOnlyHint === true &&
    !byName.get("post_api_notes")?.annotations?.readOnlyHint,
)
ok(
  "appTools: optIn keeps only asTool routes",
  appTools(app, { optIn: true })
    .map((t) => t.name)
    .sort()
    .join() === "post_api_notes,post_api_tag,whoami",
)
{
  let threw = false
  try {
    appTools(
      new Hono()
        .post("/a", asTool({ name: "x" }), (c) => c.json({}))
        .post("/b", asTool({ name: "x" }), (c) => c.json({})),
    )
  } catch {
    threw = true
  }
  ok("appTools: two routes with one name throw", threw)
}

// --- served over MCP, as the signed-in user ---
const served = new Hono()
mountMcp(served, "/mcp", { name: "app", version: "1", middleware: [fakeAuth], tools })
{
  const anon = await connect(served)
  const listed = await anon.listTools()
  const save = listed.tools.find((t) => t.name === "post_api_notes")
  ok("list: input schema from the validator", props(save).text !== undefined, save)
  const tag = listed.tools.find((t) => t.name === "post_api_tag")
  ok(
    "list: query and json validators merge",
    ["dry", "tag"].every((k) => props(tag)[k]),
  )
  await anon.close()

  const alice = await connect(served, "alice")
  const me = await alice.callTool({ name: "whoami", arguments: {} })
  ok("read: runs as the signed-in user", json(me).user === "alice", me)
  const blocked = await alice.callTool({ name: "post_api_notes", arguments: { text: "hi" } })
  ok(
    "write: without elicitation or a store, APPROVAL_REQUIRED and the route is not called",
    structured(blocked)?.code === "APPROVAL_REQUIRED" && notes.length === 0,
    blocked,
  )
  const tagged = await alice.callTool({ name: "post_api_tag", arguments: { tag: "t", dry: "1" } })
  ok(
    "write with approval: false runs; a POST's query args go in the query",
    json(tagged).tag === "t" && json(tagged).dry === "1",
    tagged,
  )
  const archived = await alice.callTool({
    name: "post_api_sub_archive",
    arguments: { before: "2026" },
  })
  ok(
    "a sub-app route with its own onError still works",
    structured(archived)?.code === "APPROVAL_REQUIRED",
    archived,
  )
  await alice.close()

  const yes = await connect(served, "alice", "accept")
  const saved = await yes.callTool({ name: "post_api_notes", arguments: { text: "hello" } })
  ok("write: approved through elicitation, the route runs", json(saved).owner === "alice", saved)
  await yes.close()
  const no = await connect(served, "alice", "decline")
  const refused = await no.callTool({ name: "post_api_notes", arguments: { text: "x" } })
  ok(
    "write: declined does nothing",
    structured(refused)?.code === "APPROVAL_DECLINED" && notes.length === 1,
  )
  await no.close()

  const bob = await connect(served, "bob")
  const theirs = await bob.callTool({ name: "get_api_notes_by_id", arguments: { id: "1" } })
  ok("scoped: another user's note is not found", structured(theirs)?.code === "NOT_FOUND", theirs)
  const list = await bob.callTool({ name: "get_api_notes", arguments: {} })
  ok("scoped: the list is the caller's own", Array.isArray(json(list)) && json(list).length === 0)
  await bob.close()
}

// --- per-user tool lists ---
{
  const roles: Record<string, string> = { ann: "admin", ben: "member" }
  const isAdmin = ({ token }: { token?: VerifiedToken }) =>
    roles[token?.claims.sub ?? ""] === "admin"
  const gatedApp = new Hono()
  mountMcp(gatedApp, "/mcp", {
    name: "gated",
    version: "1",
    middleware: [fakeAuth],
    tools: [
      defineTool({ name: "open", description: "", handler: () => "ok" }),
      defineTool({ name: "admin_only", description: "", visible: isAdmin, handler: () => "ok" }),
    ],
  })
  const ann = await connect(gatedApp, "ann")
  const ben = await connect(gatedApp, "ben")
  const annTools = (await ann.listTools()).tools.map((t) => t.name)
  const benTools = (await ben.listTools()).tools.map((t) => t.name)
  ok("visible: listed for the admin", annTools.includes("admin_only"), annTools)
  ok("visible: not listed for a member", !benTools.includes("admin_only"), benTools)
  const call = await ben.callTool({ name: "admin_only", arguments: {} }).then(
    (r) => (r as Result).isError === true,
    (e: Error) => /not found/.test(e.message),
  )
  ok("visible: not callable by a member", call)
  await Promise.all([ann.close(), ben.close()])

  let threw = false
  try {
    createMcpServer({
      name: "x",
      version: "1",
      tools: [defineTool({ name: "a", description: "", visible: () => true, handler: () => "" })],
    })
  } catch {
    threw = true
  }
  ok("visible: createMcpServer refuses a tool it cannot check", threw)
}

// --- pending approvals ---
{
  const events: ApprovalEvent[] = []
  const approvals = kvApprovals(memoryKv(), { onEvent: (e) => void events.push(e) })
  let refunds = 0
  // Shaped like signet-db's and signet-payments' factories: a plain tool
  // whose write goes through an `approve(ctx, { summary, details, args })`.
  const paymentLike = (
    approve: (ctx: unknown, r: never) => Promise<unknown> | unknown,
  ): AnyTool => ({
    name: "refund_payment",
    description: "Refund",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, amount: { type: "number" } },
      required: ["id", "amount"],
    },
    async run(input: { id: string; amount: number }, ctx: unknown) {
      const request = { summary: `Refund ${input.amount}`, details: { ...input }, args: input }
      const gate = await approve(ctx, request as never)
      if (gate !== undefined) return gate
      refunds += input.amount
      return { refunded: input.amount }
    },
  })
  const pendingApp = new Hono()
  mountMcp(pendingApp, "/mcp", {
    name: "pending",
    version: "1",
    middleware: [fakeAuth],
    approvals,
    tools: [...tools, paymentLike(approvalGate)],
  })
  pendingApp.use("/api/approvals/*", fakeAuth)
  pendingApp.route(
    "/api/approvals",
    approvalRoutes({
      approvals,
      subject: (c) => (c.get("token" as never) as VerifiedToken | undefined)?.claims.sub ?? "",
    }),
  )
  pendingApp.onError(errorHandler({ isProduction: () => false }))
  const decide = (user: string, id: string, to: "approve" | "deny") =>
    pendingApp.request(`/api/approvals/${id}/${to}`, {
      method: "POST",
      headers: { authorization: `Bearer ${user}` },
    })

  const agent = await connect(pendingApp, "carol")
  const args = { id: "p1", amount: 40 }
  const first = await agent.callTool({ name: "refund_payment", arguments: args })
  const id = structured(first)?.approval?.id ?? ""
  ok(
    "pending: a client that cannot ask gets APPROVAL_PENDING with a record id",
    structured(first)?.code === "APPROVAL_PENDING" && !!id && refunds === 0,
    first,
  )
  const again = await agent.callTool({ name: "refund_payment", arguments: args })
  ok("pending: asking again reuses the open record", structured(again)?.approval?.id === id)
  const listed = (await (
    await pendingApp.request("/api/approvals", { headers: { authorization: "Bearer carol" } })
  ).json()) as Array<{ id: string; summary: string }>
  ok(
    "routes: the person sees it pending",
    listed.length === 1 && listed[0]?.summary === "Refund 40",
  )
  ok("routes: someone else cannot decide it", (await decide("dave", id, "approve")).status === 404)
  ok("routes: approve", (await decide("carol", id, "approve")).status === 200)
  ok("routes: deciding twice is a conflict", (await decide("carol", id, "deny")).status === 409)

  const other = await agent.callTool({
    name: "refund_payment",
    arguments: { id: "p1", amount: 400 },
  })
  ok(
    "bound: different arguments are not approved",
    structured(other)?.code === "APPROVAL_PENDING" && refunds === 0,
  )
  const run = await agent.callTool({ name: "refund_payment", arguments: args })
  ok("approved: the same call runs", json(run).refunded === 40 && refunds === 40, run)
  const replay = await agent.callTool({ name: "refund_payment", arguments: args })
  ok(
    "approved: once only; a replay asks again",
    structured(replay)?.code === "APPROVAL_PENDING" && refunds === 40,
  )
  const replayId = structured(replay)?.approval?.id ?? ""
  await decide("carol", replayId, "deny")
  const denied = await agent.callTool({ name: "refund_payment", arguments: args })
  ok(
    "denied: the call is declined",
    structured(denied)?.code === "APPROVAL_DECLINED" && refunds === 40,
  )

  const routeWrite = await agent.callTool({
    name: "post_api_notes",
    arguments: { text: "via app" },
  })
  const routeId = structured(routeWrite)?.approval?.id ?? ""
  await decide("carol", routeId, "approve")
  const routeRun = await agent.callTool({ name: "post_api_notes", arguments: { text: "via app" } })
  ok("route tools use the same approvals", json(routeRun).owner === "carol", routeRun)
  await agent.close()

  const asker = await connect(pendingApp, "carol", "accept")
  await asker.callTool({ name: "refund_payment", arguments: { id: "p2", amount: 1 } })
  await asker.close()
  ok("elicited: still asks in the client and acts", refunds === 41)
  const types = events.map((e) => e.type).join()
  ok(
    "audit: every request, decision and use is an event",
    types.includes("requested,approved") &&
      types.includes("denied") &&
      events.some((e) => e.type === "used" && e.record.via === "elicitation") &&
      events.filter((e) => e.type === "used" && e.record.via === "app").length === 2,
    types,
  )
}

// --- expiry ---
{
  const approvals = kvApprovals(memoryKv(), { ttlSeconds: 0.05 })
  const call = { tool: "t", principal: "u", summary: "s", fp: "f" }
  const r = await approvals.request(call)
  await new Promise((r) => setTimeout(r, 80))
  ok("expiry: an old record reads as expired", (await approvals.get(r.id))?.status === "expired")
  ok("expiry: it cannot be approved", (await approvals.approve(r.id, "u")) === null)
  ok("expiry: and is not live for the call", (await approvals.find(call)) === null)
  ok("expiry: nor listed as pending", (await approvals.listPending("u")).length === 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
