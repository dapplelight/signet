/**
 * Every error signet-db throws is a `SignetDbError` with a stable `code` to
 * branch on and a message that says what was wrong and how to fix it.
 */

export type SignetDbErrorCode =
  | "NO_CIPHER"
  | "BAD_CIPHER_CONFIG"
  | "NOT_CIPHERTEXT"
  | "PLAINTEXT_WRITE"
  | "UNKNOWN_KEY"
  | "NO_AUDIT_TABLE"
  | "NO_ACTOR"
  | "NO_USER_ID"
  | "NO_OWNER_COLUMN"
  | "CROSS_USER_WRITE"
  | "UNSCOPED_WRITE"
  | "BAD_VALUE"
  | "CURRENCY_MISMATCH"
  | "BAD_MONEY"
  | "BAD_ID"
  | "NO_OUTBOX_TABLE"
  | "NO_IDEMPOTENCY_TABLE"
  | "IDEMPOTENCY_IN_FLIGHT"
  | "BAD_INPUT"
  | "NOT_FOUND"

export class SignetDbError extends Error {
  readonly code: SignetDbErrorCode
  constructor(code: SignetDbErrorCode, message: string) {
    super(message)
    this.name = "SignetDbError"
    this.code = code
  }
}

/** Whether `e` is a SignetDbError, optionally with a given code. */
export function isSignetDbError(e: unknown, code?: SignetDbErrorCode): e is SignetDbError {
  return e instanceof SignetDbError && (code === undefined || e.code === code)
}
