/**
 * Typed MCP tools on the official SDK v2 McpServer (`@modelcontextprotocol/server`).
 * Requires `@modelcontextprotocol/server` and `zod` (>= 4.2) as optional peers.
 * Not `hono`: this entry imports hono for types only, and recognises an
 * HTTPException by shape, so a stdio-only server loads without it.
 * `/mcp/hono` needs hono.
 *
 * Why not call `server.registerTool` directly: in SDK v1 it was generic over
 * the zod shape through v3/v4 compat types, and with ~80 tools app-a's
 * `tsc --noEmit` ran out of memory instantiating it — so app-a typed its
 * server as a local interface with `handler: (args: any)` and put
 * `@ts-nocheck` on the wiring, losing the typed input it had a schema for.
 * v2's `registerTool` is generic over Standard Schema instead, and is cheap
 * again (see the README), but the point stands: `defineTool` gives one array
 * type for tools with different schemas, and its only generic is `z.output<S>`
 * of one schema, in the app's own zod. `createMcpServer` registers through an
 * erased signature, so the SDK's generic is never instantiated and tsc does
 * the same small amount of work per tool however the SDK's types change.
 */

import {
  type ClientCapabilities,
  createRequestStateCodec,
  type InputRequiredResult,
  isInputRequiredResult,
  McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server"
import type { Context } from "hono"
import type { z } from "zod"
import type { VerifiedToken } from "../oauth-rs/verify.js"
import {
  describeToolError,
  type ErrorMeta,
  INTERNAL_ERROR,
  report,
  type ToolErrorInfo,
  type ToolErrorOptions,
  toolErrorResult,
} from "./errors.js"
import type { ConfirmPayload } from "./interaction.js"
import {
  type McpPrompt,
  type McpResource,
  registerPrompts,
  registerResources,
} from "./primitives.js"

export {
  describeToolError,
  type ErrorMeta,
  INTERNAL_ERROR,
  type ToolErrorInfo,
  type ToolErrorOptions,
  toolErrorResult,
}

/** Hints for the client (read-only, destructive…). Mirrors the MCP spec's `ToolAnnotations`. */
export type ToolAnnotations = {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

/** What a handler knows about the call besides its input. */
export type ToolContext = {
  /** The tool's name. */
  tool: string
  /** The Hono context, when served through `mcpHandler` / `mountMcp`. */
  c?: Context
  /** Claims from oauth-rs `requireToken`, when it ran. The raw token is never here. */
  token?: VerifiedToken
  /** Aborted when the client cancels the call. */
  signal: AbortSignal
  /**
   * The SDK's own handler context, for what Signet does not wrap: the
   * 2026-07-28 per-request envelope (`mcp.mcpReq.envelope`), multi-round-trip
   * `inputResponses` / `requestState()`, progress via `mcpReq.notify`.
   */
  mcp: ServerContext
  /**
   * Plumbing for `confirm()` (`./interaction.js`) — read that, not this
   * directly. Always present; `mint` is set only when `createMcpServer` was
   * given a `confirm` signing key.
   */
  confirmSupport: {
    getClientCapabilities: () => ClientCapabilities | undefined
    mint?: (payload: ConfirmPayload) => Promise<string>
  }
}

/** An MCP `CallToolResult`, returned as-is. Build one with `toolResult`. */
export type CallToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource_link"; uri: string; name: string; mimeType?: string }
  >
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

const RAW = Symbol.for("signet.mcp.rawResult")

/**
 * Return this from a handler to send an exact `CallToolResult`. Anything else a
 * handler returns is sent as one text block: a string as-is, a value as JSON —
 * except the SDK's `inputRequired(...)`, which passes through untouched. A tool
 * with an `output` schema also sends the value as `structuredContent`.
 */
export function toolResult(result: CallToolResult): CallToolResult {
  return Object.defineProperty({ ...result }, RAW, { value: true, enumerable: false })
}

type ObjectSchema = z.ZodType<Record<string, unknown>>

/**
 * What a handler may return. With an `output` schema: `z.input` of it (sent as
 * `structuredContent` plus its JSON as text), an explicit `toolResult(...)`, or
 * the SDK's `inputRequired(...)`, possibly as a promise. Without one, anything.
 * Shallow on purpose, like the input side: one `z.input<O>` per tool.
 */
export type ToolReturn<O extends ObjectSchema | undefined> = O extends ObjectSchema
  ? ToolOutput<O> | Promise<ToolOutput<O>>
  : unknown
type ToolOutput<O extends ObjectSchema> = z.input<O> | CallToolResult | InputRequiredResult

export type ToolDefinition<
  S extends ObjectSchema,
  O extends ObjectSchema | undefined = undefined,
> = {
  name: string
  description: string
  title?: string
  annotations?: ToolAnnotations
  /** A `z.object(...)`. Omit for a tool that takes no arguments. */
  input?: S
  /**
   * A `z.object(...)` describing the result, advertised as `outputSchema`. The
   * handler then returns that shape; it is sent as `structuredContent` and as
   * JSON text, and the SDK validates it against this schema before sending.
   */
  output?: O
  /**
   * Scopes the caller's token must carry. Checked against `ctx.token` from
   * oauth-rs `requireToken`; with no token the call is refused, not allowed.
   */
  scopes?: string[]
  /**
   * `false` keeps the tool callable (tools/call, scopes and error mapping as
   * usual) but leaves it out of tools/list: for deprecated aliases old clients
   * still call, which new clients and the model should not see. Default true.
   */
  listed?: boolean
  handler: (input: z.output<S>, ctx: ToolContext) => ToolReturn<O>
}

/**
 * A tool with its input type erased, so tools with different schemas share
 * one array type. Produced only by `defineTool`, which checked the handler
 * against the schema.
 */
export type McpTool = {
  readonly name: string
  readonly description: string
  readonly title?: string
  readonly annotations?: ToolAnnotations
  readonly input?: ObjectSchema
  readonly output?: ObjectSchema
  readonly scopes?: readonly string[]
  readonly listed?: boolean
  readonly handler: (input: never, ctx: ToolContext) => unknown
}

/**
 * Define a tool. The handler's `input` is `z.output` of the schema: parsed,
 * defaults applied, transforms run — the SDK validates it before the handler
 * runs, so bad input never reaches it.
 */
export function defineTool<
  S extends ObjectSchema = ObjectSchema,
  O extends ObjectSchema | undefined = undefined,
>(def: ToolDefinition<S, O>): McpTool {
  return def as McpTool
}

function toResult(value: unknown, structured: boolean): CallToolResult {
  if (value !== null && typeof value === "object" && RAW in value)
    return value as unknown as CallToolResult
  // `return inputRequired(...)`: a multi-round-trip request, for the SDK to serve.
  if (isInputRequiredResult(value)) return value as unknown as CallToolResult
  const text = typeof value === "string" ? value : (JSON.stringify(value ?? null) ?? "null")
  // With an output schema the value is the structured result; the JSON text
  // alongside is the spec's back-compat for clients that read content only.
  // The SDK validates it against the schema, and refuses one that is missing.
  if (structured)
    return {
      content: [{ type: "text", text }],
      structuredContent: value as Record<string, unknown>,
    }
  return { content: [{ type: "text", text }] }
}

export type CreateMcpServerOptions = ToolErrorOptions & {
  name: string
  version: string
  tools: readonly McpTool[]
  /** Resources (`defineResource`), with the same scopes and error mapping as tools. */
  resources?: readonly McpResource[]
  /** Prompts (`definePrompt`), with the same scopes and error mapping as tools. */
  prompts?: readonly McpPrompt[]
  /** Sent to the client (initialize, or `server/discover`): how to use these tools together. */
  instructions?: string
  /** Per-request context for handlers. `mcpHandler` fills this in. */
  context?: { c?: Context; token?: VerifiedToken }
  /**
   * Enables `confirm()` (`./interaction.js`) to sign its multi-round-trip
   * `requestState`, so an accepted confirmation is bound to the exact tool
   * call it was asked for. Without this, `confirm()` still works but cannot
   * detect a client that swaps arguments between the ask and the retry —
   * see the README's Confirm section.
   */
  confirm?: {
    /** HMAC secret, >= 32 bytes. The same key every server instance in a
     * flow's rounds must share (so a random per-process key only works when
     * one process serves every round). */
    key: Uint8Array | string
    /** How long a pending confirmation stays answerable, in seconds. Default 600. */
    ttlSeconds?: number
  }
}

type ErasedCallback = (...args: unknown[]) => Promise<CallToolResult>
type ErasedRegister = (
  name: string,
  config: {
    title?: string
    description?: string
    inputSchema?: unknown
    outputSchema?: unknown
    annotations?: ToolAnnotations
  },
  cb: ErasedCallback,
) => unknown

/**
 * Build an McpServer with these tools registered. Cheap enough to call per
 * request, which is what `mcpHandler` does; also the factory body for
 * `serveStdio(() => createMcpServer(...))`.
 */
export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const unlisted = new Set(options.tools.filter((t) => t.listed === false).map((t) => t.name))
  // The tool list is fixed for the server's life, so say so: a client then
  // opens no `subscriptions/listen` stream (2026-07-28) to wait for a change
  // that cannot come, and a Worker is not billed for holding one.
  // Resources and prompts are fixed too; each is declared only when there are some.
  const toolsCapability = {
    tools: { listChanged: false },
    ...(options.resources?.length ? { resources: { listChanged: false } } : {}),
    ...(options.prompts?.length ? { prompts: { listChanged: false } } : {}),
  }
  // Built fresh per createMcpServer call (this function is "cheap enough to
  // call per request" already), so nothing here is shared across servers or
  // requests — a fix for confirm() reading capabilities or requestState from
  // anywhere but THIS request's own server instance.
  const confirmCodec = options.confirm
    ? createRequestStateCodec<ConfirmPayload>({
        key: options.confirm.key,
        ...(options.confirm.ttlSeconds !== undefined
          ? { ttlSeconds: options.confirm.ttlSeconds }
          : {}),
      })
    : undefined
  const server = new McpServer(
    { name: options.name, version: options.version },
    {
      // With unlisted tools the capability is declared below instead, so the
      // SDK installs its tools/list handler on the first registerTool, where
      // `hideUnlisted` can see it — not in this constructor.
      ...(unlisted.size ? {} : { capabilities: toolsCapability }),
      ...(options.instructions ? { instructions: options.instructions } : {}),
      ...(confirmCodec ? { requestState: { verify: confirmCodec.verify } } : {}),
    },
  )
  let restore: (() => void) | undefined
  if (unlisted.size) {
    server.server.registerCapabilities(toolsCapability)
    restore = hideUnlisted(server, unlisted)
  }
  // The erased signature is the point — see the module comment.
  const register = server.registerTool.bind(server) as unknown as ErasedRegister
  const { c, token } = options.context ?? {}

  for (const tool of options.tools) {
    const run = async (input: unknown, mcp: ServerContext): Promise<CallToolResult> => {
      const ctx: ToolContext = {
        tool: tool.name,
        signal: mcp.mcpReq.signal,
        mcp,
        confirmSupport: {
          getClientCapabilities: () => server.server.getClientCapabilities(),
          ...(confirmCodec
            ? { mint: (payload: ConfirmPayload) => confirmCodec.mint(payload, mcp) }
            : {}),
        },
        ...(c ? { c } : {}),
        ...(token ? { token } : {}),
      }
      if (tool.scopes?.length) {
        const missing = tool.scopes.filter((s) => !token?.scopes.includes(s))
        if (missing.length) {
          return toolErrorResult({
            code: "insufficient_scope", // RFC 6750, as oauth-rs requireScopes sends
            message: `This token is missing the scope: ${missing.join(" ")}. Request a new token with it and try again.`,
          })
        }
      }
      try {
        const handler = tool.handler as (input: unknown, ctx: ToolContext) => unknown
        return toResult(await handler(input, ctx), tool.output !== undefined)
      } catch (err) {
        let custom: CallToolResult | undefined
        try {
          custom = options.errorResult?.(err, { tool: tool.name })
        } catch {} // a broken errorResult falls back to the default result
        const info = options.mapError?.(err) ?? describeToolError(err)
        if (!info) report(options, err, { tool: tool.name }, c)
        if (custom) return custom
        return toolErrorResult(info ?? INTERNAL_ERROR)
      }
    }

    register(
      tool.name,
      {
        description: tool.description,
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
        ...(tool.input ? { inputSchema: tool.input } : {}),
        ...(tool.output ? { outputSchema: tool.output } : {}),
      },
      // Without an input schema the SDK calls back with `ctx` alone.
      tool.input
        ? (input, mcp) => run(input, mcp as ServerContext)
        : (mcp) => run({}, mcp as ServerContext),
    )
    restore?.() // the SDK installed its handlers on the first registerTool
    restore = undefined
  }
  const confirmSupport: ToolContext["confirmSupport"] = {
    getClientCapabilities: () => server.server.getClientCapabilities(),
    ...(confirmCodec ? { mint: (payload: ConfirmPayload) => confirmCodec.mint(payload) } : {}),
  }
  const deps = {
    options,
    context: { confirmSupport, ...(c ? { c } : {}), ...(token ? { token } : {}) },
  }
  if (options.resources?.length) registerResources(server, options.resources, deps)
  if (options.prompts?.length) registerPrompts(server, options.prompts, deps)
  return server
}

type ListHandler = (request: unknown, ctx: unknown) => unknown
type SetRequestHandler = (method: string, handler: ListHandler) => void

/**
 * Leave `unlisted` tools out of tools/list while they stay callable.
 *
 * Not `RegisteredTool.disable()`: that is the SDK's public hide switch, but a
 * disabled tool is refused by tools/call ("Tool x disabled") and skipped by
 * the 2026-07-28 Mcp-Param header check. Not the protected
 * `_getRequestHandler("tools/list")` either. McpServer installs its list
 * handler through the public `server.server.setRequestHandler`; for the one
 * registerTool that triggers it, this catches the handler on its way in and
 * installs a wrapper instead, through that same public method. The wrapper
 * filters the SDK's own result, so each listed tool's JSON Schema, the order,
 * and everything the SDK adds on top (request validation, the configured cache
 * hint, and at encode time `resultType` / `ttlMs` / `cacheScope` on 2026-07-28)
 * are unchanged. The returned function removes the interception, and throws if
 * the SDK never installed a tools/list handler that way, so an SDK change
 * breaks createMcpServer loudly, not by listing every alias again.
 */
function hideUnlisted(server: McpServer, unlisted: ReadonlySet<string>): () => void {
  const inner = server.server as unknown as { setRequestHandler: SetRequestHandler }
  const original = inner.setRequestHandler.bind(inner)
  let caught = false
  inner.setRequestHandler = (method, handler) => {
    if (method !== "tools/list" || typeof handler !== "function") return original(method, handler)
    caught = true
    original(method, async (request, ctx) => {
      const result = (await handler(request, ctx)) as { tools: Array<{ name: string }> }
      return { ...result, tools: result.tools.filter((t) => !unlisted.has(t.name)) }
    })
  }
  return () => {
    delete (inner as Partial<typeof inner>).setRequestHandler // back to the prototype's
    if (!caught)
      throw new Error(
        "signet mcp: could not hide unlisted tools; @modelcontextprotocol/server no longer installs tools/list through setRequestHandler",
      )
  }
}
