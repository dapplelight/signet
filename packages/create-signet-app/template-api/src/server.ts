/// <reference types="bun" />
// Bun and Docker entry: the same app as the Worker (index.ts), served by
// Bun.serve. Run `bun src/server.ts`, or build the Dockerfile.
import { memoryStore } from "@dapplelight/signet-server/middleware/rate-limit"
import { createApp } from "./app"

type Bindings = { CLIENT_IP?: string }

const hops = process.env.TRUSTED_PROXY_HOPS

const app = createApp<Bindings>({
  // One process, so an in-memory count is exact. Running several replicas?
  // Share the count: upstashRateLimitStore from @dapplelight/signet-server/adapters/upstash.
  store: memoryStore(),
  // Behind proxies of your own (a load balancer, a PaaS router), set
  // TRUSTED_PROXY_HOPS to how many, and the client IP comes from
  // x-forwarded-for. Otherwise it is the socket's peer address.
  ...(hops
    ? { trust: { forwardedHops: Number(hops) } }
    : { keyFor: (c: { env: Bindings }) => c.env.CLIENT_IP ?? "no-ip" }),
})

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch: (req, srv) => app.fetch(req, { CLIENT_IP: srv.requestIP(req)?.address }),
})

console.log(`Listening on ${server.url}`)
