/**
 * Every `code` the Signet server kit puts in an error envelope.
 *
 * Exported so an app's user-facing copy can be typed exhaustively instead of
 * scanned for by a test:
 *
 *   const copy = { ...appCopy, RATE_LIMITED: "Slow down a little." } satisfies
 *     Record<ErrorCode | AppErrorCode, string>
 *
 * UPPER_SNAKE, except the two RFC 6750 codes, whose spelling the OAuth spec
 * fixes. The server test fails if the server emits a code missing here.
 */
export const ERROR_CODES = [
  // parseBody / parseQuery / parseParams
  "VALIDATION_FAILED",
  "INVALID_JSON",
  // rateLimit
  "RATE_LIMITED",
  "RATE_LIMIT_UNAVAILABLE",
  // errorHandler: an unhandled error
  "INTERNAL_ERROR",
  // errorHandler: an HTTPException thrown without a code, by status
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "CONFLICT",
  "GONE",
  "PAYLOAD_TOO_LARGE",
  "UNPROCESSABLE",
  "HTTP_ERROR",
  // analytics ingest
  "INVALID_PAYLOAD",
  // MCP tools: a timed-out call, requireApproval
  "TIMEOUT",
  "APPROVAL_REQUIRED",
  "APPROVAL_DECLINED",
  // jobs: a run that stopped for good
  "BAD_INPUT",
  "JOB_FAILED",
  "UNKNOWN_JOB",
  "CANCELLED",
  "BUDGET_EXCEEDED",
  // jobs: set-up mistakes, thrown at start-up rather than shown to a person
  "JOBS_NOT_CREATED",
  "DUPLICATE_JOB",
  "NO_BUDGET_STORE",
  // storage: uploads
  "TOO_LARGE",
  "EMPTY",
  "TYPE_NOT_ALLOWED",
  "TYPE_MISMATCH",
  "BAD_KEY",
  "QUOTA_EXCEEDED",
  "PRESIGN_UNSUPPORTED",
  "RESUMABLE_UNSUPPORTED",
  // oauth-rs (RFC 6750)
  "invalid_token",
  "insufficient_scope",
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === "string" && (ERROR_CODES as readonly string[]).includes(v)
}
