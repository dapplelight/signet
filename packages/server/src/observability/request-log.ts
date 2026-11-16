/**
 * One structured log line when a request starts and one when it ends:
 * `request.started`, then `request.completed` or `request.failed`. Lines carry
 * method, route pattern, status, duration, request id and trace id, never
 * bodies, query strings or headers. Takes a logger; never reads env.
 * Mount after `requestId` and `traceMiddleware` so both ids are set.
 */

import type { Context, MiddlewareHandler } from "hono"
import { routePath } from "hono/route"
import type { LevelName, LogFields } from "./logger.js"
import { traceContext } from "./trace.js"

type LogLike = Record<LevelName, (msg: string, fields?: LogFields) => void>

export type RequestLogConfig = {
  logger: LogLike
  /** Paths (exact match) that are not logged, e.g. `["/health"]`. */
  skipPaths?: string[]
  /** Completed requests at or over this many ms get `slow: true`. Default off. */
  slowMs?: number
  /** Level by status. Default: below 400 `info`, 4xx `warn`, 5xx `error`. */
  level?: (status: number) => LevelName
}

const byStatus = (status: number): LevelName =>
  status >= 500 ? "error" : status >= 400 ? "warn" : "info"

export function requestLog(cfg: RequestLogConfig): MiddlewareHandler {
  const skip = new Set(cfg.skipPaths)
  const levelFor = cfg.level ?? byStatus
  return async (c: Context, next) => {
    if (skip.has(c.req.path)) return next()
    const base = () => ({
      method: c.req.method,
      route: routePath(c, -1),
      reqId: c.get("reqId") as string | undefined,
      traceId: traceContext(c).traceId,
    })
    const started = Date.now()
    cfg.logger.info("request.started", base())
    const done = (msg: string, level: LevelName, status: number, error?: unknown) => {
      const durationMs = Date.now() - started
      cfg.logger[level](msg, {
        ...base(),
        status,
        durationMs,
        ...(error === undefined
          ? {}
          : { error: error instanceof Error ? error.message : "unknown error" }),
        ...(cfg.slowMs !== undefined && durationMs >= cfg.slowMs ? { slow: true } : {}),
      })
    }
    try {
      await next()
    } catch (err) {
      done("request.failed", "error", 500, err)
      throw err
    }
    // A handler's throw reaches `onError` and comes back as `c.error`.
    if (c.error) done("request.failed", "error", c.res.status, c.error)
    else done("request.completed", levelFor(c.res.status), c.res.status)
  }
}
