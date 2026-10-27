import type { Cache, CacheEntry } from "./types.js"

/**
 * Cache key: a hash of the schema shape, the instructions and the input.
 *
 * The schema must be part of the key — the same prompt against a changed schema
 * is a different question, and reusing the old answer returns data that no
 * longer validates.
 */
export async function cacheKey(
  schemaFingerprint: string,
  instructions: string,
  input: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${schemaFingerprint}\u0000${instructions}\u0000${input}`)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * A stable fingerprint for a Zod schema.
 *
 * Zod does not expose a canonical serialisation, so this walks the shape. It
 * only has to be stable and to change when the schema changes.
 */
export function fingerprintSchema(schema: unknown, depth = 0): string {
  if (depth > 8 || !schema || typeof schema !== "object") return "?"
  const def = (schema as { _def?: Record<string, unknown> })._def
  if (!def) return "?"
  const name = String(def.typeName ?? def.type ?? "?")
  const shapeFn = (def as { shape?: unknown }).shape
  const shape = typeof shapeFn === "function" ? (shapeFn as () => object)() : shapeFn
  if (shape && typeof shape === "object") {
    const keys = Object.keys(shape).sort()
    return `${name}{${keys.map((k) => `${k}:${fingerprintSchema((shape as Record<string, unknown>)[k], depth + 1)}`).join(",")}}`
  }
  const inner = (def as { innerType?: unknown; type?: unknown }).innerType ?? def.type
  if (inner && typeof inner === "object") return `${name}<${fingerprintSchema(inner, depth + 1)}>`
  return name
}

/** In-memory cache. Fine for a single Worker isolate or a Node process. */
export function memoryCache(maxEntries = 500): Cache {
  const map = new Map<string, { entry: CacheEntry; expiresAt: number }>()
  return {
    get(key) {
      const hit = map.get(key)
      if (!hit) return undefined
      if (hit.expiresAt < Date.now()) {
        map.delete(key)
        return undefined
      }
      return hit.entry
    },
    set(key, entry, ttlSeconds) {
      if (map.size >= maxEntries) {
        const oldest = map.keys().next().value
        if (oldest) map.delete(oldest)
      }
      map.set(key, { entry, expiresAt: Date.now() + ttlSeconds * 1000 })
    },
  }
}
