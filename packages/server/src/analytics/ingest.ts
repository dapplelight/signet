/**
 * Hono ingest route for browser events. Requires `hono` as an optional peer.
 *
 * This endpoint is public and unauthenticated by necessity, so it is the one
 * route an attacker can write to freely. It therefore caps batch size and event
 * count itself rather than trusting the payload, and should be rate limited.
 */

import type { Hono } from "hono"
import type { AnalyticsEngine, TrackedEvent } from "./engine.js"

export type IngestOptions = {
  engine: AnalyticsEngine
  /** Max events accepted per request. Default 50. */
  maxEvents?: number
  /** Max event-name length. Default 64. */
  maxNameLength?: number
  /** Enrich server-side — country, user agent. Never trust the client for these. */
  enrich?: (c: never) => Record<string, string | number | undefined>
}

type Body = { events?: unknown }

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
    const events: TrackedEvent[] = []

    for (const raw of body.events.slice(0, maxEvents)) {
      if (typeof raw !== "object" || raw === null) continue
      const e = raw as { name?: unknown; props?: unknown; ts?: unknown }
      if (typeof e.name !== "string" || !e.name) continue
      events.push({
        name: e.name.slice(0, maxNameLength),
        ts: typeof e.ts === "number" ? e.ts : Date.now(),
        props: {
          ...(typeof e.props === "object" && e.props ? (e.props as TrackedEvent["props"]) : {}),
          // Server values last so a client cannot spoof them.
          ...enriched,
        },
      })
    }

    const written = opts.engine.write(events)
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
