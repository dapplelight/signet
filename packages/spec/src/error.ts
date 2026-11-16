import { z } from "zod"

/** The version of the files under `schemas/` and `/spec/<version>/`. */
export const SPEC_VERSION = "v1"

/**
 * The error envelope every Signet server answers a failed request with. Zod is
 * the source of truth; `schemas/error-envelope.schema.json` is generated from it.
 */
export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.string().describe("A message safe to show."),
  code: z.string().optional().describe("Stable machine code, e.g. VALIDATION_FAILED."),
  details: z
    .object({
      formErrors: z.array(z.string()),
      fieldErrors: z.record(z.string(), z.array(z.string())),
    })
    .optional(),
  requestId: z.string().optional(),
})

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>

/**
 * Every error code and the HTTP status it is sent with, in the order of
 * `ERROR_CODES` in `@dapplelight/signet-lib/api`. A test fails if the two lists
 * differ. The codes the server maps from a bare status (`STATUS_CODES`) keep
 * that status. The others take the status of the place that raises them; codes
 * that are thrown at start-up rather than sent to a client are 500.
 * UPPER_SNAKE, except the two RFC 6750 codes, whose spelling that RFC fixes.
 */
export const ERROR_CODE_STATUS = {
  // parseBody / parseQuery / parseParams
  VALIDATION_FAILED: 400,
  INVALID_JSON: 400,
  // rateLimit
  RATE_LIMITED: 429,
  RATE_LIMIT_UNAVAILABLE: 503,
  // maintenanceMode
  MAINTENANCE: 503,
  // errorHandler: an unhandled error
  INTERNAL_ERROR: 500,
  // errorHandler: an HTTPException thrown without a code, by status
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  GONE: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE: 422,
  HTTP_ERROR: 500,
  // analytics ingest
  INVALID_PAYLOAD: 400,
  // MCP tools: a timed-out call, requireApproval
  TIMEOUT: 408,
  APPROVAL_REQUIRED: 403,
  APPROVAL_DECLINED: 403,
  APPROVAL_PENDING: 409,
  // jobs: a run that stopped for good
  BAD_INPUT: 400,
  JOB_FAILED: 500,
  UNKNOWN_JOB: 404,
  CANCELLED: 409,
  BUDGET_EXCEEDED: 429,
  // jobs: set-up mistakes, thrown at start-up rather than shown to a person
  JOBS_NOT_CREATED: 500,
  DUPLICATE_JOB: 500,
  NO_BUDGET_STORE: 500,
  // storage: uploads
  TOO_LARGE: 413,
  EMPTY: 400,
  TYPE_NOT_ALLOWED: 415,
  TYPE_MISMATCH: 415,
  BAD_KEY: 400,
  QUOTA_EXCEEDED: 413,
  PRESIGN_UNSUPPORTED: 501,
  RESUMABLE_UNSUPPORTED: 501,
  // auth: phone one-time codes
  INVALID_PHONE: 400,
  INVALID_CODE: 400,
  CODE_EXPIRED: 400,
  TOO_MANY_ATTEMPTS: 429,
  // abuse: bot checks, disposable email, AI spend caps
  CAPTCHA_REQUIRED: 400,
  CAPTCHA_FAILED: 403,
  CAPTCHA_UNAVAILABLE: 503,
  DISPOSABLE_EMAIL: 400,
  AI_SPEND_CAP_EXCEEDED: 429,
  AI_SPEND_UNAVAILABLE: 503,
  // monetisation: an offer claim refused (the reason is in details)
  OFFER_REFUSED: 409,
  // funnels: redemption links
  BAD_TOKEN: 400,
  REDEEM_REFUSED: 409,
  // oauth-rs (RFC 6750)
  invalid_token: 401,
  insufficient_scope: 403,
} as const

export type ErrorCode = keyof typeof ERROR_CODE_STATUS

/** Every error code, in the order of `ERROR_CODE_STATUS`. */
export const ERROR_CODES = Object.keys(ERROR_CODE_STATUS) as ErrorCode[]

/** The error-code table as `z.enum` of its codes. */
export const errorCodeSchema = z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]])
