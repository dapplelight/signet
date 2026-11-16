/**
 * Sign-in for clients that cannot hold the web app's cookie: a browser
 * extension or desktop app (authorization code + PKCE, S256 only) and a CLI
 * (device code, RFC 8628). Both end in bearer tokens:
 *
 *   - access token: a stored-session token (`./sessions`), short-lived
 *     (default 15 minutes), accepted by `requireStoredSession({ bearer: true })`
 *   - refresh token: opaque, stored hashed, single use and rotated on every
 *     refresh; presenting a used one revokes the whole session
 *
 * Each sign-in is a stored session, so it shows in the "your devices" list and
 * revoking it there signs the client out (access and refresh alike). The
 * session's lifetime (`refreshTtlSeconds`, default 30 days) is absolute:
 * refreshing never extends it.
 *
 * Framework-free; `clientLoginRoutes` in `./hono` mounts these as routes.
 * Errors use OAuth's shape (`{ error: "authorization_pending" }`), which is
 * what OAuth client libraries and the device flow's polling loop expect.
 *
 * Single-use codes and refresh tokens are exact on a `KeyValue` with `incr`
 * (memory, Upstash). On Workers KV, two requests racing on the same code can
 * both pass; keep this state in an exact store.
 */

import type { KeyValue } from "../adapters/index.js"
import type { RateLimitStore } from "../middleware/rate-limit.js"
import { sha256Hex } from "./bearer.js"
import { checkSession, issueSession, timingSafeEqual } from "./session.js"
import { type StoredSessionOptions, startSession } from "./sessions.js"

export type ClientLoginClient = {
  /**
   * Where `/authorize` may send the code, matched exactly, e.g.
   * `https://<extension-id>.chromiumapp.org/`. A loopback entry without a
   * port (`http://127.0.0.1/callback`) matches any port (RFC 8252), for a
   * desktop app's local listener. Absent: the client can only use the device flow.
   */
  redirectUris?: string[]
}

export type ClientLoginOptions = {
  /** The app's stored sessions. Access tokens are signed with its secret. */
  sessions: StoredSessionOptions
  /** Codes and refresh tokens. Use an exact store (with `incr`). */
  kv: KeyValue
  /** Counts device-code starts per IP and approvals per user. Use an exact store. */
  rateLimit: RateLimitStore
  /** Registered clients by `client_id`. Unknown ids are refused. */
  clients: Record<string, ClientLoginClient>
  /** The web page where a user types the device flow's code, e.g. "https://app.example.com/device". */
  verificationUri: string
  /** Default 900. */
  accessTtlSeconds?: number
  /** The session's absolute lifetime. Default 30 days. */
  refreshTtlSeconds?: number
  /** Authorization code lifetime. Default 60. */
  codeTtlSeconds?: number
  /** Device code lifetime. Default 600. */
  deviceTtlSeconds?: number
  /** Minimum seconds between device polls. Default 5; each `slow_down` adds 5. */
  pollIntervalSeconds?: number
  /** Device-code starts per IP. Default 10 per 10 minutes. */
  deviceStartsPerIp?: { max: number; windowSeconds: number }
  /** Approvals (user-code guesses) per signed-in user. Default 10 per 10 minutes. */
  approvalsPerUser?: { max: number; windowSeconds: number }
  /** KeyValue key prefix. Default "signet-cl". */
  prefix?: string
}

export type TokenResponse = {
  access_token: string
  token_type: "Bearer"
  /** Seconds. */
  expires_in: number
  refresh_token: string
}

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unsupported_grant_type"
  | "authorization_pending"
  | "slow_down"
  | "expired_token"
  | "invalid_code"
  | "rate_limited"

export type OAuthFailure = {
  ok: false
  status: 400 | 401 | 429
  error: OAuthErrorCode
  error_description?: string
  /** With `slow_down`: the interval to use from now on. */
  interval?: number
  /** With `rate_limited`. */
  retryAfterSeconds?: number
}

export type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

