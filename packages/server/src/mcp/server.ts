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
  fromJsonSchema,
  type InputRequiredResult,
  isInputRequiredResult,
  type JsonSchemaType,
  McpServer,
  type ServerContext,
  type StandardSchemaV1,
} from "@modelcontextprotocol/server"
import type { Context } from "hono"
import type { z } from "zod"
import { memoryStore, type RateLimitStore } from "../middleware/rate-limit.js"
import type { VerifiedToken } from "../oauth-rs/verify.js"
import {
  callHook,
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
  /** Calls allowed per principal per window, counted in `createMcpServer`'s `rateLimit.store`. */
  rateLimit?: ToolRateLimit
  /** Stop waiting after this many ms: the call answers `TIMEOUT` and `ctx.signal` aborts. Overrides `createMcpServer`'s `timeoutMs`. */
  timeoutMs?: number
  handler: (input: z.output<S>, ctx: ToolContext) => ToolReturn<O>
}

export type ToolRateLimit = { max: number; windowSeconds: number }

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
  readonly rateLimit?: ToolRateLimit
  readonly timeoutMs?: number
  readonly handler: (input: never, ctx: ToolContext) => unknown
}

/**
 * A tool as a plain object, for packages that should not depend on this one
 * (`agentTools(...)` from a data package, a hand-written tool): `inputSchema`
 * is a JSON Schema object or any Standard Schema (a zod object), and `run`
 * gets the validated input. `createMcpServer` takes these beside `defineTool`s.
 * A JSON Schema is validated by the SDK's own validator before `run`, so
 * `run`'s input is only as typed as the schema it declares.
 */
export type PlainTool = {
  readonly name: string
  readonly description: string
  readonly title?: string
  readonly annotations?: ToolAnnotations
  readonly inputSchema?: JsonSchemaType | StandardSchemaV1
  readonly outputSchema?: JsonSchemaType | StandardSchemaV1
  readonly scopes?: readonly string[]
  readonly listed?: boolean
  readonly rateLimit?: ToolRateLimit
  readonly timeoutMs?: number
  // Method syntax on purpose: any `run(input: X, ctx)` is assignable, whatever X is.
  run(input: never, ctx: ToolContext): unknown
}

/** Either tool shape `createMcpServer` accepts. */
export type AnyTool = McpTool | PlainTool

function asSchema(s: JsonSchemaType | StandardSchemaV1 | undefined): ObjectSchema | undefined {
  if (s === undefined) return undefined
  return ("~standard" in s ? s : fromJsonSchema(s as JsonSchemaType)) as unknown as ObjectSchema
}

/** A `PlainTool` as an `McpTool`; an `McpTool` unchanged. */
export function toMcpTool(tool: AnyTool): McpTool {
  if (!("run" in tool)) return tool
  const { inputSchema, outputSchema, run: _run, ...rest } = tool
  const input = asSchema(inputSchema)
  const output = asSchema(outputSchema)
  return {
    ...rest,
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    handler: ((i: never, c: ToolContext) => tool.run(i, c)) as McpTool["handler"],
  }
}

/** What a per-request list resolver, `principal` and `rateLimit.key` know: the caller. */
export type McpCaller = { c?: Context; token?: VerifiedToken }

/** A list fixed at module scope, or resolved per request from the caller. */
export type Resolvable<T> =
  | readonly T[]
  | ((caller: McpCaller) => readonly T[] | Promise<readonly T[]>)

/** One finished tools/call, for `onToolCall`. */
export type ToolCallEvent = {
  tool: string
  /** `principal(...)` of the caller: by default the token's `sub`. */
  principal?: string
  /**
   * Who is acting, from the token: the OAuth client (`client_id`, else
   * `azp`) and the RFC 8693 `act` claim when the token is delegated.
   */
  actor?: { clientId?: string; act?: unknown }
  durationMs: number
  /** False for an error result of any kind: thrown, scope, rate limit, timeout. */
  ok: boolean
  /** The error result's code (`RATE_LIMITED`, `TIMEOUT`, `insufficient_scope`, an app code). */
  code?: string
  /** What the handler threw, if it threw. */
  error?: unknown
}

