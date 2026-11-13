/**
 * Sentry reporting over the Envelope HTTP API. Zero dependencies — runs on Bun,
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
  /** Tags on every event. */
  tags?: Record<string, string>
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

export type StackFrame = {
  function?: string
  filename: string
  lineno: number
  colno?: number
  /** False for `node:` internals and `node_modules`. */
  in_app: boolean
}

export type SentryRequest = {
  url?: string
  method?: string
  query_string?: string
  headers?: Record<string, string>
}

export type SentryUser = { id?: string; username?: string; ip_address?: string }

/** Per-event context, the third argument of `captureException`. */
export type SentryScope = {
  /** Searchable key/value pairs; merged over `SentryConfig.tags`. */
  tags?: Record<string, string>
  /** The failing request. `authorization`, `cookie` and `set-cookie` headers are dropped. */
  request?: SentryRequest
  user?: SentryUser
}

export type SentryEvent = {
  event_id: string
  timestamp: string
  platform: string
  level: string
  release?: string
  environment?: string
  exception: {
    values: { type: string; value: string; stacktrace?: { frames: StackFrame[] } }[]
  }
  tags?: Record<string, string>
  request?: SentryRequest
  user?: SentryUser
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

function parseDsn(raw: string): { key: string; envelopeUrl: string } | null {
  try {
    const url = new URL(raw)
    const projectId = url.pathname.replace(/^\//, "")
    if (!url.username || !projectId) return null
    return {
      key: url.username,
      envelopeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
    }
  } catch {
    return null
  }
}

/**
 * Frames from a JS stack string, oldest call first (Sentry's order). Reads the
 * V8 form `at fn (file:line:col)` and the Firefox/Safari form `fn@file:line:col`;
 * lines that are neither (the message, `[native code]`) are skipped. Text goes
 * through `scrub` before it leaves.
 */
export function parseStack(
  stack: string,
  scrub: (text: string) => string = (t) => t,
): StackFrame[] {
  const frames: StackFrame[] = []
  for (const line of stack.split("\n")) {
    const v8 = /^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line)
    const gecko = v8 ? null : /^\s*(.*?)@(.+?):(\d+)(?::(\d+))?\s*$/.exec(line)
    const m = v8 ?? gecko
    if (!m) continue
    const [, fn, file = "", lineno, colno] = m
    frames.push({
      ...(fn ? { function: scrub(fn) } : {}),
      filename: scrub(file),
      lineno: Number(lineno),
      ...(colno ? { colno: Number(colno) } : {}),
      in_app: !file.startsWith("node:") && !file.includes("node_modules"),
    })
  }
  return frames.reverse()
}

function serialize(err: unknown): { type: string; value: string; stack?: string } {
  if (err instanceof Error) {
    // V8 puts "Name: message" first; a message such as "a@b:80" must not read as a frame.
    const head = `${err.name}: ${err.message}`
    const stack = err.stack?.startsWith(head) ? err.stack.slice(head.length) : err.stack
    return { type: err.name, value: err.message, stack }
  }
  return { type: "Error", value: String(err) }
}

/** Headers that carry credentials; never sent as request context. */
const SECRET_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"])

/** The request with credential headers dropped; url and query string go through `scrub`. */
function cleanRequest(r: SentryRequest, scrub: (text: string) => string): SentryRequest {
  const { headers, url, query_string, ...rest } = r
  const kept = headers
    ? Object.fromEntries(
        Object.entries(headers).filter(([k]) => !SECRET_HEADERS.has(k.toLowerCase())),
      )
    : undefined
  return {
    ...rest,
    ...(url ? { url: scrub(url) } : {}),
    ...(query_string ? { query_string: scrub(query_string) } : {}),
    ...(kept ? { headers: kept } : {}),
  }
}

export function createSentry(config: SentryConfig) {
  const parsed = config.dsn ? parseDsn(config.dsn) : null

  return {
    /**
     * Resolves to whether Sentry accepted the event; never rejects. On Workers,
     * hand it to `ctx.waitUntil` — the isolate is frozen once the response is
     * sent, and an unawaited report is cut off mid-flight.
     */
    captureException(
      err: unknown,
      context?: Record<string, unknown>,
      scope?: SentryScope,
    ): Promise<boolean> {
      if (!parsed || !config.enabled) {
        // Visible locally instead of vanishing.
        if (!config.enabled) console.error("[sentry:dev]", err, context, scope)
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
      const frames =
        config.includeStack === false || typeof serialized.stack !== "string"
          ? []
          : parseStack(serialized.stack, scrub)
      const tags = { ...config.tags, ...scope?.tags }
      const request = scope?.request && cleanRequest(scope.request, scrub)
      const built: SentryEvent = {
        event_id: crypto.randomUUID().replaceAll("-", ""),
        timestamp: new Date().toISOString(),
        platform: "javascript",
        level: "error",
        ...(config.release ? { release: config.release } : {}),
        ...(config.environment ? { environment: config.environment } : {}),
        exception: {
          values: [{ type, value, ...(frames.length ? { stacktrace: { frames } } : {}) }],
        },
        ...(Object.keys(tags).length ? { tags } : {}),
        ...(request ? { request } : {}),
        ...(scope?.user ? { user: scope.user } : {}),
        ...(context ? { extra: { ...context } } : {}),
      }
      const event = config.beforeSend ? config.beforeSend(built) : built
      if (!event) return Promise.resolve(false)
      // The Store endpoint is deprecated; events go in an envelope: three JSON
      // lines (envelope header, item header, the event).
      const body = [
        JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
        JSON.stringify({ type: "event" }),
        JSON.stringify(event),
      ].join("\n")
      // Never rethrown: a reporting failure must not take down the request it
      // was reporting on. Returned so the caller can keep the Worker alive.
      return fetch(parsed.envelopeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=${config.clientName ?? "signet"}/1.0`,
        },
        body,
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
