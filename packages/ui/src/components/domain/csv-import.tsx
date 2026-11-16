"use client"

// Import rows from a CSV file or pasted text: parse (RFC 4180), map columns to
// fields (auto-matched by name), validate every row with a schema (zod or
// anything with `safeParse`), review errors per cell, import the valid rows.
// The import itself is your callback: send the rows to an endpoint that calls
// signet-db's `bulkInsert`, and return its report to show server errors per row.
// Recipe: controllable-state + live-region + field-wiring
import type * as React from "react"
import { useId, useMemo, useState } from "react"
import { csvField, detectDelimiter, parseCsv, toCsv } from "../../lib/csv.js"
import { cn } from "../../lib/utils.js"
import { Button } from "../ui/button.js"
import { Textarea } from "../ui/textarea.js"

export { csvField, detectDelimiter, parseCsv, toCsv }

/** A field rows are imported into. */
export type CsvField = {
  /** The key in each imported row. */
  key: string
  /** Shown in the mapping step and the preview. Default: `key`. */
  label?: string
  /** Other header names that match this field ("E-mail", "Email address"). */
  aliases?: string[]
  /** Mapping cannot continue until this field has a column. */
  required?: boolean
}

/** The part of a zod schema the import uses; any validator with this shape works. */
export type CsvSchema<T> = {
  safeParse(value: unknown):
    | { success: true; data: T }
    | {
        success: false
        error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> }
      }
}

/** Field key -> index of the CSV column it reads, or null for none. */
export type CsvMapping = Record<string, number | null>

/** One parsed row after mapping and validation. `line` is 1-based, counting the header. */
export type CsvRowResult<T> = {
  line: number
  /** The mapped strings, empty cells left out, as given to the schema. */
  input: Record<string, string>
  data?: T
  /** Field key (or "" for the whole row) -> message. */
  errors: Record<string, string>
}

