/**
 * MCP resources and prompts, with the same contract as `defineTool`: typed
 * arguments, `scopes` checked against the caller's token, and one error
 * mapping (`mapError`, then the defaults, else "Internal error" plus
 * `onError`). `createMcpServer({ tools, resources, prompts })` registers them.
 *
 * One difference from tools: a failed resources/read or prompts/get is a
 * JSON-RPC error, not an `isError` result, because the protocol has no error
 * result for them. The message is `CODE: message`, and `data` carries the
 * Signet envelope (`success`, `error`, `code`, `details`). An unexpected error
 * is "Internal error" with no data, so its message never reaches the client.
 */

import {
  type GetPromptResult,
  isInputRequiredResult,
  type McpServer,
  ProtocolError,
  ProtocolErrorCode,
  type ReadResourceResult,
  ResourceNotFoundError,
  ResourceTemplate,
  type ServerContext,
} from "@modelcontextprotocol/server"
import type { Context } from "hono"
import type { z } from "zod"
import type { VerifiedToken } from "../oauth-rs/verify.js"
import {
  describeToolError,
  type ErrorMeta,
  isHttpException,
  isZodError,
  report,
  type ToolErrorOptions,
} from "./errors.js"
import type { ToolContext } from "./server.js"

type ObjectSchema = z.ZodType<Record<string, unknown>>

/** What a resource's `read` knows besides the URI. Like `ToolContext`, named for the resource. */
export type ResourceContext = Omit<ToolContext, "tool"> & { resource: string }
/** What a prompt's `render` knows besides its arguments. */
export type PromptContext = Omit<ToolContext, "tool"> & { prompt: string }

const RAW = Symbol.for("signet.mcp.rawResult")

/** Return this from `read` to send an exact `ReadResourceResult`. */
export function resourceResult(result: ReadResourceResult): ReadResourceResult {
  return Object.defineProperty({ ...result }, RAW, { value: true, enumerable: false })
}

/**
 * What `read` may return:
 *   null / undefined  the resource does not exist (the SDK's not-found error)
 *   a string          one text entry, `mimeType` or text/plain
 *   a Uint8Array      one blob entry, `mimeType` or application/octet-stream
 *   resourceResult()  sent as-is
 *   anything else     one JSON text entry, `mimeType` or application/json
 */
export type ResourceReturn = unknown

/** One concrete resource a template's `list` reports. */
export type ListedResource = {
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
}

type ResourceCommon = {
  /** Unique among resources; shown by clients. */
  name: string
  title?: string
  description?: string
  /** Advertised in the listing, and the default type of what `read` returns. */
  mimeType?: string
  /** Scopes the caller's token must carry to read it. With no token, refused. */
  scopes?: string[]
}

export type ResourceDefinition = ResourceCommon &
  (
    | {
        /** A fixed URI, e.g. `app://categories`. */
        uri: string
        template?: never
        list?: never
        read: (req: { uri: URL }, ctx: ResourceContext) => ResourceReturn | Promise<ResourceReturn>
      }
    | {
        /** An RFC 6570 URI template, e.g. `app://transactions/{id}`. */
        template: string
        uri?: never
        /** The concrete resources behind the template, for resources/list. Omit to list none. */
        list?: (ctx: ResourceContext) => ListedResource[] | Promise<ListedResource[]>
        /** `variables` are the template's values; a repeated one gives its first value. */
        read: (
          req: { uri: URL; variables: Record<string, string> },
          ctx: ResourceContext,
        ) => ResourceReturn | Promise<ResourceReturn>
      }
  )

/** A resource ready for `createMcpServer`. Produced by `defineResource`. */
export type McpResource = ResourceDefinition & { readonly kind: "resource" }

export function defineResource(def: ResourceDefinition): McpResource {
  return { ...def, kind: "resource" } as McpResource
}

/** A message in a prompt: plain text from the user, or a full message. */
export type PromptMessageInput =
  | string
  | { role: "user" | "assistant"; content: string }
  | GetPromptResult["messages"][number]

/**
 * What `render` may return: a string (one user message), a list of messages,
 * or a whole `GetPromptResult`.
 */
