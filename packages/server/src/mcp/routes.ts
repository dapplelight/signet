/**
 * Expose chosen Hono routes as MCP tools. Opt-in per route: only the routes
 * listed become tools, each with a name, a description and a zod input.
 *
 * A call runs the route in-process through `app.request`, with the MCP
 * request's own `authorization` and `cookie` headers, so the route's auth,
 * validation and error envelope apply exactly as for any other client — the
 * tool never gets more access than its caller has.
 */

import type { z } from "zod"
import { STATUS_CODES } from "../http/status-codes.js"
import { toolErrorResult } from "./errors.js"
import {
  type McpTool,
  type ToolAnnotations,
  type ToolContext,
  type ToolRateLimit,
  toolResult,
} from "./server.js"

type ObjectSchema = z.ZodType<Record<string, unknown>>

export type RouteTool = {
  /** The tool's name, e.g. `get_order`. */
  name: string
  /** What it does, for the model. */
  description: string
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  /** The route's path as registered, e.g. `/orders/:id`. */
  path: string
  /**
   * A `z.object(...)` of the arguments. Path parameters (`:id`) are filled
   * from it; the rest go in the query string for GET and DELETE, otherwise
   * in a JSON body.
   */
  input?: ObjectSchema
  title?: string
  /**
   * Merged over defaults from the method: GET is `readOnlyHint`, PUT is
   * `idempotentHint`, DELETE is `destructiveHint` and `idempotentHint`.
   */
  annotations?: ToolAnnotations
  scopes?: string[]
  rateLimit?: ToolRateLimit
  timeoutMs?: number
}

/** Anything with Hono's `app.request`. */
export type RequestableApp = {
  request(
    input: string,
    init?: RequestInit,
    env?: unknown,
    executionCtx?: unknown,
  ): Response | Promise<Response>
}

const FORWARDED = ["authorization", "cookie"]

const METHOD_HINTS: Record<RouteTool["method"], ToolAnnotations> = {
  GET: { readOnlyHint: true },
  POST: {},
  PATCH: {},
  PUT: { idempotentHint: true },
  DELETE: { destructiveHint: true, idempotentHint: true },
}

function toQueryValue(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v)
}

/**
 * Tools that call these routes on `app`, carrying the caller's auth. The
 * route's JSON is the tool's result; a non-2xx answer is an error result
 * with the envelope's `code` and `error` (or the HTTP status).
 */
export function routesAsTools(app: RequestableApp, routes: readonly RouteTool[]): McpTool[] {
  return routes.map((route) => {
    const { method, path, input, annotations, ...rest } = route
    const handler = async (args: Record<string, unknown>, ctx: ToolContext) => {
      const remaining = { ...args }
      // `:id`, `:id?` and `:id{[0-9]+}` all take the argument of that name.
      const url = path.replace(/:(\w+)(\{[^}]*\})?\??/g, (_, key: string) => {
        const value = remaining[key]
        delete remaining[key]
        return value === undefined ? "" : encodeURIComponent(String(value))
      })
      const headers = new Headers({ accept: "application/json" })
      for (const name of FORWARDED) {
        const value = ctx.c?.req.header(name)
        if (value) headers.set(name, value)
      }
      let target = url
      let body: string | undefined
      if (method === "GET" || method === "DELETE") {
        const qs = new URLSearchParams()
        for (const [k, v] of Object.entries(remaining))
          if (v !== undefined) qs.set(k, toQueryValue(v))
        const query = qs.toString()
        if (query) target += `?${query}`
      } else {
        headers.set("content-type", "application/json")
        body = JSON.stringify(remaining)
      }
      let executionCtx: unknown
      try {
        executionCtx = ctx.c?.executionCtx // Hono's getter throws outside Workers
      } catch {}
      const res = await app.request(
        target,
        { method, headers, signal: ctx.signal, ...(body !== undefined ? { body } : {}) },
        ctx.c?.env,
        executionCtx,
      )
      const text = await res.text()
      let data: unknown = text
      try {
        data = text ? JSON.parse(text) : null
      } catch {} // not JSON: the text as-is
      if (res.ok) return data
      const envelope = (data && typeof data === "object" ? data : {}) as {
        code?: unknown
        error?: unknown
        details?: { formErrors: string[]; fieldErrors: Record<string, string[]> }
      }
      return toolResult(
        toolErrorResult({
          code:
            typeof envelope.code === "string"
              ? envelope.code
              : (STATUS_CODES[res.status] ?? "HTTP_ERROR"),
          message:
            typeof envelope.error === "string"
              ? envelope.error
              : typeof data === "string" && data
                ? data
                : `${method} ${path} answered ${res.status}`,
          ...(envelope.details ? { details: envelope.details } : {}),
        }),
      )
    }
    return {
      ...rest,
      annotations: { ...METHOD_HINTS[method], ...annotations },
      ...(input ? { input } : {}),
      handler: handler as McpTool["handler"],
    } satisfies McpTool
  })
}
