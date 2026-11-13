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
 * In-memory fixed window: the counter starts at a client's first hit and
 * resets whole when the window ends, so up to 2× `max` can land across a
 * boundary. It is not a sliding window.
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
 * Which proxy in front of the app to believe about the client IP. Headers a
 * client can set itself are never read, so a spoofed one cannot pick its own
 * rate-limit bucket.
 *
 * - `"cloudflare"`: read `cf-connecting-ip`, which the Cloudflare edge sets.
 *   Only correct when every request really comes through Cloudflare.
 * - `{ forwardedHops: n }`: `n` trusted proxies each append the address they
 *   saw to `x-forwarded-for`; the client is the n-th entry from the right.
 *   Entries further left are client-supplied and ignored, and so is
 *   `cf-connecting-ip`.
 * - `"none"`: trust nothing; there is no client IP (the default).
 */
export type ClientIpTrust = "cloudflare" | { forwardedHops: number } | "none"

const V4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/

/** The first 4 groups of an IPv6 address (its /64), the IPv4 if it is IPv4-mapped, or null if not valid IPv6. */
function v6Prefix(ip: string): string | null {
  const [addr = "", zone] = ip.split("%")
  if (zone === "" || !/^[0-9a-f:.]+$/i.test(addr)) return null
  let s = addr.toLowerCase()
  const dot = s.lastIndexOf(":") + 1
  if (s.includes(".")) {
    // embedded IPv4 (::ffff:1.2.3.4) takes the place of the last two groups
    const v4 = s.slice(dot)
    if (!V4.test(v4)) return null
    const [a = 0, b = 0, c = 0, d = 0] = v4.split(".").map(Number)
    s = `${s.slice(0, dot)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = s.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves[1] ? halves[1].split(":") : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail]
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null
  // IPv4-mapped (::ffff:a.b.c.d, either spelling) is an IPv4 client: unmap it
  // so mapped clients neither share one /64 bucket nor split from their plain IPv4 key.
  const n = groups.map((g) => Number.parseInt(g, 16))
  if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) {
    return `${(n[6] ?? 0) >> 8}.${(n[6] ?? 0) & 255}.${(n[7] ?? 0) >> 8}.${(n[7] ?? 0) & 255}`
  }
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(":")}::/64`
}

/** IPv4 as is; IPv6 grouped by /64 (one subscriber holds a whole /64); else null. */
function normalizeIp(raw: string | undefined): string | null {
  const ip = raw?.trim()
  if (!ip) return null
  if (V4.test(ip)) return ip
  return v6Prefix(ip)
}

function assertHops(hops: number) {
  if (!Number.isInteger(hops) || hops < 1) {
    throw new Error("forwardedHops must be an integer >= 1")
  }
}

/**
 * The client IP under a trust setting, or null when there is none: the header
 * the setting trusts is missing or not an IP, or `"none"`. IPv6 comes back as
 * its /64 (`2001:db8:0:1::/64`), so a client cannot dodge a limit by rotating
 * through the addresses of its own prefix.
 *
 * Never returns a shared placeholder. `rateLimit` gives a null IP its own
 * bucket per limiter instead.
 */
// biome-ignore lint/suspicious/noExplicitAny: Hono's own Context defaults to any; `Env` breaks c.env.BINDING
export function clientIp<E extends Env = any>(
  c: Context<E>,
  trust: ClientIpTrust = "none",
): string | null {
  if (trust === "cloudflare") return normalizeIp(c.req.header("cf-connecting-ip"))
  if (typeof trust === "object" && trust !== null) {
    const hops = trust.forwardedHops
    assertHops(hops)
    const entries = c.req.header("x-forwarded-for")?.split(",") ?? []
    return normalizeIp(entries[entries.length - hops])
  }
  return null
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
  /**
   * Which proxy to believe about the client IP, see `ClientIpTrust`. Default
   * `"none"`: no IP, so every request shares one bucket per limiter. Set it to
   * match the deployment. Ignored when `keyFor` is given.
   */
  trust?: ClientIpTrust
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
  const trust = opts.trust ?? "none"
  if (typeof trust === "object") assertHops(trust.forwardedHops) // fail at startup, not on request 1

  return async (c: Context<E>, next: Next) => {
    const store = fixed ?? (opts.store as (c: Context<E>) => RateLimitStore)(c)
    let result: RateLimitResult
    try {
      // No IP: one "no-ip" bucket inside this limiter's scope, never a key shared
      // with other limiters or with a real address.
      const key = opts.keyFor ? opts.keyFor(c) : (clientIp(c, trust) ?? "no-ip")
      result = await store.hit(scope, key, max, windowSeconds)
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
