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
}

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
  /** localStorage key holding "1" to opt out. Default "signet-analytics-optout". */
  optOutKey?: string
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
  let queue: AnalyticsEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  // In-memory is the source of truth for the session. Persisting is
  // best-effort: where localStorage is missing or blocked (SSR, Bun, Safari
  // private mode) an opt-out must still take effect, not silently fail.
  let optedOut = readStoredOptOut(optOutKey) ?? false

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
    queue.push({ name, props, ts: Date.now() })
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
    optOut: () => {
      optedOut = true
      queue = []
      try {
        localStorage.setItem(optOutKey, "1")
      } catch {
        // Persistence failed; the in-memory flag still holds for this session.
      }
    },
    optIn: () => {
      optedOut = false
      try {
        localStorage.removeItem(optOutKey)
      } catch {}
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
