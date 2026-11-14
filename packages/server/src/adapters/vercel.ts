/**
 * Vercel as Signet adapters. No dependency on `@vercel/functions` or `@vercel/blob`.
 *
 * - Background work: `vercelDefer(waitUntil)`, passing `waitUntil` from
 *   `@vercel/functions` (in Next.js 15.1+, `after` from `next/server` works
 *   too). https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil
 * - Key-value, exact rate limiting, queues: Vercel KV is now Upstash Redis
 *   from the Marketplace, so use `upstashKv`, `upstashRateLimitStore` and
 *   `qstashQueue` from `./adapters/upstash` with the REST URL and token the
 *   integration adds to the project. https://vercel.com/docs/redis
 * - Blob storage: not here. Vercel documents Blob only through its SDKs
 *   (`@vercel/blob`, Python `vercel`), not as an HTTP API, so there is nothing
 *   stable to call over fetch. Use `s3BlobStore`, `supabaseBlobStore`, or
 *   `@vercel/blob` directly. https://vercel.com/docs/vercel-blob
 */

import type { Defer } from "./index.js"

/**
 * Vercel's `waitUntil` as a `Defer`: the function stays alive until the work
 * settles, up to its own timeout (work still running then is cancelled). A
 * rejection goes to `onError` instead of becoming an unhandled rejection.
 *
 * ```ts
 * import { waitUntil } from "@vercel/functions"
 * const defer = vercelDefer(waitUntil)
 * ```
 */
export function vercelDefer(
  waitUntil: (promise: Promise<unknown>) => void,
  onError: (err: unknown) => void = console.error,
): Defer {
  return (work) => waitUntil(work.catch(onError))
}