export type PromptReturn = string | PromptMessageInput[] | GetPromptResult

export type PromptDefinition<S extends ObjectSchema | undefined = undefined> = {
  name: string
  title?: string
  description?: string
  /**
   * A `z.object(...)` of the arguments. MCP sends prompt arguments as
   * strings, so its fields should be strings (optional ones may be omitted).
   */
  args?: S
  scopes?: string[]
  render: (
    args: S extends ObjectSchema ? z.output<S> : Record<never, never>,
    ctx: PromptContext,
  ) => PromptReturn | Promise<PromptReturn>
}

/** A prompt with its argument type erased, so prompts share one array type. */
export type McpPrompt = {
  readonly kind: "prompt"
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly args?: ObjectSchema
  readonly scopes?: readonly string[]
  readonly render: (args: never, ctx: PromptContext) => unknown
}

/** Define a prompt. `args` reach `render` parsed by the schema. */
export function definePrompt<S extends ObjectSchema | undefined = undefined>(
  def: PromptDefinition<S>,
): McpPrompt {
  return { ...def, kind: "prompt" } as unknown as McpPrompt
}

type Deps = {
  options: ToolErrorOptions
  context: { c?: Context; token?: VerifiedToken; confirmSupport: ToolContext["confirmSupport"] }
}

/**
 * The error a failed read or render becomes. A ProtocolError the handler threw
 * on purpose (not found, invalid params) passes through. Deliberate app errors
 * keep their code and message, with the envelope as `data`: -32603 for a 5xx
 * HTTPException, -32602 otherwise. Anything else is "Internal error".
 */
function protocolError(err: unknown, deps: Deps, meta: ErrorMeta): ProtocolError {
  if (ProtocolError.isInstance(err)) return err
  const info = deps.options.mapError?.(err) ?? describeToolError(err)
  if (!info) {
    report(deps.options, err, meta, deps.context.c)
    return new ProtocolError(ProtocolErrorCode.InternalError, "Internal error")
  }
  const status = isHttpException(err) ? err.status : isZodError(err) ? 400 : undefined
  const code =
    status !== undefined && status >= 500
      ? ProtocolErrorCode.InternalError
      : ProtocolErrorCode.InvalidParams
  return new ProtocolError(code, `${info.code}: ${info.message}`, {
    success: false,
    error: info.message,
    code: info.code,
    ...(info.details ? { details: info.details } : {}),
  })
}

function checkScopes(scopes: readonly string[] | undefined, token: VerifiedToken | undefined) {
  if (!scopes?.length) return
  const missing = scopes.filter((s) => !token?.scopes.includes(s))
  if (!missing.length) return
  const message = `This token is missing the scope: ${missing.join(" ")}. Request a new token with it and try again.`
  throw new ProtocolError(ProtocolErrorCode.InvalidRequest, `insufficient_scope: ${message}`, {
    success: false,
    error: message,
    code: "insufficient_scope", // RFC 6750, as oauth-rs requireScopes sends
  })
}

function baseContext(mcp: ServerContext, deps: Deps) {
  const { c, token, confirmSupport } = deps.context
  return {
    signal: mcp.mcpReq.signal,
    mcp,
    confirmSupport,
    ...(c ? { c } : {}),
    ...(token ? { token } : {}),
  }
}

function toContents(uri: URL, value: unknown, mimeType: string | undefined): ReadResourceResult {
  if (value !== null && typeof value === "object" && RAW in value)
    return value as unknown as ReadResourceResult
  if (typeof value === "string")
    return { contents: [{ uri: uri.href, mimeType: mimeType ?? "text/plain", text: value }] }
  if (value instanceof Uint8Array) {
    let bin = ""
    for (const b of value) bin += String.fromCharCode(b)
    return {
      contents: [
        { uri: uri.href, mimeType: mimeType ?? "application/octet-stream", blob: btoa(bin) },
      ],
    }
  }
  return {
    contents: [
      { uri: uri.href, mimeType: mimeType ?? "application/json", text: JSON.stringify(value) },
    ],
  }
}

type ErasedRegisterResource = (
  name: string,
  uriOrTemplate: string | ResourceTemplate,
  config: Record<string, unknown>,
  cb: (...args: unknown[]) => Promise<unknown>,
) => unknown

