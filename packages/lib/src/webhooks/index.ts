/**
 * Standard Webhooks signatures (https://www.standardwebhooks.com), Web Crypto
 * only, so the same code signs on a Worker and verifies in any receiver.
 *
 *   webhook-id         the event id; the same on every retry and redelivery,
 *                      so a receiver dedupes on it
 *   webhook-timestamp  unix seconds when this attempt was signed
 *   webhook-signature  `v1,<base64 HMAC-SHA256>` of `${id}.${timestamp}.${body}`,
 *                      keyed by the base64 part of the `whsec_` secret.
 *                      Space separated when several secrets sign (rotation).
 *
 * Svix and Resend use the same scheme with `svix-*` header names; pass
 * `headerPrefix: "svix"` to verify theirs.
 */

const enc = new TextEncoder()

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

function keyBytes(secret: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0))
}

async function hmac(secret: string, content: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    keyBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(content))))
}

/** Constant-time string compare. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/** A new `whsec_` secret: 32 random bytes, base64. Show it to the owner once. */
export function generateWebhookSecret(): string {
  return `whsec_${b64(crypto.getRandomValues(new Uint8Array(32)))}`
}

/**
 * The three headers for one delivery attempt. `secret` may be a list during
 * rotation: each signs, and a receiver holding either secret verifies.
 */
export async function signWebhook(input: {
  secret: string | readonly string[]
  id: string
  body: string
  /** Unix seconds. Default now. */
  timestamp?: number
}): Promise<Record<"webhook-id" | "webhook-timestamp" | "webhook-signature", string>> {
  const ts = String(input.timestamp ?? Math.floor(Date.now() / 1000))
  const secrets = typeof input.secret === "string" ? [input.secret] : input.secret
  const sigs = await Promise.all(
    secrets.map(async (s) => `v1,${await hmac(s, `${input.id}.${ts}.${input.body}`)}`),
  )
  return { "webhook-id": input.id, "webhook-timestamp": ts, "webhook-signature": sigs.join(" ") }
}

export type VerifyWebhookOptions = {
  /** Reject timestamps further than this from now, either way (replays). Default 300 s. */
  toleranceSeconds?: number
  /** Milliseconds, for tests. Default `Date.now()`. */
  now?: number
  /** Header names are `${prefix}-id` etc. Default "webhook"; "svix" for Svix and Resend. */
  headerPrefix?: string
}

/**
 * True when one of the `v1` signatures matches and the timestamp is within
 * tolerance. Pass the raw body text exactly as received: re-serialised JSON
 * does not verify. A malformed secret or header is false, never a throw.
 */
export async function verifyWebhook(
  secret: string,
  headers: Headers | Record<string, string | undefined>,
  body: string,
  opts: VerifyWebhookOptions = {},
): Promise<boolean> {
  const p = opts.headerPrefix ?? "webhook"
  const get = (n: string) =>
    headers instanceof Headers ? headers.get(n) : (headers[n] ?? headers[n.toLowerCase()] ?? null)
  const id = get(`${p}-id`)
  const ts = get(`${p}-timestamp`)
  const sigs = get(`${p}-signature`)
  if (!id || !ts || !sigs || !/^\d+$/.test(ts)) return false
  const now = Math.floor((opts.now ?? Date.now()) / 1000)
  if (Math.abs(now - Number(ts)) > (opts.toleranceSeconds ?? 300)) return false
  let expected: string
  try {
    expected = await hmac(secret, `${id}.${ts}.${body}`)
  } catch {
    return false
  }
  return sigs.split(" ").some((s) => s.startsWith("v1,") && same(s.slice(3), expected))
}
