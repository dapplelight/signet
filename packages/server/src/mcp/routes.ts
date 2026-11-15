/**
 * Hono routes as MCP tools.
 *
 *   appTools(app)            every route validated with `zValidator` becomes a
 *                            tool: name from the method and path, input from
 *                            the validators, `asTool(...)` / `asTool(false)`
 *                            per route to name, describe, add or leave out
 *   routesAsTools(app, [...]) the routes listed, each spelled out
 *
 * A call runs the route in-process through `app.request`, with the MCP
 * request's own `authorization` and `cookie` headers, so the route's auth,
 * validation and error envelope apply exactly as for any other client — the
 * tool never gets more access than its caller has.
 */

import type { MiddlewareHandler } from "hono"
import type { z } from "zod"
import { STATUS_CODES } from "../http/status-codes.js"
import { VALIDATES } from "../http/validate.js"
import { toolErrorResult } from "./errors.js"
import { requireApproval } from "./interaction.js"
import {
  type McpCaller,
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
  /** Who gets the tool (role, plan); see `ToolDefinition.visible`. */
  visible?: (caller: McpCaller) => boolean | Promise<boolean>
  /**
   * Ask the person through `requireApproval` before calling the route. Default
   * false here; `appTools` turns it on for every method but GET.
   */
  approval?: boolean
  /** Argument names sent in the query string whatever the method (a POST's `zValidator("query", ...)`). */
  query?: readonly string[]
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

// Auth, plus the client address the app's rate limiter already trusted on the
// MCP request itself, so route tools share the caller's bucket, not one for all.
const FORWARDED = ["authorization", "cookie", "cf-connecting-ip", "x-forwarded-for"]

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
    const { method, path, input, annotations, approval, query = [], ...rest } = route
    const handler = async (args: Record<string, unknown>, ctx: ToolContext) => {
      const remaining = { ...args }
      // `:id`, `:id?` and `:id{[0-9]+}` all take the argument of that name.
      let badParam: string | undefined
      const url = path.replace(/:(\w+)(\{[^}]*\})?\??/g, (_, key: string) => {
        const value = remaining[key]
        delete remaining[key]
        if (value === undefined) return ""
        const s = String(value)
        // encodeURIComponent leaves "." and ".." alone, and URL parsing then
        // collapses them (so does "%2e%2e"): the call would hit another route.
        if (s === "." || s === "..") badParam = key
        return encodeURIComponent(s)
      })
      if (badParam)
        return toolResult(
          toolErrorResult({
            code: "BAD_REQUEST",
            message: `Invalid value for "${badParam}"`,
          }),
        )
      const headers = new Headers({ accept: "application/json" })
      for (const name of FORWARDED) {
        const value = ctx.c?.req.header(name)
        if (value) headers.set(name, value)
      }
      if (approval) {
        const gate = await requireApproval(ctx, {
          summary: `${rest.title ?? rest.name}: ${method} ${url}`,
          ...(Object.keys(remaining).length ? { details: remaining } : {}),
          args,
        })
        if (gate) return gate
      }
      const inQuery = method === "GET" || method === "DELETE"
      const qs = new URLSearchParams()
      const json: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(remaining)) {
        if (v === undefined) continue
        if (inQuery || query.includes(k)) qs.set(k, toQueryValue(v))
        else json[k] = v
      }
      let target = url
      const search = qs.toString()
      if (search) target += `?${search}`
      let body: string | undefined
      if (!inQuery) {
        headers.set("content-type", "application/json")
        body = JSON.stringify(json)
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

/** `asTool(...)`'s options: everything `RouteTool` has but what the route itself says. */
export type AsToolOptions = Partial<
  Pick<
    RouteTool,
    | "name"
    | "description"
    | "title"
    | "input"
    | "annotations"
    | "scopes"
    | "rateLimit"
    | "timeoutMs"
    | "visible"
    | "approval"
  >
>

const TOOL = Symbol.for("signet.mcp.asTool")

/**
 * Per-route say over `appTools`, as a no-op middleware before the handler:
 *
 *   app.post("/notes", asTool({ description: "Save a note" }), zValidator("json", Note), save)
 *   app.post("/webhook", asTool(false), zValidator("json", Event), hook)   // never a tool
 *   app.get("/me", asTool({ description: "Who am I" }), me)                // a tool with no validator
 */
export function asTool(options: AsToolOptions | false): MiddlewareHandler {
  const mw: MiddlewareHandler = (_c, next) => next()
  Object.defineProperty(mw, TOOL, { value: options })
  return mw
}

export type AppToolsOptions = {
  /** Only routes with `asTool(...)` become tools; a bare `zValidator` is not enough. Default false. */
  optIn?: boolean
  /** Ask before every write (any method but GET). Default true; `asTool({ approval })` overrides per route. */
  approval?: boolean
}

/** The routes `appTools` reads: Hono's `app.routes`. */
export type RoutableApp = RequestableApp & {
  routes: ReadonlyArray<{ method: string; path: string; handler: unknown }>
}

type Validates = { target: string; schema: z.ZodType }
type ZodObjectLike = z.ZodType<Record<string, unknown>> & {
  shape: Record<string, unknown>
  extend(shape: Record<string, unknown>): ZodObjectLike
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"])
const isObject = (s: z.ZodType): s is ZodObjectLike =>
  typeof (s as { extend?: unknown }).extend === "function" &&
  typeof (s as { shape?: unknown }).shape === "object"

/** `GET /api/notes/:id` → `get_api_notes_by_id`. */
export function routeToolName(method: string, path: string): string {
  const parts = path
    .split("/")
    .filter((p) => p && p !== "*")
    .map((p) => (p.startsWith(":") ? `by_${p.slice(1).replace(/\{.*$|\?$/g, "")}` : p))
    .map((p) => p.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, ""))
  return [method.toLowerCase(), ...(parts.length ? parts : ["root"])].join("_").slice(0, 64)
}

/**
 * Every route on `app` validated with `zValidator` (or marked `asTool(...)`)
 * as a tool, through `routesAsTools`: the caller's auth goes with each call,
 * so a tool runs as the signed-in user and sees only their data. Call it
 * after the routes are registered.
 *
 *   name         `asTool({ name })`, else from the method and path (`routeToolName`)
 *   description  `asTool({ description })`, else the schema's `.describe(...)`, else "METHOD /path"
 *   input        the json, query and param validators' `z.object`s, merged
 *   read/write   GET is read-only; every other method is a write and asks
 *                first through `requireApproval` (`approval: false` to turn off)
 *
 * A route is skipped when its validators are not all `z.object`s on json,
 * query or param (a form, header or cookie validator), or a path parameter
 * has no schema: give it `asTool({ input })`, or spell it out in `routesAsTools`.
 */
export function appTools(app: RoutableApp, options: AppToolsOptions = {}): McpTool[] {
  const groups = new Map<string, { method: string; path: string; handlers: unknown[] }>()
  for (const r of app.routes) {
    if (!METHODS.has(r.method)) continue // `app.use` is ALL
    const key = `${r.method} ${r.path}`
    const g = groups.get(key) ?? { method: r.method, path: r.path, handlers: [] }
    let h = r.handler as { __COMPOSED_HANDLER?: unknown } | undefined
    // `app.route(...)` with its own onError wraps each handler; Hono keeps the original here.
    while (h?.__COMPOSED_HANDLER) h = h.__COMPOSED_HANDLER as typeof h
    g.handlers.push(h)
    groups.set(key, g)
  }
  const routes: RouteTool[] = []
  for (const { method, path, handlers } of groups.values()) {
    const marks = handlers.flatMap((h) =>
      h && typeof h === "function" && TOOL in h
        ? [(h as { [TOOL]: AsToolOptions | false })[TOOL]]
        : [],
    )
    if (marks.includes(false)) continue
    const meta: AsToolOptions = Object.assign({}, ...marks)
    const checks = handlers.flatMap((h) =>
      h && typeof h === "function" && VALIDATES in h
        ? [(h as unknown as { [VALIDATES]: Validates })[VALIDATES]]
        : [],
    )
    if (!checks.length && !marks.length) continue
    if (options.optIn && !marks.length) continue
    let input = meta.input as ZodObjectLike | undefined
    if (!input) {
      // GET and DELETE send every argument in the query string, so a json validator could never pass.
      if (checks.some((v) => v.target === "json") && (method === "GET" || method === "DELETE"))
        continue
      if (!checks.every((v) => ["json", "query", "param"].includes(v.target) && isObject(v.schema)))
        continue
      for (const v of checks)
        input = input
          ? input.extend((v.schema as ZodObjectLike).shape)
          : (v.schema as ZodObjectLike)
    }
    const params = [...path.matchAll(/:(\w+)/g)].map((m) => m[1] as string)
    if (params.some((p) => !input || !(p in input.shape))) continue
    const queryCheck = checks.find((v) => v.target === "query")
    const described = checks.map((v) => v.schema.description).find(Boolean)
    routes.push({
      ...meta,
      name: meta.name ?? routeToolName(method, path),
      description: meta.description ?? described ?? `${method} ${path}`,
      method: method as RouteTool["method"],
      path,
      ...(input ? { input } : {}),
      approval: meta.approval ?? (method !== "GET" && options.approval !== false),
      ...(queryCheck && method !== "GET" && method !== "DELETE"
        ? { query: Object.keys((queryCheck.schema as ZodObjectLike).shape) }
        : {}),
    })
  }
  const seen = new Set<string>()
  for (const r of routes) {
    if (seen.has(r.name))
      throw new Error(
        `signet mcp: two routes are both tool "${r.name}"; name one with asTool({ name })`,
      )
    seen.add(r.name)
  }
  return routesAsTools(app, routes)
}
