/// <reference types="bun" />
// Bun and Docker entry: the same app as the Worker (index.ts), served by
// Bun.serve. Run `bun src/server.ts`, or build the Dockerfile.
import { memoryStore } from "@dapplelight/signet-server/middleware/rate-limit"
import { createApp } from "./app"

const hops = process.env.TRUSTED_PROXY_HOPS

const app = createApp<Record<string, never>>({
  // One process, so an in-memory count is exact. Running several replicas?
  // Share the count: upstashRateLimitStore from @dapplelight/signet-server/adapters/upstash.
  store: memoryStore(),
  // Behind proxies of your own (a load balancer, a PaaS router), set
  // TRUSTED_PROXY_HOPS to how many, and the client IP comes from
  // x-forwarded-for. Otherwise fetch below replaces that header with the
  // socket's peer address, so one hop (this server) is all there is to trust.
  trust: { forwardedHops: hops ? Number(hops) : 1 },
})

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch(req, srv) {
    if (hops) return app.fetch(req)
    // Overwrite, never append: a client-supplied x-forwarded-for must not pick its bucket.
    // The rate limiter then groups an IPv6 peer by its /64, like any other client IP.
    const headers = new Headers(req.headers)
    headers.set("x-forwarded-for", srv.requestIP(req)?.address ?? "")
    return app.fetch(new Request(req, { headers }))
  },
})

console.log(`Listening on ${server.url}`)
