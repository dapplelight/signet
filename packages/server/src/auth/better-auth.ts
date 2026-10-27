/**
 * Opinionated defaults for Better Auth.
 *
 * Both products in the audit that have a real user system — app-a and
 * app-b — independently chose Better Auth, so this does not reimplement
 * it. It captures the configuration they each had to work out separately.
 *
 * Deliberately returns a plain options object instead of calling `betterAuth()`,
 * so this package needs no dependency on Better Auth and no version coupling.
 * Spread it into your own call:
 *
 *   betterAuth({ ...betterAuthDefaults(env), database: drizzleAdapter(db, ...) })
 */

import { isDevAuthEnabled } from "./guards.js"

export type BetterAuthEnv = {
  BETTER_AUTH_SECRET?: string
  /** Better Auth's own name for its public URL. Preferred over WEB_URL/WORKER_URL. */
  BETTER_AUTH_URL?: string
  WEB_URL?: string
  WORKER_URL?: string
  ADMIN_URL?: string
  LANDING_URL?: string
  /** Set to scope the session cookie across subdomains, e.g. ".example.com". */
  COOKIE_DOMAIN?: string
  SESSION_DURATION_SECONDS?: string
  DEV_AUTH_ENABLED?: string
  APP_ENV?: string
  NODE_ENV?: string
}

/**
 * Everything that changes Better Auth's behaviour is opt-in and defaults to
 * Better Auth's own default. An earlier version defaulted to app-a's config,
 * which silently weakened other apps: see each option.
 */
export type BetterAuthDefaultsOptions = {
  /**
   * True when the frontend is served from a different origin than the API
   * (Pages → Worker). Forces SameSite=None; Secure so the browser sends the
   * session cookie on cross-origin fetches. Default true.
   */
  crossOrigin?: boolean
  /** Default: env.BETTER_AUTH_URL, else WEB_URL, else WORKER_URL. */
  baseURL?: string
  /** Replaces the list built from WEB_URL, LANDING_URL and ADMIN_URL. */
  trustedOrigins?: string[]
  /** Extra trusted origins beyond the URL env vars (or `trustedOrigins`). */
  extraTrustedOrigins?: string[]
  /** Session lifetime. Default env.SESSION_DURATION_SECONDS, else Better Auth's (7 days). */
  sessionSeconds?: number
  /**
   * Trust the signed session cookie for this many seconds before re-reading the
   * session row. Saves a database round trip per request, but a deleted
   * account or revoked session stays signed in for up to this long.
   * Default: off.
   */
  cookieCacheSeconds?: number
  /**
   * Skip Better Auth's OAuth state-cookie check. That check is CSRF protection
   * on the OAuth callback. Only turn it off when the state cookie cannot
   * round-trip in your deployment, and prefer fixing the cookie setup.
   * Default: false.
   */
  skipStateCookieCheck?: boolean
  /** Better Auth's own limiter on /api/auth/*. Default: Better Auth's. */
  rateLimit?: { window: number; max: number }
}

export function betterAuthDefaults(env: BetterAuthEnv, opts: BetterAuthDefaultsOptions = {}) {
  const crossOrigin = opts.crossOrigin ?? true
  const sessionSeconds =
    opts.sessionSeconds ??
    (env.SESSION_DURATION_SECONDS ? Number(env.SESSION_DURATION_SECONDS) : undefined)

  return {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: opts.baseURL ?? (env.BETTER_AUTH_URL || env.WEB_URL || env.WORKER_URL || undefined),

    session: {
      ...(sessionSeconds ? { expiresIn: sessionSeconds } : {}),
      // Silently extend an active session once a day rather than logging the
      // user out on a fixed schedule. (Also Better Auth's default; explicit so
      // it survives a change there.)
      updateAge: 24 * 60 * 60,
      ...(opts.cookieCacheSeconds
        ? { cookieCache: { enabled: true, maxAge: opts.cookieCacheSeconds } }
        : {}),
    },

    advanced: {
      defaultCookieAttributes: {
        sameSite: crossOrigin ? ("none" as const) : ("lax" as const),
        secure: true,
        ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
      },
    },

    ...(opts.skipStateCookieCheck ? { account: { skipStateCookieCheck: true } } : {}),

    emailAndPassword: {
      // Throws if DEV_AUTH_ENABLED survives into production or staging.
      enabled: isDevAuthEnabled(env),
      disableSignUp: true,
    },

    trustedOrigins: [
      ...(opts.trustedOrigins ?? [env.WEB_URL || "", env.LANDING_URL || "", env.ADMIN_URL || ""]),
      ...(opts.extraTrustedOrigins ?? []),
    ].filter(Boolean),

    ...(opts.rateLimit ? { rateLimit: opts.rateLimit } : {}),
  }
}

/**
 * Only enable a social provider when BOTH halves of its credentials are set.
 *
 * A provider configured with one half silently fails at redirect time, which is
 * hard to trace. From app-b, which logs the skip.
 */
export function socialProviders(
  creds: Record<string, { clientId?: string; clientSecret?: string }>,
  onSkip?: (provider: string, reason: string) => void,
): Record<string, { clientId: string; clientSecret: string }> {
  return Object.fromEntries(
    Object.entries(creds).flatMap(([name, { clientId, clientSecret }]) => {
      if (clientId && clientSecret) return [[name, { clientId, clientSecret }]]
      if (clientId || clientSecret) onSkip?.(name, "incomplete_credentials")
      return []
    }),
  )
}
