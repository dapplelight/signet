"use client"

// Experiment screens for the admin, on signet-db's createExperiments and
// signet-server's experimentAdminRoutes: a list of experiments with their
// status, and one experiment's readout (exposures, conversions, rate, lift
// and p-value per variant against the control) with start, stop and roll
// out. Data comes in as props shaped like signet-db's results (or their
// JSON); actions go out as callbacks, so any client fits.
// Recipe: selection + live-region
import { CircleCheck, Play, Square, Trophy } from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table.js"

// ---------------------------------------------------------------- data model

export type ExperimentStatus = "draft" | "running" | "stopped" | "rolled_out"

/** signet-db `Experiment`, or its JSON. */
export type ExperimentView = {
  key: string
  description?: string | null
  status: ExperimentStatus
  variants: readonly { key: string; weight: number; value?: unknown }[]
  goal: string
  winner?: string | null
  startedAt?: Date | string | null
  stoppedAt?: Date | string | null
}

/** signet-db `VariantResult`. */
export type VariantResultView = {
  key: string
  exposed: number
  converted: number
  rate: number
  lift: number | null
  pValue: number | null
  significant: boolean
}

/** signet-db `ExperimentResults`, or its JSON from `GET /:key`. */
export type ExperimentResultsView = {
  goal: string
  alpha: number
  control: string
  variants: readonly VariantResultView[]
}

// -------------------------------------------------------------------- labels

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

/** Every string the experiment screens show, in English. */
export const DEFAULT_EXPERIMENT_LABELS = {
  experiments: "Experiments",
  noExperiments: "No experiments yet",
  status: {
    draft: "Draft",
    running: "Running",
    stopped: "Stopped",
    rolled_out: "Rolled out",
  } as Record<ExperimentStatus, string>,
  goal: (goal: string) => `Goal: ${goal}`,
  variant: "Variant",
  weight: "Weight",
  exposed: "Exposed",
  converted: "Converted",
  rate: "Rate",
  lift: "Lift",
  pValue: "p-value",
  control: "Control",
  significant: "Significant",
  notSignificant: "Not significant yet",
  winner: "Winner",
  noResults: "No results: pass the analytics events table to see conversions.",
  caption: (alpha: number) =>
    `Each variant is compared with the control by a two-proportion z-test; significant below p = ${alpha}.`,
  start: "Start",
  resume: "Resume",
  stop: "Stop",
  rollout: "Roll out",
  rolloutTo: (variant: string) => `Roll out ${variant}`,
  working: "Saving…",
  failed: "Could not save. Try again.",
}

export type ExperimentLabels = typeof DEFAULT_EXPERIMENT_LABELS

function useLabels(labels?: Partial<ExperimentLabels>): ExperimentLabels {
  return React.useMemo(() => ({ ...DEFAULT_EXPERIMENT_LABELS, ...labels }), [labels])
}

const STATUS_VARIANT: Record<ExperimentStatus, "default" | "secondary" | "outline"> = {
  draft: "outline",
  running: "default",
  stopped: "secondary",
  rolled_out: "secondary",
}

/** A badge for an experiment's status. */
export function ExperimentStatusBadge({
  status,
  labels: labelsProp,
}: {
  status: ExperimentStatus
  labels?: Partial<ExperimentLabels>
}) {
  const labels = useLabels(labelsProp)
  return (
    <Badge data-slot="experiment-status" data-status={status} variant={STATUS_VARIANT[status]}>
      {labels.status[status]}
    </Badge>
  )
}

// ---------------------------------------------------------------------- list

export type ExperimentListProps = Omit<React.ComponentProps<"section">, "children" | "onSelect"> & {
  experiments: readonly ExperimentView[]
  /** The experiment shown, marked `aria-current`. */
  selected?: string
  onSelect?: (key: string) => void
  labels?: Partial<ExperimentLabels>
}

