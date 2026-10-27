import { ApiError } from "@dapplelight/signet-lib/api"

/**
 * Errors surface through the same envelope as the rest of the kit, so a product
 * handles an AI failure exactly like any other API failure.
 */
export class AiError extends ApiError {
  constructor(
    message: string,
    code: string,
    status = 502,
    readonly cause?: unknown,
  ) {
    super(message, status, code)
  }
}

export const BUDGET_EXCEEDED = "AI_BUDGET_EXCEEDED"
export const ALL_PROVIDERS_FAILED = "AI_ALL_PROVIDERS_FAILED"
export const SCHEMA_INVALID = "AI_SCHEMA_INVALID"
export const NO_PROVIDERS = "AI_NO_PROVIDERS"

/**
 * Only transient failures are retried.
 *
 * A schema violation or a bad key will fail identically on every attempt, so
 * retrying it burns budget and latency for a guaranteed failure. Workers AI
 * signals an exhausted free allocation as 3036, delivered as a 429 — that is
 * transient in the sense that another PROVIDER should be tried, which the
 * failover chain handles.
 */
export function isTransient(err: unknown): boolean {
  if (err instanceof AiError && err.code === SCHEMA_INVALID) return false
  const e = err as { name?: string; status?: number; statusCode?: number; message?: string }
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return true
  const status = e?.status ?? e?.statusCode
  if (typeof status === "number") return status === 408 || status === 429 || status >= 500
  const msg = String(e?.message ?? "").toLowerCase()
  if (/\b(3036|rate.?limit|timeout|timed out|econnreset|etimedout|fetch failed)\b/.test(msg)) {
    return true
  }
  // Unknown shape: treat as permanent. Retrying an unclassified error is how a
  // budget cap gets spent on something that was never going to succeed.
  return false
}
