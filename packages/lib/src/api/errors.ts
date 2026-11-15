import type { ErrorEnvelope } from "./contract.js"

/**
 * A failed request that is not an auth failure.
 *
 * Carries `status` and the optional `code`/`details` from the envelope so call
 * sites can branch without re-parsing the response, and `body`, the parsed JSON
 * body whatever its shape, for endpoints whose error is not an envelope (a 409
 * `{ warning: "overlap", overlapPct, proceed }`).
 */
export class ApiError extends Error {
  // string, not the literal, so TimeoutError can name itself.
  override readonly name: string = "ApiError"
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: ErrorEnvelope["details"],
    /** From the envelope, else the X-Request-Id header. For tracing a user's report. */
    readonly requestId?: string,
    /**
     * Seconds until a retry can succeed, when the server said (429, 503). From
     * Retry-After, else RateLimit-Reset, else X-RateLimit-Reset. Use it to say
     * "try again in 30 seconds" and hold the button until then.
     */
    readonly retryAfter?: number,
    /**
     * The parsed JSON response body, envelope or not. Undefined when it was not
     * JSON: an HTML or plain-text body is neither kept here nor used as the
     * message. Use `client.send()` to read such a body yourself.
     */
    readonly body?: unknown,
  ) {
    super(message)
  }
}

/**
 * The client gave up waiting: `createRpcClient`'s `timeoutMs` (or a per-call
 * `timeout(ms)`) passed before the response headers arrived. An ApiError with
 * status 408 and code `TIMEOUT`, so error copy, `isRetryable` and toasts treat
 * it like the server's own timeout.
 */
export class TimeoutError extends ApiError {
  override readonly name = "TimeoutError"
  constructor(
    /** The limit that ran out. */
    readonly timeoutMs: number,
    requestId?: string,
  ) {
    super(`Request timed out after ${timeoutMs} ms`, 408, "TIMEOUT", undefined, requestId)
  }
}

export function isTimeoutError(e: unknown): e is TimeoutError {
  return e instanceof TimeoutError
}

/**
 * A 401. Separate from ApiError on purpose.
 *
 * Every product in the audit special-cased 401 and then had nowhere consistent
 * to handle it. A distinct class lets the query client skip retries and trigger
 * one redirect, instead of each call site checking `status === 401`.
 */
export class AuthError extends Error {
  readonly name = "AuthError"
  readonly status = 401
  constructor(
    message = "Session expired",
    /** The envelope's code, e.g. "invalid_passcode", when the server sent one. */
    readonly code?: string,
    /** The parsed JSON body, when there was one. */
    readonly body?: unknown,
  ) {
    super(message)
  }
}

export function isAuthError(e: unknown): e is AuthError {
  return e instanceof AuthError
}
