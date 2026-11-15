/**
 * Client-side event tracking.
 *
 * Designed so `track()` is always safe to call: with no transport configured it
 * is a no-op, so product code can instrument first and decide where events go
 * later — or never. Nothing in a product should import an analytics vendor.
 *
 * Events are batched and flushed with `sendBeacon`, which survives page unload;
 * a plain fetch on unload is routinely cancelled and loses the events that
 * matter most (the last thing someone did before leaving).
 */

export type EventProps = Record<string, string | number | boolean | null | undefined>

export type AnalyticsEvent = {
  name: string
  props?: EventProps
  /** Epoch ms, set at track() time, not at flush time. */
  ts: number
  /** Random id for this browser, kept in localStorage. Not derived from anything about the person. */
  anonymousId?: string
  /** Random id for this visit; a new one after `sessionTimeoutMs` of inactivity. */
  sessionId?: string
  /** Set by `identify()`. The server decides whether to keep it (see `registerIngest`). */
  userId?: string
}

/** A visit: its id and when it was last active. */
export type SessionState = { id: string; lastSeen: number }

/** The ids every event carries, for attaching to server calls (see `headers()`). */
export type AnalyticsContext = { anonymousId: string; sessionId: string; userId?: string }

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

/**
 * Continue `prev` if it was active within `timeoutMs`, else start a new
 * session. Pure, so a server or a test can run the same rule.
 */
export function continueSession(
  prev: SessionState | null | undefined,
  now: number,
  timeoutMs = 30 * 60_000,
): SessionState {
  if (prev && now - prev.lastSeen < timeoutMs && now >= prev.lastSeen)
    return { id: prev.id, lastSeen: now }
  return { id: randomId(), lastSeen: now }
}

/** Header names `headers()` sets and signet-server's `analyticsContext` reads. */
export const ANALYTICS_HEADERS = {
  anonymousId: "x-signet-anonymous-id",
  sessionId: "x-signet-session-id",
} as const

export type Transport = (events: AnalyticsEvent[]) => void | Promise<void>

export type AnalyticsConfig = {
  /** Where events go. Omit for a no-op client. */
  transport?: Transport
  /** Flush after this many events. Default 10. */
  batchSize?: number
  /** Flush after this long, ms. Default 5000. */
  flushIntervalMs?: number
  /** Honour navigator.doNotTrack and a stored opt-out. Default true. */
  respectDoNotTrack?: boolean
  /** localStorage key holding "1" (opted out) or "0" (opted in). Default "signet-analytics-optout". */
  optOutKey?: string
  /**
   * Track nothing until `optIn()` is called (consent first, as DPDP and GDPR
   * expect for anything beyond strictly necessary). Default false.
   */
  requireConsent?: boolean
  /** A visit ends after this long without an event. Default 30 minutes. */
  sessionTimeoutMs?: number
  /**
   * Trait keys `identify()` may send. Default none: a userId links events,
   * but names, emails and phone numbers never leave the browser unless listed.
   */
  traitKeys?: readonly string[]
  /** localStorage key prefix for the anonymous and session ids. Default "signet-analytics". */
  storageKey?: string
}

function readJson<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : null
  } catch {
    return null
  }
}

function writeStore(key: string, value: string | null): void {
  try {
    value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value)
  } catch {
    // Memory still holds it for this page.
  }
}

function readStoredOptOut(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key)
    return v === "1" ? true : v === null ? null : false
  } catch {
    // No localStorage: Bun/Node, SSR, or blocked storage.
    return null
  }
}

/** POSTs a batch to your own ingest route. Uses sendBeacon when available. */
export function beaconTransport(url: string): Transport {
  return (events) => {
    const body = JSON.stringify({ events })
    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        // Beacon survives unload; fetch does not.
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))
        return
      }
    } catch {
      // Fall through to fetch.
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {})
  }
}

