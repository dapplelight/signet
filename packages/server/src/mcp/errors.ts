/**
 * Error mapping shared by tools, resources and prompts: which errors are
 * deliberate (keep their code and message) and which are "Internal error"
 * (reported to `onError`, never shown to the client).
 */

import type { Context } from "hono"
import { STATUS_CODES } from "../http/status-codes.js"
import type { CallToolResult } from "./server.js"

/**
 * Which handler failed. `tool` is its name — a tool's, or a resource's or
 * prompt's, with `kind` set for those two. Tools leave `kind` unset.
 */
export type ErrorMeta = { tool: string; kind?: "resource" | "prompt" }

/** What a tool's error becomes: the Signet envelope's `code`, `error` and `details`. */
export type ToolErrorInfo = {
  code: string
  message: string
  details?: { formErrors: string[]; fieldErrors: Record<string, string[]> }
}

export type ToolErrorOptions = {
  /**
   * Build the whole error result yourself — for an app that already has a
   * result shape its clients (and the LLM) read. Runs first, before `mapError`
   * and the defaults; a returned result is sent as-is, undefined falls through.
   *
   * Reporting is unchanged by it: `onError` still fires for exactly the errors
   * that would otherwise have been "Internal error" (not claimed by `mapError`
   * or the defaults), whether or not `errorResult` handled them. A throwing
   * `errorResult` counts as undefined.
   *
   * Only for errors a handler throws. Input the SDK rejects before the handler
   * runs, and a missing scope, keep their own results.
   */
  errorResult?: (err: unknown, meta: { tool: string }) => CallToolResult | undefined
  /**
   * Map an app's own error type before the defaults run — e.g. signet-lib's
   * `ApiError` from an upstream API. Return undefined to fall through.
   */
  mapError?: (err: unknown) => ToolErrorInfo | undefined
  /**
   * Hear about an unexpected error; the client only sees "Internal error".
   * A returned promise is passed to `executionCtx.waitUntil` on Workers.
   */
  onError?: (
    err: unknown,
    meta: ErrorMeta,
    // biome-ignore lint/suspicious/noConfusingVoidType: `void` lets a callback that returns nothing type-check
  ) => void | Promise<unknown>
}

type ZodErrorLike = Error & {
  issues: Array<{ path: ReadonlyArray<PropertyKey>; message: string }>
}

export function isZodError(err: unknown): err is ZodErrorLike {
  // By shape, not instanceof: the app's zod may be a different copy (or major) from ours.
  return (
    err instanceof Error && err.name === "ZodError" && Array.isArray((err as ZodErrorLike).issues)
  )
}

type HttpExceptionLike = Error & {
  status: number
  code?: unknown
  details?: ToolErrorInfo["details"]
}

/**
 * Hono's HTTPException, or signet's ApiException (a subclass), by shape: this
 * module must load without hono, and shape also matches a second copy of it.
 */
export function isHttpException(err: unknown): err is HttpExceptionLike {
  if (!(err instanceof Error)) return false
  const e = err as Error & { status?: unknown; getResponse?: unknown }
  return (
    typeof e.status === "number" &&
    (e.name === "HTTPException" || typeof e.getResponse === "function")
  )
}

function flatten(err: ZodErrorLike): NonNullable<ToolErrorInfo["details"]> {
  const formErrors: string[] = []
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of err.issues) {
    if (issue.path.length === 0) formErrors.push(issue.message)
    else {
      const key = String(issue.path[0])
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message]
    }
  }
  return { formErrors, fieldErrors }
}

/**
 * The error mapping `createMcpServer` uses. Deliberate errors keep their code
 * and message; anything else is undefined, meaning "Internal error".
 */
export function describeToolError(err: unknown): ToolErrorInfo | undefined {
  if (isHttpException(err)) {
    // ApiException carries a code and details; a plain HTTPException has neither.
    return {
      code:
        (typeof err.code === "string" ? err.code : undefined) ??
        STATUS_CODES[err.status] ??
        "HTTP_ERROR",
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    }
  }
  if (isZodError(err)) {
    return { code: "VALIDATION_FAILED", message: "Validation failed", details: flatten(err) }
  }
  return undefined
}

/** An MCP error result: `isError`, a text block, and the envelope as structured content. */
export function toolErrorResult(info: ToolErrorInfo): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `${info.code}: ${info.message}` }],
    structuredContent: {
      success: false,
      error: info.message,
      code: info.code,
      ...(info.details ? { details: info.details } : {}),
    },
  }
}

export const INTERNAL_ERROR: ToolErrorInfo = { code: "INTERNAL_ERROR", message: "Internal error" }

/** Pass an unexpected error to `onError`, keeping a Worker alive for its promise. */
export function report(
  opts: ToolErrorOptions,
  err: unknown,
  meta: ErrorMeta,
  c: Context | undefined,
): void {
  let pending: unknown
  try {
    pending = opts.onError?.(err, meta)
  } catch {
    return // a broken reporter must not turn one error into two
  }
  if (!(pending instanceof Promise)) return
  const settled = pending.catch(() => {})
  // Hono's executionCtx getter throws outside Workers, where the process
  // outlives the response and the promise completes on its own.
  try {
    c?.executionCtx.waitUntil(settled)
  } catch {}
}
