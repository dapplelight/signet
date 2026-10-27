/**
 * Hono bindings for the resource server. Requires `hono` as an optional peer.
 */

import type { Context, Hono, MiddlewareHandler, Next } from "hono"
import { type MetadataOptions, protectedResourceMetadata, wwwAuthenticate } from "./metadata.js"
import { TokenError, type TokenVerifier, type VerifiedToken } from "./verify.js"

export const METADATA_PATH = "/.well-known/oauth-protected-resource"

/** Serve RFC 9728 metadata. Unauthenticated by design — it is discovery. */
export function registerProtectedResourceMetadata(
  app: Hono<never>,
  options: MetadataOptions,
  path: string = METADATA_PATH,
): void {
  const doc = protectedResourceMetadata(options)
  app.get(path, (c) => c.json(doc))
}

export type RequireTokenOptions = {
  verifier: TokenVerifier
  /** Absolute URL of the metadata document, sent on every 401. */
  resourceMetadataUrl: string
  /** Scopes every request must carry. Per-route scopes use `requireScopes`. */
  scopes?: string[]
}

function unauthorized(c: Context, url: string, err: TokenError, required?: string[]): Response {
  c.header(
    "WWW-Authenticate",
    wwwAuthenticate({
      resourceMetadataUrl: url,
      error: err.code,
      description: err.message,
      requiredScopes: required,
    }),
  )
  return c.json({ success: false as const, error: err.message, code: err.code }, err.status)
}

/**
 * Verify the bearer token and put the claims on the context.
 *
 * The raw token is deliberately NOT stored on the context. A client's token
 * must never be forwarded to a provider — keeping only the claims makes that
 * mistake harder to make by accident.
 */
export function requireToken(options: RequireTokenOptions): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const header = c.req.header("authorization") ?? ""
    if (!/^Bearer\s+/i.test(header)) {
      return unauthorized(c, options.resourceMetadataUrl, new TokenError("Missing bearer token"))
    }
    const token = header.replace(/^Bearer\s+/i, "").trim()

    let verified: VerifiedToken
    try {
      verified = await options.verifier.verify(token)
    } catch (err) {
      const e = err instanceof TokenError ? err : new TokenError("Token verification failed")
      return unauthorized(c, options.resourceMetadataUrl, e)
    }

    if (options.scopes?.length) {
      const missing = options.scopes.filter((s) => !verified.scopes.includes(s))
      if (missing.length) {
        return unauthorized(
          c,
          options.resourceMetadataUrl,
          new TokenError(`Missing scope: ${missing.join(" ")}`, "insufficient_scope", 403),
          options.scopes,
        )
      }
    }

    c.set("token", verified)
    c.set("subject", verified.claims.sub)
    await next()
  }
}

/**
 * Per-route scope enforcement with step-up.
 *
 * A 403 carries `WWW-Authenticate` naming the scope required, so a client can
 * request a new token with it rather than simply failing.
 */
export function requireScopes(resourceMetadataUrl: string, ...scopes: string[]): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const verified = c.get("token") as VerifiedToken | undefined
    if (!verified) {
      return unauthorized(
        c,
        resourceMetadataUrl,
        new TokenError("requireToken must run before requireScopes"),
      )
    }
    const missing = scopes.filter((s) => !verified.scopes.includes(s))
    if (missing.length) {
      return unauthorized(
        c,
        resourceMetadataUrl,
        new TokenError(`Missing scope: ${missing.join(" ")}`, "insufficient_scope", 403),
        scopes,
      )
    }
    await next()
  }
}
