"use client"

/**
 * A form drawn from a schema, on AutoForm (`@autoform/react`, TanStack Form
 * adapter) with Signet's own controls. Optional peers: `@autoform/react`,
 * `@autoform/zod`, `@tanstack/react-form`, `zod`.
 *
 *   const Expense = z.object({
 *     amount: z.number().positive(),
 *     note: z.string().max(500).optional(),
 *     kind: z.enum(["food", "travel"]),
 *   })
 *   <SchemaForm schema={Expense} onSubmit={save} />
 *
 * Customise a field in the schema with AutoForm's `fieldConfig`
 * (`.check(fieldConfig({ label, description, inputProps, fieldType: "textarea", order }))`),
 * or replace a control type for the whole form with `formComponents`.
 * Server validation errors (signet-server's 422 envelope) go back onto fields with
 * `@dapplelight/signet-lib/form`:
 *
 *   <SchemaForm schema={Expense} onSubmit={save}
 *     onSubmitError={(error, form) => applyServerErrors(form, error)} />
 */
import type {
  AutoFormFieldProps,
  AutoFormUIComponents,
  ExtendableAutoFormProps,
  FieldWrapperProps,
  SchemaProvider,
} from "@autoform/react"
import { AutoForm, useFieldContext } from "@autoform/react/tanstack-form"
import { ZodProvider } from "@autoform/zod"
import { PlusIcon, XIcon } from "lucide-react"
import type * as React from "react"
import { useLabels } from "../../lib/labels.js"
import { cn } from "../../lib/utils.js"
import { Button } from "./button.js"
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from "./field.js"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.js"
import { Switch } from "./switch.js"
import { Textarea } from "./textarea.js"

type Renderable = React.ReactNode | (() => React.ReactNode)
const show = (r: Renderable) => (typeof r === "function" ? r() : r)

function FieldWrapper({ label, error, children, parsedField }: FieldWrapperProps) {
  const description = parsedField.fieldConfig?.description as React.ReactNode
  const inline = parsedField.type === "boolean"
  return (
    <Field
      data-slot="schema-field"
      data-type={parsedField.type}
      errors={error ? [String(show(error as Renderable))] : []}
      className={inline ? "flex-row flex-wrap items-center gap-x-3" : undefined}
    >
      {inline && children}
      <FieldLabel>
        {show(label as Renderable)}
        {parsedField.required && !inline && (
          <span aria-hidden className="text-accent-red">
            {" "}
            *
          </span>
        )}
      </FieldLabel>
      {!inline && children}
      {description != null && <FieldDescription>{description}</FieldDescription>}
      <FieldError className={inline ? "basis-full" : undefined} />
    </Field>
  )
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const l = useLabels()
  return (
    <Button type="submit" className="self-start">
      {children ?? l.submit}
    </Button>
  )
}

const ui: AutoFormUIComponents = {
  Form: ({ className, ...props }) => (
    // The schema validates; the browser's own checks (step, required) would block or duplicate it.
    <form
      data-slot="schema-form"
      noValidate
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  ),
  FieldWrapper,
  ErrorMessage: ({ error }) => (
    <p role="alert" className="text-sm text-accent-red">
      {error}
    </p>
  ),
  SubmitButton,
  ObjectWrapper: ({ label, children }) => (
    <fieldset data-slot="schema-object" className="flex flex-col gap-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">{show(label as Renderable)}</legend>
      {children}
    </fieldset>
  ),
  ArrayWrapper: function ArrayWrapper({ label, children, onAddItem }) {
    const l = useLabels()
    return (
      <fieldset data-slot="schema-array" className="flex flex-col gap-3">
        <legend className="text-sm font-medium">{show(label as Renderable)}</legend>
        {children}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={onAddItem}
        >
          <PlusIcon /> {l.addItem}
        </Button>
      </fieldset>
    )
  },
  ArrayElementWrapper: function ArrayElementWrapper({ children, onRemove }) {
    const l = useLabels()
    return (
      <div data-slot="schema-array-item" className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-3">{children}</div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={l.removeItem}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>
    )
  },
}

// Each control reads its TanStack field; Field's label and errors wire to it.
function StringField({ inputProps }: AutoFormFieldProps) {
  const field = useFieldContext<string>()
  return (
    <FieldControl
      {...inputProps}
      name={field.name}
      value={field.state.value ?? ""}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => field.handleChange(e.target.value)}
      onBlur={field.handleBlur}
    />
  )
}

