"use client"
import { SchemaForm } from "@dapplelight/signet-ui/components/schema-form"
import { useState } from "react"
import { z } from "zod"

const Expense = z.object({
  merchant: z.string().min(1),
  amount: z.number().positive(),
  kind: z.enum(["food", "travel", "software"]),
  date: z.date().optional(),
  reimbursable: z.boolean().default(false),
  note: z.string().max(500).optional(),
})

export function SchemaFormDemo() {
  const [saved, setSaved] = useState<string | null>(null)
  return (
    <div className="w-full max-w-sm">
      <SchemaForm
        schema={Expense}
        submit="Save expense"
        onSubmit={(values) => setSaved(JSON.stringify(values))}
      />
      {saved && <p className="mt-3 break-all text-xs text-text-muted">{saved}</p>}
    </div>
  )
}

const Invite = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]),
})

export function SchemaFormDefaultsDemo() {
  return (
    <div className="w-full max-w-sm">
      <SchemaForm
        schema={Invite}
        submit="Send invite"
        defaultValues={{ email: "dana@acme.test", role: "member" }}
        onSubmit={() => {}}
      />
    </div>
  )
}

export function SchemaFormServerErrorDemo() {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="w-full max-w-sm">
      <SchemaForm
        schema={Invite}
        submit="Send invite"
        onSubmit={async () => {
          throw new Error("That address is already a member.")
        }}
        onSubmitError={(e) => setError((e as Error).message)}
      />
      {error && (
        <p role="alert" className="mt-3 text-sm text-accent-red">
          {error}
        </p>
      )}
    </div>
  )
}
