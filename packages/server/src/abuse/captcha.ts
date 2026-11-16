/**
 * Bot checks: verify a Cloudflare Turnstile or hCaptcha token on the server,
 * and a middleware that requires one on chosen routes (sign-up, password
 * reset). Plain `fetch` to each provider's siteverify endpoint; no SDK.
 *
 * ```ts
 * const captcha = captchaVerifier({ provider: "turnstile", secret: env.TURNSTILE_SECRET })
 * app.use("/api/auth/sign-up/*", requireCaptcha({ verifier: captcha, trust: "cloudflare" }))
 * app.use("/api/auth/forget-password", requireCaptcha({ verifier: captcha, trust: "cloudflare" }))
 * ```
 *
 * `provider: "test"` passes `CAPTCHA_TEST_PASS` and refuses anything else,
 * with no network, for local development and tests. It throws when `appEnv`
 * is production or staging. Pair it with `<CaptchaWidget provider="test">`.
 */

import type { Context, MiddlewareHandler } from "hono"
import { type ClientIpTrust, clientIp } from "../middleware/rate-limit.js"

export type CaptchaProvider = "turnstile" | "hcaptcha" | "test"

/** The token test mode accepts. Any other token fails. */
export const CAPTCHA_TEST_PASS = "signet-captcha-test-pass"

export const SITEVERIFY_URLS = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  hcaptcha: "https://api.hcaptcha.com/siteverify",
} as const

export type CaptchaOptions = {
  provider: CaptchaProvider
  /** The provider's secret key. Required except in test mode. */
  secret?: string
  /** hCaptcha: the site key the token must belong to. Optional. */
  siteKey?: string
  /** Refuse tokens solved on another hostname (the provider reports it). */
  hostname?: string | string[]
  /** Turnstile: refuse tokens whose widget `action` differs. */
  action?: string
  /** Per verify. Default 5000 ms. */
  timeoutMs?: number
  fetch?: typeof fetch
  /** Test mode throws when this is production or staging. Default "local". */
  appEnv?: string
}

export type CaptchaResult =
  | { ok: true; hostname?: string; action?: string }
  | {
      ok: false
      /** missing: no token. invalid: the provider said no. unavailable: it could not be asked. */
      reason: "missing" | "invalid" | "unavailable"
      errorCodes: string[]
    }

export type CaptchaVerifier = {
  provider: CaptchaProvider
  verify(token: string | null | undefined, opts?: { ip?: string | null }): Promise<CaptchaResult>
}

// Turnstile tokens are at most 2048 characters; hCaptcha's are shorter.
const MAX_TOKEN = 2048

export function captchaVerifier(opts: CaptchaOptions): CaptchaVerifier {
  const { provider } = opts
  if (provider === "test") {
    const appEnv = opts.appEnv ?? "local"
    if (appEnv === "production" || appEnv === "staging")
      throw new Error(`SECURITY: captcha test mode passes a fixed token; not allowed in ${appEnv}.`)
    return {
      provider,
      async verify(token) {
        if (!token) return { ok: false, reason: "missing", errorCodes: ["missing-input-response"] }
        return token === CAPTCHA_TEST_PASS
          ? { ok: true, hostname: "localhost" }
          : { ok: false, reason: "invalid", errorCodes: ["invalid-input-response"] }
      },
    }
  }
  if (provider !== "turnstile" && provider !== "hcaptcha")
    throw new Error(`captchaVerifier: unknown provider "${String(provider)}".`)
  if (!opts.secret) throw new Error(`captchaVerifier: ${provider} needs a secret.`)
  const secret = opts.secret
  const doFetch = opts.fetch ?? fetch
  const hosts = opts.hostname === undefined ? null : [opts.hostname].flat()

  return {
    provider,
    async verify(token, { ip } = {}) {
      if (!token) return { ok: false, reason: "missing", errorCodes: ["missing-input-response"] }
      if (token.length > MAX_TOKEN)
        return { ok: false, reason: "invalid", errorCodes: ["invalid-input-response"] }
      const form = new URLSearchParams({ secret, response: token })
      if (ip) form.set("remoteip", ip)
      if (provider === "hcaptcha" && opts.siteKey) form.set("sitekey", opts.siteKey)
      let body: {
        success?: unknown
        "error-codes"?: unknown
        hostname?: unknown
        action?: unknown
      }
      try {
        const res = await doFetch(SITEVERIFY_URLS[provider], {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
        })
        if (!res.ok) throw new Error(`siteverify answered ${res.status}`)
        body = (await res.json()) as typeof body
      } catch (err) {
        return {
          ok: false,
          reason: "unavailable",
          errorCodes: [String((err as Error)?.message ?? err)],
        }
      }
      const errorCodes = Array.isArray(body["error-codes"]) ? body["error-codes"].map(String) : []
      const hostname = typeof body.hostname === "string" ? body.hostname : undefined
      const action = typeof body.action === "string" ? body.action : undefined
      if (body.success !== true) return { ok: false, reason: "invalid", errorCodes }
      if (hosts && !(hostname && hosts.includes(hostname)))
        return { ok: false, reason: "invalid", errorCodes: ["hostname-mismatch"] }
      if (opts.action !== undefined && action !== opts.action)
        return { ok: false, reason: "invalid", errorCodes: ["action-mismatch"] }
      return { ok: true, ...(hostname ? { hostname } : {}), ...(action ? { action } : {}) }
    },
  }
}

