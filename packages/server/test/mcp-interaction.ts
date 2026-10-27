/**
 * confirm() and progress(): the SDK's own multi-round-trip input and
 * progress notifications, driven through mountMcp with the SDK's client.
 * confirm() covers: the 3-way result, the signed binding to a call's
 * arguments (app-a's forgeability finding), and no-capability clients.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { Hono } from "hono"
import { z } from "zod"
import { confirm, defineTool, isConfirmPending, progress } from "../src/mcp"
import { mountMcp } from "../src/mcp/hono"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean | undefined, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const MODERN = "2026-07-28"
async function connect(app: Hono, opts: { elicitation?: boolean } = {}) {
  const client = new Client(
    { name: "t", version: "0" },
    {
      versionNegotiation: { mode: { pin: MODERN } },
      ...(opts.elicitation ? { capabilities: { elicitation: { form: {} } } } : {}),
    },
  )
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://t.local/mcp"), {
      fetch: async (u, i) => app.fetch(new Request(u, i)),
    }),
  )
  return client
}

const KEY = "a".repeat(32) // >= 32 bytes, as createRequestStateCodec requires

let deletedCount = 0
function makeApp(opts: { confirmKey?: string } = { confirmKey: KEY }) {
  deletedCount = 0
  const app = new Hono()
  mountMcp(app, "/mcp", {
    name: "confirm-test",
    version: "1",
    ...(opts.confirmKey ? { confirm: { key: opts.confirmKey } } : {}),
    tools: [
      defineTool({
        name: "delete_transactions",
        description: "Delete",
        input: z.object({ count: z.number() }),
        handler: async (input, ctx) => {
          const answer = await confirm(ctx, {
            message: `Delete ${input.count} transactions?`,
            detail: `${input.count} rows removed`,
            args: input,
          })
          if (isConfirmPending(answer)) return answer
          if (answer === "unsupported") return "Unsupported: pass confirmDeleteAll instead."
          if (answer !== "confirmed") return "Cancelled."
          deletedCount += input.count
          return "Deleted."
        },
      }),
      defineTool({
        name: "import_statement",
        description: "Import",
        input: z.object({ rows: z.number() }),
        handler: async (input, ctx) => {
          for (let i = 1; i <= input.rows; i++)
            await progress(ctx, i, input.rows, `Row ${i} of ${input.rows}`)
          return "Imported."
        },
      }),
    ],
  })
  return app
}

const app = makeApp()

// --- confirm: accepted ---
{
  const client = await connect(app, { elicitation: true })
  let asked: { message?: string } = {}
  client.setRequestHandler("elicitation/create", async (req) => {
    asked = req.params as { message?: string }
    return { action: "accept", content: { confirm: true } }
  })
  const r = await client.callTool({ name: "delete_transactions", arguments: { count: 3 } })
  ok(
    "confirm: accepted runs the action",
    (r.content as Array<{ text: string }>)[0]?.text === "Deleted." && deletedCount === 3,
  )
  ok(
    "confirm: message and detail reach the client",
    asked.message === "Delete 3 transactions?\n\n3 rows removed",
    asked,
  )
  await client.close()
}

// --- confirm: declined ---
{
  const before = deletedCount
  const client = await connect(app, { elicitation: true })
  client.setRequestHandler("elicitation/create", async () => ({
    action: "accept",
    content: { confirm: false },
  }))
  const r = await client.callTool({ name: "delete_transactions", arguments: { count: 5 } })
  ok(
    "confirm: declined does not run the action",
    (r.content as Array<{ text: string }>)[0]?.text === "Cancelled." && deletedCount === before,
  )
  await client.close()
}

// --- confirm: client cancels the elicitation ---
{
  const before = deletedCount
  const client = await connect(app, { elicitation: true })
  client.setRequestHandler("elicitation/create", async () => ({ action: "cancel" }))
  const r = await client.callTool({ name: "delete_transactions", arguments: { count: 9 } })
  ok(
    "confirm: a cancelled elicitation never runs the action",
    (r.content as Array<{ text: string }>)[0]?.text !== "Deleted." && deletedCount === before,
    r,
  )
  await client.close()
}

// --- confirm: no elicitation capability -> "unsupported", never silently asked or refused ---
{
  const before = deletedCount
  const client = await connect(app) // no elicitation capability declared
  const r = await client.callTool({ name: "delete_transactions", arguments: { count: 7 } })
  ok(
    "confirm: a client that cannot elicit gets 'unsupported'",
    (r.content as Array<{ text: string }>)[0]?.text ===
      "Unsupported: pass confirmDeleteAll instead." && deletedCount === before,
    r,
  )
  await client.close()
}

// --- confirm: signed binding. app-a's forgeability finding: an accepted
// answer must not unlock a DIFFERENT call's arguments. Modelled at the raw
// wire, since an honest client (including the SDK's own) always resends the
// arguments it started with — only a non-compliant or malicious one swaps
// them between the ask and the retry. ---
const ELICIT_META = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "raw", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": { elicitation: {} },
}
const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": MODERN,
  "mcp-method": "tools/call",
  "mcp-name": "delete_transactions",
}
async function ask(count: number) {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "delete_transactions", arguments: { count }, _meta: ELICIT_META },
    }),
  })
  return (await res.json()) as {
    result: { inputRequests: Record<string, unknown>; requestState: string }
  }
}
async function retry(count: number, requestState: string, inputId: string) {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "delete_transactions",
        arguments: { count },
        requestState,
        inputResponses: { [inputId]: { action: "accept", content: { confirm: true } } },
        _meta: ELICIT_META,
      },
    }),
  })
  return (await res.json()) as { result: { content: Array<{ text: string }> } }
}

{
  const before = deletedCount
  const asked = await ask(3)
  const inputId = Object.keys(asked.result.inputRequests)[0] as string
  const same = await retry(3, asked.result.requestState, inputId)
  ok(
    "signed binding: the same arguments, genuinely confirmed, succeed",
    same.result.content[0]?.text === "Deleted." && deletedCount === before + 3,
    same,
  )
}
{
  const before = deletedCount
  const asked = await ask(3)
  const inputId = Object.keys(asked.result.inputRequests)[0] as string
  const swapped = await retry(3000, asked.result.requestState, inputId)
  ok(
    "signed binding: a valid requestState replayed against DIFFERENT arguments reads as declined, not confirmed",
    swapped.result.content[0]?.text === "Cancelled." && deletedCount === before, // unchanged
    swapped,
  )
}

// --- confirm: without a confirm.key, still works but cannot detect the swap ---
{
  const noKeyApp = makeApp({})
  const client = await connect(noKeyApp, { elicitation: true })
  client.setRequestHandler("elicitation/create", async () => ({
    action: "accept",
    content: { confirm: true },
  }))
  const r = await client.callTool({ name: "delete_transactions", arguments: { count: 2 } })
  ok(
    "no confirm.key: still asks and still confirms",
    (r.content as Array<{ text: string }>)[0]?.text === "Deleted.",
  )
  await client.close()
}

// --- progress ---
{
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 99,
      method: "tools/call",
      params: {
        name: "import_statement",
        arguments: { rows: 3 },
        _meta: { progressToken: "tok-1" },
      },
    }),
  })
  const text = await res.text()
  const events = text
    .split("\n\n")
    .map((chunk) => chunk.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => !!l)
    .map((l) => JSON.parse(l.slice(6)))
  const notes = events.filter((e) => e.method === "notifications/progress").map((e) => e.params)
  ok(
    "progress: one notification per step, in order, with the token, total and message",
    notes.length === 3 &&
      notes.every(
        (p, i) =>
          p.progressToken === "tok-1" &&
          p.progress === i + 1 &&
          p.total === 3 &&
          p.message === `Row ${i + 1} of 3`,
      ),
    notes,
  )
  const result = events.find((e) => e.id === 99)
  ok(
    "progress: the tool still completes after reporting",
    result?.result?.content?.[0]?.text === "Imported.",
  )
}

// --- progress: no token on the request is a silent no-op ---
{
  const raw = new Hono()
  mountMcp(raw, "/mcp", {
    name: "no-token",
    version: "1",
    tools: [
      defineTool({
        name: "noop_import",
        input: z.object({}),
        description: "",
        handler: async (_input, ctx) => {
          await progress(ctx, 1, 1) // no progressToken on this request: must not throw
          return "ok"
        },
      }),
    ],
  })
  const res = await raw.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "noop_import", arguments: {} },
    }),
  })
  const text = await res.text()
  const data = text.split("\n").find((l) => l.startsWith("data: "))
  const body = data ? JSON.parse(data.slice(6)) : JSON.parse(text)
  ok(
    "progress: no progressToken on the request is a silent no-op",
    (body as { result?: { content?: Array<{ text: string }> } }).result?.content?.[0]?.text ===
      "ok",
    body,
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) throw new Error(`${fail} failed`)
