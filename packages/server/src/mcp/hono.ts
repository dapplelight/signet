/**
 * Serve MCP over streamable HTTP from a Hono route. Requires `hono` and
 * `@modelcontextprotocol/server` (v2) as optional peers.
 *
 * Built on the SDK's `createMcpHandler`, which serves the 2026-07-28 revision
 * (stateless: no initialize, no session, `server/discover`) and, through its
 * default `legacy: 'stateless'`, 2025-era clients too — one factory, both
 * eras, chosen per request. GET and DELETE, the 2025 session operations, get
 * the SDK's 405.
 *
 * A handler is created per request, with a factory that closes over that
 * request's Hono context and verified token — what app-b arrived at
 * on Workers, where one isolate serves many users. The SDK's factory only
 * sees the raw `Request` (a clone, on the legacy leg), so a closure is the one
 * way to hand a tool its `c`. The tools are what is shared — a module-scope
 * array of `defineTool`s — and building a server from them is a loop of
 * `registerTool` calls.
 *
 * Not `@modelcontextprotocol/hono`: its `createMcpHonoApp` builds an app of its
 * own rather than a route on yours, and its Host/Origin middleware (DNS
 * rebinding protection, for servers bound to localhost) wraps helpers
 * `@modelcontextprotocol/server` already exports. Pass it in `middleware` if a
 * local server needs it.
 */

import {
  type CreateMcpHandlerOptions,
  createMcpHandler,
  type McpRequestContext,
  type McpServer,
} from "@modelcontextprotocol/server"
import type { Context, Handler, Hono, MiddlewareHandler } from "hono"
import type { VerifiedToken } from "../oauth-rs/verify.js"
import { type CreateMcpServerOptions, createMcpServer } from "./server.js"

export type McpHandlerOptions = (
  | Omit<CreateMcpServerOptions, "context">
  | {
      /**
       * Build the server yourself, per request — for what createMcpServer does
       * not wrap (subscriptions, completions). Must return a NEW server each call.
       * `req.era` says which protocol era it will serve.
       */
      server: (c: Context, req: McpRequestContext) => McpServer | Promise<McpServer>
    }
) & {
  /**
   * Passed to the SDK's `createMcpHandler`. `legacy: 'reject'` refuses
   * 2025-era clients; `responseMode: 'sse'` always streams (the default,
   * `'auto'`, answers with one JSON body unless a tool sends progress first).
   * `'json'` and a `bus` are left out: the handler lives for one request, so
   * a shared bus would have nothing to publish to it.
   */
  http?: Omit<CreateMcpHandlerOptions, "bus" | "maxSubscriptions" | "responseMode"> & {
    responseMode?: "auto" | "sse"
  }
}

/**
 * The route handler. Put oauth-rs `requireToken` before it; the verified
 * claims reach each tool as `ctx.token`.
 */
export function mcpHandler(options: McpHandlerOptions): Handler {
  const { http, ...rest } = options
  return (c) => {
    const handler = createMcpHandler(
      (req) =>
        "server" in rest
          ? rest.server(c, req)
          : createMcpServer({
              ...rest,
              context: { c, token: c.get("token") as VerifiedToken | undefined },
            }),
      http,
    )
    return handler.fetch(c.req.raw)
  }
}

/**
 * `app.on(["GET", "POST", "DELETE"], path, ...middleware, mcpHandler(options))`.
 * GET and DELETE are routed so they get the SDK's 405 rather than a 404,
 * after the middleware (so an unauthenticated one still gets a 401).
 */
export function mountMcp(
  // biome-ignore lint/suspicious/noExplicitAny: accepts any app's Env; Hono<Env> is invariant, so a named Env would reject callers' concrete types
  app: Hono<any>,
  path: string,
  options: McpHandlerOptions & { middleware?: MiddlewareHandler[] },
): void {
  const { middleware = [], ...rest } = options
  const methods = ["GET", "POST", "DELETE"]
  // Registered one by one; Hono runs same-route handlers in registration order.
  for (const m of middleware) app.on(methods, path, m)
  app.on(methods, path, mcpHandler(rest as McpHandlerOptions))
}
