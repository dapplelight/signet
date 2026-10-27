/**
 * Cloudflare Workers Analytics Engine writer.
 *
 * Data stays in your own Cloudflare account and is queried with the SQL API.
 * No third party, no database to operate, no cookie banner.
 *
 * The binding's limits are real and violating them makes writes **fail
 * silently** — no error, no data. This module enforces them rather than
 * letting events disappear:
 *   - at most 20 blobs, 5120 bytes total across them
 *   - at most 20 doubles
 *   - exactly one index, at most 96 bytes
 */

export const LIMITS = {
  maxBlobs: 20,
  maxBlobBytes: 5120,
  maxDoubles: 20,
  maxIndexBytes: 96,
} as const

/** The subset of the Analytics Engine binding this uses. */
export type AnalyticsEngineDataset = {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void
}

export type TrackedEvent = {
  name: string
  props?: Record<string, string | number | boolean | null | undefined>
  ts?: number
}

export type EngineConfig = {
  /** The binding. Omit to disable — useful locally. */
  dataset?: AnalyticsEngineDataset
  /** Groups rows for sampling. The event name is a sensible default. */
  indexBy?: (event: TrackedEvent) => string
  onEvent?: (event: string, data: Record<string, unknown>) => void
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length

/** Truncate to a byte budget without splitting a multi-byte character. */
export function truncateBytes(value: string, maxBytes: number): string {
  if (utf8Bytes(value) <= maxBytes) return value
  let out = value
  while (out.length > 0 && utf8Bytes(out) > maxBytes) {
    out = out.slice(0, -1)
  }
  return out
}

/**
 * Flatten an event into the blobs/doubles/indexes shape, within limits.
 *
 * Blobs hold the event name then alternating key/value strings. Doubles hold
 * numeric prop values. Anything over the limits is dropped rather than
 * silently failing the whole write.
 */
export function toDataPoint(event: TrackedEvent, indexBy?: EngineConfig["indexBy"]) {
  const blobs: string[] = [event.name]
  const doubles: number[] = [event.ts ?? Date.now()]

  for (const [key, value] of Object.entries(event.props ?? {})) {
    if (value === null || value === undefined) continue
    if (typeof value === "number") {
      if (doubles.length < LIMITS.maxDoubles) doubles.push(value)
      continue
    }
    // Key and value are two blobs, so stop with room for both.
    if (blobs.length + 2 > LIMITS.maxBlobs) continue
    blobs.push(key, String(value))
  }

  // Trim from the end until the total fits — the event name stays.
  while (blobs.length > 1 && blobs.reduce((n, b) => n + utf8Bytes(b), 0) > LIMITS.maxBlobBytes) {
    blobs.pop()
  }

  return {
    blobs,
    doubles,
    indexes: [truncateBytes(indexBy ? indexBy(event) : event.name, LIMITS.maxIndexBytes)],
  }
}

export function createAnalyticsEngine(config: EngineConfig) {
  return {
    write(events: TrackedEvent[]): number {
      if (!config.dataset) {
        config.onEvent?.("analytics.skipped", { count: events.length, reason: "no_dataset" })
        return 0
      }
      let written = 0
      for (const event of events) {
        try {
          config.dataset.writeDataPoint(toDataPoint(event, config.indexBy))
          written++
        } catch (err) {
          config.onEvent?.("analytics.write_failed", { name: event.name, err: String(err) })
        }
      }
      return written
    },
    get isEnabled() {
      return !!config.dataset
    },
  }
}

export type AnalyticsEngine = ReturnType<typeof createAnalyticsEngine>
