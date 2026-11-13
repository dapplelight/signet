import {
  durableObjectStore,
  type RateLimitNamespace,
} from "@dapplelight/signet-server/middleware/rate-limit-do"
import { createApp } from "./app"

// The Durable Object behind the rate limiter. wrangler.jsonc binds it as
// RATE_LIMIT and its first migration creates it. A Worker entry may export only
// handlers and classes like this one — workerd rejects anything else (a string
// constant) with "Incorrect type for map entry".
export { RateLimitCounter } from "@dapplelight/signet-server/middleware/rate-limit-do"

// Exact per-IP limit: one Durable Object per scope:key.
export default createApp<{ RATE_LIMIT: RateLimitNamespace }>({
  store: (c) => durableObjectStore(c.env.RATE_LIMIT),
  trust: "cloudflare",
})
