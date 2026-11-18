/// <reference types="bun" /> // @bun
// web:begin
// The one process to run: the API under /api (and /mcp), and the built web
// app from dist/ for every other path. `dev` runs this next to Vite, which
// proxies /api to it; `start` serves both from here.
import { join, normalize } from "node:path"
// web:end
// The one process to run: the API under /api (and /mcp). `dev` runs it and // @!web
// restarts it on change; `start` serves it. // @!web
// !bun:begin
import { readFile } from "node:fs/promises" // @web
import { createServer } from "node:http"
import { Readable } from "node:stream"
// !bun:end
import { createApp } from "./app.ts"
import { pruneKv, sqlKv } from "./db/kv.ts"
import { openDb } from "./db/open.ts"
import { env } from "./env.ts"
import { createAppWorkflows } from "./workflows.ts" // @workflows

const { db, query } = openDb(env.DATABASE_PATH)
// OBSERVABILITY=on adds request logs, spans and /health/live and /health/ready.
const serviceName = "__APP_NAME__"
const observability = env.OBSERVABILITY === "on" ? { serviceName } : undefined
const app = createApp({ db, query, kv: sqlKv(db.orm), observability })
setInterval(() => pruneKv(db.orm), 60 * 60 * 1000)
// workflows:begin
// The workflow runner (api/workflows.ts): every second it takes the runs that
// are due, including any a restart cut short. The same on Bun, Deno and Node.
void createAppWorkflows(db).poll({ intervalMs: 1000 })
// workflows:end

const DIST = join(import.meta.dirname, "../dist") // @web

// bun:begin
const server = Bun.serve({
  port: env.PORT,
  async fetch(req, srv) { // @web
  fetch(req, srv) { // @!web
    const { pathname } = new URL(req.url)
    if (
      pathname.startsWith("/api/") ||
      pathname.startsWith("/mcp") ||
      (observability && pathname.startsWith("/health/"))
    ) {
      // Overwrite, never append: a client-set x-forwarded-for must not pick its
      // own rate-limit bucket. Behind a proxy of your own, pass the proxy's
      // header through instead and raise TRUST's hops in services.ts.
      const headers = new Headers(req.headers)
      headers.set("x-forwarded-for", srv.requestIP(req)?.address ?? "")
      return app.fetch(new Request(req, { headers }))
    }
    // web:begin
    // A file (it has an extension) or the app's index.html for its routes.
    if (/\.[a-z0-9]+$/i.test(pathname)) {
      const path = normalize(join(DIST, pathname))
      const file = Bun.file(path)
      if (path.startsWith(DIST) && (await file.exists())) return new Response(file)
      return new Response("Not found", { status: 404 })
    }
    const index = Bun.file(join(DIST, "index.html"))
    if (await index.exists()) return new Response(index)
    return new Response("No web build yet: run `build`, or use `dev` and open Vite's URL.", {
      status: 404,
    })
    // web:end
    return new Response("Not found", { status: 404 }) // @!web
  },
})

console.log(`Listening on ${server.url}`)
// bun:end
// !bun:begin
// web:begin
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  webmanifest: "application/manifest+json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
}

/** A file from dist/, or null when there is none. */
async function file(path: string): Promise<Response | null> {
  const body = await readFile(path).catch(() => null)
  if (!body) return null
  const type = TYPES[path.slice(path.lastIndexOf(".") + 1)] ?? "application/octet-stream"
  return new Response(body, { headers: { "content-type": type } })
}
// web:end

/** One request: the API, or (with the web app) a file from dist/. */
async function handle(req: Request, ip: string): Promise<Response> { // @web
function handle(req: Request, ip: string): Promise<Response> | Response { // @!web
  const { pathname } = new URL(req.url)
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/mcp") ||
    (observability && pathname.startsWith("/health/"))
  ) {
    // Overwrite, never append: a client-set x-forwarded-for must not pick its
    // own rate-limit bucket. Behind a proxy of your own, pass the proxy's
    // header through instead and raise TRUST's hops in services.ts.
    const headers = new Headers(req.headers)
    headers.set("x-forwarded-for", ip)
    return app.fetch(new Request(req, { headers }))
  }
  // web:begin
  // A file (it has an extension) or the app's index.html for its routes.
  if (/\.[a-z0-9]+$/i.test(pathname)) {
    const path = normalize(join(DIST, pathname))
    const found = path.startsWith(DIST) ? await file(path) : null
    return found ?? new Response("Not found", { status: 404 })
  }
  const index = await file(join(DIST, "index.html"))
  if (index) return index
  return new Response("No web build yet: run `build`, or use `dev` and open Vite's URL.", {
    status: 404,
  })
  // web:end
  return new Response("Not found", { status: 404 }) // @!web
}

// node:http runs under Node and Deno alike: requests in, the fetch-style
// handler above, responses streamed back out.
const server = createServer(async (req, res) => {
  try {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers))
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value)
    const method = req.method ?? "GET"
    const response = await handle(
      new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
        method,
        headers,
        body:
          method === "GET" || method === "HEAD"
            ? undefined
            : (Readable.toWeb(req) as unknown as ReadableStream),
        // Required by fetch for a streamed request body.
        duplex: "half",
      } as RequestInit),
      req.socket.remoteAddress ?? "",
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
server.listen(env.PORT, () => console.log(`Listening on http://localhost:${env.PORT}`))
// !bun:end
