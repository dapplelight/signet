/**
 * Sentry reporting over the Store HTTP API. Zero dependencies — runs on Bun,
 * Node and Cloudflare Workers, where the official SDK does not.
 *
 * From app-a. Generalised so configuration is injected rather than read from a
 * module-level env singleton, which made it untestable and non-portable.
 */

export type SentryConfig = {
  /** https://<key>@<host>/<project_id>. Reporting is disabled when absent. */
  dsn?: string
  /** Only send when true. Locally, errors go to console.error instead. */
  enabled: boolean
  release?: string
  environment?: string
  /** Identifies the reporting client to Sentry. */
  clientName?: string
  /**
   * Applied to the exception message and stack before sending. Default
   * `redactSecrets`: error text routinely carries credentials and personal data
   * (a failed query with an email in it, a URL with a token). Pass your own to
   * add patterns; `(t) => t` turns scrubbing off.
   */
  scrub?: (text: string) => string
  /** Send the stack trace. Default true. */
  includeStack?: boolean
  /**
   * Last look at the event: return it (edited or not) to send, or null to drop
   * it. Runs after `scrub`. Context values are yours to allowlist here.
   */
  beforeSend?: (event: SentryEvent) => SentryEvent | null
}

export type SentryEvent = {
  event_id: string
  timestamp: string
  platform: string
  level: string
  release?: string
  environment?: string
  exception: { values: { type: string; value: string }[] }
  extra?: Record<string, unknown>
}

/**
 * The default scrub. Replaces, in order: bearer tokens and JWTs, key=value /
 * key: value secrets (password, passwd, secret, token, api_key, apikey,
 * authorization, cookie), email addresses, and digit runs of 9+ (account, card
 * and phone numbers). Conservative by design — it may over-redact an id, never
 * under-redact a credential it recognises.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(
      /\b(password|passwd|secret|token|api[_-]?key|authorization|cookie)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi,
      "$1$2[redacted]",
    )
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/\d{9,}/g, "[redacted-number]")
}

function parseDsn(raw: string): { key: string; storeUrl: string } | null {
  try {
    const url = new URL(raw)
    const projectId = url.pathname.replace(/^\//, "")
    if (!url.username || !projectId) return null
    return { key: url.username, storeUrl: `${url.protocol}//${url.host}/api/${projectId}/store/` }
  } catch {
    return null
  }
}

function serialize(err: unknown): { type: string; value: string; stacktrace?: unknown } {
  if (err instanceof Error) {
    return { type: err.name, value: err.message, stacktrace: err.stack }
  }
  return { type: "Error", value: String(err) }
}

export function createSentry(config: SentryConfig) {
  const parsed = config.dsn ? parseDsn(config.dsn) : null

  return {
    /**
     * Resolves to whether Sentry accepted the event; never rejects. On Workers,
     * hand it to `ctx.waitUntil` — the isolate is frozen once the response is
     * sent, and an unawaited report is cut off mid-flight.
     */
    captureException(err: unknown, context?: Record<string, unknown>): Promise<boolean> {
      if (!parsed || !config.enabled) {
        // Visible locally instead of vanishing.
        if (!config.enabled) console.error("[sentry:dev]", err, context)
        return Promise.resolve(false)
      }
      const scrub = config.scrub ?? redactSecrets
      const serialized = serialize(err)
      // err.name is the app's to set, so a custom error can carry anything.
      // Keep it only if it looks like a class name, and scrub it regardless.
      const type = /^[A-Za-z_$][\w$]{0,63}$/.test(serialized.type)
        ? scrub(serialized.type)
        : "Error"
      const value = scrub(serialized.value)
      const stacktrace =
        config.includeStack === false || typeof serialized.stacktrace !== "string"
          ? undefined
          : scrub(serialized.stacktrace)
      const built: SentryEvent = {
        event_id: crypto.randomUUID().replaceAll("-", ""),
        timestamp: new Date().toISOString(),
        platform: "javascript",
        level: "error",
        ...(config.release ? { release: config.release } : {}),
        ...(config.environment ? { environment: config.environment } : {}),
        exception: { values: [{ type, value }] },
        ...(context || stacktrace
          ? { extra: { ...context, ...(stacktrace ? { stacktrace } : {}) } }
          : {}),
      }
      const event = config.beforeSend ? config.beforeSend(built) : built
      if (!event) return Promise.resolve(false)
      // Never rethrown: a reporting failure must not take down the request it
      // was reporting on. Returned so the caller can keep the Worker alive.
      return fetch(parsed.storeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=${config.clientName ?? "signet"}/1.0`,
        },
        body: JSON.stringify(event),
      })
        .then((res) => res.ok)
        .catch(() => false)
    },
    get isEnabled() {
      return !!parsed && config.enabled
    },
  }
}

export type Sentry = ReturnType<typeof createSentry>
