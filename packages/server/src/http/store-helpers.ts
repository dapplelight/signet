/**
 * Internal helpers for the routes over signet-db stores (experiments,
 * status), typed by shape so this package does not depend on signet-db.
 * Not an export path.
 */

import type { Context, MiddlewareHandler } from "hono"
import { type ApiErrorStatus, ApiException } from "./errors.js"

export type Actor = { type: "user" | "agent" | "system"; id: string }

const STATUS: Record<string, ApiErrorStatus> = {
  BAD_VALUE: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
}

/** `app.onError`: signet-db errors (by shape) become the envelope; anything else goes on. */
export const storeError = (e: Error) => {
  const code = (e as { code?: unknown }).code
  if (e.name === "SignetDbError" && typeof code === "string" && STATUS[code])
    throw new ApiException(
      STATUS[code] as ApiErrorStatus,
      e.message,
      code === "BAD_VALUE" ? "VALIDATION_FAILED" : code,
    )
  throw e
}

/** The JSON object body, or 400 INVALID_JSON. */
export const jsonBody = async (c: Context): Promise<Record<string, unknown>> => {
  try {
    const v = await c.req.json()
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    throw new ApiException(400, "Invalid JSON body", "INVALID_JSON")
  }
}

/** Deny by default: anything but `true` from `authorize` is 403. */
export const adminGate =
  (authorize: (c: Context) => unknown): MiddlewareHandler =>
  async (c, next) => {
    if ((await authorize(c)) !== true)
      throw new ApiException(403, "You do not have permission to do that.", "FORBIDDEN")
    await next()
  }
