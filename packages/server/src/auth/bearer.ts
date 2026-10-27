/**
 * Bearer-token auth for machine callers — CLIs, MCP servers, webhooks, cron.
 *
 * Two shapes, both found in the audit:
 *   - single shared token in an env var (app-h)
 *   - per-user tokens stored hashed in a table (app-a, `app_` prefix)
 *
 * Only the hash is ever stored, so a database leak does not yield live tokens.
 */

import { timingSafeEqual } from "./session.js"

export function readBearer(headers: Headers): string | null {
  const h = headers.get("authorization") ?? ""
  if (!/^Bearer\s+/i.test(h)) return null
  const token = h.replace(/^Bearer\s+/i, "").trim()
  return token || null
}

/** Single shared token compared against an env secret. Constant-time. */
export function verifySharedToken(headers: Headers, expected: string | undefined | null): boolean {
  const token = readBearer(headers)
  if (!token || !expected) return false
  return timingSafeEqual(token, expected)
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Mint a prefixed API token. The prefix makes tokens greppable in logs and
 * lets secret scanners recognise them. Returns the raw token — show it once,
 * store only `hash`.
 */
export async function createApiToken(prefix: string): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const body = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  const token = `${prefix}_${body}`
  return { token, hash: await sha256Hex(token) }
}

/** Hash an incoming token for table lookup. Returns null when absent or wrong prefix. */
export async function hashIncomingToken(headers: Headers, prefix: string): Promise<string | null> {
  const token = readBearer(headers)
  if (!token?.startsWith(`${prefix}_`)) return null
  return sha256Hex(token)
}
