/**
 * The wire contract shared by client and server. Types only — no runtime.
 *
 * Errors are enveloped, successful responses are not. That asymmetry is
 * deliberate: it matches what app-a already serves, so routes do not have to be
 * rewritten to adopt this, and it keeps success payloads directly usable
 * without unwrapping at every call site.
 */

export type ErrorEnvelope = {
  success: false
  /** Human-readable. Safe to show a user. Never contains internals in production. */
  error: string
  /** Stable machine-readable code for branching, e.g. "EMAIL_NOT_ALLOWED". */
  code?: string
  /** Field-level validation detail, shaped like Zod's `flatten()`. */
  details?: { formErrors: string[]; fieldErrors: Record<string, string[]> }
  /** Correlates the error with the server's logs. Show it in a bug report. */
  requestId?: string
}

export function isErrorEnvelope(v: unknown): v is ErrorEnvelope {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { success?: unknown }).success === false &&
    typeof (v as { error?: unknown }).error === "string"
  )
}