/** What an import reports back, the shape of signet-db's `bulkInsert`. `row` indexes the rows passed. */
export type CsvImportReport = {
  inserted: number
  skipped?: number
  errors?: ReadonlyArray<{ row: number; field?: string; message: string }>
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

/** Each field's best column: its key, label or an alias, compared without case, spaces or punctuation. */
export function autoMatch(headers: readonly string[], fields: readonly CsvField[]): CsvMapping {
  const used = new Set<number>()
  const mapping: CsvMapping = {}
  const keys = headers.map(norm)
  for (const f of fields) {
    const names = [f.key, f.label ?? "", ...(f.aliases ?? [])].map(norm).filter(Boolean)
    const i = keys.findIndex((k, idx) => !used.has(idx) && names.includes(k))
    mapping[f.key] = i < 0 ? null : i
    if (i >= 0) used.add(i)
  }
  return mapping
}

/** Map and validate data rows (no header). Empty cells are left out so optional fields stay optional. */
export function validateRows<T>(
  rows: readonly (readonly string[])[],
  fields: readonly CsvField[],
  mapping: CsvMapping,
  schema?: CsvSchema<T>,
): CsvRowResult<T>[] {
  return rows.map((cells, i) => {
    const input: Record<string, string> = {}
    for (const f of fields) {
      const col = mapping[f.key]
      const v = col === null || col === undefined ? "" : (cells[col] ?? "").trim()
      if (v !== "") input[f.key] = v
    }
    const line = i + 2
    if (!schema) return { line, input, data: input as T, errors: {} }
    const r = schema.safeParse(input)
    if (r.success) return { line, input, data: r.data, errors: {} }
    const errors: Record<string, string> = {}
    for (const issue of r.error.issues) {
      const key = String(issue.path[0] ?? "")
      errors[key] ??= issue.message
    }
    return { line, input, errors }
  })
}

/** Every string the import shows, in English. Spread and override for another language. */
export const DEFAULT_CSV_IMPORT_LABELS = {
  title: "Import from CSV",
  file: "Choose a CSV file",
  paste: "Or paste CSV",
  pastePlaceholder: "name,email\nAsha,asha@example.com",
  next: "Continue",
  back: "Back",
  empty: "There are no rows to import.",
  mapTitle: "Match columns to fields",
  column: "Column",
  field: "Field",
  none: "Do not import",
  required: "required",
  missing: (labels: string) => `Choose a column for ${labels}.`,
  reviewTitle: "Review",
  summary: (valid: number, invalid: number) =>
    `${valid.toLocaleString()} ready, ${invalid.toLocaleString()} with errors`,
  onlyErrors: "Show only rows with errors",
  line: "Line",
  showing: (shown: number, total: number) =>
    `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} rows`,
  import: (n: number) => `Import ${n.toLocaleString()} rows`,
  importing: "Importing…",
  failed: "The import failed. Nothing was changed by this step; try again.",
  done: (r: CsvImportReport) =>
    `Imported ${r.inserted.toLocaleString()} rows${r.skipped ? `, skipped ${r.skipped.toLocaleString()} already there` : ""}${r.errors?.length ? `, ${r.errors.length.toLocaleString()} failed` : ""}.`,
  downloadErrors: "Download rows with errors",
  again: "Import another file",
}

export type CsvImportLabels = typeof DEFAULT_CSV_IMPORT_LABELS

type Step = "source" | "map" | "review" | "done"
type Part =
  | "root"
  | "title"
  | "source"
  | "mapping"
  | "review"
  | "table"
  | "cell"
  | "error"
  | "actions"
  | "status"

export type CsvImportProps<T> = Omit<React.ComponentProps<"section">, "children"> & {
  fields: readonly CsvField[]
  /** Validates each mapped row; its output is what `onImport` gets. Without it rows are the mapped strings. */
  schema?: CsvSchema<T>
  /** Gets the valid rows. Return signet-db's `bulkInsert` report to show server errors per row. */
  onImport: (rows: T[]) => Promise<CsvImportReport | undefined> | CsvImportReport | undefined
  /** Separator; detected from the first line when left out. */
  delimiter?: string
  /** Rows shown in the review table. Default 100. */
  previewRows?: number
  /** Largest file read, in bytes. Default 10 MB. */
  maxBytes?: number
  labels?: Partial<CsvImportLabels>
  /** A class per part, merged over the defaults. */
  classNames?: Partial<Record<Part, string>>
}

/** The whole flow in one card. Parts carry `data-slot="csv-import-*"`; the root has `data-step`. */
export function CsvImport<T = Record<string, string>>({
  fields,
  schema,
  onImport,
  delimiter,
  previewRows = 100,
  maxBytes = 10 * 1024 * 1024,
  labels: labelsProp,
  classNames = {},
  className,
  ...props
}: CsvImportProps<T>) {
  const labels = useMemo(() => ({ ...DEFAULT_CSV_IMPORT_LABELS, ...labelsProp }), [labelsProp])
  const id = useId()
  const [step, setStep] = useState<Step>("source")
  const [text, setText] = useState("")
  const [table, setTable] = useState<string[][]>([])
  const [mapping, setMapping] = useState<CsvMapping>({})
  const [onlyErrors, setOnlyErrors] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [report, setReport] = useState<CsvImportReport | null>(null)
  // Server errors from the last import, by CSV line.
  const [serverErrors, setServerErrors] = useState<Record<number, Record<string, string>>>({})

  const headers = table[0] ?? []
  const results = useMemo(
    () =>
      step === "review" || step === "done"
        ? validateRows(table.slice(1), fields, mapping, schema).map((r) =>
            serverErrors[r.line]
              ? { ...r, data: undefined, errors: { ...r.errors, ...serverErrors[r.line] } }
              : r,
          )
        : [],
    [step, table, fields, mapping, schema, serverErrors],
  )
  const valid = results.filter((r) => Object.keys(r.errors).length === 0)
  const invalid = results.length - valid.length
  const missing = fields.filter(
    (f) => f.required && (mapping[f.key] === null || mapping[f.key] === undefined),
  )

  const load = (csv: string) => {
    const rows = parseCsv(csv, { delimiter: delimiter ?? detectDelimiter(csv) })
    if (rows.length < 2) {
      setMessage(labels.empty)
      return
    }
    setTable(rows)
    setMapping(autoMatch(rows[0] as string[], fields))
    setServerErrors({})
    setMessage("")
    setStep("map")
  }

  const runImport = async () => {
    setBusy(true)
    setMessage("")
    try {
      const sent = valid
      const r = (await onImport(sent.map((v) => v.data as T))) ?? { inserted: sent.length }
      const byLine: Record<number, Record<string, string>> = {}
      for (const e of r.errors ?? []) {
        const line = sent[e.row]?.line
        if (line === undefined) continue
        byLine[line] = { ...byLine[line], [e.field ?? ""]: e.message }
      }
      setServerErrors(byLine)
      setReport(r)
      setStep("done")
      setMessage(labels.done(r))
    } catch {
      setMessage(labels.failed)
    } finally {
      setBusy(false)
    }
  }

  const errorRows = results.filter((r) => Object.keys(r.errors).length > 0)
  const downloadErrors = () => {
    const keys = fields.map((f) => f.key)
    const csv = toCsv([
      [labels.line, ...fields.map((f) => f.label ?? f.key), "errors"],
      ...errorRows.map((r) => [
        r.line,
        ...keys.map((k) => r.input[k] ?? ""),
        Object.entries(r.errors)
          .map(([k, m]) => (k ? `${k}: ${m}` : m))
          .join("; "),
      ]),
    ])
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "import-errors.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const shown = (onlyErrors && invalid > 0 ? errorRows : results).slice(0, previewRows)
  const label = (f: CsvField) => f.label ?? f.key

  return (
    <section
      data-slot="csv-import"
      data-step={step}
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex flex-col gap-4 rounded-xl bg-bg-surface p-5 text-sm text-text-primary ring-1 ring-border-default",
        classNames.root,
        className,
      )}
      {...props}
    >
      <h2
        id={`${id}-title`}
        data-slot="csv-import-title"
        className={cn("m-0 text-base font-medium", classNames.title)}
      >
        {step === "map" ? labels.mapTitle : step === "source" ? labels.title : labels.reviewTitle}
      </h2>

      {step === "source" && (
        <div data-slot="csv-import-source" className={cn("flex flex-col gap-3", classNames.source)}>
          <label className="flex flex-col gap-1.5">
            <span className="text-text-secondary">{labels.file}</span>
            <input
              type="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-bg-elevated file:px-3 file:py-1.5 file:text-text-primary"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                if (file.size > maxBytes) {
                  setMessage(`${file.name}: too large`)
                  return
                }
                load(await file.text())
              }}
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-paste`} className="text-text-secondary">
              {labels.paste}
            </label>
            <Textarea
              id={`${id}-paste`}
              value={text}
              rows={6}
              placeholder={labels.pastePlaceholder}
              onChange={(e) => setText(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div data-slot="csv-import-actions" className={cn("flex gap-2", classNames.actions)}>
            <Button type="button" disabled={!text.trim()} onClick={() => load(text)}>
              {labels.next}
            </Button>
          </div>
        </div>
      )}

      {step === "map" && (
        <div
          data-slot="csv-import-mapping"
          className={cn("flex flex-col gap-3", classNames.mapping)}
        >
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-xs text-text-muted">
                <th scope="col" className="py-1.5 font-medium">
                  {labels.field}
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  {labels.column}
                </th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.key} className="border-t border-border-default">
                  <th scope="row" className="py-2 pr-3 font-normal">
                    <label htmlFor={`${id}-map-${f.key}`}>{label(f)}</label>
                    {f.required && (
                      <span className="ml-1 text-xs text-text-muted">({labels.required})</span>
                    )}
                  </th>
                  <td className="py-2">
                    <select
                      id={`${id}-map-${f.key}`}
                      data-slot="csv-import-select"
                      value={mapping[f.key] ?? ""}
                      aria-invalid={missing.includes(f) || undefined}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          [f.key]: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className="h-8 w-full rounded-lg border border-border-default bg-bg-elevated px-2 text-sm text-text-primary outline-none focus-visible:border-ring aria-invalid:border-destructive"
                    >
                      <option value="">{labels.none}</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `#${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div data-slot="csv-import-actions" className={cn("flex gap-2", classNames.actions)}>
            <Button type="button" variant="outline" onClick={() => setStep("source")}>
              {labels.back}
            </Button>
            <Button
              type="button"
              disabled={missing.length > 0}
              onClick={() => {
                setServerErrors({})
                setStep("review")
              }}
            >
              {labels.next}
            </Button>
          </div>
          {missing.length > 0 && (
            <p className="m-0 text-xs text-text-muted">
              {labels.missing(missing.map(label).join(", "))}
            </p>
          )}
        </div>
      )}

      {(step === "review" || step === "done") && (
        <div data-slot="csv-import-review" className={cn("flex flex-col gap-3", classNames.review)}>
          <div className="flex flex-wrap items-center gap-3">
            <span data-slot="csv-import-summary">{labels.summary(valid.length, invalid)}</span>
            {invalid > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={onlyErrors}
                  onChange={(e) => setOnlyErrors(e.target.checked)}
                />
                {labels.onlyErrors}
              </label>
            )}
          </div>
          <div className="max-h-96 overflow-auto rounded-lg border border-border-default">
            <table
              data-slot="csv-import-table"
              className={cn("w-full border-collapse text-left text-xs", classNames.table)}
            >
              <thead className="sticky top-0 bg-bg-surface">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium text-text-muted">
                    {labels.line}
                  </th>
                  {fields.map((f) => (
                    <th key={f.key} scope="col" className="px-2 py-1.5 font-medium text-text-muted">
                      {label(f)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.line}
                    data-invalid={Object.keys(r.errors).length > 0 || undefined}
                    className="border-t border-border-default data-invalid:bg-accent-red-subtle"
                  >
                    <th
                      scope="row"
                      className="px-2 py-1.5 font-normal text-text-muted tabular-nums"
                    >
                      {r.line}
                      {r.errors[""] && (
                        <span
                          data-slot="csv-import-error"
                          className={cn("block text-accent-red", classNames.error)}
                        >
                          {r.errors[""]}
                        </span>
                      )}
                    </th>
                    {fields.map((f) => {
                      const err = r.errors[f.key]
                      return (
                        <td
                          key={f.key}
                          data-slot="csv-import-cell"
                          data-invalid={err ? "" : undefined}
                          aria-invalid={err ? true : undefined}
                          className={cn(
                            "px-2 py-1.5 align-top data-invalid:ring-1 data-invalid:ring-destructive data-invalid:ring-inset",
                            classNames.cell,
                          )}
                        >
                          {r.input[f.key] ?? ""}
                          {err && (
                            <span
                              data-slot="csv-import-error"
                              className={cn("block text-accent-red", classNames.error)}
                            >
                              {err}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length < (onlyErrors && invalid > 0 ? invalid : results.length) && (
            <p className="m-0 text-xs text-text-muted">
              {labels.showing(shown.length, onlyErrors && invalid > 0 ? invalid : results.length)}
            </p>
          )}
          <div
            data-slot="csv-import-actions"
            className={cn("flex flex-wrap gap-2", classNames.actions)}
          >
            {step === "review" ? (
              <>
                <Button type="button" variant="outline" onClick={() => setStep("map")}>
                  {labels.back}
                </Button>
                <Button type="button" disabled={busy || valid.length === 0} onClick={runImport}>
                  {busy ? labels.importing : labels.import(valid.length)}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep("source")
                  setText("")
                  setReport(null)
                  setMessage("")
                }}
              >
                {labels.again}
              </Button>
            )}
            {errorRows.length > 0 && (
              <Button type="button" variant="ghost" onClick={downloadErrors}>
                {labels.downloadErrors}
              </Button>
            )}
          </div>
        </div>
      )}

      <p
        role="status"
        data-slot="csv-import-status"
        data-done={report ? "" : undefined}
        className={cn("m-0 text-sm empty:hidden", classNames.status)}
      >
        {message}
      </p>
    </section>
  )
}