type CodeRecord = {
  sub: string
  clientId: string
  redirectUri: string
  challenge: string
  exp: number
}
type DeviceRecord = {
  clientId: string
  userCode: string
  exp: number
  /** The starting poll interval; the live one is in the poll record. */
  interval: number
  sub?: string
}
/** Kept apart from `DeviceRecord`, so a poll never writes over an approval. */
type PollRecord = { lastPoll: number; interval: number }
type RefreshRecord = { sid: string; sub: string; clientId: string; exp: number; used?: true }

export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
/** RFC 8628 §6.1: no vowels or look-alikes, so a code never spells a word. */
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"

const fail = (
  error: OAuthErrorCode,
  error_description?: string,
  status: 400 | 401 | 429 = 400,
): OAuthFailure => ({
  ok: false,
  status,
  error,
  ...(error_description ? { error_description } : {}),
})

function b64url(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)))
const ttl = (exp: number) => Math.max(1, Math.ceil((exp - Date.now()) / 1000))

async function readJson<T>(kv: KeyValue, key: string): Promise<T | null> {
  try {
    const raw = await kv.get(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** First caller wins, where the store can count atomically; otherwise always true. */
async function claim(kv: KeyValue, key: string, exp: number): Promise<boolean> {
  return kv.incr ? (await kv.incr(`${key}:claim`, ttl(exp))) === 1 : true
}

const keys = (o: ClientLoginOptions) => {
  const p = o.prefix ?? "signet-cl"
  return {
    code: (hash: string) => `${p}:ac:${hash}`,
    device: (hash: string) => `${p}:dc:${hash}`,
    poll: (hash: string) => `${p}:dp:${hash}`,
    user: (code: string) => `${p}:uc:${code}`,
    refresh: (hash: string) => `${p}:rt:${hash}`,
  }
}

/** S256: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  )
}

/** Exact match, or a portless loopback registration matching any port. */
export function redirectUriAllowed(registered: string[], given: string): boolean {
  for (const r of registered) {
    if (r === given) return true
    let a: URL
    let b: URL
    try {
      a = new URL(r)
      b = new URL(given)
    } catch {
      continue
    }
    const loopback = a.hostname === "127.0.0.1" || a.hostname === "[::1]"
    if (
      a.protocol === "http:" &&
      loopback &&
      !a.port &&
      b.protocol === "http:" &&
      b.hostname === a.hostname &&
      b.pathname === a.pathname &&
      b.search === a.search &&
      !b.hash
    )
      return true
  }
  return false
}

/** A new stored session for `sub`, and its first token pair. */
async function signIn(
  o: ClientLoginOptions,
  sub: string,
  clientId: string,
  ctx: { userAgent?: string | null; ip?: string | null },
): Promise<TokenResponse> {
  const lifetime = o.refreshTtlSeconds ?? 60 * 60 * 24 * 30
  const { record } = await startSession(
    { ...o.sessions, ttlSeconds: lifetime },
    { sub, userAgent: ctx.userAgent ?? clientId, ip: ctx.ip ?? null },
  )
  return issueTokens(o, { sid: record.id, sub, clientId, exp: record.expiresAt })
}

async function issueTokens(
  o: ClientLoginOptions,
  r: Omit<RefreshRecord, "used">,
): Promise<TokenResponse> {
  const refresh = randomToken()
  await o.kv.set(keys(o).refresh(await sha256Hex(refresh)), JSON.stringify(r), {
    ttlSeconds: ttl(r.exp),
  })
  const expiresIn = Math.min(o.accessTtlSeconds ?? 900, ttl(r.exp))
  const access = await issueSession(o.sessions, r.sub, { sid: r.sid, ttlSeconds: expiresIn })
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: refresh,
  }
}

/**
 * The `/authorize` step, for a user already signed in on the web (`sub`).
 * Returns where to redirect: the client's `redirect_uri` with `code` and
 * `state`. A bad `client_id` or `redirect_uri` is never redirected to; other
 * errors are, as `?error=` (RFC 6749 §4.1.2.1), when `redirectTo` is set.
 */
export async function authorizeClient(
  o: ClientLoginOptions,
  input: {
    sub: string
    client_id?: string | null
    redirect_uri?: string | null
    code_challenge?: string | null
    code_challenge_method?: string | null
    state?: string | null
  },
): Promise<{ ok: true; redirectTo: string } | (OAuthFailure & { redirectTo?: string })> {
  const client = input.client_id ? o.clients[input.client_id] : undefined
  if (!client || !input.client_id) return fail("invalid_client", "Unknown client_id")
  const redirectUri = input.redirect_uri ?? ""
  if (!redirectUriAllowed(client.redirectUris ?? [], redirectUri))
    return fail("invalid_request", "redirect_uri is not registered for this client")

  const back = (params: Record<string, string>) => {
    const url = new URL(redirectUri)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    if (input.state) url.searchParams.set("state", input.state)
    return url.toString()
  }
  if (
    input.code_challenge_method !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge ?? "")
  ) {
    const description = "PKCE with code_challenge_method=S256 is required"
    return {
      ...fail("invalid_request", description),
      redirectTo: back({ error: "invalid_request", error_description: description }),
    }
  }

  const code = randomToken()
  const exp = Date.now() + (o.codeTtlSeconds ?? 60) * 1000
  const record: CodeRecord = {
    sub: input.sub,
    clientId: input.client_id,
    redirectUri,
    challenge: input.code_challenge as string,
    exp,
  }
  await o.kv.set(keys(o).code(await sha256Hex(code)), JSON.stringify(record), {
    ttlSeconds: ttl(exp),
  })
  return { ok: true, redirectTo: back({ code }) }
}

/**
 * The token endpoint: `grant_type` `authorization_code` (with
 * `code_verifier`), `refresh_token`, or the device code grant. `params` is the
 * form (or JSON) body. `userAgent` names the device in the sessions list.
 */
export async function exchangeToken(
  o: ClientLoginOptions,
  params: Record<string, string | undefined>,
  ctx: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ ok: true; tokens: TokenResponse } | OAuthFailure> {
  const clientId = params.client_id ?? ""
  if (!o.clients[clientId]) return fail("invalid_client", "Unknown client_id", 401)
  switch (params.grant_type) {
    case "authorization_code":
      return codeGrant(o, clientId, params, ctx)
    case "refresh_token":
      return refreshGrant(o, clientId, params.refresh_token ?? "")
    case DEVICE_CODE_GRANT:
      return deviceGrant(o, clientId, params.device_code ?? "", ctx)
    default:
      return fail("unsupported_grant_type")
  }
}

async function codeGrant(
  o: ClientLoginOptions,
  clientId: string,
  params: Record<string, string | undefined>,
  ctx: { userAgent?: string | null; ip?: string | null },
): Promise<{ ok: true; tokens: TokenResponse } | OAuthFailure> {
  const verifier = params.code_verifier ?? ""
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
    return fail("invalid_request", "code_verifier must be 43-128 unreserved characters")
  const key = keys(o).code(await sha256Hex(params.code ?? ""))
  const rec = await readJson<CodeRecord>(o.kv, key)
  if (!rec || rec.exp <= Date.now()) return fail("invalid_grant", "Code is invalid or expired")
  // Single use, whatever happens next: a wrong verifier burns the code too.
  await o.kv.delete(key)
  if (!(await claim(o.kv, key, rec.exp))) return fail("invalid_grant", "Code already used")
  if (rec.clientId !== clientId || rec.redirectUri !== (params.redirect_uri ?? ""))
    return fail("invalid_grant", "Code was issued to another client or redirect_uri")
  if (!timingSafeEqual(await pkceChallenge(verifier), rec.challenge))
    return fail("invalid_grant", "code_verifier does not match code_challenge")
  return { ok: true, tokens: await signIn(o, rec.sub, clientId, ctx) }
}

async function refreshGrant(
  o: ClientLoginOptions,
  clientId: string,
  token: string,
): Promise<{ ok: true; tokens: TokenResponse } | OAuthFailure> {
  const key = keys(o).refresh(await sha256Hex(token))
  const rec = await readJson<RefreshRecord>(o.kv, key)
  if (!rec || rec.exp <= Date.now())
    return fail("invalid_grant", "Refresh token is invalid or expired")
  if (rec.used) {
    // A rotated-out token came back: one of the two holders is not the user.
    await Promise.all([o.sessions.store.revoke(rec.sid), o.kv.delete(key)])
    return fail("invalid_grant", "Refresh token was already used; the session is revoked")
  }
  if (rec.clientId !== clientId)
    return fail("invalid_grant", "Refresh token belongs to another client")
  if (!(await claim(o.kv, key, rec.exp))) return fail("invalid_grant", "Refresh token already used")
  const session = await o.sessions.store.get(rec.sid)
  if (!session || session.sub !== rec.sub) {
    await o.kv.delete(key)
    return fail("invalid_grant", "Session has been revoked")
  }
  await o.kv.set(key, JSON.stringify({ ...rec, used: true }), { ttlSeconds: ttl(rec.exp) })
  const { used: _used, ...next } = rec
  return { ok: true, tokens: await issueTokens(o, next) }
}

async function deviceGrant(
  o: ClientLoginOptions,
  clientId: string,
  deviceCode: string,
  ctx: { userAgent?: string | null; ip?: string | null },
): Promise<{ ok: true; tokens: TokenResponse } | OAuthFailure> {
  const k = keys(o)
  const hash = await sha256Hex(deviceCode)
  const key = k.device(hash)
  const rec = await readJson<DeviceRecord>(o.kv, key)
  if (!rec || rec.clientId !== clientId) return fail("invalid_grant", "Unknown device_code")
  const now = Date.now()
  if (rec.exp <= now) {
    await Promise.all([
      o.kv.delete(key),
      o.kv.delete(k.poll(hash)),
      o.kv.delete(k.user(rec.userCode)),
    ])
    return fail("expired_token", "The device code expired; start again")
  }
  if (!rec.sub) {
    // Only the poll key is written here: an approval landing between the read
    // above and this write stays in the device record.
    const last = (await readJson<PollRecord>(o.kv, k.poll(hash))) ?? {
      lastPoll: 0,
      interval: rec.interval,
    }
    const early = now - last.lastPoll < last.interval * 1000
    const next: PollRecord = { lastPoll: now, interval: last.interval + (early ? 5 : 0) }
    await o.kv.set(k.poll(hash), JSON.stringify(next), { ttlSeconds: ttl(rec.exp) + 300 })
    return early ? { ...fail("slow_down"), interval: next.interval } : fail("authorization_pending")
  }
  await Promise.all([o.kv.delete(key), o.kv.delete(k.poll(hash))])
  if (!(await claim(o.kv, key, rec.exp))) return fail("invalid_grant", "Device code already used")
  return { ok: true, tokens: await signIn(o, rec.sub, clientId, ctx) }
}

function randomUserCode(): string {
  let out = ""
  while (out.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      // 240 = 12 × 20: rejection sampling, no modulo bias.
      if (b < 240 && out.length < 8) out += USER_CODE_ALPHABET[b % 20]
    }
  }
  return out
}

