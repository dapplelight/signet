/**
 * Cloudflare bindings as Signet adapters: Workers KV and R2. Structural types, so no workers-types dependency.
 *
 * A Queues binding already is a `Queue<T>` (same `send(body, { delaySeconds })`),
 * and `waitUntilDefer(ctx)` lives in `./adapters`, so neither needs a wrapper.
 */

import type { BlobStore, KeyValue } from "./index.js"

/** The subset of a Workers KV namespace this uses. */
export type KvNamespaceLike = {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

/** The subset of an R2 bucket binding this uses. */
export type R2BucketLike = {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>
    httpMetadata?: { contentType?: string }
  } | null>
  delete(key: string): Promise<void>
}

/**
 * Workers KV as a `KeyValue`. No `incr`: KV has no atomic increment and is
 * eventually consistent, so `kvRateLimitStore` over it is approximate. KV's
 * minimum TTL is 60s; shorter TTLs are raised to it.
 */
export function cloudflareKv(namespace: KvNamespaceLike): KeyValue {
  return {
    get: (key) => namespace.get(key),
    set: (key, value, opts) =>
      namespace.put(
        key,
        value,
        opts?.ttlSeconds ? { expirationTtl: Math.max(60, opts.ttlSeconds) } : undefined,
      ),
    delete: (key) => namespace.delete(key),
  }
}

/** R2 as a `BlobStore`. No `signedUrl`: a binding cannot presign; use R2's S3 API for that. */
export function r2BlobStore(bucket: R2BucketLike): BlobStore {
  return {
    async put(key, body, opts) {
      await bucket.put(
        key,
        body,
        opts?.contentType ? { httpMetadata: { contentType: opts.contentType } } : undefined,
      )
    },
    async get(key) {
      const obj = await bucket.get(key)
      if (!obj) return null
      return { body: await obj.arrayBuffer(), contentType: obj.httpMetadata?.contentType }
    },
    delete: (key) => bucket.delete(key),
  }
}
