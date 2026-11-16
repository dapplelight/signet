/**
 * Hono middleware. Requires `hono` as a peer dependency.
 *
 * Imported from "@dapplelight/signet-server/auth/hono" so apps that do not use Hono never
 * pull it in.
 */

import { type Context, Hono, type MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import { type ClientIpTrust, clientIp } from "../middleware/rate-limit.js"
import { type ApiKeyStore, verifyApiKey } from "./api-keys.js"
import { hashIncomingToken, readBearer, verifySharedToken } from "./bearer.js"
import {
  approveDeviceLogin,
  authorizeClient,
  type ClientLoginOptions,
  exchangeToken,
  type OAuthFailure,
  revokeClientToken,
  startDeviceLogin,
} from "./client-login.js"
import {
  checkSession,
  clearCookie,
  readSessionCookie,
  type SessionOptions,
  type SessionPayload,
  sessionCookie,
  verifySession,
} from "./session.js"
import { type StoredSessionOptions, type ValidSession, validateSession } from "./sessions.js"

function resendResigned(c: Context, opts: SessionOptions, token: string, exp: number) {
  c.header("Set-Cookie", sessionCookie(token, opts, exp - Math.floor(Date.now() / 1000)), {
    append: true,
  })
}

/**
 * Gate on a stateless session cookie. Sets `session` in the context. With
 * `previousSecrets`, a cookie signed by an old key passes and is re-sent signed
 * with the current one. Stored-session cookies are refused: use `requireStoredSession`.
 */
export function requireSession(opts: SessionOptions): MiddlewareHandler {
  return async (c, next) => {
    const token = readSessionCookie(c.req.header("cookie"), opts)
    const checked = await checkSession(token, opts)
    if (!checked || checked.payload.sid !== undefined)
      throw new HTTPException(401, { message: "Unauthorized" })
    if (checked.resigned) resendResigned(c, opts, checked.resigned, checked.payload.exp)
    c.set("session", checked.payload satisfies SessionPayload)
    await next()
  }
}

export type StoredSessionMiddlewareOptions = StoredSessionOptions & {
  /** Which proxy to believe for the IP recorded on activity. Default "none" (no IP). */
  trust?: ClientIpTrust
  /** Keep the lastSeen write off the response, e.g. `(c) => waitUntilDefer(c.executionCtx)`. */
  defer?: (c: Context) => (work: Promise<unknown>) => void
  /**
   * Also accept `Authorization: Bearer <access token>` (from
   * `./auth/client-login`), checked first, so one route serves the web app's
   * cookie and an extension, desktop app or CLI. Default false.
   */
  bearer?: boolean
}

/**
 * Gate on a stored-session cookie (`./sessions`): signature, expiry and that
 * the session has not been revoked. Sets `session` (a `ValidSession`) in the context.
 */
export function requireStoredSession(opts: StoredSessionMiddlewareOptions): MiddlewareHandler {
  return async (c, next) => {
    const bearer = opts.bearer ? readBearer(c.req.raw.headers) : null
    const token = bearer ?? readSessionCookie(c.req.header("cookie"), opts)
    const session = await validateSession(token, opts, {
      ip: clientIp(c, opts.trust ?? "none"),
      ...(opts.defer ? { defer: opts.defer(c) } : {}),
    })
    if (!session) throw new HTTPException(401, { message: "Unauthorized" })
    // A re-signed bearer token is not sent back: the client refreshes instead.
    if (session.resigned && !bearer) resendResigned(c, opts, session.resigned, session.payload.exp)
    c.set("session", session)
    await next()
  }
}

/**
 * "Your devices": mount with `app.route("/api/sessions", sessionRoutes(opts))`.
 *
 *   GET    /               { sessions: [{ id, device, ip, createdAt, lastSeenAt, expiresAt, current }] }
 *   DELETE /:id            revoke one of mine; revoking the current one also clears the cookie
 *   POST   /revoke-others  sign out everywhere else; { revoked: n }
 *
 * Guarded by `requireStoredSession`. These are cookie-authenticated writes:
 * put `csrfMiddleware` in front when the cookie is `SameSite=None`.
 */
export function sessionRoutes(opts: StoredSessionMiddlewareOptions) {
  const current = (c: Context) => c.get("session" as never) as ValidSession
  return new Hono()
    .use("*", requireStoredSession(opts))
    .get("/", async (c) => {
      const me = current(c)
      const list = await opts.store.listByUser(me.record.sub)
      return c.json({
        sessions: list.map(({ sub: _sub, ...r }) => ({ ...r, current: r.id === me.record.id })),
      })
    })
    .post("/revoke-others", async (c) => {
      const me = current(c)
      const revoked = await opts.store.revokeAll(me.record.sub, { except: me.record.id })
      return c.json({ revoked })
    })
    .delete("/:id", async (c) => {
      const me = current(c)
      const id = c.req.param("id")
      const target = await opts.store.get(id)
      // Someone else's session reads as missing, not forbidden: ids are not enumerable.
      if (!target || target.sub !== me.record.sub)
        throw new HTTPException(404, { message: "Session not found" })
      await opts.store.revoke(id)
      if (id === me.record.id) c.header("Set-Cookie", clearCookie(opts))
      return c.json({ revoked: 1 })
    })
}

/** For `hc<SessionRoutes>`: import it with `import type`, so no server code reaches the browser. */
export type SessionRoutes = ReturnType<typeof sessionRoutes>

/**
 * Gate on an API key from `./api-keys`. Sets `apiKey` (an `ApiKeyInfo`, no
 * hash) in the context. 401 for a missing, unknown, revoked or expired key;
 * 403 when it lacks one of `scopes`.
 */
export function requireApiKey(opts: {
  store: ApiKeyStore
  prefix: string
  scopes?: string[]
  touchEverySeconds?: number
  defer?: (c: Context) => (work: Promise<unknown>) => void
}): MiddlewareHandler {
  return async (c, next) => {
    const r = await verifyApiKey(opts.store, c.req.raw.headers, {
      prefix: opts.prefix,
      ...(opts.scopes ? { scopes: opts.scopes } : {}),
      ...(opts.touchEverySeconds !== undefined
        ? { touchEverySeconds: opts.touchEverySeconds }
        : {}),
      ...(opts.defer ? { defer: opts.defer(c) } : {}),
    })
    if (!r.ok) {
      if (r.reason === "insufficient_scope")
        throw new HTTPException(403, { message: "Insufficient scope" })
      throw new HTTPException(401, { message: "Invalid API key" })
    }
    c.set("apiKey", r.key)
    await next()
  }
}

/** Gate on a single shared bearer token held in an environment secret. */
export function requireSharedToken(
  getExpected: (c: never) => string | undefined,
): MiddlewareHandler {
  return async (c, next) => {
    if (!verifySharedToken(c.req.raw.headers, getExpected(c as never))) {
      throw new HTTPException(401, { message: "Unauthorized" })
    }
    await next()
  }
}

export type DualAuthOptions<U> = {
  session: SessionOptions
  /** API token prefix, e.g. "app". Tokens look like `app_<64 hex>`. */
  tokenPrefix: string
  /** Look up a user by the SHA-256 hash of their API token. */
  findUserByTokenHash: (hash: string) => Promise<U | null>
  /** Look up a user by the session's `sub` claim. */
  findUserBySub: (sub: string) => Promise<U | null>
  /** Fired after a successful token auth. Do not await — keep it off the hot path. */
  onTokenUsed?: (hash: string) => void
}

/**
 * Accept either a machine API token or a browser session, in that order.
 *
 * The pattern app-a arrived at: one protected route serves both the web app and
 * the CLI/MCP client without duplicating the route.
 */
export function requireAuth<U>(opts: DualAuthOptions<U>): MiddlewareHandler {
  return async (c, next) => {
    const hash = await hashIncomingToken(c.req.raw.headers, opts.tokenPrefix)
    if (hash) {
      const user = await opts.findUserByTokenHash(hash)
      if (!user) throw new HTTPException(401, { message: "Invalid API token" })
      c.set("user", user)
      opts.onTokenUsed?.(hash)
      return next()
    }

    const token = readSessionCookie(c.req.header("cookie"), opts.session)
    const session = await verifySession(token, opts.session)
    if (!session?.sub) throw new HTTPException(401, { message: "Unauthorized" })
    const user = await opts.findUserBySub(session.sub)
    if (!user) throw new HTTPException(401, { message: "User not found" })
    c.set("user", user)
    await next()
  }
}

export type ClientLoginRoutesOptions = ClientLoginOptions & {
  /**
   * Which proxy to believe for client IPs (device-start limit, the sessions
   * list). Required: `"none"` is an explicit opt-in to every caller sharing one
   * device-start bucket, so a few requests can lock everyone out.
   */
  trust: ClientIpTrust
  /**
   * Where `/authorize` sends a visitor who is not signed in, given the URL to
   * come back to. Absent: they get a 401.
   */
  loginUrl?: (returnTo: string) => string
}

/**
 * Bearer sign-in for extensions, desktop apps and CLIs (`./auth/client-login`).
 * Mount with `app.route("/api/auth", clientLoginRoutes(opts))`:
 *
 *   GET  /authorize       web-signed-in user -> 302 to redirect_uri?code&state (PKCE S256)
 *   POST /token           grant_type authorization_code | refresh_token | device code -> tokens
 *   POST /device/code     { client_id } -> { device_code, user_code, verification_uri, … }
 *   POST /device/approve  web-signed-in user, { user_code } -> { ok, client_id }
 *   POST /revoke          { token } -> 200, always
 *
 * `/token`, `/device/code` and `/revoke` take a form or JSON body and answer
 * in OAuth's shape (`{ error }`, `Cache-Control: no-store`). `/authorize` and
 * `/device/approve` read the web app's stored-session cookie; the approve
 * route is a cookie-authenticated write, so put `csrfMiddleware` in front
 * when the cookie is `SameSite=None`.
 */
export function clientLoginRoutes(opts: ClientLoginRoutesOptions) {
  if (opts.trust === undefined) {
    throw new Error(
      'clientLoginRoutes: set `trust` ("cloudflare", { forwardedHops }, or "none" for one shared device-start bucket)',
    )
  }
  const trust = opts.trust
  const ipOf = (c: Context) => clientIp(c, trust)
  const webUser = async (c: Context) => {
    const token = readSessionCookie(c.req.header("cookie"), opts.sessions)
    const s = await validateSession(token, opts.sessions, { ip: ipOf(c) })
    return s?.record.sub ?? null
  }
  const params = async (c: Context): Promise<Record<string, string | undefined>> => {
    const type = c.req.header("content-type") ?? ""
    try {
      if (type.includes("application/json")) {
        const body = (await c.req.json()) as Record<string, unknown>
        return Object.fromEntries(
          Object.entries(body ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"),
        )
      }
      const form = await c.req.parseBody()
      return Object.fromEntries(
        Object.entries(form).filter((e): e is [string, string] => typeof e[1] === "string"),
      )
    } catch {
      return {}
    }
  }
  const oauth = (c: Context, r: OAuthFailure) => {
    c.header("Cache-Control", "no-store")
    if (r.retryAfterSeconds !== undefined) c.header("Retry-After", String(r.retryAfterSeconds))
    const { ok: _ok, status, retryAfterSeconds: _r, ...body } = r
    return c.json(body, status)
  }

  return new Hono()
    .get("/authorize", async (c) => {
      const sub = await webUser(c)
      if (!sub) {
        if (opts.loginUrl) return c.redirect(opts.loginUrl(c.req.url), 302)
        throw new HTTPException(401, { message: "Sign in first" })
      }
      const q = (k: string) => c.req.query(k) ?? null
      const r = await authorizeClient(opts, {
        sub,
        client_id: q("client_id"),
        redirect_uri: q("redirect_uri"),
        code_challenge: q("code_challenge"),
        code_challenge_method: q("code_challenge_method"),
        state: q("state"),
      })
      if (r.ok || r.redirectTo) return c.redirect(r.redirectTo as string, 302)
      return oauth(c, r)
    })
    .post("/token", async (c) => {
      const r = await exchangeToken(opts, await params(c), {
        userAgent: c.req.header("user-agent") ?? null,
        ip: ipOf(c),
      })
      if (!r.ok) return oauth(c, r)
      c.header("Cache-Control", "no-store")
      return c.json(r.tokens)
    })
    .post("/device/code", async (c) => {
      const p = await params(c)
      const r = await startDeviceLogin(opts, { client_id: p.client_id, ip: ipOf(c) })
      if (!r.ok) return oauth(c, r)
      const { ok: _ok, ...body } = r
      c.header("Cache-Control", "no-store")
      return c.json(body)
    })
    .post("/device/approve", async (c) => {
      const sub = await webUser(c)
      if (!sub) throw new HTTPException(401, { message: "Unauthorized" })
      const r = await approveDeviceLogin(opts, { user_code: (await params(c)).user_code, sub })
      return r.ok ? c.json(r) : oauth(c, r)
    })
    .post("/revoke", async (c) => {
      await revokeClientToken(opts, (await params(c)).token ?? "")
      return c.body(null, 200)
    })
}

/** For `hc<ClientLoginRoutes>`: import it with `import type`. */
export type ClientLoginRoutes = ReturnType<typeof clientLoginRoutes>
