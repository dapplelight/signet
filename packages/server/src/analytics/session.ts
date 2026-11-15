/**
 * Server-side events that join the browser's visit and user.
 *
 * The browser client (signet-lib's `createAnalytics`) keeps a random
 * anonymous id and session id and sends them as headers with
 * `analytics.headers()`. `analyticsContext` reads them back, and
 * `serverTracker` stamps them on events the server records itself (a signup,
 * a payment), so those land in the same visit as the clicks before them.
 */

import type { TrackedEvent } from "./engine.js"
import { cleanId } from "./ingest.js"
import type { AnalyticsSink } from "./sinks.js"

/** The header names signet-lib's `analytics.headers()` sets. */
export const ANALYTICS_HEADERS = {
  anonymousId: "x-signet-anonymous-id",
  sessionId: "x-signet-session-id",
} as const

export type AnalyticsContext = { anonymousId?: string; sessionId?: string; userId?: string }

/** The visit ids from a request's headers. Malformed ids are dropped. */
export function analyticsContext(headers: Headers | { get(name: string): string | null }) {
  return {
    anonymousId: cleanId(headers.get(ANALYTICS_HEADERS.anonymousId)),
    sessionId: cleanId(headers.get(ANALYTICS_HEADERS.sessionId)),
  } satisfies AnalyticsContext
}

/**
 * `track` and `identify` for one request, writing to `sink` with the
 * request's ids. `identify` writes `$identify`, which signet-db's analytics
 * store uses to link the anonymous events before it to the user.
 *
 * ```ts
 * const t = serverTracker(sink, { ...analyticsContext(c.req.raw.headers), userId: user?.id })
 * await t.identify(user.id)      // just signed up or signed in
 * await t.track("signup", { plan: "free" })
 * ```
 */
export function serverTracker(sink: AnalyticsSink, context: AnalyticsContext = {}) {
  const ctx = { ...context }
  const write = (name: string, props?: TrackedEvent["props"]) =>
    sink.write([{ name, props, ts: Date.now(), ...ctx }])
  return {
    track: write,
    /** Link this visit to `userId`. Pass traits only if you mean to store them. */
    identify(userId: string, traits?: TrackedEvent["props"]) {
      ctx.userId = userId
      return write("$identify", traits)
    },
    get context(): AnalyticsContext {
      return { ...ctx }
    },
  }
}
