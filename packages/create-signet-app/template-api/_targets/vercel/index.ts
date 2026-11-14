// Vercel entry. Vercel deploys a Hono app with zero configuration from the
// default export of a root index.ts (vercel.json pins the "hono" preset).
// https://vercel.com/docs/frameworks/backend/hono
import { memoryStore } from "@dapplelight/signet-server/middleware/rate-limit"
import { createApp } from "./src/app.ts"

export default createApp<Record<string, never>>({
  // Per function instance, so the count is approximate once Vercel runs
  // several. For an exact, shared count use a Redis-backed store: Vercel KV is
  // Upstash Redis from the Marketplace (https://vercel.com/docs/redis).
  store: memoryStore(),
  // Vercel overwrites x-forwarded-for with the client's IP and never forwards
  // one a client sent (https://vercel.com/docs/headers/request-headers#x-forwarded-for),
  // so the single address in it is the one to trust.
  trust: { forwardedHops: 1 },
})
