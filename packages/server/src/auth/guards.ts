/**
 * Configuration guards. These exist because the failure they prevent is silent.
 *
 * Lifted from app-a/apps/api/src/auth.ts, which was the only implementation in
 * the audit that had them.
 */

/**
 * True only when dev auth is explicitly enabled outside production.
 *
 * Throws rather than returning false in production or staging: a dev-auth flag
 * reaching prod is a total authentication bypass, and failing the boot is the
 * correct response. Silently ignoring it lets a misconfigured deploy serve.
 */
export function isDevAuthEnabled(env: Record<string, string | undefined>): boolean {
  if (env.DEV_AUTH_ENABLED !== "true") return false
  const appEnv = env.APP_ENV ?? env.NODE_ENV ?? "local"
  if (appEnv === "production" || appEnv === "staging") {
    throw new Error(
      `SECURITY: DEV_AUTH_ENABLED=true is not allowed in ${appEnv}. Remove it before deploying.`,
    )
  }
  return true
}

/**
 * Assert required secrets are present, naming every missing one at once.
 *
 * Workers do not expose bindings at module scope, so call this per request or
 * inside a lazy factory, never at import time.
 */
export function requireEnv<K extends string>(
  env: Record<string, string | undefined>,
  keys: readonly K[],
): Record<K, string> {
  const missing = keys.filter((k) => !env[k])
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`)
  }
  return Object.fromEntries(keys.map((k) => [k, env[k] as string])) as Record<K, string>
}

/**
 * Soft variant: report what is missing and let the caller degrade instead of
 * crashing. Pattern taken from app-b, which disables auth and logs
 * rather than failing the whole worker.
 */
export function checkEnv<K extends string>(
  env: Record<string, string | undefined>,
  keys: readonly K[],
): { ok: true; values: Record<K, string> } | { ok: false; missing: K[] } {
  const missing = keys.filter((k) => !env[k])
  if (missing.length) return { ok: false, missing }
  return {
    ok: true,
    values: Object.fromEntries(keys.map((k) => [k, env[k] as string])) as Record<K, string>,
  }
}