/** Every experiment with its status and goal; picking one calls `onSelect`. */
export function ExperimentList({
  experiments,
  selected,
  onSelect,
  labels: labelsProp,
  className,
  ...props
}: ExperimentListProps) {
  const labels = useLabels(labelsProp)
  const headingId = React.useId()
  return (
    <section
      data-slot="experiment-list"
      aria-labelledby={headingId}
      className={cn("flex flex-col gap-2", className)}
      {...props}
    >
      <h2 id={headingId} className="text-xs font-medium text-text-muted">
        {labels.experiments}
      </h2>
      {experiments.length === 0 ? (
        <p className="text-sm text-text-muted">{labels.noExperiments}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {experiments.map((e) => (
            <li key={e.key}>
              <button
                type="button"
                aria-current={selected === e.key ? "true" : undefined}
                onClick={() => onSelect?.(e.key)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-bg-elevated aria-[current=true]:bg-bg-elevated"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-text-primary">{e.key}</span>
                  <span className="truncate text-xs text-text-muted">{labels.goal(e.goal)}</span>
                </span>
                <ExperimentStatusBadge status={e.status} labels={labelsProp} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ------------------------------------------------------------------- results

export type ExperimentResultsProps = Omit<
  React.ComponentProps<"section">,
  "children" | "results"
> & {
  experiment: ExperimentView
  /** Null when the server has no events table. */
  results?: ExperimentResultsView | null
  onStart?: () => unknown
  onStop?: () => unknown
  onRollout?: (variant: string) => unknown
  labels?: Partial<ExperimentLabels>
}

/**
 * One experiment's readout: per-variant exposures, conversions, rate, lift
 * and p-value against the control, with start, stop and roll out a winner.
 * An action that throws or resolves false shows the failure message.
 */
export function ExperimentResults({
  experiment,
  results,
  onStart,
  onStop,
  onRollout,
  labels: labelsProp,
  className,
  ...props
}: ExperimentResultsProps) {
  const labels = useLabels(labelsProp)
  const headingId = React.useId()
  const [phase, setPhase] = React.useState<"idle" | "pending" | "failed">("idle")
  const run = async (fn: () => unknown) => {
    setPhase("pending")
    try {
      setPhase((await fn()) === false ? "failed" : "idle")
    } catch {
      setPhase("failed")
    }
  }
  const { status } = experiment
  const busy = phase === "pending"
  const byKey = new Map(results?.variants.map((v) => [v.key, v]))
  const canRollout = onRollout && (status === "running" || status === "stopped")
  return (
    <section
      data-slot="experiment-results"
      data-status={status}
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-4 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default",
        className,
      )}
      {...props}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 id={headingId} className="text-lg font-semibold tracking-tight text-text-primary">
              {experiment.key}
            </h2>
            <ExperimentStatusBadge status={status} labels={labelsProp} />
          </div>
          {experiment.description && (
            <p className="text-sm text-text-secondary">{experiment.description}</p>
          )}
          <p className="text-xs text-text-muted">{labels.goal(results?.goal ?? experiment.goal)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onStart && (status === "draft" || status === "stopped") && (
            <Button disabled={busy} onClick={() => run(onStart)}>
              <Play data-icon="inline-start" aria-hidden />
              {status === "draft" ? labels.start : labels.resume}
            </Button>
          )}
          {onStop && status === "running" && (
            <Button variant="outline" disabled={busy} onClick={() => run(onStop)}>
              <Square data-icon="inline-start" aria-hidden />
              {labels.stop}
            </Button>
          )}
        </div>
      </header>

      <Table>
        {results && <TableCaption>{labels.caption(results.alpha)}</TableCaption>}
        <TableHeader>
          <TableRow>
            <TableHead>{labels.variant}</TableHead>
            <TableHead className="text-right">{labels.weight}</TableHead>
            <TableHead className="text-right">{labels.exposed}</TableHead>
            <TableHead className="text-right">{labels.converted}</TableHead>
            <TableHead className="text-right">{labels.rate}</TableHead>
            <TableHead className="text-right">{labels.lift}</TableHead>
            <TableHead className="text-right">{labels.pValue}</TableHead>
            {canRollout && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {experiment.variants.map((v, i) => {
            const r = byKey.get(v.key)
            const isWinner = experiment.winner === v.key
            return (
              <TableRow
                key={v.key}
                data-variant={v.key}
                data-significant={r?.significant ? "" : undefined}
                data-winner={isWinner ? "" : undefined}
              >
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {v.key}
                    {i === 0 && <Badge variant="outline">{labels.control}</Badge>}
                    {isWinner && (
                      <Badge>
                        <Trophy data-icon="inline-start" aria-hidden />
                        {labels.winner}
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{v.weight}</TableCell>
                <TableCell className="text-right tabular-nums">{r ? r.exposed : "–"}</TableCell>
                <TableCell className="text-right tabular-nums">{r ? r.converted : "–"}</TableCell>
                <TableCell className="text-right tabular-nums">{r ? pct(r.rate) : "–"}</TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    r?.significant && (r.lift ?? 0) > 0 && "text-accent-green",
                    r?.significant && (r.lift ?? 0) < 0 && "text-accent-red",
                  )}
                >
                  {r?.lift != null ? `${r.lift > 0 ? "+" : ""}${pct(r.lift)}` : "–"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r?.pValue != null ? (
                    <span
                      className="inline-flex items-center gap-1"
                      title={r.significant ? labels.significant : labels.notSignificant}
                    >
                      {r.significant && <CircleCheck className="size-3.5" aria-hidden />}
                      {r.pValue < 0.001 ? "<0.001" : r.pValue.toFixed(3)}
                      <span className="sr-only">
                        {r.significant ? labels.significant : labels.notSignificant}
                      </span>
                    </span>
                  ) : (
                    "–"
                  )}
                </TableCell>
                {canRollout && (
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={labels.rolloutTo(v.key)}
                      onClick={() => run(() => onRollout(v.key))}
                    >
                      {labels.rollout}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {results === null && <p className="text-sm text-text-muted">{labels.noResults}</p>}
      <p role="status" className="text-sm text-text-secondary empty:hidden">
        {phase === "pending" ? labels.working : phase === "failed" ? labels.failed : ""}
      </p>
    </section>
  )
}
