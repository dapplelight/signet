"use client"
import { type JobRun, JobRuns } from "@dapplelight/signet-ui/domain/job-runs"
import { useState } from "react"

const initial: JobRun[] = [
  {
    id: "run_8f21",
    job: "invoice.generate",
    state: "running",
    attempt: 1,
    progress: { done: 340, total: 500, note: "March invoices" },
  },
  { id: "run_8f20", job: "email.digest", state: "done", attempt: 1 },
  {
    id: "run_8f1e",
    job: "payout.settle",
    state: "dead",
    attempt: 5,
    error: { code: "GATEWAY_TIMEOUT", message: "Bank did not respond" },
  },
  { id: "run_8f1b", job: "report.export", state: "queued", attempt: 0 },
]

export function JobRunsDemo() {
  const [runs, setRuns] = useState(initial)
  return (
    <div className="w-full">
      <JobRuns
        runs={runs}
        onRetry={(run) =>
          setRuns((rs) =>
            rs.map((r) =>
              r.id === run.id
                ? { ...r, state: "queued", attempt: r.attempt + 1, error: undefined }
                : r,
            ),
          )
        }
        onCancel={(run) =>
          setRuns((rs) => rs.map((r) => (r.id === run.id ? { ...r, state: "cancelled" } : r)))
        }
      />
    </div>
  )
}

export function JobRunsReadOnlyDemo() {
  return (
    <div className="w-full">
      <JobRuns runs={initial.slice(0, 2)} />
    </div>
  )
}

export function JobRunsEmptyDemo() {
  return (
    <div className="w-full">
      <JobRuns runs={[]} emptyMessage="Nothing has run yet" />
    </div>
  )
}
