/**
 * Small plug interfaces so server code runs off Cloudflare too, plus in-memory and Node/Bun versions.
 *
 * Providers live in sibling subpaths: `./adapters/node` (filesystem blobs),
 * `./adapters/cloudflare` (KV, R2), `./adapters/upstash` (Redis REST, QStash)
 * and `./adapters/supabase` (Storage). None adds a dependency: each is fetch or
 * a structural binding type. Every adapter takes its config as an argument.
 */

import type { RateLimitStore } from "../middleware/rate-limit.js"

export type KeyValue = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, opts?: { ttlSeconds?: number }): Promise<void>
  delete(key: string): Promise<void>
  /**
   * Atomic increment. Creates the key at 1 with `ttlSeconds`; a later
   * increment keeps the TTL it started with. Absent when the backend cannot
   * do it atomically (Workers KV).
   */
  incr?(key: string, ttlSeconds: number): Promise<number>
}

export type Queue<T> = {
  send(message: T, opts?: { delaySeconds?: number }): Promise<void>
}

export type BlobBody = ArrayBuffer | Uint8Array | string

export type BlobStore = {
  put(key: string, body: BlobBody, opts?: { contentType?: string }): Promise<void>
  get(key: string): Promise<{ body: ArrayBuffer; contentType?: string } | null>
  delete(key: string): Promise<void>
  signedUrl?(
    key: string,
    opts: { expiresInSeconds: number; method?: "GET" | "PUT" },
  ): Promise<string>
}

/** Run work after the response without blocking it, e.g. `waitUntilDefer(ctx)`. */
export type Defer = (work: Promise<unknown>) => void

/** In-process key-value store with TTLs. One process only; lost on restart. */
export function memoryKv(): KeyValue {
  const map = new Map<string, { value: string; expiresAt: number }>()
  const read = (key: string) => {
    const hit = map.get(key)
    if (hit && hit.expiresAt <= Date.now()) map.delete(key)
    return map.get(key)
  }
  const expiry = (ttl?: number) => (ttl ? Date.now() + ttl * 1000 : Number.POSITIVE_INFINITY)
  return {
    async get(key) {
      return read(key)?.value ?? null
    },
    async set(key, value, opts) {
      map.set(key, { value, expiresAt: expiry(opts?.ttlSeconds) })
    },
    async delete(key) {
      map.delete(key)
    },
    async incr(key, ttlSeconds) {
      const hit = read(key)
      const value = String(Number(hit?.value ?? 0) + 1)
      map.set(key, { value, expiresAt: hit?.expiresAt ?? expiry(ttlSeconds) })
      return Number(value)
    },
  }
}

/**
 * In-process queue: `handler` runs after the delay. A handler error is logged
 * (or given to `onError`), never thrown back at the sender. No retries, and
 * pending messages are lost if the process exits.
 */
export function memoryQueue<T>(
  handler: (message: T) => unknown,
  onError: (err: unknown) => void = console.error,
): Queue<T> {
  return {
    async send(message, opts) {
      setTimeout(
        () => {
          Promise.resolve()
            .then(() => handler(message))
            .catch(onError)
        },
        (opts?.delaySeconds ?? 0) * 1000,
      )
    },
  }
}

/** Node/Bun: the process outlives the response, so just let the work run and catch its error. */
export function processDefer(onError: (err: unknown) => void = console.error): Defer {
  return (work) => {
    work.catch(onError)
  }
}

/** Workers `ctx`, Netlify `context`, or anything else with the standard `waitUntil`. */
export function waitUntilDefer(ctx: { waitUntil(promise: Promise<unknown>): void }): Defer {
  return (work) => ctx.waitUntil(work)
}

/**
 * A `RateLimitStore` over any `KeyValue`. Fixed window, keyed per window, so
 * up to 2× `max` can pass across a boundary (same as `memoryStore`).
 *
 * Exact when the store has `incr` (Upstash, `memoryKv`). Without it the count
 * is a read-modify-write: APPROXIMATE, because concurrent hits can read the
 * same value and lose increments, and Workers KV is eventually consistent on
 * top of that. Fine for smoothing, not for a login limiter.
 */
export function kvRateLimitStore(kv: KeyValue, prefix = "signet-rl"): RateLimitStore {
  return {
    async hit(scope, key, max, windowSeconds) {
      const now = Date.now()
      const windowMs = windowSeconds * 1000
      const bucket = Math.floor(now / windowMs)
      const id = `${prefix}:${scope}:${key}:${bucket}`
      let count: number
      if (kv.incr) {
        count = await kv.incr(id, windowSeconds)
      } else {
        count = Number((await kv.get(id)) ?? 0) + 1
        await kv.set(id, String(count), { ttlSeconds: windowSeconds })
      }
      return {
        ok: count <= max,
        remaining: Math.max(0, max - count),
        resetSeconds: Math.ceil(((bucket + 1) * windowMs - now) / 1000),
      }
    },
  }
}

/** Rejects blob keys that could escape a directory or URL path: empty, absolute, `..`, `.` or backslashes. */
export function assertBlobKey(key: string): void {
  const segments = key.split("/")
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("\0") ||
    segments.some((s) => s === ".." || s === "." || s === "")
  ) {
    throw new Error(`Invalid blob key: ${JSON.stringify(key)}`)
  }
}
