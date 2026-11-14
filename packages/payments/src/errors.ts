/**
 * One error type for every gateway: branch on `e.code`, never on a gateway's
 * own message. `retryable` is true only for outages (network, 5xx, 429), which
 * is also the only case `createPayments` falls back to another gateway on.
 */

export type PaymentsErrorCode =
  /** The gateway cannot do this (see its `capabilities`). Thrown before any network call. */
  | "UNSUPPORTED"
  | "BAD_INPUT"
  /** The gateway refused the charge or refund (402, a card decline). Never retried, never failed over. */
  | "DECLINED"
  /** A 4xx from the gateway other than a decline. */
  | "GATEWAY_ERROR"
  | "NOT_FOUND"
  /** Network failure, timeout, 429 or 5xx after retries. Safe to fail over. */
  | "GATEWAY_UNAVAILABLE"
  | "BAD_SIGNATURE"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "UNBALANCED"
  | "CURRENCY_MISMATCH"
  | "NO_GATEWAY"

export class PaymentsError extends Error {
  readonly code: PaymentsErrorCode
  readonly gateway?: string
  readonly status?: number
  /** The gateway's parsed error body, when there was one. */
  readonly raw?: unknown
  constructor(
    code: PaymentsErrorCode,
    message: string,
    extra: { gateway?: string; status?: number; raw?: unknown } = {},
  ) {
    super(message)
    this.name = "PaymentsError"
    this.code = code
    this.gateway = extra.gateway
    this.status = extra.status
    this.raw = extra.raw
  }
  get retryable(): boolean {
    return this.code === "GATEWAY_UNAVAILABLE"
  }
}

export const isPaymentsError = (e: unknown, code?: PaymentsErrorCode): e is PaymentsError =>
  e instanceof PaymentsError && (code === undefined || e.code === code)
