"use client"
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@dapplelight/signet-ui/components/field"
import { useState } from "react"

export function FieldDemo() {
  return (
    <Field className="w-full max-w-sm">
      <FieldLabel>Billing email</FieldLabel>
      <FieldControl type="email" placeholder="billing@acme.com" />
      <FieldDescription>Receipts are sent here.</FieldDescription>
    </Field>
  )
}

export function FieldErrorDemo() {
  const [email, setEmail] = useState("billing@acme")
  return (
    <Field
      className="w-full max-w-sm"
      errors={email.includes(".") ? [] : [{ message: "Enter a full email address" }]}
    >
      <FieldLabel>Billing email</FieldLabel>
      <FieldControl type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <FieldDescription>Receipts are sent here.</FieldDescription>
      <FieldError />
    </Field>
  )
}

export function FieldRequiredDemo() {
  return (
    <Field className="w-full max-w-sm">
      <FieldLabel>Company name</FieldLabel>
      <FieldControl required placeholder="Acme Finance" />
      <FieldError match="valueMissing">Company name is required.</FieldError>
    </Field>
  )
}

export function FieldDisabledDemo() {
  return (
    <Field className="w-full max-w-sm" disabled>
      <FieldLabel>Workspace ID</FieldLabel>
      <FieldControl defaultValue="ws_4f9a2c" />
      <FieldDescription>Set when the workspace was created.</FieldDescription>
    </Field>
  )
}
