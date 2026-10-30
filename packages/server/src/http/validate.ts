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

// Built from `issues` rather than the deprecated `error.flatten()` (Zod 4).
function fail(result: { error: z.ZodError }): never {
  const formErrors: string[] = []
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0]
    if (key === undefined) formErrors.push(issue.message)
    else {
      const k = String(key)
      fieldErrors[k] = [...(fieldErrors[k] ?? []), issue.message]
    }
  }
  throw new ApiException(400, "Validation failed", "VALIDATION_FAILED", { formErrors, fieldErrors })
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

/** A key given once is a string; a repeated key (`?tag=a&tag=b`) is an array. */
export function parseQuery<T>(c: Context, schema: z.ZodType<T>): T {
  const query = Object.fromEntries(
    Object.entries(c.req.queries()).map(([k, v]) => [k, v.length === 1 ? v[0] : v]),
  )
  const result = schema.safeParse(query)
  if (!result.success) fail(result)
  return result.data
}

export function parseParams<T>(c: Context, schema: z.ZodType<T>): T {
  const result = schema.safeParse(c.req.param())
  if (!result.success) fail(result)
  return result.data
}
