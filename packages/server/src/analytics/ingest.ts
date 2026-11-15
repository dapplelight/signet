/**
 * Hono ingest route for browser events. Requires `hono` as an optional peer.
 *
 * This endpoint is public and unauthenticated by necessity, so it is the one
 * route an attacker can write to freely. It therefore caps batch size and event
 * count itself rather than trusting the payload, and should be rate limited.
 */

import type { Hono } from "hono"
import type { TrackedEvent } from "./engine.js"
import type { AnalyticsSink } from "./sinks.js"

export type IngestOptions = {
  /** Any sink: `createAnalyticsEngine(...)`, `httpSink(...)`, `memorySink()`. */
  engine: AnalyticsSink
  /** Max events accepted per request. Default 50. */
  maxEvents?: number
  /** Max event-name length. Default 64. */
  maxNameLength?: number
  /**
   * The signed-in user for this request, from your session, e.g.
   * `(c) => c.get("user")?.id`. Events then carry it, overriding anything the
   * client sent. Without it a client-sent `userId` is dropped, since anyone
   * can post to this route claiming to be anyone.
   */
  userId?: (c: never) => string | undefined | Promise<string | undefined>
  /** Keep a client-sent `userId` when there is no `userId` resolver. Default false. */
  trustClientUserId?: boolean
  /** Enrich server-side — country, user agent. Never trust the client for these. */
  enrich?: (c: never) => Record<string, string | number | undefined>
}

type Body = { events?: unknown }

/** An id from the client: a short string of id characters, else dropped. */
export const cleanId = (v: unknown): string | undefined =>
  typeof v === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : undefined

export function registerIngest(app: Hono<never>, path: string, opts: IngestOptions): void {
  const maxEvents = opts.maxEvents ?? 50
  const maxNameLength = opts.maxNameLength ?? 64

  app.post(path, async (c) => {
    const body = (await c.req.json().catch(() => null)) as Body | null
    if (!body || !Array.isArray(body.events)) {
      return c.json(
        { success: false as const, error: "Invalid payload", code: "INVALID_PAYLOAD" },
        400,
      )
    }

    const enriched = opts.enrich?.(c as never) ?? {}
    const serverUser = opts.userId ? cleanId(await opts.userId(c as never)) : undefined
    const events: TrackedEvent[] = []

    for (const raw of body.events.slice(0, maxEvents)) {
      if (typeof raw !== "object" || raw === null) continue
      const e = raw as Record<string, unknown>
      if (typeof e.name !== "string" || !e.name) continue
      events.push({
        name: e.name.slice(0, maxNameLength),
        ts: typeof e.ts === "number" ? e.ts : Date.now(),
        anonymousId: cleanId(e.anonymousId),
        sessionId: cleanId(e.sessionId),
        userId: opts.userId ? serverUser : opts.trustClientUserId ? cleanId(e.userId) : undefined,
        props: {
          ...(typeof e.props === "object" && e.props ? (e.props as TrackedEvent["props"]) : {}),
          // Server values last so a client cannot spoof them.
          ...enriched,
        },
      })
    }

    const written = await opts.engine.write(events)
    // 202: accepted, nothing to report back. The client never waits on this.
    return c.json({ success: true as const, written }, 202)
  })
}

/** Country and user agent from the Cloudflare request. Not client-supplied. */
export function cloudflareEnrichment(c: {
  req: { header(name: string): string | undefined; raw: Request }
}): Record<string, string | undefined> {
  const cf = (c.req.raw as Request & { cf?: { country?: string } }).cf
  return {
    country: cf?.country,
    ua: c.req.header("user-agent")?.slice(0, 200),
  }
}
