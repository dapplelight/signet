/**
 * Where server-side analytics events go, independent of runtime.
 *
 * `AnalyticsSink` is the plug. `createAnalyticsEngine` (Cloudflare Workers
 * Analytics Engine) already satisfies it; `httpSink` batches events to any
 * HTTP collector over fetch, and `memorySink` / `consoleSink` are for tests and
 * local dev. `registerIngest` takes any of them.
 */

import { type Defer, processDefer } from "../adapters/index.js"
import type { TrackedEvent } from "./engine.js"

export type AnalyticsSink = {
  /** Accept events; returns how many were accepted (written, or buffered to send). */
  write(events: TrackedEvent[]): number | Promise<number>
  /** Send anything buffered. Sinks that write at once leave it out. */
  flush?(): Promise<void>
}

export type HttpSinkConfig = {
  /** The collector. Each batch is POSTed as JSON `{ events: TrackedEvent[] }`. */
  url: string
  /** Extra headers, e.g. `{ Authorization: \`Bearer ${env.COLLECTOR_TOKEN}\` }`. */
  headers?: Record<string, string>
  /**
   * Runs each flush after the response. Default `processDefer()` (Node/Bun).
   * On Workers pass `waitUntilDefer(ctx)` and make the sink per request; on
   * Vercel, `vercelDefer(waitUntil)`.
   */
  defer?: Defer
  /** Events per POST. Default 100. */
  maxBatch?: number
  onEvent?: (event: string, data: Record<string, unknown>) => void
}

/**
 * Buffers events and POSTs them in batches. Writes in the same tick share one
 * flush, scheduled through `defer`; `flush()` sends what is left now (call it
 * before a process exits). A failed POST is reported to `onEvent` as
 * `analytics.flush_failed` and its batch dropped, never retried or thrown:
 * analytics must not take a request down.
 */
export function httpSink(config: HttpSinkConfig): AnalyticsSink & { flush(): Promise<void> } {
  const maxBatch = Math.max(1, config.maxBatch ?? 100)
  const defer = config.defer ?? processDefer()
  const buffer: TrackedEvent[] = []
  let scheduled = false

  async function flush(): Promise<void> {
    scheduled = false
    while (buffer.length) {
      const batch = buffer.splice(0, maxBatch)
      try {
        const res = await fetch(config.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...config.headers },
          body: JSON.stringify({ events: batch }),
        })
        if (!res.ok)
          config.onEvent?.("analytics.flush_failed", { status: res.status, count: batch.length })
      } catch (err) {
        config.onEvent?.("analytics.flush_failed", { err: String(err), count: batch.length })
      }
    }
  }

  return {
    write(events) {
      if (!events.length) return 0
      buffer.push(...events)
      if (!scheduled) {
        scheduled = true
        defer(Promise.resolve().then(flush))
      }
      return events.length
    },
    flush,
  }
}

/** Keeps every event in `events`. For tests. */
export function memorySink(): AnalyticsSink & { readonly events: TrackedEvent[] } {
  const events: TrackedEvent[] = []
  return {
    events,
    write(batch) {
      events.push(...batch)
      return batch.length
    },
  }
}

/** Logs each event. For local dev, where there is no dataset or collector. */
export function consoleSink(
  log: (event: TrackedEvent) => void = (e) => console.log("[analytics]", e.name, e.props ?? {}),
): AnalyticsSink {
  return {
    write(events) {
      for (const e of events) log(e)
      return events.length
    },
  }
}