/** Header, then JSON or form body fields, where a captcha token is looked for by default. */
export const CAPTCHA_HEADER = "x-captcha-token"
const BODY_FIELDS = ["captchaToken", "cf-turnstile-response", "h-captcha-response"]

/**
 * The token from the `x-captcha-token` header, else a JSON or form body field
 * (`captchaToken`, `cf-turnstile-response`, `h-captcha-response`). Reads a
 * clone of the body, so the route (or Better Auth's handler) still gets it.
 */
export async function captchaToken(c: Context): Promise<string | undefined> {
  const header = c.req.header(CAPTCHA_HEADER)
  if (header) return header
  const type = c.req.header("content-type") ?? ""
  try {
    if (type.includes("application/json")) {
      const b = (await c.req.raw.clone().json()) as Record<string, unknown> | null
      for (const f of BODY_FIELDS) if (typeof b?.[f] === "string") return b[f] as string
    } else if (type.includes("form")) {
      const f = await c.req.raw.clone().formData()
      for (const name of BODY_FIELDS) {
        const v = f.get(name)
        if (typeof v === "string") return v
      }
    }
  } catch {}
  return undefined
}

const REFUSALS = {
  missing: { status: 400, code: "CAPTCHA_REQUIRED", error: "Complete the bot check first." },
  invalid: { status: 403, code: "CAPTCHA_FAILED", error: "The bot check failed. Try again." },
  unavailable: {
    status: 503,
    code: "CAPTCHA_UNAVAILABLE",
    error: "The bot check is unavailable. Try again.",
  },
} as const

export type RequireCaptchaOptions = {
  /** A verifier, or one built per request (to read secrets from `c.env`). */
  verifier: CaptchaVerifier | ((c: Context) => CaptchaVerifier)
  /** Where the token is. Default `captchaToken`. */
  token?: (c: Context) => string | null | undefined | Promise<string | null | undefined>
  /** Which proxy to believe about the client IP sent to the provider. Default "none" (not sent). */
  trust?: ClientIpTrust
  /** Told about every refusal, e.g. for a log line. */
  onRefuse?: (result: Extract<CaptchaResult, { ok: false }>, c: Context) => void
}

/**
 * Refuses the request unless it carries a valid captcha token. Fails closed:
 * a provider that cannot be reached is a 503, never a pass.
 *
 *   400 CAPTCHA_REQUIRED     no token
 *   403 CAPTCHA_FAILED       the provider refused it (or wrong hostname or action)
 *   503 CAPTCHA_UNAVAILABLE  the provider could not be asked
 */
export function requireCaptcha(opts: RequireCaptchaOptions): MiddlewareHandler {
  return async (c, next) => {
    const verifier = typeof opts.verifier === "function" ? opts.verifier(c) : opts.verifier
    const token = await (opts.token ?? captchaToken)(c)
    const result = await verifier.verify(token, { ip: clientIp(c, opts.trust ?? "none") })
    if (result.ok) return next()
    opts.onRefuse?.(result, c)
    const { status, ...refusal } = REFUSALS[result.reason]
    const requestId = c.get("reqId" as never) as string | undefined
    return c.json(
      { success: false as const, ...refusal, ...(requestId ? { requestId } : {}) },
      status,
    )
  }
}
