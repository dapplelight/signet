/**
 * Where jobs run: a Cloudflare Queues consumer, an Upstash QStash receiver (signature verified with Web Crypto), and an in-process Node/Bun worker.
 */

import { memoryQueue } from "../adapters/index.js"
import { type CreateJobsOptions, createJobs, type JobMessage, type Jobs } from "./jobs.js"

/** The subset of a Cloudflare Queues `MessageBatch` this uses. */
export type QueueBatchLike = {
  messages: readonly { body: unknown; ack(): void; retry(opts?: { delaySeconds?: number }): void }[]
}

/**
 * `export default { queue: cloudflareConsumer(jobs) }`. Each message is run
 * and acked: a failing job is retried by `handle` itself (re-sent with
 * backoff) or dead-lettered, so the batch never redelivers it. Only an error
 * in `handle`'s own plumbing (the store or queue down) asks Cloudflare to retry.
 */
export function cloudflareConsumer(jobs: Pick<Jobs, "handle">, retryDelaySeconds = 30) {
  return async (batch: QueueBatchLike): Promise<void> => {
    for (const msg of batch.messages) {
      try {
        await jobs.handle(msg.body as JobMessage)
        msg.ack()
      } catch {
        msg.retry({ delaySeconds: retryDelaySeconds })
      }
    }
  }
}

export type QstashKeys = {
  currentSigningKey: string
  nextSigningKey: string
}

const enc = new TextEncoder()

function b64url(bytes: ArrayBuffer): string {
  let bin = ""
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromB64url(s: string): string {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/")
  return atob(pad + "=".repeat((4 - (pad.length % 4)) % 4))
}

async function verifyWith(
  jwt: string,
  key: string,
  body: string,
  url: string | undefined,
  now: number,
): Promise<boolean> {
  const [header, payload, signature, extra] = jwt.split(".")
  if (!header || !payload || !signature || extra !== undefined) return false
  const hmac = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  )
  let sig: Uint8Array<ArrayBuffer>
  try {
    sig = Uint8Array.from(fromB64url(signature), (c) => c.charCodeAt(0))
  } catch {
    return false
  }
  if (!(await crypto.subtle.verify("HMAC", hmac, sig, enc.encode(`${header}.${payload}`))))
    return false
  let claims: { iss?: string; sub?: string; exp?: number; nbf?: number; body?: string }
  try {
    if (JSON.parse(fromB64url(header)).alg !== "HS256") return false
    claims = JSON.parse(fromB64url(payload))
  } catch {
    return false
  }
  if (claims.iss !== "Upstash") return false
  if (url !== undefined && claims.sub?.replace(/\/+$/, "") !== url.replace(/\/+$/, "")) return false
  if (typeof claims.exp !== "number" || now > claims.exp) return false
  if (typeof claims.nbf === "number" && now < claims.nbf) return false
  const hash = b64url(await crypto.subtle.digest("SHA-256", enc.encode(body)))
  return claims.body?.replace(/=+$/, "") === hash
}

/**
 * Verify an `Upstash-Signature` header: an HS256 JWT signed with the current
 * signing key, or the next one during rotation. Checks `iss` = "Upstash",
 * `exp`/`nbf`, the SHA-256 of the raw body, and `sub` against `url` when given
 * (the destination URL QStash called; pass it when a proxy changes `request.url`).
 */
export async function verifyQstashSignature(args: {
  signature: string | null
  body: string
  keys: QstashKeys
  url?: string
  /** Seconds since epoch. Default now. */
  now?: number
}): Promise<boolean> {
  const { signature, body, keys, url, now = Math.floor(Date.now() / 1000) } = args
  if (!signature) return false
  for (const key of [keys.currentSigningKey, keys.nextSigningKey]) {
    if (key && (await verifyWith(signature, key, body, url, now))) return true
  }
  return false
}

/**
 * A fetch handler for QStash deliveries (`qstashQueue`'s destination): verify,
 * run, answer 200. A bad signature answers 401; a plumbing error answers 500,
 * which QStash retries. Pass the keys from env per request.
 */
export function qstashReceiver(
  jobs: Pick<Jobs, "handle">,
  options: { keys: QstashKeys; url?: string },
) {
  return async (request: Request): Promise<Response> => {
    const body = await request.text()
    const valid = await verifyQstashSignature({
      signature: request.headers.get("upstash-signature"),
      body,
      keys: options.keys,
      url: options.url ?? request.url,
    })
    if (!valid) return Response.json({ success: false, error: "Bad signature" }, { status: 401 })
    let message: JobMessage
    try {
      message = JSON.parse(body)
    } catch {
      return Response.json({ success: false, error: "Body is not JSON" }, { status: 400 })
    }
    try {
      const result = await jobs.handle(message)
      return Response.json({ success: true, ...result })
    } catch {
      return Response.json({ success: false, error: "Job plumbing failed" }, { status: 500 })
    }
  }
}

/**
 * Node/Bun, one process: jobs on `memoryQueue`, run in the background of
 * this process. Pending messages are lost on exit; use a real queue
 * (QStash, Cloudflare) or `startWorker` over a durable one when that matters.
 */
export function inProcessJobs(
  options: Omit<CreateJobsOptions, "queue">,
  onError: (err: unknown) => void = console.error,
): Jobs {
  let jobs: Jobs | undefined
  const queue = memoryQueue<JobMessage>((m) => jobs?.handle(m), onError)
  jobs = createJobs({ ...options, queue })
  return jobs
}

/**
 * Poll a queue you own (a table, a Redis list) and run what it returns.
 * `receive` hands back up to a batch of messages; each one is acked after
 * `handle` resolves. Returns a stop function.
 */
export function startWorker(
  jobs: Pick<Jobs, "handle">,
  source: {
    receive(): Promise<readonly JobMessage[]>
    ack?(message: JobMessage): Promise<void>
  },
  options: { intervalMs?: number; onError?: (err: unknown) => void } = {},
): () => void {
  const { intervalMs = 1000, onError = console.error } = options
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const loop = async () => {
    try {
      for (const m of await source.receive()) {
        await jobs.handle(m)
        await source.ack?.(m)
      }
    } catch (err) {
      onError(err)
    }
    if (!stopped) timer = setTimeout(loop, intervalMs)
  }
  void loop()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
