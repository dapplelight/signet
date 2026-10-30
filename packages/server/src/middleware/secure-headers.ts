/**
 * Security headers. Requires `hono` as an optional peer.
 *
 * The default CSP assumes a JSON API: it returns data, so it needs no scripts,
 * styles or frames. `relaxedPaths` carves out doc UIs that do.
 */

import type { Context, MiddlewareHandler, Next } from "hono"

/** A JSON API needs nothing. Deny everything. */
export const STRICT_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"

/** For a Swagger/Scalar UI: CDN scripts and inline bootstrap, still unframeable. */
export const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: https://cdn.jsdelivr.net",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ")

export type SecureHeadersOptions = {
  csp?: string
  /** Paths served a relaxed CSP, e.g. ["/docs", "/openapi.json"]. Each also covers its sub-paths ("/docs/"). */
  relaxedPaths?: string[]
  relaxedCsp?: string
  /**
   * HSTS max-age in seconds. Default one year.
   * Set 0 to omit — do that on a domain not fully on HTTPS yet, since a cached
   * HSTS header cannot be withdrawn before it expires.
   */
  hstsMaxAge?: number
}

export function secureHeaders(opts: SecureHeadersOptions = {}): MiddlewareHandler {
  const relaxedPaths = opts.relaxedPaths ?? []
  const isRelaxed = (path: string) =>
    relaxedPaths.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`))
  const hsts = opts.hstsMaxAge ?? 31_536_000

  return async (c: Context, next: Next) => {
    await next()
    c.header("X-Content-Type-Options", "nosniff")
    c.header("X-Frame-Options", "DENY")
    // 0, not 1: the legacy XSS auditor introduced its own vulnerabilities and
    // modern browsers rely on CSP instead.
    c.header("X-XSS-Protection", "0")
    c.header("Referrer-Policy", "strict-origin-when-cross-origin")
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    c.header("Cross-Origin-Opener-Policy", "same-origin")
    c.header("Cross-Origin-Resource-Policy", "same-site")
    if (hsts > 0) c.header("Strict-Transport-Security", `max-age=${hsts}; includeSubDomains`)
    c.header(
      "Content-Security-Policy",
      isRelaxed(c.req.path) ? (opts.relaxedCsp ?? DOCS_CSP) : (opts.csp ?? STRICT_CSP),
    )
  }
}
