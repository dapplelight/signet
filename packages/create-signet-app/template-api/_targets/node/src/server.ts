/// <reference types="node" />
// Node entry: the app in ./app.ts behind node:http. Node 22.18+ runs this file
// as is (type stripping), which is why relative imports carry `.ts`.
// Run `node src/server.ts`.
import { createServer } from "node:http"
import { Readable } from "node:stream"
import { memoryStore } from "@dapplelight/signet-server/middleware/rate-limit"
import { createApp } from "./app.ts"

const hops = process.env.TRUSTED_PROXY_HOPS

const app = createApp<Record<string, never>>({
  // One process, so an in-memory count is exact. Running several replicas?
  // Share the count with a store backed by Redis or a Durable Object.
  store: memoryStore(),
  // Behind proxies of your own, set TRUSTED_PROXY_HOPS to how many and the
  // client IP comes from x-forwarded-for. Otherwise the header is replaced
  // with the socket's peer address below.
  trust: { forwardedHops: hops ? Number(hops) : 1 },
})

// A minimal node:http to fetch bridge: IncomingMessage in, Request to Hono,
// Response back out, streamed both ways.
const server = createServer(async (req, res) => {
  try {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value)
    }
    // Overwrite, never append: a client-supplied x-forwarded-for must not pick its bucket.
    if (!hops) headers.set("x-forwarded-for", req.socket.remoteAddress ?? "")
    const method = req.method ?? "GET"
    const hasBody = method !== "GET" && method !== "HEAD"
    const response = await app.fetch(
      new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
        method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
        // Required by fetch for a streamed request body.
        duplex: "half",
      } as RequestInit),
    )
    // Headers iterate set-cookie once per cookie; writeHead takes a flat list.
    res.writeHead(response.status, [...response.headers].flat())
    if (response.body) Readable.fromWeb(response.body as never).pipe(res)
    else res.end()
  } catch (err) {
    console.error(err)
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" })
    res.end(JSON.stringify({ success: false, error: "Internal error" }))
  }
})

const port = Number(process.env.PORT ?? 3000)
server.listen(port, () => console.log(`Listening on http://localhost:${port}`))
