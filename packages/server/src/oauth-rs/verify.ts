/**
 * OAuth 2.1 access token verification for a RESOURCE SERVER.
 *
 * The audience check is the reason this file exists. A token signed by the
 * correct issuer but minted for a DIFFERENT resource will pass signature and
 * expiry checks and look completely valid. Skipping `aud` therefore builds an
 * open door that passes every test you are likely to write, which is why
 * RFC 8707 resource indicators exist and why `audience` is required here rather
 * than optional.
 */

import {
  algParams,
  createJwksCache,
  type JwksCache,
  SUPPORTED_ALGS,
  type SupportedAlg,
} from "./jwks.js"

export type Claims = {
  iss: string
  sub: string
  aud: string | string[]
  exp: number
  iat?: number
  nbf?: number
  /** Space-delimited per RFC 8693; some issuers send an array. */
  scope?: string
  scp?: string | string[]
  client_id?: string
  jti?: string
  [key: string]: unknown
}

export type VerifiedToken = { claims: Claims; scopes: string[] }

export type VerifierOptions = {
  /** Expected `iss`. Must match exactly. */
  issuer: string
  /**
   * This resource server's identifier — the canonical URI clients name when
   * requesting a token. REQUIRED: a token for another audience is not for you.
   */
  audience: string
  jwksUri: string
  /** Tolerance for clock drift, seconds. Default 60. */
  clockSkewSeconds?: number
  /** Restrict further if you know the issuer's algorithm. */
  allowedAlgs?: readonly SupportedAlg[]
  /**
   * Require the RFC 9068 access-token type (`typ: at+jwt`). Default false,
   * since many issuers still send `JWT`; turn it on when yours sends at+jwt, so
   * an ID token from the same issuer cannot be replayed as an access token.
   */
  requireAtJwt?: boolean
  jwks?: JwksCache
  now?: () => number
}

export class TokenError extends Error {
  constructor(
    message: string,
    /** RFC 6750 error code: invalid_token | insufficient_scope. */
    readonly code: "invalid_token" | "insufficient_scope" = "invalid_token",
    readonly status: 401 | 403 = 401,
  ) {
    super(message)
    this.name = "TokenError"
  }
}

const b64urlToBytes = (s: string): Uint8Array => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/") + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const decodeJson = (s: string): unknown => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)))

function keyMatchesAlg(key: CryptoKey, alg: string): boolean {
  const params = algParams(alg)
  if (!params) return false
  const a = key.algorithm as { name: string; hash?: { name: string }; namedCurve?: string }
  if (a.name !== params.name) return false
  return params.namedCurve ? a.namedCurve === params.namedCurve : a.hash?.name === params.hash
}

/** Normalise scopes from `scope` (string) or `scp` (string or array). */
export function scopesOf(claims: Claims): string[] {
  if (typeof claims.scope === "string") return claims.scope.split(" ").filter(Boolean)
  if (Array.isArray(claims.scp)) return claims.scp.filter(Boolean)
  if (typeof claims.scp === "string") return claims.scp.split(" ").filter(Boolean)
  return []
}

export function createTokenVerifier(options: VerifierOptions) {
  const skew = options.clockSkewSeconds ?? 60
  const allowed = options.allowedAlgs ?? SUPPORTED_ALGS
  const jwks = options.jwks ?? createJwksCache({ jwksUri: options.jwksUri })
  const now = options.now ?? (() => Date.now())

  return {
    async verify(token: string): Promise<VerifiedToken> {
      const parts = token.split(".")
      if (parts.length !== 3) throw new TokenError("Malformed token")
      const [headerB64, payloadB64, sigB64] = parts

      let header: { alg?: string; kid?: string; typ?: string }
      let claims: Claims
      try {
        header = decodeJson(headerB64) as typeof header
        claims = decodeJson(payloadB64) as Claims
      } catch {
        throw new TokenError("Malformed token")
      }

      // Algorithm is pinned to an allow-list. "none" and any symmetric
      // algorithm are rejected here rather than reaching key selection — this
      // is the classic alg-confusion bypass.
      const alg = header.alg ?? ""
      if (!allowed.includes(alg as SupportedAlg)) {
        throw new TokenError(`Unsupported algorithm: ${alg || "missing"}`)
      }

      if (options.requireAtJwt && !/^(application\/)?at\+jwt$/i.test(header.typ ?? "")) {
        throw new TokenError("Not an access token (typ is not at+jwt)")
      }

      let key: CryptoKey | null
      try {
        key = await jwks.get(header.kid)
      } catch {
        throw new TokenError("Signing keys unavailable")
      }
      if (!key) throw new TokenError("No matching signing key")
      // The header's alg must match the key it selected: an ES256 header must
      // not be checked against a P-384 key, nor RS512 against an RS256 key.
      if (!keyMatchesAlg(key, alg)) throw new TokenError("Algorithm does not match the signing key")

      const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
      let sig: Uint8Array
      try {
        sig = b64urlToBytes(sigB64)
      } catch {
        throw new TokenError("Malformed token")
      }
      const params = alg.startsWith("ES")
        ? { name: "ECDSA", hash: alg === "ES384" ? "SHA-384" : "SHA-256" }
        : { name: "RSASSA-PKCS1-v1_5" }
      const valid = await crypto.subtle.verify(
        params,
        key,
        sig as BufferSource,
        data as BufferSource,
      )
      if (!valid) throw new TokenError("Invalid signature")

      const seconds = Math.floor(now() / 1000)

      if (claims.iss !== options.issuer) {
        throw new TokenError("Issuer mismatch")
      }

      // RFC 8707. A token minted for another resource is NOT for us, however
      // valid its signature.
      const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : []
      if (!audiences.includes(options.audience)) {
        throw new TokenError("Token audience does not include this resource server")
      }

      if (typeof claims.exp !== "number" || claims.exp + skew < seconds) {
        throw new TokenError("Token expired")
      }
      if (typeof claims.nbf === "number" && claims.nbf - skew > seconds) {
        throw new TokenError("Token not yet valid")
      }
      if (!claims.sub) throw new TokenError("Token has no subject")

      return { claims, scopes: scopesOf(claims) }
    },
  }
}

export type TokenVerifier = ReturnType<typeof createTokenVerifier>
