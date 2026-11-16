/**
 * Bulk insert for imports (CSV, spreadsheets, another system's export):
 * validated, chunked, idempotent, with a report per row instead of one
 * error for the whole file.
 *
 * - Every row is checked with a schema first (default: `toZod(table, { mode: "insert" })`);
 *   a row that fails is reported and left out, the rest still go in.
 * - `key` names a unique column. A row whose key is already in the table, or
 *   earlier in the same import, is skipped, so running the same file twice
 *   inserts nothing the second time.
 * - Rows go in chunks through the scope you pass (`scoped`, `audited`), so
 *   owner columns, encryption, the audit trail and version history apply as
 *   for any other insert. When a chunk fails, its rows are retried one at a
 *   time to find the ones the database refuses.
 *
 * The report's `row` is the index into `rows`, matching signet-ui's
 * `CsvImport` report.
 */

import { getTableName, inArray, type Table } from "drizzle-orm"
import { columnsOf } from "./db.js"
import { SignetDbError } from "./errors.js"
import { dbOfOps, type Ops, type Scope } from "./scoped.js"
import { MANAGED_KEYS, toZod } from "./zod.js"

export type BulkInsertError = { row: number; field?: string; message: string }
export type BulkInsertReport = {
  inserted: number
  /** Rows whose key was already there, or repeated in this import. */
  skipped: number
  errors: BulkInsertError[]
}

/** The part of a zod schema bulkInsert uses. */
export type BulkInsertSchema = {
  safeParse(value: unknown):
    | { success: true; data: unknown }
    | {
        success: false
        error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> }
      }
}

export type BulkInsertOptions = {
  /** JS key of a unique column (a primary key or one with a unique index) that identifies a row. */
  key: string
  /** Validates and shapes each row. Default: `toZod(table, { mode: "insert" })`, keeping `key`. */
  schema?: BulkInsertSchema
  /**
   * Rows per insert statement. Default: as many as fit in 100 bound
   * parameters on SQLite (D1's limit), 500 on Postgres.
   */
  chunkSize?: number
}

const firstLine = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0]?.slice(0, 300) || "Insert failed."

/** Insert `rows` into `table` through `ops`, skipping keys already there. Never throws for a bad row. */
export async function bulkInsert<S extends Scope>(
  ops: Ops<S>,
  table: Table,
  rows: readonly unknown[],
  options: BulkInsertOptions,
): Promise<BulkInsertReport> {
  const cols = columnsOf(table)
  const keyCol = cols[options.key]
  if (!keyCol)
    throw new SignetDbError(
      "UNKNOWN_KEY",
      `bulkInsert: ${getTableName(table)} has no column "${options.key}". Pass the JS key of a unique column as \`key\`.`,
    )
  const keep = (MANAGED_KEYS as readonly string[]).includes(options.key) ? [options.key] : []
  const schema =
    options.schema ??
    (toZod(table, { mode: "insert", keep: keep as never }) as unknown as BulkInsertSchema)
  const dialect = dbOfOps(ops as Ops<Scope>)?.dialect ?? "sqlite"
  const width = Object.keys(cols).length
  const chunkSize = Math.max(
    1,
    options.chunkSize ?? (dialect === "pg" ? 500 : Math.floor(100 / width)),
  )

  const report: BulkInsertReport = { inserted: 0, skipped: 0, errors: [] }
  const seen = new Set<string>()
  const ready: { row: number; key: string; value: Record<string, unknown> }[] = []
  rows.forEach((input, row) => {
    const r = schema.safeParse(input)
    if (!r.success) {
      const byField = new Map<string, string>()
      for (const issue of r.error.issues) {
        const field = String(issue.path[0] ?? "")
        if (!byField.has(field)) byField.set(field, issue.message)
      }
      for (const [field, message] of byField)
        report.errors.push(field ? { row, field, message } : { row, message })
      return
    }
    const value = r.data as Record<string, unknown>
    const k = value[options.key]
    if (k === undefined || k === null || k === "") {
      report.errors.push({ row, field: options.key, message: "Required to import." })
      return
    }
    const key = String(k)
    if (seen.has(key)) {
      report.skipped++
      return
    }
    seen.add(key)
    ready.push({ row, key, value })
  })

  for (let i = 0; i < ready.length; i += chunkSize) {
    const chunk = ready.slice(i, i + chunkSize)
    const found = await ops.select(
      table,
      inArray(
        keyCol,
        chunk.map((c) => c.value[options.key]),
      ),
      { withDeleted: true },
    )
    const there = new Set(found.map((r) => String((r as Record<string, unknown>)[options.key])))
    const fresh = chunk.filter((c) => !there.has(c.key))
    report.skipped += chunk.length - fresh.length
    if (fresh.length === 0) continue
    try {
      await ops.insert(table, fresh.map((c) => c.value) as never)
      report.inserted += fresh.length
    } catch {
      // ponytail: one statement per row to find the bad ones; fine for the few
      // chunks that fail, slow if most of a large file collides.
      for (const c of fresh) {
        try {
          await ops.insert(table, c.value as never)
          report.inserted++
        } catch (e) {
          report.errors.push({ row: c.row, message: firstLine(e) })
        }
      }
    }
  }
  report.errors.sort((a, b) => a.row - b.row)
  return report
}
