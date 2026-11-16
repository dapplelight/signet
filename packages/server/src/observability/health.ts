/**
 * Liveness and readiness routes for load balancers. `GET /live` always answers
 * 200. `GET /ready` runs every check at once; a check that returns anything but
 * `true`, throws or outlives `timeoutMs` counts as failed and the answer is 503.
 * The body holds one boolean per check, never error text. Takes config; never
 * reads env. Mount under a prefix of your choosing, e.g. `/health`.
 */

import { Hono } from "hono"

export type HealthConfig = {
  /** Named readiness checks. Return `true` when the dependency is usable. */
  checks: Record<string, () => Promise<boolean>>
  /** Per-check limit in ms. Default 2000. */
  timeoutMs?: number
}

async function run(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(resolve, timeoutMs, false)
    })
    // The async wrapper turns a synchronous throw into a rejection too.
    return (await Promise.race([(async () => (await check()) === true)(), timeout])) === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export function healthRoutes(cfg: HealthConfig): Hono {
  const timeoutMs = cfg.timeoutMs ?? 2000
  const app = new Hono()
  app.use("*", async (c, next) => {
    await next()
    c.header("Cache-Control", "no-store")
  })
  app.get("/live", (c) => c.json({ ok: true }))
  app.get("/ready", async (c) => {
    const names = Object.keys(cfg.checks)
    const results = await Promise.all(names.map((n) => run(cfg.checks[n], timeoutMs)))
    const checks = Object.fromEntries(names.map((n, i) => [n, results[i]]))
    const ok = results.every(Boolean)
    return c.json({ ok, checks }, ok ? 200 : 503)
  })
  return app
}
