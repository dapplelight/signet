import { initRuntimeEnv } from "@dapplelight/signet-server/env"
import { errorHandler } from "@dapplelight/signet-server/http"
import { parseBody } from "@dapplelight/signet-server/http/validate"
import { csrfMiddleware } from "@dapplelight/signet-server/middleware/csrf"
import { type RateLimitOptions, rateLimit } from "@dapplelight/signet-server/middleware/rate-limit"
import { requestId } from "@dapplelight/signet-server/middleware/request-id"
import { Hono } from "hono"
import { z } from "zod"
import { env } from "./env"

type AppEnv<B> = { Bindings: B; Variables: { reqId: string } }

/**
 * The API. The Worker entry (index.ts) and the Bun/Docker entry (server.ts)
 * differ only in how they rate limit, so each passes its own store and key.
 */
export function createApp<B extends Record<string, unknown>>(
  limit: Pick<RateLimitOptions<AppEnv<B>>, "store" | "trust" | "keyFor">,
) {
  return (
    new Hono<AppEnv<B>>()
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
      .post("/api/echo", async (c) => {
        const { message } = await parseBody(c, z.object({ message: z.string().min(1) }))
        return c.json({ message })
      })
      .onError(errorHandler({ isProduction }))
  )
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