function TextareaField({ inputProps }: AutoFormFieldProps) {
  const field = useFieldContext<string>()
  return (
    <FieldControl
      render={<Textarea />}
      {...inputProps}
      name={field.name}
      value={field.state.value ?? ""}
      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => field.handleChange(e.target.value)}
      onBlur={field.handleBlur}
    />
  )
}

function NumberField({ inputProps }: AutoFormFieldProps) {
  const field = useFieldContext<number | undefined>()
  return (
    <FieldControl
      type="number"
      inputMode="decimal"
      step="any"
      {...inputProps}
      name={field.name}
      value={field.state.value ?? ""}
      // Empty is "no value", not 0, so a required number says so.
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        field.handleChange(e.target.value === "" ? undefined : e.target.valueAsNumber)
      }
      onBlur={field.handleBlur}
    />
  )
}

const isoDay = (d: unknown) =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : ""

function DateField({ inputProps }: AutoFormFieldProps) {
  const field = useFieldContext<Date | undefined>()
  return (
    <FieldControl
      type="date"
      {...inputProps}
      name={field.name}
      value={isoDay(field.state.value)}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        field.handleChange(e.target.value ? new Date(`${e.target.value}T00:00:00Z`) : undefined)
      }
      onBlur={field.handleBlur}
    />
  )
}

function BooleanField({ inputProps }: AutoFormFieldProps) {
  const field = useFieldContext<boolean>()
  return (
    <FieldControl
      render={<Switch />}
      {...inputProps}
      name={field.name}
      checked={!!field.state.value}
      onCheckedChange={(checked: boolean) => field.handleChange(checked)}
      onBlur={field.handleBlur}
    />
  )
}

function SelectField({ inputProps, parsedField }: AutoFormFieldProps) {
  const field = useFieldContext<string>()
  const l = useLabels()
  const { placeholder, ...rest } = (inputProps ?? {}) as { placeholder?: string }
  const options = (parsedField.options ?? []) as [string, string][]
  return (
    <Select
      name={field.name}
      value={field.state.value ?? null}
      onValueChange={(v) => field.handleChange(v as string)}
    >
      <FieldControl render={<SelectTrigger />} {...rest} onBlur={field.handleBlur}>
        <SelectValue placeholder={placeholder ?? l.chooseOption}>
          {(v: string | null) => options.find(([key]) => key === v)?.[1] ?? v}
        </SelectValue>
      </FieldControl>
      <SelectContent>
        {options.map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const controls = {
  string: StringField,
  textarea: TextareaField,
  number: NumberField,
  date: DateField,
  boolean: BooleanField,
  select: SelectField,
}

type ZodLike = { "~standard": unknown }

export type SchemaFormProps<T extends Record<string, unknown>> = Omit<
  ExtendableAutoFormProps<T>,
  "schema" | "withSubmit"
> & {
  /** A zod object schema, or any AutoForm `SchemaProvider`. */
  schema: ZodLike | SchemaProvider<T>
  /** The submit button's text; false hides it (render your own in `children`). */
  submit?: React.ReactNode | false
  /** A rejected `onSubmit` comes here with the TanStack form, e.g. for `applyServerErrors`. */
  onSubmitError?: (error: unknown, form: unknown) => void
}

export function SchemaForm<T extends Record<string, unknown>>({
  schema,
  submit,
  onSubmit,
  onSubmitError,
  uiComponents,
  formComponents,
  children,
  ...props
}: SchemaFormProps<T>) {
  const provider = (
    "parseSchema" in (schema as object) ? schema : new ZodProvider(schema as never)
  ) as SchemaProvider<T>
  return (
    <AutoForm<T>
      {...props}
      schema={provider}
      uiComponents={{ ...ui, ...uiComponents }}
      formComponents={{ ...controls, ...formComponents }}
      onSubmit={async (values, form, e) => {
        try {
          await onSubmit?.(values, form, e)
        } catch (error) {
          if (!onSubmitError) throw error
          onSubmitError(error, form)
        }
      }}
    >
      {children}
      {submit !== false && <SubmitButton>{submit}</SubmitButton>}
    </AutoForm>
  )
}
