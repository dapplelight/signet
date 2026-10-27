/**
 * TanStack Form integration.
 *
 * Deliberately small. TanStack Form already handles state, validation and
 * subscriptions; this supplies only the parts every product would otherwise
 * rewrite:
 *
 *   1. Normalising errors for display. A field's `errors` array mixes raw
 *      Standard Schema issue objects (from zod) with plain strings (from
 *      anything injected), so rendering it directly prints "[object Object]".
 *   2. Pushing server validation errors back onto the right fields, closing
 *      the loop with the `ApiError.details.fieldErrors` envelope that
 *      @dapplelight/signet-server/http already produces.
 */

import { ApiError } from "../api/errors.js"

/** Anything a validator or an injection can put in a field's error array. */
export type FieldError =
  | string
  | { message?: string; path?: Array<string | number> }
  | null
  | undefined

/**
 * Human-readable messages from a field's `errors` array.
 *
 * Handles both shapes, drops empties and de-duplicates — a field failing the
 * same rule on change and on blur otherwise shows the message twice.
 */
export function errorMessages(errors: readonly FieldError[] | undefined): string[] {
  if (!errors?.length) return []
  const out: string[] = []
  for (const e of errors) {
    if (!e) continue
    const msg = typeof e === "string" ? e : e.message
    if (msg && !out.includes(msg)) out.push(msg)
  }
  return out
}

/** First message, or undefined. What a field component usually renders. */
export function firstError(errors: readonly FieldError[] | undefined): string | undefined {
  return errorMessages(errors)[0]
}

export type FieldMeta = {
  errorMap?: Record<string, unknown>
  isTouched?: boolean
  [key: string]: unknown
}

/** The minimum of TanStack's FormApi this module needs. Keeps it testable. */
export type ServerErrorTarget = {
  setFieldMeta(field: never, updater: (meta: FieldMeta | undefined) => unknown): void
}

/**
 * TanStack passes `undefined` for a field that has not been registered yet —
 * a conditionally-rendered field, or a name only the server knows about.
 * Without this the updater throws and NO errors reach the user, not even the
 * ones for fields that do exist.
 */
const withMeta = (meta: FieldMeta | undefined): FieldMeta =>
  meta ?? { errorMap: {}, isTouched: false }

export type ServerErrorOptions = {
  /**
   * errorMap key for server errors. Kept separate from validator keys
   * (onChange, onBlur) so re-validating clears it naturally rather than
   * leaving a stale "email taken" on a field the user has since fixed.
   */
  key?: string
  /** Where non-field errors go. Default: returned, not assigned. */
  onFormError?: (messages: string[]) => void
}

/**
 * Apply `{ fieldErrors, formErrors }` from a 422 onto the form.
 *
 * Returns form-level messages that belong to no field, so the caller can show
 * them near the submit button. Safe to call with any error: a non-validation
 * failure returns its message as a form-level error rather than throwing.
 */
export function applyServerErrors(
  form: ServerErrorTarget,
  error: unknown,
  options: ServerErrorOptions = {},
): string[] {
  const key = options.key ?? "onServer"

  if (!(error instanceof ApiError)) {
    const messages = [error instanceof Error ? error.message : String(error)]
    options.onFormError?.(messages)
    return messages
  }

  const details = error.details
  if (!details) {
    const messages = [error.message]
    options.onFormError?.(messages)
    return messages
  }

  for (const [field, messages] of Object.entries(details.fieldErrors ?? {})) {
    if (!messages?.length) continue
    form.setFieldMeta(field as never, (raw) => {
      const meta = withMeta(raw)
      return {
        ...meta,
        isTouched: true, // otherwise the field hides its error until touched
        errorMap: { ...meta.errorMap, [key]: messages[0] },
      }
    })
  }

  const formErrors = details.formErrors?.length ? details.formErrors : []
  if (formErrors.length) options.onFormError?.(formErrors)
  return formErrors
}

/** Clear previously applied server errors. Call before re-submitting. */
export function clearServerErrors(
  form: ServerErrorTarget,
  fields: readonly string[],
  key = "onServer",
): void {
  for (const field of fields) {
    form.setFieldMeta(field as never, (raw) => {
      const meta = withMeta(raw)
      const next = { ...meta.errorMap }
      delete next[key]
      return { ...meta, errorMap: next }
    })
  }
}

/**
 * Wrap a submit handler so server validation errors land on fields
 * automatically.
 *
 *   onSubmit: submitWithServerErrors(
 *     () => form,
 *     ({ value }) => api.post("/signup", value),
 *     { onFormError: setBanner },
 *   )
 *
 * Rethrows anything that is not an ApiError — a network failure is not a
 * validation result and should not be silently absorbed into the form.
 */
export function submitWithServerErrors<TValue, TResult>(
  getForm: () => ServerErrorTarget,
  submit: (args: { value: TValue }) => Promise<TResult>,
  options: ServerErrorOptions = {},
): (args: { value: TValue }) => Promise<TResult | undefined> {
  return async (args) => {
    try {
      return await submit(args)
    } catch (err) {
      if (err instanceof ApiError) {
        applyServerErrors(getForm(), err, options)
        return undefined
      }
      throw err
    }
  }
}