/** "bcdf-ghjk", "BCDFGHJK " -> "BCDFGHJK"; null when it cannot be a code. */
export function normalizeUserCode(input: string | null | undefined): string | null {
  const s = (input ?? "").toUpperCase().replace(/[^A-Z]/g, "")
  return s.length === 8 && [...s].every((c) => USER_CODE_ALPHABET.includes(c)) ? s : null
}

/** Device flow, step 1 (the CLI): a device code to poll with and a user code to show. */
export async function startDeviceLogin(
  o: ClientLoginOptions,
  input: { client_id?: string | null; ip?: string | null },
): Promise<({ ok: true } & DeviceCodeResponse) | OAuthFailure> {
  const clientId = input.client_id ?? ""
  if (!o.clients[clientId]) return fail("invalid_client", "Unknown client_id", 401)
  const limit = o.deviceStartsPerIp ?? { max: 10, windowSeconds: 600 }
  const hit = await o.rateLimit.hit(
    "device-start",
    input.ip ?? "no-ip",
    limit.max,
    limit.windowSeconds,
  )
  if (!hit.ok)
    return { ...fail("rate_limited", undefined, 429), retryAfterSeconds: hit.resetSeconds }

  const k = keys(o)
  const lifetime = o.deviceTtlSeconds ?? 600
  const exp = Date.now() + lifetime * 1000
  let userCode = randomUserCode()
  // ponytail: 20^8 codes, so a clash is vanishingly rare; three tries then use the last.
  for (let i = 0; i < 3 && (await o.kv.get(k.user(userCode))); i++) userCode = randomUserCode()
  const deviceCode = randomToken()
  const hash = await sha256Hex(deviceCode)
  const interval = o.pollIntervalSeconds ?? 5
  const rec: DeviceRecord = { clientId, userCode, exp, interval }
  await o.kv.set(k.device(hash), JSON.stringify(rec), { ttlSeconds: lifetime + 300 })
  await o.kv.set(k.user(userCode), hash, { ttlSeconds: lifetime })
  const shown = `${userCode.slice(0, 4)}-${userCode.slice(4)}`
  const complete = new URL(o.verificationUri)
  complete.searchParams.set("user_code", shown)
  return {
    ok: true,
    device_code: deviceCode,
    user_code: shown,
    verification_uri: o.verificationUri,
    verification_uri_complete: complete.toString(),
    expires_in: lifetime,
    interval,
  }
}

