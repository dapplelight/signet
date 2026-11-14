/**
 * Call a remote MCP server's tools over streamable HTTP with a bearer token:
 * list tools, call one, get a typed result. `fetch` only — no SDK, no hono —
 * so it runs on Workers, Bun, Node 18+ and in the browser.
 *
 * Two protocol eras, as the server side serves:
 *   "legacy" (default)  2025-11-25: `initialize`, then requests carrying
 *                       `MCP-Protocol-Version` and any `Mcp-Session-Id`.
 *                       Every current server answers it, stateless or not.
 *   "modern"            2026-07-28: no handshake; each request carries its
 *                       version, client info and capabilities in `_meta`, plus
 *                       `Mcp-Method` / `Mcp-Name`. For servers that reject 2025.
 *
 * It declares no client capabilities, so a server never asks it for input:
 * a Signet `confirm` / `requireApproval` answers "unsupported" /
 * `APPROVAL_REQUIRED` rather than waiting on an answer that cannot come.
 */

const LEGACY_VERSION = "2025-11-25"
const MODERN_VERSION = "2026-07-28"

export type McpClientOptions = {
  /** The server's MCP endpoint, e.g. `https://api.example.com/mcp`. */
  url: string | URL
  /** Sent as `Authorization: Bearer …`; a function is called per request (for refresh). */
  token?: string | (() => string | Promise<string>)
  /** Default: "legacy" (2025-11-25), which every current server answers. */
  era?: "legacy" | "modern"
  /** Default `{ name: "signet-mcp-client", version: "1" }`. */
  clientInfo?: { name: string; version: string }
  /** Extra headers on every request. */
  headers?: Record<string, string>
  /** Default: the global `fetch`. Pass `app.fetch`-backed one for in-process tests. */
  fetch?: (input: Request) => Promise<Response>
}

/** A tool as tools/list describes it. */
export type McpToolInfo = {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
}

/** A tools/call result; `T` types `structuredContent` (a tool with an output schema). */
export type McpCallResult<T = Record<string, unknown>> = {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>
  structuredContent?: T
  isError?: boolean
  [key: string]: unknown
}

/** A JSON-RPC error, or an HTTP failure (`code` 0, with `status`). */
export class McpClientError extends Error {
  override name = "McpClientError"
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
    readonly status?: number,
  ) {
    super(message)
  }
}

export type McpClient = {
  /** Every tool, following `nextCursor` pages. */
  listTools(): Promise<McpToolInfo[]>
  /** Call a tool. An `isError` result is returned, not thrown: read `isError`. */
  callTool<T = Record<string, unknown>>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<McpCallResult<T>>
  /** End a 2025 session, if the server opened one. */
  close(): Promise<void>
}

