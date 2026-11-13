/**
 * CSRF guard for cookie-authenticated APIs. Requires `hono` as an optional peer.
 *
 * Wraps Hono's `csrf()`: an unsafe request (not GET/HEAD/OPTIONS) that a browser
 * form could send (urlencoded, multipart or text/plain) must carry
 * `Sec-Fetch-Site: same-origin` or an `Origin` this app trusts. The trusted
 * origins are the request's own plus the same env keys `corsMiddleware` reads,
 * so one config covers both.
 *
 * A request with a bearer token is skipped: browsers never attach one on their
 * own, so it cannot be forged cross-site.
 *
 * Needed once a session cookie is `sameSite: "none"` (frontend and API on
 * different origins): Lax no longer protects you then.
 */

import { csrf as honoCsrf } from "hono/csrf"
import { createMiddleware } from "hono/factory"
import { HTTPException } from "hono/http-exception"
import { ApiException } from "../http/errors.js"
import { allowedOrigins, type CorsOptions } from "./cors.js"

export type CsrfOptions = Pick<CorsOptions, "originEnvKeys" | "extraOrigins" | "devOrigins">

export function csrfMiddleware(opts: CsrfOptions = {}) {
  const guard = honoCsrf({
    origin: (origin, c) =>
      origin === new URL(c.req.url).origin || allowedOrigins(opts).includes(origin),
  })
  return createMiddleware(async (c, next) => {
    if (/^Bearer\s/i.test(c.req.header("authorization") ?? "")) return next()
    try {
      return await guard(c, next)
    } catch (e) {
      // Hono throws a bare 403 with a plain-text body. Re-throw it as the
      // standard error envelope; errors from downstream handlers pass through.
      if (e instanceof HTTPException && e.status === 403 && !(e instanceof ApiException)) {
        throw new ApiException(403, "Cross-site request blocked", "FORBIDDEN")
      }
      throw e
    }
  })
}
