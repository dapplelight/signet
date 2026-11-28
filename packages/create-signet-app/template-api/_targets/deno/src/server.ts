// Deno and Docker entry: the app in ./app.ts, served by Deno.serve.
// Run `deno run -A src/server.ts`, or build the Dockerfile.
import { memoryStore } from "@dapplelight/signet-server/middleware/rate-limit"
import { createApp } from "./app.ts"

/** The slice of Deno's global this file uses (tsc has no Deno types). */
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(
    options: { port: number; onListen?: (addr: { port: number }) => void },
    handler: (
      req: Request,
      info: { remoteAddr: { hostname: string } },
    ) => Response | Promise<Response>,
  ): unknown
}

const hops = Deno.env.get("TRUSTED_PROXY_HOPS")

const app = createApp<Record<string, never>>({
  // The memory store counts per process, so with more than one instance each keeps
  // its own count. Swap in upstashRateLimitStore from @dapplelight/signet-server/adapters/upstash.
  store: memoryStore(),
  // Behind proxies of your own (a load balancer, a PaaS router), set
  // TRUSTED_PROXY_HOPS to how many, and the client IP comes from
  // x-forwarded-for. Otherwise the handler below replaces that header with
  // the socket's peer address, so one hop (this server) is all there is to trust.
  trust: { forwardedHops: hops ? Number(hops) : 1 },
})

Deno.serve(
  {
    port: Number(Deno.env.get("PORT") ?? 3000),
    onListen: ({ port }) => console.log(`Listening on http://localhost:${port}`),
  },
  (req, info) => {
    if (hops) return app.fetch(req)
    // Overwrite, never append: a client-supplied x-forwarded-for must not pick its bucket.
    const headers = new Headers(req.headers)
    headers.set("x-forwarded-for", info.remoteAddr.hostname)
    return app.fetch(new Request(req, { headers }))
  },
)
