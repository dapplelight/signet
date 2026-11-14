/**
 * Zod request validation. Requires `hono` and `zod` as optional peers.
 *
 * Improves on app-a's version, which did `JSON.stringify(error.flatten())` into
 * the message field — the client then had to JSON.parse an error string to show
 * field errors. Here the structure goes in `details`, where the envelope
 * already has a place for it.
 */

import type { Context, MiddlewareHandler, ValidationTargets } from "hono"
import { type InferInput, validator } from "hono/validator"
import type { z } from "zod"
import { ApiException } from "./errors.js"

// Built from `issues` rather than the deprecated `error.flatten()` (Zod 4).
function fail(result: { error: z.ZodError }): never {
  const formErrors: string[] = []
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of result.error.issues) {
    if (issue.path.length === 0) formErrors.push(issue.message)
    else {
      // Full dotted path (`address.city`, `guests.2.name`); one segment stays flat.
      const k = issue.path.map(String).join(".")
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

/**
 * A key given once is a string; a repeated key (`?tag=a&tag=b`) is an array.
 * So a one-item array (`qs({ tag: ["a"] })` is `?tag=a`) arrives as a string:
 * an array-typed field needs `z.preprocess` to wrap a lone string, or it fails
 * with 400 VALIDATION_FAILED.
 */
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

/** What the client sends: the schema's input for JSON, strings for query/param/header/cookie/form. */
type ClientInput<T extends keyof ValidationTargets, S extends z.ZodType> = T extends "json"
  ? z.input<S>
  : InferInput<z.input<S>, T>

/**
 * Hono validator middleware on a Zod schema. Same call shape as
 * `@hono/zod-validator`, without the dependency, and failures are Signet's
 * 400 `VALIDATION_FAILED` envelope (the same `details` as `parseBody`).
 *
 * Unlike `parseBody`, Hono sees the types: `c.req.valid("json")` is the parsed
 * value, and `hc<typeof app>` types the request from the schema's input.
 *
 *   app.post("/notes", zValidator("json", NoteInput), (c) => c.json(save(c.req.valid("json"))))
 *
 * A JSON body needs a JSON `Content-Type`; Hono answers 400 without one.
 * Query values arrive as strings (a repeated key as an array): coerce them
 * (`z.coerce.number()`).
 */
export function zValidator<T extends keyof ValidationTargets, S extends z.ZodType>(
  target: T,
  schema: S,
): MiddlewareHandler<
  // biome-ignore lint/suspicious/noExplicitAny: any Env, like Hono's own validator
  any,
  string,
  { in: { [K in T]: ClientInput<K, S> }; out: { [K in T]: z.output<S> } }
> {
  return validator(target, async (value) => {
    const result = await schema.safeParseAsync(value)
    if (!result.success) fail(result)
    return result.data
  }) as never
}