export function registerResources(
  server: McpServer,
  resources: readonly McpResource[],
  deps: Deps,
): void {
  const register = server.registerResource.bind(server) as unknown as ErasedRegisterResource
  for (const r of resources) {
    const meta: ErrorMeta = { tool: r.name, kind: "resource" }
    const ctxOf = (mcp: ServerContext): ResourceContext => ({
      resource: r.name,
      ...baseContext(mcp, deps),
    })
    const run = async (uri: URL, variables: Record<string, string>, mcp: ServerContext) => {
      checkScopes(r.scopes, deps.context.token)
      let value: unknown
      try {
        const read = r.read as (req: unknown, ctx: ResourceContext) => unknown
        value = await read(r.uri !== undefined ? { uri } : { uri, variables }, ctxOf(mcp))
      } catch (err) {
        throw protocolError(err, deps, meta)
      }
      if (value === null || value === undefined) throw new ResourceNotFoundError(uri.href)
      if (isInputRequiredResult(value)) return value
      return toContents(uri, value, r.mimeType)
    }
    const config = {
      ...(r.title ? { title: r.title } : {}),
      ...(r.description ? { description: r.description } : {}),
      ...(r.mimeType ? { mimeType: r.mimeType } : {}),
    }
    if (r.uri !== undefined) {
      register(r.name, r.uri, config, (uri, mcp) => run(uri as URL, {}, mcp as ServerContext))
      continue
    }
    const list = r.list
    const template = new ResourceTemplate(r.template, {
      list: list
        ? async (mcp: ServerContext) => {
            try {
              checkScopes(r.scopes, deps.context.token)
            } catch {
              return { resources: [] } // no scope: nothing to list, not an error
            }
            try {
              return { resources: await list(ctxOf(mcp)) }
            } catch (err) {
              throw protocolError(err, deps, meta)
            }
          }
        : undefined,
    })
    register(r.name, template, config, (uri, vars, mcp) => {
      const variables: Record<string, string> = {}
      for (const [k, v] of Object.entries((vars ?? {}) as Record<string, string | string[]>))
        variables[k] = Array.isArray(v) ? (v[0] ?? "") : v
      return run(uri as URL, variables, mcp as ServerContext)
    })
  }
}

function toPromptResult(value: unknown): unknown {
  if (isInputRequiredResult(value)) return value
  if (typeof value === "string")
    return { messages: [{ role: "user", content: { type: "text", text: value } }] }
  if (Array.isArray(value))
    return {
      messages: value.map((m) =>
        typeof m === "string"
          ? { role: "user", content: { type: "text", text: m } }
          : typeof m.content === "string"
            ? { role: m.role, content: { type: "text", text: m.content } }
            : m,
      ),
    }
  return value
}

type ErasedRegisterPrompt = (
  name: string,
  config: Record<string, unknown>,
  cb: (...args: unknown[]) => Promise<unknown>,
) => unknown

export function registerPrompts(
  server: McpServer,
  prompts: readonly McpPrompt[],
  deps: Deps,
): void {
  const register = server.registerPrompt.bind(server) as unknown as ErasedRegisterPrompt
  for (const p of prompts) {
    const meta: ErrorMeta = { tool: p.name, kind: "prompt" }
    const run = async (args: unknown, mcp: ServerContext) => {
      checkScopes(p.scopes, deps.context.token)
      try {
        const render = p.render as (args: unknown, ctx: PromptContext) => unknown
        return toPromptResult(await render(args, { prompt: p.name, ...baseContext(mcp, deps) }))
      } catch (err) {
        throw protocolError(err, deps, meta)
      }
    }
    register(
      p.name,
      {
        ...(p.title ? { title: p.title } : {}),
        ...(p.description ? { description: p.description } : {}),
        ...(p.args ? { argsSchema: p.args } : {}),
      },
      // Without an args schema the SDK calls back with `ctx` alone.
      p.args
        ? (args, mcp) => run(args, mcp as ServerContext)
        : (mcp) => run({}, mcp as ServerContext),
    )
  }
}
