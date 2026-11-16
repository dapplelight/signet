import type { ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"
import { useLabels } from "../../lib/labels.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import { DataTable, type DataTableFeatures, TruncatedCell } from "../ui/data-table.js"

/**
 * One background-job run, as signet-server's `jobs.status(id)` or a dead-letter
 * entry describes it. Plain data: this component imports nothing from a server.
 */
export type JobRun = {
  id: string
  job: string
  state: string
  attempt: number
  error?: { code: string; message?: string }
  progress?: { done: number; total?: number; note?: string }
  updatedAt?: string
}

type JobRunsProps = {
  runs: JobRun[]
  /** Shown on failed (`dead`) runs. */
  onRetry?: (run: JobRun) => void
  /** Shown on runs that have not finished. */
  onCancel?: (run: JobRun) => void
  emptyMessage?: string
  className?: string
}

const FINISHED = new Set(["done", "dead", "cancelled"])

function stateVariant(state: string) {
  if (state === "dead") return "destructive" as const
  if (state === "running") return "default" as const
  if (state === "done") return "secondary" as const
  return "outline" as const
}

function progressText(p: JobRun["progress"]) {
  if (!p) return ""
  const count = p.total !== undefined ? `${p.done}/${p.total}` : String(p.done)
  return p.note ? `${count} · ${p.note}` : count
}

/** A table of job runs with their state, attempts, error and retry/cancel actions. */
function JobRuns({
  runs,
  onRetry,
  onCancel,
  emptyMessage = "No job runs",
  className,
}: JobRunsProps) {
  const l = useLabels()
  const columns = useMemo<ColumnDef<DataTableFeatures, JobRun, unknown>[]>(
    () => [
      { accessorKey: "job", header: l.job, meta: { filter: "facet" } },
      {
        accessorKey: "state",
        header: l.status,
        meta: { filter: "facet" },
        cell: ({ row }) => (
          <Badge variant={stateVariant(row.original.state)}>{row.original.state}</Badge>
        ),
      },
      { accessorKey: "attempt", header: l.attempts },
      {
        id: "progress",
        header: l.progress,
        cell: ({ row }) => (
          <span className="tabular-nums text-text-muted">
            {progressText(row.original.progress)}
          </span>
        ),
      },
      {
        id: "error",
        header: l.error,
        accessorFn: (r) => (r.error ? `${r.error.code}: ${r.error.message ?? ""}` : ""),
        cell: ({ row }) =>
          row.original.error ? (
            <TruncatedCell className="text-accent-red">
              {row.original.error.code}
              {row.original.error.message ? `: ${row.original.error.message}` : ""}
            </TruncatedCell>
          ) : null,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{l.actions}</span>,
        cell: ({ row }) => {
          const run = row.original
          return (
            <div className="flex justify-end gap-1">
              {onRetry && run.state === "dead" ? (
                <Button
                  size="xs"
                  variant="outline"
                  aria-label={l.retryItem(`${run.job} ${run.id}`)}
                  onClick={() => onRetry(run)}
                >
                  {l.retry}
                </Button>
              ) : null}
              {onCancel && !FINISHED.has(run.state) ? (
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={l.cancelItem(`${run.job} ${run.id}`)}
                  onClick={() => onCancel(run)}
                >
                  {l.cancel}
                </Button>
              ) : null}
            </div>
          )
        },
      },
    ],
    [onRetry, onCancel, l],
  )
  return (
    <DataTable
      columns={columns}
      data={runs}
      getRowId={(r) => r.id}
      emptyMessage={emptyMessage}
      className={className}
    />
  )
}

export type { JobRunsProps }
export { JobRuns }
