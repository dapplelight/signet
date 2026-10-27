/**
 * Exact rate limiting on Cloudflare Workers, backed by a Durable Object.
 *
 * `memoryStore` is per-isolate, so the effective limit is `max × isolates`.
 * Cloudflare's own rate-limit binding is also approximate: app-b saw it
 * answer "allowed" for 300 of 300 requests on workers.dev. A Durable Object is
 * the one primitive that gives an exact count, because every request for a key
 * reaches the same single-threaded instance.
 *
 * One object per `scope:key`. Storage calls hold the object's input gate, so the
 * read-increment-write below cannot interleave with another request for the
 * same key.
 *
 * No `cloudflare:workers` import: the class uses the classic `fetch` interface,
 * so this module still loads (and is testable) under Bun and Node.
 *
 *   // worker entry — the class must be exported for the binding to find it.
 *   // An entry module may export only handlers and Durable Object classes:
 *   // workerd rejects anything else (a string constant) with "Incorrect type
 *   // for map entry".
 *   export { RateLimitCounter } from "@dapplelight/signet-server/middleware/rate-limit-do"
 *
 *   // wrangler.jsonc
 *   "durable_objects": { "bindings": [{ "name": "RATE_LIMIT", "class_name": "RateLimitCounter" }] },
 *   "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RateLimitCounter"] }]
 *
 *   app.use("/api/*", rateLimit({ store: (c) => durableObjectStore(c.env.RATE_LIMIT), max: 60 }))
 */

import type { RateLimitResult, RateLimitStore } from "./rate-limit.js"

/** The subset of DurableObjectState this uses. Structural, so no workers-types dependency. */
export type RateLimitCounterState = {
  storage: {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
    deleteAll(): Promise<void>
    setAlarm(scheduledTime: number): Promise<void>
  }
}

/** The subset of DurableObjectNamespace this uses. */
export type RateLimitNamespace = {
  idFromName(name: string): unknown
  get(id: never): { fetch(input: string, init?: RequestInit): Promise<Response> }
}

type Window = { count: number; resetAt: number }

export class RateLimitCounter {
  constructor(private readonly state: RateLimitCounterState) {}

  async fetch(request: Request): Promise<Response> {
    const { max, windowSeconds } = (await request.json()) as { max: number; windowSeconds: number }
    const now = Date.now()
    let window = await this.state.storage.get<Window>("window")
    if (!window || now >= window.resetAt) {
      window = { count: 0, resetAt: now + windowSeconds * 1000 }
      // Delete the object's storage once the window is over, so one-off IPs do
      // not accumulate forever.
      await this.state.storage.setAlarm(window.resetAt)
    }
    window.count++
    await this.state.storage.put("window", window)
    const result: RateLimitResult = {
      ok: window.count <= max,
      remaining: Math.max(0, max - window.count),
      resetSeconds: Math.max(0, Math.ceil((window.resetAt - now) / 1000)),
    }
    return Response.json(result)
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll()
  }
}

/**
 * A RateLimitStore over a RateLimitCounter namespace. The binding lives on the
 * request's env, so build it per request: `store: (c) => durableObjectStore(c.env.RATE_LIMIT)`.
 *
 * Throws when the object cannot be reached; `rateLimit`'s `failOpen` decides
 * what happens then.
 */
export function durableObjectStore(namespace: RateLimitNamespace): RateLimitStore {
  return {
    async hit(scope, key, max, windowSeconds) {
      const stub = namespace.get(namespace.idFromName(`${scope}:${key}`) as never)
      const res = await stub.fetch("https://rate-limit/hit", {
        method: "POST",
        body: JSON.stringify({ max, windowSeconds }),
      })
      if (!res.ok) throw new Error(`rate limit store returned ${res.status}`)
      return (await res.json()) as RateLimitResult
    },
  }
}
