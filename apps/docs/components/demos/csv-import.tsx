"use client"
import { type CsvField, CsvImport } from "@dapplelight/signet-ui/domain/csv-import"
import { useState } from "react"

const fields: CsvField[] = [
  { key: "name", label: "Customer", aliases: ["Full name"], required: true },
  { key: "email", label: "Email", aliases: ["E-mail", "Email address"], required: true },
  { key: "plan", label: "Plan" },
]

const sample = `Full name,E-mail,Plan
Asha Verma,asha@acme.example,Pro
Rohan Iyer,rohan@acme.example,Starter
Meera Nair,not-an-email,Pro
Dev Patel,dev@acme.example,Team`

const schema = {
  safeParse(value: unknown) {
    const v = value as Record<string, string>
    if (v.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) {
      return { success: true as const, data: v }
    }
    return {
      success: false as const,
      error: { issues: [{ path: ["email"], message: "Not a valid email" }] },
    }
  },
}

export function CsvImportDemo() {
  const [, setImported] = useState(0)
  return (
    <div className="w-full max-w-2xl">
      <CsvImport
        fields={fields}
        schema={schema}
        onImport={async (rows) => {
          setImported(rows.length)
          await new Promise((r) => setTimeout(r, 600))
          return { inserted: rows.length }
        }}
      />
    </div>
  )
}

export function CsvImportServerErrorsDemo() {
  return (
    <div className="w-full max-w-2xl">
      <CsvImport
        fields={fields}
        onImport={async (rows) => {
          await new Promise((r) => setTimeout(r, 600))
          return {
            inserted: rows.length - 1,
            errors: [{ row: 0, field: "email", message: "Already registered" }],
          }
        }}
      />
      <p className="mt-3 text-xs text-neutral-500">Paste this to try it:</p>
      <pre className="mt-1 rounded-md bg-neutral-100 p-2 text-xs dark:bg-neutral-900">{sample}</pre>
    </div>
  )
}

export function CsvImportLabelsDemo() {
  return (
    <div className="w-full max-w-2xl">
      <CsvImport
        fields={fields}
        onImport={() => undefined}
        labels={{
          title: "Import customers",
          paste: "Or paste rows from your spreadsheet",
          next: "Next",
          import: (n) => `Add ${n} customers`,
        }}
      />
    </div>
  )
}
