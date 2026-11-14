"use client"

// A form field on UI SDK's field behaviour: the label names the control, the
// description and error describe it, and aria-invalid follows the error.
// `errors` takes a TanStack Form field's `state.meta.errors` as they are, the
// same shape `@dapplelight/signet-lib/form`'s `errorMessages` reads.
import {
  FieldControl as FieldControlPrimitive,
  FieldDescription as FieldDescriptionPrimitive,
  FieldError as FieldErrorPrimitive,
  FieldLabel as FieldLabelPrimitive,
  Field as FieldPrimitive,
} from "@ui-sdk/react/field"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Input } from "./input.js"

/** Strings and `{ message }` issues, in any mix; empties are skipped. */
type FieldErrors = readonly (string | { message?: string } | null | undefined)[]

const messagesOf = (errors: FieldErrors | undefined): string[] => {
  const out: string[] = []
  for (const e of errors ?? []) {
    const m = typeof e === "string" ? e : e?.message
    if (m && !out.includes(m)) out.push(m)
  }
  return out
}

const FieldMessages = React.createContext<string[]>([])

type FieldProps = React.ComponentProps<typeof FieldPrimitive> & {
  /** Validation errors to show. Any message marks the field invalid. */
  errors?: FieldErrors
}

function Field({ className, errors, invalid, ...props }: FieldProps) {
  const messages = messagesOf(errors)
  return (
    <FieldMessages.Provider value={messages}>
      <FieldPrimitive
        invalid={invalid ?? (messages.length > 0 ? true : undefined)}
        className={cn("group/field flex flex-col gap-2 data-disabled:opacity-50", className)}
        {...props}
      />
    </FieldMessages.Provider>
  )
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof FieldLabelPrimitive>) {
  return (
    <FieldLabelPrimitive
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none data-disabled:cursor-not-allowed data-invalid:text-destructive",
        className,
      )}
      {...props}
    />
  )
}

/** Connects a control to the field. Renders Signet's Input unless `render` says otherwise. */
function FieldControl({ render, ...props }: React.ComponentProps<typeof FieldControlPrimitive>) {
  return <FieldControlPrimitive render={render ?? <Input />} {...props} />
}

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<typeof FieldDescriptionPrimitive>) {
  return (
    <FieldDescriptionPrimitive className={cn("text-sm text-text-muted", className)} {...props} />
  )
}

/**
 * The field's error. Without children it shows the first of the field's
 * `errors`; with children it shows them whenever the field is invalid, or
 * for one browser validity flag with `match`.
 */
function FieldError({
  className,
  children,
  match,
  ...props
}: React.ComponentProps<typeof FieldErrorPrimitive>) {
  const messages = React.useContext(FieldMessages)
  const own = children === undefined && messages.length > 0
  return (
    <FieldErrorPrimitive
      match={own ? true : match}
      className={cn("text-sm text-destructive", className)}
      {...props}
    >
      {own ? messages[0] : children}
    </FieldErrorPrimitive>
  )
}

export { Field, FieldControl, FieldDescription, FieldError, FieldLabel, type FieldProps }
