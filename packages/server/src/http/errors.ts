/**
 * Server half of the error envelope. Requires `hono` as an optional peer.
 *
 * Pairs with `@dapplelight/signet-lib/api` on the client: what `errorHandler` writes is
 * exactly what `createApiClient` parses.
 */

import type { Context, ErrorHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import { STATUS_CODES as CODES } from "./status-codes.js"

export type ErrorHandlerOptions = {
  /**
   * True in production. Unhandled error messages are replaced with a generic
   * string — they can carry connection strings, file paths and query text.
   * Read this per request; on Workers a module-scope `process.env` read is
   * unreliable.
   */
  isProduction: () => boolean
  /**
   * Report an unhandled error. Sentry, a logger, anything. A returned promise
   * is passed to `executionCtx.waitUntil` on Workers, so the report is not cut
   * off when the response is sent.
   */
  onError?: (
    err: Error,
    meta: { path: string; method: string; reqId?: string },
    // biome-ignore lint/suspicious/noConfusingVoidType: `void` lets a callback that returns nothing type-check; `undefined` would reject `() => { log() }`
  ) => void | Promise<unknown>
  /**
   * Where the request id lives. Default: `c.get("reqId")`, set by Signet's
   * requestId middleware. Pass this when the app has its own.
   */
  getRequestId?: (c: Context) => string | undefined
}

/** The request id Signet's requestId middleware sets. */
export const defaultRequestId = (c: Context): string | undefined =>
  c.get("reqId") as string | undefined

/**
 * Statuses a route is expected to raise deliberately. Includes 502/503/504 for
 * a dependency being down ("the store is unreachable"), which a client should
 * be able to tell apart from our own 500.
 */
export type ApiErrorStatus = 400 | 401 | 403 | 404 | 405 | 409 | 410 | 422 | 429 | 502 | 503 | 504

/** Throw from a route to return a specific status with a stable code. */
export class ApiException extends HTTPException {
  constructor(
    status: ApiErrorStatus,
    message: string,
    readonly code?: string,
    readonly details?: { formErrors: string[]; fieldErrors: Record<string, string[]> },
  ) {
    super(status as never, { message })
  }
}

/**
 * The code for an HTTPException thrown without one (auth's 401s, Hono's own).
 * Defined in a hono-free module so `/mcp` can read it without importing hono.
 */
export const STATUS_CODES: Record<number, string> = CODES

export function errorHandler(opts: ErrorHandlerOptions): ErrorHandler {
  return (err, c) => {
    // On every error, so a user's report can be traced to the log line. Set by
    // the requestId middleware; absent without it.
    const reqId = (opts.getRequestId ?? defaultRequestId)(c)
    const requestId = reqId ? { requestId: reqId } : {}

    if (err instanceof ApiException) {
      return c.json(
        {
          success: false as const,
          error: err.message,
          ...(err.code ? { code: err.code } : {}),
          ...(err.details ? { details: err.details } : {}),
          ...requestId,
        },
        err.status,
      )
    }

    if (err instanceof HTTPException) {
      const code = STATUS_CODES[err.status] ?? "HTTP_ERROR"
      return c.json({ success: false as const, error: err.message, code, ...requestId }, err.status)
    }

    const report = opts.onError?.(err, {
      path: c.req.path,
      method: c.req.method,
      reqId,
    })
    if (report instanceof Promise) {
      // Hono's executionCtx getter throws outside Workers; there the process
      // outlives the response and the promise completes on its own.
      try {
        c.executionCtx.waitUntil(report.catch(() => {}))
      } catch {}
    }

    return c.json(
      {
        success: false as const,
        error: opts.isProduction() ? "Internal server error" : err.message,
        code: "INTERNAL_ERROR",
        ...requestId,
      },
      500,
    )
  }
}
