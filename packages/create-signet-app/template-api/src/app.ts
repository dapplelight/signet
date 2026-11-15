import { initRuntimeEnv } from "@dapplelight/signet-server/env"
import { errorHandler } from "@dapplelight/signet-server/http"
import { zValidator } from "@dapplelight/signet-server/http/validate"
// mcp:begin
import { appTools } from "@dapplelight/signet-server/mcp"
import { mountMcp } from "@dapplelight/signet-server/mcp/hono"
// mcp:end
import { csrfMiddleware } from "@dapplelight/signet-server/middleware/csrf"
import { type RateLimitOptions, rateLimit } from "@dapplelight/signet-server/middleware/rate-limit"
import { requestId } from "@dapplelight/signet-server/middleware/request-id"
import { Hono } from "hono"
import { z } from "zod"
import { env } from "./env.ts"

type AppEnv<B> = { Bindings: B; Variables: { reqId: string } }

/**
 * The API. Each target's entry (src/index.ts on Workers, src/server.ts on Bun
 * or Node, index.ts on Vercel) differs only in how it rate limits, so each
 * passes its own store and key.
 */
export function createApp<B extends Record<string, unknown>>(
  limit: Pick<RateLimitOptions<AppEnv<B>>, "store" | "trust" | "keyFor">,
) {
  const app = new Hono<AppEnv<B>>()
    // Bindings arrive per request on Workers. Hand them over first, then read
    // vars through the validated `env` from ./env. Reading env.APP_ENV here
    // validates on the first request, so a bad or missing var fails loudly
    // instead of whenever a handler happens to read it.
    .use("*", async (c, next) => {
      initRuntimeEnv(c.env)
      void env.APP_ENV
      await next()
    })
    .use("*", requestId())
    // Blocks cross-site form POSTs that ride a session cookie; bearer-token calls
    // skip it. Trusts only this API's own origin until you list your frontend's
    // env key: csrfMiddleware({ originEnvKeys: ["WEB_URL"] }), the same keys you
    // give corsMiddleware.
    .use("/api/*", csrfMiddleware())
    .use("/api/*", rateLimit<AppEnv<B>>({ ...limit, max: 60 }))
    .get("/api/health", (c) => c.json({ ok: true }))
    // mcp:begin
    // Validated with zValidator, so it is also the MCP tool `post_api_echo`
    // (see below). Describe it for the model with .describe(...).
    // mcp:end
    .post(
      "/api/echo",
      zValidator("json", z.object({ message: z.string().min(1) }).describe("Echo a message back")),
      (c) => c.json({ message: c.req.valid("json").message }),
    )
    .onError(errorHandler({ isProduction }))

  // mcp:begin
  // MCP: every route validated with zValidator is a tool at /mcp
  // that runs the route as the caller (their auth header and cookie go
  // with it). GET routes are read tools; anything else asks the person first.
  // asTool(false) on a route leaves it out. Turn it all off with MCP=off.
  mountMcp(app, "/mcp", {
    name: "api",
    version: "0.0.0",
    middleware: [async (c, next) => (env.MCP === "off" ? c.notFound() : next())],
    tools: appTools(app),
  })
  // mcp:end
  return app
}

// Fails closed: if the env does not validate, treat it as production so a 500
// hides its message instead of leaking it.
function isProduction(): boolean {
  try {
    return env.APP_ENV === "production"
  } catch {
    return true
  }
}
