import type { Cache, CacheEntry, KeyValueLike, KvNamespaceLike } from "./types.js"

/**
 * Cache key: a SHA-256 of the schema shape, the instructions, the input and,
 * when given, the model.
 *
 * The schema must be part of the key — the same prompt against a changed schema
 * is a different question, and reusing the old answer returns data that no
 * longer validates. So must the model: switching to a better one should not
 * keep serving the old one's answers. `createExtractor` passes its provider
 * chain (`name/model` of each, in order).
 */
export async function cacheKey(
  schemaFingerprint: string,
  instructions: string,
  input: string,
  model?: string,
): Promise<string> {
  const parts = [schemaFingerprint, instructions, input]
  if (model) parts.push(model)
  const data = new TextEncoder().encode(parts.join("\u0000"))
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

/**
 * Cache over a shared key-value store, so every isolate or process sees the
 * same entries. Takes a `KeyValueLike` (`upstashKv`, `cloudflareKv` from
 * signet-server's adapters) or a Workers KV namespace directly (`env.AI_CACHE`).
 * Entries are JSON with their own expiry, checked on read, because a store may
 * keep a key past the TTL asked for (Workers KV's minimum is 60s, so a shorter
 * TTL is stored for 60s and still expires on time). An unreadable entry is a miss.
 */
export function kvCache(store: KeyValueLike | KvNamespaceLike, prefix = "signet-ai-cache"): Cache {
  const kv: KeyValueLike =
    "put" in store
      ? {
          get: (k) => store.get(k),
          set: (k, v, o) =>
            store.put(k, v, { expirationTtl: Math.max(60, Math.ceil(o?.ttlSeconds ?? 60)) }),
        }
      : store
  return {
    async get(key) {
      const raw = await kv.get(`${prefix}:${key}`)
      if (!raw) return undefined
      try {
        const { entry, expiresAt } = JSON.parse(raw) as { entry: CacheEntry; expiresAt: number }
        return expiresAt > Date.now() ? entry : undefined
      } catch {
        return undefined
      }
    },
    async set(key, entry, ttlSeconds) {
      const value = JSON.stringify({ entry, expiresAt: Date.now() + ttlSeconds * 1000 })
      await kv.set(`${prefix}:${key}`, value, { ttlSeconds })
    },
  }
}
