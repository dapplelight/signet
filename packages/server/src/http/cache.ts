/**
 * HTTP caching for GET routes. Requires `hono` as an optional peer.
 *
 *   app.get("/plans", httpCache({ maxAge: 300 }), list)              // public, ETag + 304
 *   app.get("/me/orders", auth, httpCache({ private: true }), mine)  // per user
 *   app.get("/stats", (c) => cachedResponse(c, { kv, freshSeconds: 60, staleSeconds: 600 }, () => c.json(build())))
 *
 * Per-user responses: `private: true` (or `cachedResponse`'s `varyBy`) adds
 * `Cache-Control: private` so a CDN never stores one user's body for another,
 * and `Vary: Cookie, Authorization` so a browser cache keys on who asked.
 */

import type { Context, MiddlewareHandler } from "hono"
import type { Defer, KeyValue } from "../adapters/index.js"

export type CacheControlOptions = {
  /** Seconds a cache may reuse the response without asking. Default 0 (revalidate every time, cheap with the ETag). */
  maxAge?: number
  /** Shared caches (CDN) only. Ignored with `private`. */
  sMaxAge?: number
  /** Seconds a stale response may be served while revalidating in the background. */
  staleWhileRevalidate?: number
  /** Seconds a stale response may be served when the origin errors. */
  staleIfError?: number
  /** Per-user: `private`, plus `Vary: Cookie, Authorization`. */
  private?: boolean
  /** Never store (secrets, one-time tokens). Overrides the rest. */
  noStore?: boolean
  /** More request headers the body depends on, e.g. `["Accept-Language"]`. */
  vary?: string[]
}

/** The `Cache-Control` value for `opts`. */
export function cacheControlValue(opts: CacheControlOptions): string {
  if (opts.noStore) return "no-store"
  const maxAge = opts.maxAge ?? 0
  const parts = [opts.private ? "private" : "public"]
  parts.push(maxAge > 0 ? `max-age=${maxAge}` : "no-cache")
  if (opts.sMaxAge !== undefined && !opts.private) parts.push(`s-maxage=${opts.sMaxAge}`)
  if (opts.staleWhileRevalidate) parts.push(`stale-while-revalidate=${opts.staleWhileRevalidate}`)
  if (opts.staleIfError) parts.push(`stale-if-error=${opts.staleIfError}`)
  return parts.join(", ")
}

/**
 * Add names to a `Vary` header value: case-insensitive dedupe, and `*`
 * absorbs everything. `mergeVary("Accept", "cookie", "Cookie")` is `Accept, cookie`.
 */
export function mergeVary(existing: string | null | undefined, ...names: string[]): string {
  const out: string[] = []
  for (const n of [...(existing ?? "").split(","), ...names].map((s) => s.trim()).filter(Boolean)) {
    if (n === "*") return "*"
    if (!out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n)
  }
  return out.join(", ")
}

const PER_USER = ["Cookie", "Authorization"]
// What a 304 keeps (RFC 9110 15.4.5).
const KEEP_ON_304 = ["cache-control", "content-location", "date", "etag", "expires", "vary"]