export function createAnalytics(config: AnalyticsConfig = {}) {
  const batchSize = config.batchSize ?? 10
  const flushIntervalMs = config.flushIntervalMs ?? 5000
  const optOutKey = config.optOutKey ?? "signet-analytics-optout"
  const timeoutMs = config.sessionTimeoutMs ?? 30 * 60_000
  const idKey = `${config.storageKey ?? "signet-analytics"}-id`
  const sessionKey = `${config.storageKey ?? "signet-analytics"}-session`
  const traitKeys = new Set(config.traitKeys ?? [])
  let queue: AnalyticsEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  // In-memory is the source of truth for the session. Persisting is
  // best-effort: where localStorage is missing or blocked (SSR, Bun, Safari
  // private mode) an opt-out must still take effect, not silently fail.
  let optedOut = readStoredOptOut(optOutKey) ?? config.requireConsent === true
  let anonymousId = readJson<string>(idKey) ?? ""
  let session = readJson<SessionState>(sessionKey)
  let userId: string | undefined

  /** The current ids, starting or continuing the session. Persists only while tracking is allowed. */
  const context = (touch: boolean): AnalyticsContext => {
    if (!anonymousId) {
      anonymousId = randomId()
      if (!suppressed()) writeStore(idKey, JSON.stringify(anonymousId))
    }
    const now = Date.now()
    const next = continueSession(session, now, timeoutMs)
    if (touch || next.id !== session?.id) {
      session = next
      if (!suppressed()) writeStore(sessionKey, JSON.stringify(session))
    }
    return { anonymousId, sessionId: (session as SessionState).id, userId }
  }

  const dntSaysNo = () =>
    config.respectDoNotTrack !== false &&
    typeof navigator !== "undefined" &&
    navigator.doNotTrack === "1"

  const suppressed = () => optedOut || dntSaysNo()

  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!queue.length || !config.transport) {
      queue = []
      return
    }
    const batch = queue
    queue = []
    try {
      void config.transport(batch)
    } catch {
      // Analytics must never break the app it is measuring.
    }
  }

  const track = (name: string, props?: EventProps) => {
    if (!config.transport || suppressed()) return
    queue.push({ name, props, ts: Date.now(), ...context(true) })
    if (queue.length >= batchSize) return flush()
    if (!timer) timer = setTimeout(flush, flushIntervalMs)
  }

  // Flush on the way out. visibilitychange fires reliably on mobile, where
  // pagehide/unload often do not.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush()
    })
  }

  return {
    track,
    flush,
    pageview: (path?: string) =>
      track("pageview", {
        path: path ?? (typeof location !== "undefined" ? location.pathname : undefined),
        referrer: typeof document !== "undefined" ? document.referrer || undefined : undefined,
      }),
    /**
     * Link this browser's events to `userId` from now on, and send an
     * `$identify` event so the server can link the anonymous events before
     * it. Traits are sent only for keys in `traitKeys`.
     */
    identify: (id: string, traits?: EventProps) => {
      if (!id) return
      userId = id
      const allowed = Object.fromEntries(
        Object.entries(traits ?? {}).filter(([k]) => traitKeys.has(k)),
      )
      track("$identify", allowed)
    },
    /** On sign-out: forget the user and start a new anonymous id and session. */
    reset: () => {
      flush()
      userId = undefined
      anonymousId = ""
      session = null
      writeStore(idKey, null)
      writeStore(sessionKey, null)
    },
    /** The ids events carry, continuing the session (does not extend it). */
    get context(): AnalyticsContext {
      return context(false)
    },
    /**
     * Headers that let server-side events join this visit:
     * `api.post(url, body, { headers: analytics.headers() })`. Empty while suppressed.
     */
    headers: (): Record<string, string> => {
      if (suppressed()) return {}
      const c = context(false)
      return {
        [ANALYTICS_HEADERS.anonymousId]: c.anonymousId,
        [ANALYTICS_HEADERS.sessionId]: c.sessionId,
      }
    },
    optOut: () => {
      optedOut = true
      queue = []
      // Forget the ids too: an opted-out browser keeps nothing that could link it.
      writeStore(idKey, null)
      writeStore(sessionKey, null)
      writeStore(optOutKey, "1")
    },
    optIn: () => {
      optedOut = false
      // "0" records the choice, so `requireConsent` does not ask again.
      writeStore(optOutKey, "0")
    },
    get isOptedOut() {
      return suppressed()
    },
    /** Pending events. Tests and debugging. */
    get pending() {
      return queue.length
    },
  }
}

export type Analytics = ReturnType<typeof createAnalytics>

/** A client that does nothing. The default, so instrumentation is always safe. */
export const noopAnalytics = createAnalytics()
