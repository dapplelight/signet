/**
 * Stateless HMAC-signed session cookie. No database, no session table.
 *
 * Generalised from app-c/apps/worker/src/auth/session.ts, which was the
 * cleanest implementation in the audit: Web Crypto only, no dependencies, runs
 * on Workers and Node alike.
 *
 * Use when there is no user table — a shared passcode gate, an invite site, an
 * admin dashboard with one login. For a real user system use `betterAuthConfig`.
 */

export type SessionOptions = {
  /** Cookie name. Namespace it per app: "hf_session", "rsvp_session". */
  cookieName: string
  /** Signing secret. Must be high-entropy and per-environment. */
  secret: string
  /** Lifetime in seconds. Default 14 days. */
  ttlSeconds?: number
  /**
   * Cross-site cookie. "none" is required when the frontend and API are on
   * different origins (Pages → Worker) and forces Secure. Default "lax".
   */
  sameSite?: "strict" | "lax" | "none"
  /** Scope to all subdomains, e.g. ".example.com". */
  domain?: string
}

export type SessionPayload = {
  /** Issued at, epoch seconds. */
  iat: number
  /** Expires at, epoch seconds. */
  exp: number
  /** Payload version, for forward-compatible changes. */
  v: 1
  /** Optional opaque subject — a user id, a guest id, a household id. */
  sub?: string
}

const DEFAULT_TTL = 60 * 60 * 24 * 14

function b64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes
  let s = ""
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

function unb64url(input: string): Uint8Array {
  const pad = "=".repeat((4 - (input.length % 4)) % 4)
  const s = atob(input.replaceAll("-", "+").replaceAll("_", "/") + pad)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))
  return b64url(new Uint8Array(sig))
}

/** Constant-time string compare. Prevents timing oracles on signature checks. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function issueSession(opts: SessionOptions, sub?: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    iat: now,
    exp: now + (opts.ttlSeconds ?? DEFAULT_TTL),
    v: 1,
    ...(sub ? { sub } : {}),
  }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${await hmac(opts.secret, body)}`
}

export async function verifySession(
  token: string | undefined | null,
  opts: SessionOptions,
): Promise<SessionPayload | null> {
  if (!token) return null
  const [body, sig] = token.split(".")
  if (!body || !sig) return null
  // Constant-time — a plain !== leaks signature bytes through response timing.
  if (!timingSafeEqual(await hmac(opts.secret, body), sig)) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body))) as SessionPayload
    if (payload.v !== 1) return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

function cookieAttrs(opts: SessionOptions): string[] {
  const sameSite = opts.sameSite ?? "lax"
  return [
    "HttpOnly",
    // SameSite=None is meaningless without Secure and browsers drop the cookie.
    ...(sameSite === "none" ? ["Secure"] : ["Secure"]),
    `SameSite=${sameSite === "none" ? "None" : sameSite === "strict" ? "Strict" : "Lax"}`,
    "Path=/",
    ...(opts.domain ? [`Domain=${opts.domain}`] : []),
  ]
}

export function sessionCookie(token: string, opts: SessionOptions): string {
  return [
    `${opts.cookieName}=${token}`,
    ...cookieAttrs(opts),
    `Max-Age=${opts.ttlSeconds ?? DEFAULT_TTL}`,
  ].join("; ")
}

export function clearCookie(opts: SessionOptions): string {
  return [`${opts.cookieName}=`, ...cookieAttrs(opts), "Max-Age=0"].join("; ")
}

export function readSessionCookie(
  cookieHeader: string | null | undefined,
  opts: SessionOptions,
): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const p = part.trim()
    if (p.startsWith(`${opts.cookieName}=`)) return p.slice(opts.cookieName.length + 1)
  }
  return null
}
