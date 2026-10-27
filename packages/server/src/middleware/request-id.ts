/** Request correlation id. Requires `hono` as an optional peer. */

import type { Context, MiddlewareHandler, Next } from "hono"

export type RequestIdOptions = {
  /** Build a per-request child logger bound to the id. */
  childLogger?: (reqId: string) => unknown
  /** Header to honour from upstream and echo back. Default "x-request-id". */
  header?: string
  /**
   * Whether an incoming id is safe to reuse. Default: 1–128 chars of
   * [A-Za-z0-9_-]. The header is caller-controlled and the id reaches logs and
   * Sentry, so anything else is replaced with a fresh UUID.
   */
  accept?: (id: string) => boolean
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

export function requestId(opts: RequestIdOptions = {}): MiddlewareHandler {
  const header = opts.header ?? "x-request-id"
  return async (c: Context, next: Next) => {
    const incoming = c.req.header(header)
    const id =
      incoming && (opts.accept ?? ((v) => SAFE_ID.test(v)))(incoming)
        ? incoming
        : crypto.randomUUID()
    c.set("reqId", id)
    if (opts.childLogger) c.set("logger", opts.childLogger(id))
    c.header("X-Request-Id", id)
    await next()
  }
}
