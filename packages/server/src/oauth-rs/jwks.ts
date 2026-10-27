/**
 * JWKS fetching, caching and rotation. Web Crypto only — runs on Workers.
 *
 * Keys are cached by `kid`. An unknown `kid` triggers at most one refetch
 * (rate-limited), because key rotation is normal and an issuer that rotates
 * must not cause an outage — but an attacker must not be able to force an
 * unbounded number of fetches by sending garbage `kid` values either.
 */

export type Jwk = {
  kid?: string
  kty: string
  alg?: string
  use?: string
  n?: string
  e?: string
  crv?: string
  x?: string
  y?: string
}

/** Algorithms this verifier will accept. `none` is not and can never be one. */
export const SUPPORTED_ALGS = ["RS256", "RS384", "RS512", "ES256", "ES384"] as const
export type SupportedAlg = (typeof SUPPORTED_ALGS)[number]

function algParams(alg: string): { name: string; hash: string; namedCurve?: string } | null {
  switch (alg) {
    case "RS256":
      return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
    case "RS384":
      return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" }
    case "RS512":
      return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" }
    case "ES256":
      return { name: "ECDSA", hash: "SHA-256", namedCurve: "P-256" }
    case "ES384":
      return { name: "ECDSA", hash: "SHA-384", namedCurve: "P-384" }
    default:
      return null
  }
}

export type JwksOptions = {
  jwksUri: string
  /** Cache lifetime. Default 10 minutes. */
  ttlSeconds?: number
  /** Minimum gap between refetches triggered by an unknown kid. Default 60s. */
  minRefetchSeconds?: number
  fetchImpl?: typeof fetch
  now?: () => number
}

export function createJwksCache(options: JwksOptions) {
  const ttl = (options.ttlSeconds ?? 600) * 1000
  const minRefetch = (options.minRefetchSeconds ?? 60) * 1000
  const doFetch = options.fetchImpl ?? fetch
  const now = options.now ?? (() => Date.now())

  let keys = new Map<string, CryptoKey>()
  let fetchedAt = 0
  let inFlight: Promise<void> | null = null

  async function importKey(jwk: Jwk): Promise<CryptoKey | null> {
    const alg = jwk.alg && SUPPORTED_ALGS.includes(jwk.alg as SupportedAlg) ? jwk.alg : null
    // An issuer may omit `alg`; infer it from the key type rather than guessing
    // something permissive.
    const resolved =
      alg ??
      (jwk.kty === "RSA" ? "RS256" : jwk.kty === "EC" && jwk.crv === "P-256" ? "ES256" : null)
    if (!resolved) return null
    const params = algParams(resolved)
    if (!params) return null
    try {
      return await crypto.subtle.importKey(
        "jwk",
        jwk as JsonWebKey,
        params.namedCurve
          ? { name: params.name, namedCurve: params.namedCurve }
          : { name: params.name, hash: params.hash },
        false,
        ["verify"],
      )
    } catch {
      return null
    }
  }

  async function refresh(): Promise<void> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const res = await doFetch(options.jwksUri, { headers: { accept: "application/json" } })
      if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`)
      const body = (await res.json()) as { keys?: Jwk[] }
      const next = new Map<string, CryptoKey>()
      for (const jwk of body.keys ?? []) {
        if (jwk.use && jwk.use !== "sig") continue
        const key = await importKey(jwk)
        // A key with no kid is usable only when it is the sole key.
        if (key) next.set(jwk.kid ?? "__single__", key)
      }
      keys = next
      fetchedAt = now()
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    async get(kid: string | undefined): Promise<CryptoKey | null> {
      const stale = now() - fetchedAt > ttl
      if (!keys.size || stale) await refresh()

      const lookup = kid ?? (keys.size === 1 ? [...keys.keys()][0] : undefined)
      if (lookup && keys.has(lookup)) return keys.get(lookup) ?? null

      // Unknown kid: the issuer may have rotated. Refetch at most once per
      // window so a stream of bogus kids cannot be turned into a fetch flood.
      if (now() - fetchedAt > minRefetch) {
        await refresh()
        const retry = kid ?? (keys.size === 1 ? [...keys.keys()][0] : undefined)
        if (retry && keys.has(retry)) return keys.get(retry) ?? null
      }
      return null
    },
    /** Tests only. */
    _size: () => keys.size,
  }
}

export type JwksCache = ReturnType<typeof createJwksCache>
export { algParams }
