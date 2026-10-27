/**
 * Zod request validation. Requires `hono` and `zod` as optional peers.
 *
 * Improves on app-a's version, which did `JSON.stringify(error.flatten())` into
 * the message field — the client then had to JSON.parse an error string to show
 * field errors. Here the structure goes in `details`, where the envelope
 * already has a place for it.
 */

import type { Context } from "hono"
import type { z } from "zod"
import { ApiException } from "./errors.js"

function fail(result: { error: z.ZodError }): never {
  const flat = result.error.flatten()
  throw new ApiException(400, "Validation failed", "VALIDATION_FAILED", {
    formErrors: flat.formErrors,
    fieldErrors: flat.fieldErrors as Record<string, string[]>,
  })
}

export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new ApiException(400, "Invalid JSON body", "INVALID_JSON")
  }
  const result = schema.safeParse(body)
  if (!result.success) fail(result)
  return result.data
}

export function parseQuery<T>(c: Context, schema: z.ZodType<T>): T {
  const result = schema.safeParse(c.req.query())
  if (!result.success) fail(result)
  return result.data
}

export function parseParams<T>(c: Context, schema: z.ZodType<T>): T {
  const result = schema.safeParse(c.req.param())
  if (!result.success) fail(result)
  return result.data
}
