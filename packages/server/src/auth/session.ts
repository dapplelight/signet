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
  /**
   * Keys being rotated out. A cookie signed with one of these still verifies,
   * and `checkSession` hands back a copy re-signed with `secret`, so a key
   * rotates without signing anyone out. Drop a key once `ttlSeconds` has
   * passed since it stopped being `secret`.
   */
  previousSecrets?: string[]
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
  /**
   * Stored-session id (`./sessions`). A token carrying one is only valid
   * against its store, so the stateless `verifySession` rejects it.
   */
  sid?: string
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

const MIN_SECRET_LENGTH = 32

/** HMAC-SHA256 of `data`, base64url. Throws on a secret shorter than 32 characters. */
export async function hmacSha256(secret: string, data: string): Promise<string> {
  if (!secret || secret.length < MIN_SECRET_LENGTH)
    throw new Error(`Session secret must be at least ${MIN_SECRET_LENGTH} characters.`)
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

/**
 * Constant-time string compare. Prevents timing oracles on signature checks.
 * Pass the expected (secret) value as `b`: the loop runs over its length, so the
 * time taken does not reveal how long the secret is.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i)
  return diff === 0
}

export async function issueSession(
  opts: SessionOptions,
  sub?: string,
  extra: { sid?: string; ttlSeconds?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    iat: now,
    exp: now + (extra.ttlSeconds ?? opts.ttlSeconds ?? DEFAULT_TTL),
    v: 1,
    ...(sub ? { sub } : {}),
    ...(extra.sid ? { sid: extra.sid } : {}),
  }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${await hmacSha256(opts.secret, body)}`
}

/**
 * Verify a token against `secret` and then each of `previousSecrets`. Returns
 * the payload, and `resigned` — the same payload (same `iat`/`exp`) signed with
 * `secret` — when an old key matched: send it back as the new cookie.
 * Accepts stored-session tokens too; `./sessions` checks those against the store.
 */
export async function checkSession(
  token: string | undefined | null,
  opts: SessionOptions,
): Promise<{ payload: SessionPayload; resigned?: string } | null> {
  if (!token) return null
  const [body, sig, extra] = token.split(".")
  if (!body || !sig || extra !== undefined) return null
  let keyIndex = -1
  const keys = [opts.secret, ...(opts.previousSecrets ?? [])]
  for (let i = 0; i < keys.length; i++) {
    // Constant-time — a plain !== leaks signature bytes through response timing.
    // Every key is tried, so timing does not reveal which one matched.
    if (timingSafeEqual(sig, await hmacSha256(keys[i] as string, body)) && keyIndex < 0)
      keyIndex = i
  }
  if (keyIndex < 0) return null
  let payload: SessionPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(unb64url(body))) as SessionPayload
  } catch {
    return null
  }
  if (payload?.v !== 1 || typeof payload.exp !== "number") return null
  if (payload.exp < Math.floor(Date.now() / 1000)) return null
  if (keyIndex === 0) return { payload }
  return { payload, resigned: `${body}.${await hmacSha256(opts.secret, body)}` }
}

/** Stateless verify. Rejects stored-session tokens (they carry `sid`): use `./sessions` for those. */
export async function verifySession(
  token: string | undefined | null,
  opts: SessionOptions,
): Promise<SessionPayload | null> {
  const checked = await checkSession(token, opts)
  if (!checked || checked.payload.sid !== undefined) return null
  return checked.payload
}

function cookieAttrs(opts: SessionOptions): string[] {
  const sameSite = opts.sameSite ?? "lax"
  return [
    "HttpOnly",
    // SameSite=None is meaningless without Secure and browsers drop the cookie.
    "Secure",
    `SameSite=${sameSite === "none" ? "None" : sameSite === "strict" ? "Strict" : "Lax"}`,
    "Path=/",
    ...(opts.domain ? [`Domain=${opts.domain}`] : []),
  ]
}

/** `maxAgeSeconds` defaults to `ttlSeconds`; pass `exp - now` when re-sending a re-signed token. */
export function sessionCookie(token: string, opts: SessionOptions, maxAgeSeconds?: number): string {
  return [
    `${opts.cookieName}=${token}`,
    ...cookieAttrs(opts),
    `Max-Age=${Math.max(0, maxAgeSeconds ?? opts.ttlSeconds ?? DEFAULT_TTL)}`,
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