/**
 * Device flow, step 2 (the web app): the signed-in user `sub` approves the
 * code they typed. Single use; counted per user against guessing.
 */
export async function approveDeviceLogin(
  o: ClientLoginOptions,
  input: { user_code?: string | null; sub: string },
): Promise<{ ok: true; client_id: string } | OAuthFailure> {
  const limit = o.approvalsPerUser ?? { max: 10, windowSeconds: 600 }
  const hit = await o.rateLimit.hit("device-approve", input.sub, limit.max, limit.windowSeconds)
  if (!hit.ok)
    return { ...fail("rate_limited", undefined, 429), retryAfterSeconds: hit.resetSeconds }
  const code = normalizeUserCode(input.user_code)
  if (!code) return fail("invalid_code", "That code is not valid")
  const k = keys(o)
  const hash = await o.kv.get(k.user(code))
  const rec = hash ? await readJson<DeviceRecord>(o.kv, k.device(hash)) : null
  if (!hash || !rec || rec.sub || rec.exp <= Date.now())
    return fail("invalid_code", "That code is not valid or has expired")
  await o.kv.delete(k.user(code))
  if (!(await claim(o.kv, k.user(code), rec.exp)))
    return fail("invalid_code", "That code was already used")
  await o.kv.set(k.device(hash), JSON.stringify({ ...rec, sub: input.sub }), {
    ttlSeconds: ttl(rec.exp) + 300,
  })
  return { ok: true, client_id: rec.clientId }
}

/**
 * Sign a client out (RFC 7009): revokes the session behind a refresh or access
 * token. Unknown tokens are ignored, so the caller always answers 200.
 */
export async function revokeClientToken(o: ClientLoginOptions, token: string): Promise<void> {
  if (!token) return
  const key = keys(o).refresh(await sha256Hex(token))
  const rec = await readJson<RefreshRecord>(o.kv, key)
  if (rec) {
    await Promise.all([o.sessions.store.revoke(rec.sid), o.kv.delete(key)])
    return
  }
  const sid = (await checkSession(token, o.sessions))?.payload.sid
  if (sid) await o.sessions.store.revoke(sid)
}
