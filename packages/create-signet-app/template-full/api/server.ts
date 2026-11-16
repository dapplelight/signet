/// <reference types="bun" />
// The one process to run: the API under /api (and /mcp), and the built web
// app from dist/ for every other path. `dev` runs this next to Vite, which
// proxies /api to it; `start` serves both from here.
import { join, normalize } from "node:path"
import { createApp } from "./app.ts"
import { pruneKv, sqlKv } from "./db/kv.ts"
import { openDb } from "./db/open.ts"
import { env } from "./env.ts"

const { db, query } = openDb(env.DATABASE_PATH)
// OBSERVABILITY=on adds request logs, spans and /health/live and /health/ready.
const observability = env.OBSERVABILITY === "on" ? { serviceName: "__APP_NAME__" } : undefined
const app = createApp({ db, query, kv: sqlKv(db.orm), observability })
setInterval(() => pruneKv(db.orm), 60 * 60 * 1000)

const DIST = join(import.meta.dirname, "../dist")

const server = Bun.serve({
  port: env.PORT,
  async fetch(req, srv) {
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
  },
})

console.log(`Listening on ${server.url}`)
