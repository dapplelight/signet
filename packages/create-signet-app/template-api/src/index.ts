import { initRuntimeEnv } from "@dapplelight/signet-server/env"
import { errorHandler } from "@dapplelight/signet-server/http"
import { parseBody } from "@dapplelight/signet-server/http/validate"
import { rateLimit } from "@dapplelight/signet-server/middleware/rate-limit"
import {
  durableObjectStore,
  type RateLimitNamespace,
} from "@dapplelight/signet-server/middleware/rate-limit-do"
import { requestId } from "@dapplelight/signet-server/middleware/request-id"
import { Hono } from "hono"
import { z } from "zod"
import { env } from "./env"

// The Durable Object behind the rate limiter. wrangler.jsonc binds it as
// RATE_LIMIT and its first migration creates it. A Worker entry may export only
// handlers and classes like this one — workerd rejects anything else (a string
// constant) with "Incorrect type for map entry".
export { RateLimitCounter } from "@dapplelight/signet-server/middleware/rate-limit-do"

type AppEnv = {
  Bindings: { RATE_LIMIT: RateLimitNamespace; APP_ENV?: string }
  Variables: { reqId: string }
}

const app = new Hono<AppEnv>()
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
  // Exact per-IP limit: one Durable Object per scope:key.
  .use("/api/*", rateLimit<AppEnv>({ store: (c) => durableObjectStore(c.env.RATE_LIMIT), max: 60 }))
  .get("/api/health", (c) => c.json({ ok: true }))
  .post("/api/echo", async (c) => {
    const { message } = await parseBody(c, z.object({ message: z.string().min(1) }))
    return c.json({ message })
  })
  .onError(errorHandler({ isProduction }))

// Fails closed: if the env does not validate, treat it as production so a 500
// hides its message instead of leaking it.
function isProduction(): boolean {
  try {
    return env.APP_ENV === "production"
  } catch {
    return true
  }
}

export default app