type RpcMessage = {
  id?: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function envelopeError(res: Response, body: unknown): McpClientError {
  const error = (body as { error?: unknown } | null)?.error
  const message = typeof error === "string" && error ? error : `MCP server answered ${res.status}`
  return new McpClientError(message, 0, body, res.status)
}

/** The response to request `id`, from a JSON body or an SSE stream. */
async function readResponse(res: Response, id: number): Promise<RpcMessage> {
  const type = res.headers.get("content-type") ?? ""
  if (!type.includes("text/event-stream")) {
    const body = (await res.json()) as (RpcMessage & { jsonrpc?: string }) | null
    // Not JSON-RPC: a Signet envelope (`{success:false,error:"...",code:"..."}`
    // from token or rate-limit middleware) or some other JSON.
    if (
      !body ||
      typeof body !== "object" ||
      !("jsonrpc" in body) ||
      (body.error !== undefined && typeof body.error !== "object")
    )
      throw envelopeError(res, body)
    return body
  }
  if (!res.body) throw new McpClientError("Empty event stream", 0, undefined, res.status)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (value) buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n")
      let end = buffer.indexOf("\n\n")
      while (end !== -1) {
        const data = buffer
          .slice(0, end)
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n")
        buffer = buffer.slice(end + 2)
        if (data) {
          const msg = JSON.parse(data) as RpcMessage
          // Notifications and server requests on the stream are skipped.
          if (msg.id === id && ("result" in msg || "error" in msg)) return msg
        }
        end = buffer.indexOf("\n\n")
      }
      if (done) throw new McpClientError("Stream ended before the response", 0)
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

export function createMcpClient(options: McpClientOptions): McpClient {
  const url = String(options.url)
  const doFetch = options.fetch ?? ((req: Request) => fetch(req))
  const era = options.era ?? "legacy"
  const clientInfo = options.clientInfo ?? { name: "signet-mcp-client", version: "1" }
  let nextId = 1
  let session: Promise<{ version: string; sessionId?: string }> | undefined

  async function baseHeaders(): Promise<Headers> {
    const headers = new Headers(options.headers)
    headers.set("content-type", "application/json")
    headers.set("accept", "application/json, text/event-stream")
    const token = typeof options.token === "function" ? await options.token() : options.token
    if (token) headers.set("authorization", `Bearer ${token}`)
    return headers
  }

  async function post(headers: Headers, body: unknown): Promise<Response> {
    const res = await doFetch(
      new Request(url, { method: "POST", headers, body: JSON.stringify(body) }),
    )
    if (res.status === 202) return res // a notification, accepted
    // A JSON-RPC error comes back with a 4xx too (2026: 400/404); read it below.
    const type = res.headers.get("content-type") ?? ""
    if (!res.ok && !type.includes("json") && !type.includes("event-stream")) {
      throw new McpClientError(
        `MCP server answered ${res.status}${res.status === 401 ? " (check the token)" : ""}`,
        0,
        await res.text().catch(() => undefined),
        res.status,
      )
    }
    return res
  }

  async function request(
    method: string,
    params: Record<string, unknown>,
    headers: Headers,
  ): Promise<unknown> {
    const id = nextId++
    const res = await post(headers, { jsonrpc: "2.0", id, method, params })
    const msg = await readResponse(res, id)
    if (msg.error)
      throw new McpClientError(msg.error.message, msg.error.code, msg.error.data, res.status)
    return msg.result
  }

  function initialize() {
    session ??= (async () => {
      const headers = await baseHeaders()
      headers.set("mcp-protocol-version", LEGACY_VERSION)
      const id = nextId++
      const res = await post(headers, {
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo },
      })
      const msg = await readResponse(res, id)
      if (msg.error)
        throw new McpClientError(msg.error.message, msg.error.code, msg.error.data, res.status)
      const version = (msg.result as { protocolVersion?: string }).protocolVersion ?? LEGACY_VERSION
      const sessionId = res.headers.get("mcp-session-id") ?? undefined
      const next = await baseHeaders()
      next.set("mcp-protocol-version", version)
      if (sessionId) next.set("mcp-session-id", sessionId)
      await post(next, { jsonrpc: "2.0", method: "notifications/initialized" })
      return { version, ...(sessionId ? { sessionId } : {}) }
    })().catch((err) => {
      session = undefined // let the next call retry the handshake
      throw err
    })
    return session
  }

  async function call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const headers = await baseHeaders()
    if (era === "modern") {
      headers.set("mcp-protocol-version", MODERN_VERSION)
      headers.set("mcp-method", method)
      // Tool names are ASCII by the spec's naming rule, so no Base64 sentinel is needed.
      if (typeof params.name === "string") headers.set("mcp-name", params.name)
      return request(
        method,
        {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MODERN_VERSION,
            "io.modelcontextprotocol/clientInfo": clientInfo,
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
        headers,
      )
    }
    const { version, sessionId } = await initialize()
    headers.set("mcp-protocol-version", version)
    if (sessionId) headers.set("mcp-session-id", sessionId)
    return request(method, params, headers)
  }

  return {
    async listTools() {
      const tools: McpToolInfo[] = []
      let cursor: string | undefined
      do {
        const page = (await call("tools/list", cursor ? { cursor } : {})) as {
          tools: McpToolInfo[]
          nextCursor?: string
        }
        tools.push(...page.tools)
        cursor = page.nextCursor
      } while (cursor)
      return tools
    },
    async callTool<T>(name: string, args: Record<string, unknown> = {}) {
      return (await call("tools/call", { name, arguments: args })) as McpCallResult<T>
    },
    async close() {
      const current = session
      session = undefined
      const sessionId = current ? (await current.catch(() => undefined))?.sessionId : undefined
      if (!sessionId) return
      const headers = await baseHeaders()
      headers.set("mcp-session-id", sessionId)
      await doFetch(new Request(url, { method: "DELETE", headers })).catch(() => {})
    },
  }
}
