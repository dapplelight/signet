/// <reference types="node" />
// Vercel entry. Vercel deploys a Hono app with zero configuration from the
// default export of a root index.ts (vercel.json pins the "hono" preset).
// https://vercel.com/docs/frameworks/backend/hono
import { upstashRateLimitStore } from "@dapplelight/signet-server/adapters/upstash"
import { memoryStore } from "@dapplelight/signet-server/middleware/rate-limit"
import { createApp } from "./src/app.ts"

const local = memoryStore()
let shared: ReturnType<typeof upstashRateLimitStore> | undefined

export default createApp<Record<string, never>>({
  // Shared across all function instances through Upstash Redis (the Vercel
  // Marketplace sets KV_REST_API_URL and KV_REST_API_TOKEN). Without them this
  // falls back to memoryStore, which counts per instance, so set them before
  // relying on the limit. Read per request: env is not safe at module scope.
  store: () => {
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return local
    return (shared ??= upstashRateLimitStore({ url, token }))
  },
  // Vercel overwrites x-forwarded-for with the client's IP and never forwards
  // one a client sent (https://vercel.com/docs/headers/request-headers#x-forwarded-for),
  // so the single address in it is the one to trust.
  trust: { forwardedHops: 1 },
})