// ponytail: one in-memory store per isolate for tools with `rateLimit` and no
// configured store; pass a durable `rateLimit.store` where the limit matters.
let sharedStore: RateLimitStore | undefined

class ToolTimeout extends Error {}

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
  /** `defineTool`s and plain tool objects (`PlainTool`), in list order. */
  tools: readonly AnyTool[]
  /**
   * Advertise `listChanged: true` for tools (and resources and prompts, when
   * declared): set when the lists can change while a client is connected.
   * `resolveMcpServer` sets it for any list given as a function. Default false.
   */
  listChanged?: boolean
  /**
   * Who is calling, as one string: the rate-limit key and `onToolCall`'s
   * `principal`. Default: the token's `sub`.
   */
  principal?: (caller: McpCaller) => string | undefined
  /**
   * Per-tool rate limiting, per principal. `store` is any `RateLimitStore`
   * (`memoryStore()`, a Durable Object, Upstash…); default a per-isolate memory
   * store. `max` / `windowSeconds` apply to every tool without its own
   * `rateLimit`. A caller with no principal shares the "anonymous" bucket.
   * A store that throws lets the call through, like `rateLimit` middleware.
   */
  rateLimit?: { store?: RateLimitStore; max?: number; windowSeconds?: number }
  /** Default per-call timeout in ms for every tool; a tool's `timeoutMs` overrides it. */
  timeoutMs?: number
  /**
   * Hear about every finished tools/call (name, principal, actor, duration,
   * ok or error code) for logs, analytics or an audit trail. A returned
   * promise goes to `waitUntil`; a throw is ignored.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` lets a callback that returns nothing type-check
  onToolCall?: (event: ToolCallEvent) => void | Promise<unknown>
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
  const tools = options.tools.map(toMcpTool)
  const unlisted = new Set(tools.filter((t) => t.listed === false).map((t) => t.name))
  // A fixed tool list says so: a client then opens no `subscriptions/listen`
  // stream (2026-07-28) to wait for a change that cannot come, and a Worker
  // is not billed for holding one. Dynamic lists (`listChanged`) say the
  // opposite, so a client listens and re-lists on `list_changed`.
  // Resources and prompts are each declared only when there are some.
  const listChanged = options.listChanged ?? false
  const toolsCapability = {
    tools: { listChanged },
    ...(options.resources?.length ? { resources: { listChanged } } : {}),
    ...(options.prompts?.length ? { prompts: { listChanged } } : {}),
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
  const caller: McpCaller = { ...(c ? { c } : {}), ...(token ? { token } : {}) }
  const principal = options.principal ? options.principal(caller) : token?.claims.sub
  const clientId = token?.claims.client_id ?? token?.claims.azp
  const act = token?.claims.act
  const actor =
    clientId !== undefined || act !== undefined
      ? {
          ...(typeof clientId === "string" ? { clientId } : {}),
          ...(act !== undefined ? { act } : {}),
        }
      : undefined

  for (const tool of tools) {
    const limit =
      tool.rateLimit ??
      (options.rateLimit?.max !== undefined
        ? { max: options.rateLimit.max, windowSeconds: options.rateLimit.windowSeconds ?? 60 }
        : undefined)
    const timeoutMs = tool.timeoutMs ?? options.timeoutMs

    // Wraps `call` for `onToolCall`: every outcome, error results included.
    const run = async (input: unknown, mcp: ServerContext): Promise<CallToolResult> => {
      const started = Date.now()
      const thrown: { err?: unknown } = {}
      const result = await call(input, mcp, thrown)
      if (options.onToolCall) {
        const code = result.isError ? result.structuredContent?.code : undefined
        const event: ToolCallEvent = {
          tool: tool.name,
          ...(principal !== undefined ? { principal } : {}),
          ...(actor ? { actor } : {}),
          durationMs: Date.now() - started,
          ok: result.isError !== true,
          ...(typeof code === "string" ? { code } : {}),
          ...("err" in thrown ? { error: thrown.err } : {}),
        }
        const hook = options.onToolCall
        callHook(() => hook(event), c)
      }
      return result
    }

    const call = async (
      input: unknown,
      mcp: ServerContext,
      thrown: { err?: unknown },
    ): Promise<CallToolResult> => {
      const timeout = timeoutMs ? new AbortController() : undefined
      const ctx: ToolContext = {
        tool: tool.name,
        signal: timeout ? AbortSignal.any([mcp.mcpReq.signal, timeout.signal]) : mcp.mcpReq.signal,
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
      if (limit) {
        sharedStore ??= memoryStore()
        const store = options.rateLimit?.store ?? sharedStore
        let hit: Awaited<ReturnType<RateLimitStore["hit"]>> | undefined
        try {
          hit = await store.hit(
            `mcp:${options.name}:${tool.name}`,
            principal ?? "anonymous",
            limit.max,
            limit.windowSeconds,
          )
        } catch {} // fail open, as the rateLimit middleware does by default
        if (hit && !hit.ok) {
          return toolErrorResult({
            code: "RATE_LIMITED",
            message: `Too many calls to ${tool.name}. Try again in ${hit.resetSeconds} seconds.`,
          })
        }
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const handler = tool.handler as (input: unknown, ctx: ToolContext) => unknown
        const work = Promise.resolve().then(() => handler(input, ctx))
        if (!timeout) return toResult(await work, tool.output !== undefined)
        work.catch(() => {}) // after a timeout nobody awaits it; a late rejection is not unhandled
        const expired = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timeout.abort()
            reject(new ToolTimeout())
          }, timeoutMs)
        })
        return toResult(await Promise.race([work, expired]), tool.output !== undefined)
      } catch (err) {
        if (err instanceof ToolTimeout) {
          return toolErrorResult({
            code: "TIMEOUT",
            message: `${tool.name} took longer than ${timeoutMs} ms and was stopped. Try again, or with less work.`,
          })
        }
        thrown.err = err
        let custom: CallToolResult | undefined
        try {
          custom = options.errorResult?.(err, { tool: tool.name })
        } catch {} // a broken errorResult falls back to the default result
        const info = options.mapError?.(err) ?? describeToolError(err)
        if (!info) report(options, err, { tool: tool.name }, c)
        if (custom) return custom
        return toolErrorResult(info ?? INTERNAL_ERROR)
      } finally {
        clearTimeout(timer)
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

export type ResolveMcpServerOptions = Omit<
  CreateMcpServerOptions,
  "tools" | "resources" | "prompts"
> & {
  /** An array, or `(caller) => tools` resolved per request: per-user tool lists. */
  tools: Resolvable<AnyTool>
  resources?: Resolvable<McpResource>
  prompts?: Resolvable<McpPrompt>
}

/**
 * `createMcpServer`, with lists that may be functions of the caller (its
 * Hono context and verified token), resolved for this request. Any function
 * list turns on `listChanged`. `mcpHandler` / `mountMcp` call this; use it
 * directly as a `serveStdio` factory (which accepts a promise).
 */
export async function resolveMcpServer(options: ResolveMcpServerOptions): Promise<McpServer> {
  const { c, token } = options.context ?? {}
  const caller: McpCaller = { ...(c ? { c } : {}), ...(token ? { token } : {}) }
  const resolve = <T>(list: Resolvable<T> | undefined) =>
    typeof list === "function" ? list(caller) : list
  const [tools, resources, prompts] = await Promise.all([
    resolve(options.tools),
    resolve(options.resources),
    resolve(options.prompts),
  ])
  const dynamic = [options.tools, options.resources, options.prompts].some(
    (l) => typeof l === "function",
  )
  const { tools: _t, resources: _r, prompts: _p, ...rest } = options
  return createMcpServer({
    ...rest,
    tools: tools ?? [],
    ...(resources ? { resources } : {}),
    ...(prompts ? { prompts } : {}),
    listChanged: options.listChanged ?? dynamic,
  })
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
