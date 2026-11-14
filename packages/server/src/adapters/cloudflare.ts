/**
 * Cloudflare bindings as Signet adapters: Workers KV, R2 and a Queues producer. Structural types, so no workers-types dependency.
 *
 * `waitUntilDefer(ctx)` lives in `./adapters`; the Queues consumer is
 * `cloudflareConsumer` in `./jobs`.
 */

import type { BlobStore, KeyValue, Queue } from "./index.js"

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

/**
 * The subset of a Queues producer binding this uses.
 * https://developers.cloudflare.com/queues/configuration/javascript-apis/#producer
 */
export type QueueBindingLike<T> = {
  send(body: T, options?: { delaySeconds?: number }): Promise<unknown>
  sendBatch(
    messages: Iterable<{ body: T; delaySeconds?: number }>,
    options?: { delaySeconds?: number },
  ): Promise<unknown>
}

/** Messages per `sendBatch` call. https://developers.cloudflare.com/queues/platform/limits/ */
export const QUEUE_BATCH_MAX = 100

export type CloudflareQueue<T> = Queue<T> & {
  sendBatch(messages: readonly T[], opts?: { delaySeconds?: number }): Promise<void>
}

/**
 * A Queues producer binding as a `Queue<T>`, for `createJobs({ queue })` or
 * your own messages; `cloudflareConsumer` in `./jobs` is the other end.
 * Delays are rounded up to whole seconds (Queues takes integers, max 24 h);
 * `sendBatch` is split into calls of 100, Cloudflare's per-call limit. The
 * 256 KB per-batch and 128 KB per-message limits are Cloudflare's to enforce.
 */
export function cloudflareQueue<T>(binding: QueueBindingLike<T>): CloudflareQueue<T> {
  const delay = (opts?: { delaySeconds?: number }) =>
    opts?.delaySeconds ? { delaySeconds: Math.ceil(opts.delaySeconds) } : undefined
  return {
    async send(message, opts) {
      await binding.send(message, delay(opts))
    },
    async sendBatch(messages, opts) {
      for (let i = 0; i < messages.length; i += QUEUE_BATCH_MAX) {
        await binding.sendBatch(
          messages.slice(i, i + QUEUE_BATCH_MAX).map((body) => ({ body })),
          delay(opts),
        )
      }
    },
  }
}
