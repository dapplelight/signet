// Demo page for data editing (CSV import, editable grid, rich text editor) on
// fake data. Open data-edit.html in `bun run dev`; ?theme=cinematic, ?dark=1
// and ?screen=import|grid|editor pick what to show.

import {
  DataGrid,
  type DataGridChange,
  type DataGridColumn,
} from "@dapplelight/signet-ui/components/data-grid"
import { RichTextContent, RichTextEditor } from "@dapplelight/signet-ui/components/rich-text-editor"
import { CsvImport, type CsvImportReport } from "@dapplelight/signet-ui/domain/csv-import"
import { type ReactNode, StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { applyTheme, initialTheme } from "./themes"

const params = new URLSearchParams(location.search)
if (params.has("dark"))
  document.documentElement.classList.toggle("dark", params.get("dark") === "1")
await applyTheme(initialTheme())

const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms))

type Customer = {
  id: string
  name: string
  seats: number | null
  plan: string | null
  renews: string | null
  active: boolean
}
const PLANS = [
  { value: "free", label: "Free" },
  { value: "team", label: "Team" },
  { value: "pro", label: "Pro" },
]
const COLUMNS: DataGridColumn<Customer>[] = [
  { id: "name", header: "Name", width: 200 },
  { id: "seats", header: "Seats", type: "number", width: 100 },
  { id: "plan", header: "Plan", type: "select", options: PLANS, width: 120 },
  { id: "renews", header: "Renews", type: "date", width: 150 },
  { id: "active", header: "Active", type: "checkbox", width: 90 },
]
const CUSTOMERS: Customer[] = Array.from({ length: 10_000 }, (_, i) => ({
  id: `c${i + 1}`,
  name: `Customer ${i + 1}`,
  seats: (i * 7) % 60,
  plan: PLANS[i % 3]?.value ?? null,
  renews: `2027-${String((i % 12) + 1).padStart(2, "0")}-15`,
  active: i % 4 !== 0,
}))

function Grid() {
  const [rows, setRows] = useState(CUSTOMERS)
  return (
    <div className="flex w-full max-w-3xl flex-col gap-2">
      <p className="m-0 text-sm text-text-muted">
        10,000 rows. Names containing "fail" are refused by the fake server.
      </p>
      <DataGrid
        aria-label="Customers"
        columns={COLUMNS}
        rows={rows}
        getRowId={(r) => r.id}
        selectable
        onChange={async (changes: DataGridChange<Customer>[]) => {
          await wait()
          if (changes.some((c) => String(c.value).toLowerCase().includes("fail")))
            throw new Error("The server refused this name.")
          setRows((all) =>
            all.map((r) => {
              const mine = changes.filter((c) => c.rowId === r.id)
              return mine.length
                ? { ...r, ...Object.fromEntries(mine.map((c) => [c.columnId, c.value])) }
                : r
            }),
          )
          return undefined
        }}
      />
    </div>
  )
}

function Import() {
  return (
    <CsvImport
      className="w-full max-w-2xl"
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "email", label: "Email", aliases: ["E-mail"] },
        { key: "seats", label: "Seats" },
      ]}
      schema={{
        safeParse: (v: unknown) => {
          const r = v as Record<string, string>
          const issues = [
            ...(r.email && !/^[^@\s]+@[^@\s]+$/.test(r.email)
              ? [{ path: ["email"], message: "Not an email address" }]
              : []),
            ...(r.seats && !/^\d+$/.test(r.seats)
              ? [{ path: ["seats"], message: "A whole number" }]
              : []),
          ]
          return issues.length
            ? { success: false as const, error: { issues } }
            : { success: true as const, data: r }
        },
      }}
      onImport={async (rows): Promise<CsvImportReport> => {
        await wait()
        return { inserted: rows.length, skipped: 0 }
      }}
    />
  )
}

function Editor() {
  const [body, setBody] = useState(
    "## Launch notes\n\n**Copy** is final. @[Asha Rao](user:u1), check the `hero` image.\n\n- Pricing page\n- Docs [link](https://example.com)",
  )
  const people = [
    { id: "u1", name: "Asha Rao", email: "asha@example.com" },
    { id: "u2", name: "Dev Patel", email: "dev@example.com" },
  ]
  return (
    <div className="grid w-full max-w-3xl gap-4 md:grid-cols-2">
      <RichTextEditor
        aria-label="Notes"
        value={body}
        onValueChange={setBody}
        placeholder="Write something. Type @ to mention someone."
        onMentionSearch={(q) =>
          people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
        }
      />
      <div className="flex flex-col gap-2">
        <RichTextContent value={body} className="rounded-lg bg-bg-elevated p-3" />
        <pre className="m-0 overflow-auto rounded-lg bg-bg-elevated p-3 text-xs">{body}</pre>
      </div>
    </div>
  )
}

const SCREENS: Record<string, () => ReactNode> = {
  import: () => <Import />,
  grid: () => <Grid />,
  editor: () => <Editor />,
}

function Page() {
  const only = params.get("screen")
  const names = only && SCREENS[only] ? [only] : Object.keys(SCREENS)
  return (
    <main className="flex min-h-dvh flex-col items-center gap-10 bg-background p-8 text-foreground">
      <h1 className="sr-only">Signet: data editing</h1>
      <a href="./" className="self-start text-sm text-text-secondary underline">
        Showcase
      </a>
      {names.map((n) => (
        <div key={n} data-screen={n} className="flex w-full justify-center">
          {SCREENS[n]?.()}
        </div>
      ))}
    </main>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element #root not found")
createRoot(root).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
