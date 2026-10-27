/**
 * Rate limiting with a pluggable store. Requires `hono` as an optional peer.
 *
 * The audit had two implementations with opposite tradeoffs:
 *   - app-a: an in-memory Map. Fast, zero setup, but **per-isolate** on
 *     Workers, so counters are independent per POP. Best-effort only.
 *   - app-c: D1-backed. Correct across isolates, costs a query.
 *
 * Both are legitimate; which is right depends on whether the limit is a
 * safeguard or a security control. Login attempts need the durable store.
 * General API smoothing does not. So the store is an interface. For an exact
 * count on Workers, see `./rate-limit-do` (Durable Object).
 */

import type { Context, Env, MiddlewareHandler, Next } from "hono"

export type RateLimitResult = {
  ok: boolean
  remaining: number
  /** Seconds until the window resets. */
  resetSeconds: number
}

export type RateLimitStore = {
  hit(scope: string, key: string, max: number, windowSeconds: number): Promise<RateLimitResult>
}

/**
 * In-memory sliding window.
 *
 * NOT shared across Workers isolates — each POP keeps its own counter, so the
 * effective limit is `max × isolates`. Use for smoothing, never as a security
 * control. For login attempts use a durable store.
 */
export function memoryStore(): RateLimitStore {
  const hits = new Map<string, { count: number; resetAt: number }>()
  let lastCleanup = 0

  return {
    async hit(scope, key, max, windowSeconds) {
      const now = Date.now()
      // Evict expired entries periodically — no timer needed, and Workers
      // would not keep one alive between requests anyway.
      if (now - lastCleanup > 300_000) {
        for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k)
        lastCleanup = now
      }
      const id = `${scope}:${key}`
      let entry = hits.get(id)
      if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + windowSeconds * 1000 }
        hits.set(id, entry)
      }
      entry.count++
      return {
        ok: entry.count <= max,
        remaining: Math.max(0, max - entry.count),
        resetSeconds: Math.max(0, Math.ceil((entry.resetAt - now) / 1000)),
      }
    },
  }
}

/**
 * The client IP.
 *
 * On Cloudflare, `CF-Connecting-IP` is set by the edge and cannot be spoofed.
 * `x-forwarded-for` **can** be spoofed by the client, so it is only a fallback
 * for non-CF deployments — do not reorder these.
 */
// biome-ignore lint/suspicious/noExplicitAny: Hono's own Context defaults to any; `Env` breaks c.env.BINDING
export function clientIp<E extends Env = any>(c: Context<E>): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  )
}

// E defaults to `any`, not `Env`: with `Env`, c.env is `object` and the documented
// `(c) => durableObjectStore(c.env.RATE_LIMIT)` stops compiling. Pass your app's
// env type (`rateLimit<AppEnv>(...)`) for typed variables in callbacks.
// biome-ignore lint/suspicious/noExplicitAny: Hono's own Context defaults to any; `Env` breaks c.env.BINDING
export type RateLimitOptions<E extends Env = any> = {
  /**
   * A store, or a function building one per request — a Durable Object binding
   * only exists on `c.env`, which is not available when the middleware is created.
   */
  store?: RateLimitStore | ((c: Context<E>) => RateLimitStore)
  /** Namespace, so "login" and "api" limits do not share a counter. */
  scope?: string
  max?: number
  windowSeconds?: number
  /** Defaults to the client IP. Use a user id for per-account limits. */
  keyFor?: (c: Context<E>) => string
  /**
   * When the store throws (a Durable Object unreachable, D1 down): let the
   * request through (true, the default) or answer 503 (false). A limiter
   * outage should not take the API down with it; set false where the limit is
   * the security control, e.g. login attempts.
   */
  failOpen?: boolean
  /** Told about every store failure, whichever way `failOpen` goes. */
  onStoreError?: (err: unknown, c: Context<E>) => void
  /** Where the request id lives, for the 429/503 envelope. Default: `c.get("reqId")`. */
  getRequestId?: (c: Context<E>) => string | undefined
}

// biome-ignore lint/suspicious/noExplicitAny: Hono's own Context defaults to any; `Env` breaks c.env.BINDING
export function rateLimit<E extends Env = any>(
  opts: RateLimitOptions<E> = {},
): MiddlewareHandler<E> {
  const fixed = typeof opts.store === "function" ? null : (opts.store ?? memoryStore())
  const failOpen = opts.failOpen ?? true
  const scope = opts.scope ?? "api"
  const max = opts.max ?? 100
  const windowSeconds = opts.windowSeconds ?? 60

  return async (c: Context<E>, next: Next) => {
    const store = fixed ?? (opts.store as (c: Context<E>) => RateLimitStore)(c)
    let result: RateLimitResult
    try {
      result = await store.hit(scope, (opts.keyFor ?? clientIp)(c), max, windowSeconds)
    } catch (err) {
      opts.onStoreError?.(err, c)
      // Only the store call is guarded. next() is outside the try, so an error
      // thrown by the handler itself is never mistaken for a store failure and
      // the handler never runs twice.
      if (!failOpen)
        return c.json(
          envelope(c, "Rate limiter unavailable", "RATE_LIMIT_UNAVAILABLE", opts.getRequestId),
          503,
        )
      return next()
    }

    c.header("X-RateLimit-Limit", String(max))
    c.header("X-RateLimit-Remaining", String(result.remaining))
    // Epoch seconds (the GitHub convention), NOT the IETF draft's RateLimit-Reset,
    // which is seconds from now. Retry-After on the 429 is seconds from now.
    c.header("X-RateLimit-Reset", String(Math.ceil(Date.now() / 1000) + result.resetSeconds))

    if (!result.ok) {
      c.header("Retry-After", String(result.resetSeconds))
      // Same envelope the rest of the API uses, so the client's ApiError path
      // handles it without a special case.
      return c.json(envelope(c, "Too many requests", "RATE_LIMITED", opts.getRequestId), 429)
    }
    return next()
  }
}

function envelope<E extends Env>(
  c: Context<E>,
  error: string,
  code: string,
  getRequestId?: (c: Context<E>) => string | undefined,
) {
  const requestId = getRequestId ? getRequestId(c) : (c.get("reqId" as never) as string | undefined)
  return { success: false as const, error, code, ...(requestId ? { requestId } : {}) }
}
