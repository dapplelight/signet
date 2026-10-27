import { createEnv } from "@dapplelight/signet-server/env"
import { z } from "zod"

// Every var and secret this Worker reads, declared once. Add a key here, then
// read it as `env.KEY` — never from `c.env` or `process.env` directly.
// Bindings that are not strings (RATE_LIMIT) are typed on the Hono app instead.
export const envSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
})

export type Env = z.infer<typeof envSchema>

// Lazy: validated on first read, not at import. Cloudflare runs module scope
// during deploy validation with no secrets, so an eager check would fail a good
// deploy. The first request calls initRuntimeEnv() before anything reads this.
export const env = createEnv(envSchema)
