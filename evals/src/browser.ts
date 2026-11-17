import { statSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve, sep } from "node:path"
import { ROOT } from "./arms"

/** Playwright comes from packages/test, which pins the version (same as scripts/qa). */
export function chromium() {
  return createRequire(join(ROOT, "packages/test/package.json"))("@playwright/test").chromium
}

/** Static server for a built app, bound to 127.0.0.1. Unknown paths get index.html, as a single-page app host does. */
export function serveDist(dist: string) {
  const root = resolve(dist)
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname)
      let file = resolve(root, `.${path}`)
      if (file !== root && !file.startsWith(root + sep))
        return new Response("Not found", { status: 404 })
      try {
        if (!statSync(file).isFile()) throw new Error("not a file")
      } catch {
        file = join(root, "index.html")
      }
      return new Response(Bun.file(file))
    },
  })
}
