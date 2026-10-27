/**
 * Default user-facing copy for every code in ERROR_CODES.
 *
 * Signet owns these codes, so it ships working copy for them; an app overrides
 * the ones its product needs to phrase differently and adds its own codes:
 *
 *   export const COPY = {
 *     ...DEFAULT_ERROR_COPY,
 *     RATE_LIMITED: { title: "Easy there", detail: "Search again shortly.", action: "wait" },
 *     PROVIDER_UNAVAILABLE: { ... },
 *   } satisfies Record<ErrorCode | AppErrorCode, ErrorCopy>
 *
 * A new Signet code arrives with its default; a new app code still fails the
 * build until it has copy. Wording is product-neutral on purpose — no product
 * nouns, no blame.
 */

import type { ErrorCode } from "./codes.js"

/** What the UI should offer. "wait" pairs with ApiError.retryAfter. */
export type ErrorAction = "retry" | "wait" | "edit" | "sign_in" | "go_back"

/**
 * Generic over the action, so an app can add its own: `ErrorCopy<ErrorAction |
 * "new_search">`. The spread defaults still fit, since ErrorAction is a subset.
 */
export type ErrorCopy<A extends string = ErrorAction> = { title: string; detail: string; action: A }

export const DEFAULT_ERROR_COPY: Record<ErrorCode, ErrorCopy> = {
  VALIDATION_FAILED: {
    title: "Check the highlighted fields",
    detail: "Some of what you entered needs another look.",
    action: "edit",
  },
  INVALID_JSON: {
    title: "We couldn't read that",
    detail: "The request was malformed. Try again.",
    action: "retry",
  },
  RATE_LIMITED: {
    title: "Too many requests",
    detail: "Wait a moment, then try again.",
    action: "wait",
  },
  RATE_LIMIT_UNAVAILABLE: {
    title: "Temporarily unavailable",
    detail: "Try again in a moment.",
    action: "retry",
  },
  INTERNAL_ERROR: {
    title: "Something went wrong",
    detail: "It's on our side. Try again in a moment.",
    action: "retry",
  },
  BAD_REQUEST: {
    title: "We couldn't do that",
    detail: "The request wasn't valid. Try again.",
    action: "retry",
  },
  UNAUTHORIZED: {
    title: "Sign in to continue",
    detail: "Your session has ended or you're not signed in.",
    action: "sign_in",
  },
  FORBIDDEN: {
    title: "You don't have access",
    detail: "Your account can't open this.",
    action: "go_back",
  },
  NOT_FOUND: {
    title: "Not found",
    detail: "It may have been moved or deleted.",
    action: "go_back",
  },
  METHOD_NOT_ALLOWED: {
    title: "We couldn't do that",
    detail: "That action isn't available here.",
    action: "go_back",
  },
  CONFLICT: {
    title: "Something changed",
    detail: "This was updated elsewhere. Refresh and try again.",
    action: "retry",
  },
  GONE: { title: "No longer available", detail: "This has been removed.", action: "go_back" },
  PAYLOAD_TOO_LARGE: { title: "Too large", detail: "Try something smaller.", action: "edit" },
  UNPROCESSABLE: {
    title: "We couldn't process that",
    detail: "Check what you entered and try again.",
    action: "edit",
  },
  HTTP_ERROR: { title: "Something went wrong", detail: "Try again in a moment.", action: "retry" },
  INVALID_PAYLOAD: {
    title: "We couldn't read that",
    detail: "The request was malformed. Try again.",
    action: "retry",
  },
  invalid_token: {
    title: "Sign in to continue",
    detail: "Your access has expired or isn't valid.",
    action: "sign_in",
  },
  insufficient_scope: {
    title: "More access needed",
    detail: "Grant the requested permission, then try again.",
    action: "sign_in",
  },
}

/**
 * Copy for a code from an ApiError. Unknown or missing codes get the table's
 * INTERNAL_ERROR copy, else Signet's — so the UI always has something to show,
 * and the result's action may be one of Signet's even with an app table.
 */
export function errorCopy(code: string | undefined): ErrorCopy
export function errorCopy<A extends string>(
  code: string | undefined,
  copy: { readonly [code: string]: ErrorCopy<A> },
): ErrorCopy<A | ErrorAction>
export function errorCopy(
  code: string | undefined,
  copy: { readonly [code: string]: ErrorCopy<string> } = DEFAULT_ERROR_COPY,
): ErrorCopy<string> {
  const table = copy as Record<string, ErrorCopy<string> | undefined>
  return (
    (code !== undefined && Object.hasOwn(table, code) ? table[code] : undefined) ??
    table.INTERNAL_ERROR ??
    DEFAULT_ERROR_COPY.INTERNAL_ERROR
  )
}