async function digest(body: ArrayBuffer): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", body))
  return [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

const stripWeak = (t: string) => t.trim().replace(/^W\//, "")
/** Weak comparison, as If-None-Match requires. */
export function etagMatches(etag: string, ifNoneMatch: string | null | undefined): boolean {
  if (!ifNoneMatch) return false
  if (ifNoneMatch.trim() === "*") return true
  return ifNoneMatch.split(",").some((t) => stripWeak(t) === stripWeak(etag))
}

/**
 * Cache headers and conditional GETs for GET and HEAD routes: on a 2xx it
 * sets `Cache-Control` (unless the handler set its own), merges `Vary`, adds
 * an `ETag` from a hash of the body (unless the handler set one) and answers
 * `If-None-Match` with a 304 that keeps the cache headers. Other methods and
 * statuses pass through untouched.
 */
export function httpCache(opts: CacheControlOptions = {}): MiddlewareHandler {
  const value = cacheControlValue(opts)
  const vary = [...(opts.private ? PER_USER : []), ...(opts.vary ?? [])]
  return async (c, next) => {
    await next()
    if (
      (c.req.method !== "GET" && c.req.method !== "HEAD") ||
      c.res.status < 200 ||
      c.res.status > 299
    )
      return
    const headers = new Headers(c.res.headers)
    if (!headers.has("Cache-Control")) headers.set("Cache-Control", value)
    if (vary.length) headers.set("Vary", mergeVary(headers.get("Vary"), ...vary))
    if (opts.noStore) {
      c.res = new Response(c.res.body, { status: c.res.status, headers })
      return
    }
    let etag = headers.get("ETag")
    const body = await c.res.arrayBuffer()
    if (!etag) {
      etag = `"${await digest(body)}"`
      headers.set("ETag", etag)
    }
    if (etagMatches(etag, c.req.header("If-None-Match"))) {
      for (const k of [...headers.keys()]) if (!KEEP_ON_304.includes(k)) headers.delete(k)
      c.res = new Response(null, { status: 304, headers })
      return
    }
    c.res = new Response(c.req.method === "HEAD" ? null : body, { status: c.res.status, headers })
  }
}

export type ResponseCacheOptions = {
  /** Any Signet `KeyValue`: `memoryKv`, `cloudflareKv`, `upstashKv`. */
  kv: KeyValue
  /** Served from the cache without rendering. */
  freshSeconds: number
  /** After fresh: served from the cache while one background render refreshes it. Then it is gone. */
  staleSeconds: number
  /** Default: method and full URL. */
  key?: string
  /**
   * Per-user: who asked (a user or org id). Part of the cache key, and the
   * response is marked `Cache-Control: private` with `Vary: Cookie, Authorization`.
   * Leave it out only when the body is the same for everyone.
   */
  varyBy?: string
  /** Runs the background refresh. Default: `c.executionCtx.waitUntil` on Workers, else fire and forget. */
  defer?: Defer
  /** Key prefix. Default "signet-rc". */
  prefix?: string
}

type Entry = { s: number; h: [string, string][]; b: string; t: number }

/**
 * A stale-while-revalidate cache of a handler's response in a `KeyValue`.
 * Only 200s are stored, as text (JSON, HTML), never `Set-Cookie`.
 * `X-Cache` says `HIT`, `STALE` or `MISS`.
 *
 * Workers KV is eventually consistent and rounds TTLs up to 60 s, so a
 * refresh in one region shows in another a little later; fine for a cache.
 */
// ponytail: bodies are stored as text; binary responses need base64 here before caching them.
export async function cachedResponse<R extends Response>(
  c: Context,
  opts: ResponseCacheOptions,
  render: () => R | Promise<R>,
): Promise<R> {
  const raw = `${opts.key ?? `${c.req.method} ${c.req.url}`}\n${opts.varyBy ?? ""}`
  const key = `${opts.prefix ?? "signet-rc"}:${await digest(new TextEncoder().encode(raw).buffer as ArrayBuffer)}`
  const ttl = opts.freshSeconds + opts.staleSeconds

  const mark = (res: Response, state: "HIT" | "STALE" | "MISS") => {
    const headers = new Headers(res.headers)
    headers.set("X-Cache", state)
    if (opts.varyBy !== undefined) {
      if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, no-cache")
      headers.set("Vary", mergeVary(headers.get("Vary"), ...PER_USER))
    }
    return new Response(res.body, { status: res.status, headers }) as R
  }
  const store = async (res: Response) => {
    if (res.status !== 200 || res.headers.has("Set-Cookie")) return res
    const b = await res.clone().text()
    const entry: Entry = { s: res.status, h: [...res.headers], b, t: Date.now() }
    try {
      await opts.kv.set(key, JSON.stringify(entry), { ttlSeconds: ttl })
    } catch {
      // a failed cache write (KV 429, network) must not fail a good response
    }
    return res
  }

  let hit: Entry | undefined
  try {
    const v = await opts.kv.get(key)
    hit = v ? (JSON.parse(v) as Entry) : undefined
  } catch {
    hit = undefined // a broken cache is a miss, never an error
  }
  const age = hit ? (Date.now() - hit.t) / 1000 : Number.POSITIVE_INFINITY
  if (hit && age < ttl) {
    const res = new Response(hit.b, { status: hit.s, headers: hit.h })
    if (age < opts.freshSeconds) return mark(res, "HIT")
    const lock = `${key}:refresh`
    const refresh = (async () => {
      // Another request is already refreshing it. Atomic with `incr`; best effort without (Workers KV).
      if (opts.kv.incr) {
        if ((await opts.kv.incr(lock, 30)) > 1) return
      } else {
        if (await opts.kv.get(lock)) return
        await opts.kv.set(lock, "1", { ttlSeconds: 30 })
      }
      try {
        await store(await render())
      } finally {
        await opts.kv.delete(lock)
      }
    })()
    if (opts.defer) opts.defer(refresh)
    else {
      const caught = refresh.catch(() => {})
      try {
        c.executionCtx.waitUntil(caught)
      } catch {}
    }
    return mark(res, "STALE")
  }
  return mark(await store(await render()), "MISS")
}
