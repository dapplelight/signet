"use client"

// Experiment screens for the admin, on signet-db's createExperiments and
// signet-server's experimentAdminRoutes: a list of experiments with their
// status, one experiment's readout (exposures, conversions, rate, lift
// and p-value per variant against the control) with start, stop and roll
// out, the create / edit form, and a pricing experiment's readout (signet-db
// createPricing: conversion, trial conversion, revenue per exposed user and
// an LTV estimate per variant) with one-click rollout of the winning
// offering. Data comes in as props shaped like signet-db's results (or their
// JSON); actions go out as callbacks, so any client fits.
// Recipe: selection + live-region + field-wiring
import { CircleCheck, Play, Plus, Square, Trophy, X } from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import { Input } from "../ui/input.js"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table.js"
import { Textarea } from "../ui/textarea.js"
import { formatMoney } from "./billing-screens.js"

// ---------------------------------------------------------------- data model

export type ExperimentStatus = "draft" | "running" | "stopped" | "rolled_out"

/** signet-db `Experiment`, or its JSON. */
export type ExperimentView = {
  key: string
  description?: string | null
  status: ExperimentStatus
  variants: readonly { key: string; weight: number; value?: unknown }[]
  goal: string
  /** A flag rule's `when`: `{ plan?, attributes? }`; null is everyone. */
  audience?: Record<string, unknown> | null
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
  // form
  newExperiment: "New experiment",
  editExperiment: (key: string) => `Edit ${key}`,
  key: "Key",
  description: "Description",
  goalEvent: "Goal event",
  goalHint: "The analytics event that counts as a conversion.",
  audience: "Audience (JSON)",
  audienceHint: 'A flag rule\'s when, e.g. { "plan": ["free"] }. Empty is everyone.',
  variants: "Variants",
  variantKey: (i: number) => `Variant ${i + 1} key`,
  variantWeight: (i: number) => `Variant ${i + 1} weight`,
  variantValue: (i: number) => `Variant ${i + 1} value (JSON)`,
  variantOffering: (i: number) => `Variant ${i + 1} offering`,
  variantVersion: (i: number) => `Variant ${i + 1} offering version`,
  placementOwn: "The placement's own offering",
  customJson: "Custom JSON",
  latestVersion: "Latest",
  addVariant: "Add variant",
  removeVariant: (i: number) => `Remove variant ${i + 1}`,
  save: "Save",
  saved: "Saved.",
  lockedNote: "Variants and goal are fixed once an experiment starts.",
  invalid: {
    key: 'Use 1-64 letters, digits, ".", "_" or "-".',
    goal: "Name the goal event.",
    variants: "An experiment has 2 to 10 variants.",
    variantKey: 'Use 1-64 letters, digits, ".", "_" or "-", once each.',
    weight: "A weight is a positive number.",
    json: "Not valid JSON.",
    audience: "A JSON object, or empty.",
  },
  // pricing readout
  offering: "Offering",
  conversion: "Conversion",
  trialConversion: "Trial conversion",
  revenuePerExposed: "Revenue / exposed user",
  ltv: "LTV (estimate)",
  placements: (list: readonly string[]) =>
    list.length ? `Running on ${list.join(", ")}` : "Not running on a placement",
  pricingCaption: (alpha: number) =>
    `Conversion is a trial or purchase after exposure, compared with the control by a two-proportion z-test (significant below p = ${alpha}). Revenue is charges minus refunds after exposure. LTV is an estimate: the average charge times the payments expected from observed churn.`,
  approximate: "Includes App Store list prices",
  rolloutOffering: (variant: string) => `Make ${variant}'s offering the placement's offering`,
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

// --------------------------------------------------------------- shared bits

const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/i

function useAction() {
  const [phase, setPhase] = React.useState<"idle" | "pending" | "done" | "failed">("idle")
  const run = async (fn: () => unknown) => {
    setPhase("pending")
    try {
      setPhase((await fn()) === false ? "failed" : "done")
    } catch {
      setPhase("failed")
    }
  }
  return [phase, run] as const
}

function FieldError({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null
  return (
    <p id={id} className="text-xs text-destructive">
      {children}
    </p>
  )
}

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50 dark:bg-input/30"

// ---------------------------------------------------------------------- form

/** An offering the form can pick, from signet-db `offerings.list()` (latest version). */
export type OfferingChoice = { key: string; version?: number }

/** What `ExperimentForm` submits: the body of `POST /` (with key) or `PATCH /:key`. */
export type ExperimentInputView = {
  key: string
  description: string | null
  goal: string
  audience: Record<string, unknown> | null
  variants: { key: string; weight: number; value?: unknown }[]
}

type VariantDraft = {
  key: string
  weight: string
  /** "" is no value (the placement's own offering), "json" a custom value, else an offering key. */
  pick: string
  version: string
  json: string
}

const draftOf = (
  v: { key: string; weight: number; value?: unknown },
  offerings: readonly OfferingChoice[] | undefined,
): VariantDraft => {
  const val = v.value as { offering?: unknown; version?: unknown } | undefined
  const named =
    offerings &&
    val &&
    typeof val.offering === "string" &&
    Object.keys(val).every((k) => k === "offering" || k === "version")
  return {
    key: v.key,
    weight: String(v.weight),
    pick: named
      ? (val.offering as string)
      : v.value === undefined || v.value === null
        ? ""
        : "json",
    version: named && typeof val.version === "number" ? String(val.version) : "",
    json: v.value === undefined || v.value === null ? "" : JSON.stringify(v.value, null, 2),
  }
}

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

export type ExperimentFormProps = Omit<React.ComponentProps<"form">, "onSubmit" | "children"> & {
  /** The experiment to edit; omitted creates one. */
  experiment?: ExperimentView
  /** Offerings to pick per variant (a pricing experiment); omitted shows a JSON value. */
  offerings?: readonly OfferingChoice[]
  /** POST `/` (new) or PATCH `/:key` (edit). Resolve false or throw to show the failure. */
  onSubmit: (input: ExperimentInputView) => unknown
  onStart?: () => unknown
  onStop?: () => unknown
  labels?: Partial<ExperimentLabels>
}

/**
 * Create or edit an experiment: key, description, goal event, audience, and
 * 2 to 10 variants with weights and a value, either JSON or (with
 * `offerings`) an offering and optional version for a pricing experiment.
 * Only a draft is editable; start and stop sit beside save.
 */
export function ExperimentForm({
  experiment,
  offerings,
  onSubmit,
  onStart,
  onStop,
  labels: labelsProp,
  className,
  ...props
}: ExperimentFormProps) {
  const labels = useLabels(labelsProp)
  const id = React.useId()
  const status = experiment?.status ?? "draft"
  const locked = status !== "draft"
  const [key, setKey] = React.useState(experiment?.key ?? "")
  const [description, setDescription] = React.useState(experiment?.description ?? "")
  const [goal, setGoal] = React.useState(experiment?.goal ?? "")
  const [audience, setAudience] = React.useState(
    experiment?.audience ? JSON.stringify(experiment.audience, null, 2) : "",
  )
  const [variants, setVariants] = React.useState<VariantDraft[]>(() =>
    (
      experiment?.variants ?? [
        { key: "control", weight: 50 },
        { key: "test", weight: 50 },
      ]
    ).map((v) => draftOf(v, offerings)),
  )
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [phase, run] = useAction()
  const set = (i: number, patch: Partial<VariantDraft>) =>
    setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)))

  const validate = (): ExperimentInputView | null => {
    const e: Record<string, string> = {}
    if (!KEY.test(key)) e.key = labels.invalid.key
    if (!goal.trim()) e.goal = labels.invalid.goal
    let aud: Record<string, unknown> | null = null
    if (audience.trim()) {
      const p = parseJson(audience)
      if (!p.ok || !p.value || typeof p.value !== "object" || Array.isArray(p.value))
        e.audience = labels.invalid.audience
      else aud = p.value as Record<string, unknown>
    }
    if (variants.length < 2 || variants.length > 10) e.variants = labels.invalid.variants
    const seen = new Set<string>()
    const out = variants.map((v, i) => {
      if (!KEY.test(v.key) || seen.has(v.key)) e[`v${i}key`] = labels.invalid.variantKey
      seen.add(v.key)
      const weight = Number(v.weight)
      if (!(Number.isFinite(weight) && weight > 0)) e[`v${i}weight`] = labels.invalid.weight
      let value: unknown
      if (v.pick === "json" || (!offerings && v.json.trim())) {
        const p = parseJson(v.json)
        if (p.ok) value = p.value
        else e[`v${i}value`] = labels.invalid.json
      } else if (v.pick) {
        const n = Number(v.version)
        value = { offering: v.pick, ...(v.version && Number.isInteger(n) ? { version: n } : {}) }
      }
      return { key: v.key, weight, ...(value !== undefined ? { value } : {}) }
    })
    setErrors(e)
    if (Object.keys(e).length) return null
    return {
      key,
      description: description.trim() || null,
      goal: goal.trim(),
      audience: aud,
      variants: out,
    }
  }

  const invalid = (k: string) =>
    errors[k] ? { "aria-invalid": true, "aria-describedby": `${id}${k}` } : {}
  const busy = phase === "pending"
  return (
    <form
      data-slot="experiment-form"
      data-status={status}
      aria-labelledby={`${id}h`}
      noValidate
      className={cn(
        "flex flex-col gap-4 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default",
        className,
      )}
      onSubmit={(ev) => {
        ev.preventDefault()
        const input = validate()
        if (input) run(() => onSubmit(input))
      }}
      {...props}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 id={`${id}h`} className="text-lg font-semibold tracking-tight text-text-primary">
            {experiment ? labels.editExperiment(experiment.key) : labels.newExperiment}
          </h2>
          {experiment && <ExperimentStatusBadge status={status} labels={labelsProp} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {experiment && onStart && (status === "draft" || status === "stopped") && (
            <Button type="button" disabled={busy} onClick={() => run(onStart)}>
              <Play data-icon="inline-start" aria-hidden />
              {status === "draft" ? labels.start : labels.resume}
            </Button>
          )}
          {experiment && onStop && status === "running" && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => run(onStop)}>
              <Square data-icon="inline-start" aria-hidden />
              {labels.stop}
            </Button>
          )}
        </div>
      </header>
      {locked && <p className="text-sm text-text-muted">{labels.lockedNote}</p>}
      <fieldset disabled={locked || busy} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}f-key`} className="flex flex-col gap-1 text-xs text-text-muted">
              {labels.key}
              <Input
                id={`${id}f-key`}
                value={key}
                readOnly={!!experiment}
                onChange={(e) => setKey(e.target.value)}
                {...invalid("key")}
              />
            </label>
            <FieldError id={`${id}key`}>{errors.key}</FieldError>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}f-goal`} className="flex flex-col gap-1 text-xs text-text-muted">
              {labels.goalEvent}
              <Input
                id={`${id}f-goal`}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                {...invalid("goal")}
              />
            </label>
            <span className="text-xs text-text-muted">{labels.goalHint}</span>
            <FieldError id={`${id}goal`}>{errors.goal}</FieldError>
          </div>
        </div>
        <label htmlFor={`${id}f-desc`} className="flex flex-col gap-1 text-xs text-text-muted">
          {labels.description}
          <Input
            id={`${id}f-desc`}
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}f-aud`} className="flex flex-col gap-1 text-xs text-text-muted">
            {labels.audience}
            <Textarea
              id={`${id}f-aud`}
              value={audience}
              rows={2}
              className="font-mono"
              placeholder={labels.audienceHint}
              onChange={(e) => setAudience(e.target.value)}
              {...invalid("audience")}
            />
          </label>
          <FieldError id={`${id}audience`}>{errors.audience}</FieldError>
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-xs font-medium text-text-muted">{labels.variants}</legend>
          {variants.map((v, i) => (
            <div
              key={i}
              data-slot="experiment-form-variant"
              className="grid gap-2 rounded-lg p-3 ring-1 ring-border-default sm:grid-cols-[1fr_6rem_auto]"
            >
              <Input
                aria-label={labels.variantKey(i)}
                value={v.key}
                onChange={(e) => set(i, { key: e.target.value })}
                {...invalid(`v${i}key`)}
              />
              <Input
                aria-label={labels.variantWeight(i)}
                type="number"
                min={0}
                step="any"
                value={v.weight}
                onChange={(e) => set(i, { weight: e.target.value })}
                {...invalid(`v${i}weight`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={labels.removeVariant(i)}
                disabled={variants.length <= 2}
                onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}
              >
                <X aria-hidden />
              </Button>
              {offerings && (
                <div className="grid gap-2 sm:col-span-3 sm:grid-cols-[1fr_8rem]">
                  <select
                    aria-label={labels.variantOffering(i)}
                    className={selectClass}
                    value={v.pick}
                    onChange={(e) => set(i, { pick: e.target.value })}
                  >
                    <option value="">{labels.placementOwn}</option>
                    {offerings.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.key}
                      </option>
                    ))}
                    <option value="json">{labels.customJson}</option>
                  </select>
                  {v.pick && v.pick !== "json" && (
                    <Input
                      aria-label={labels.variantVersion(i)}
                      type="number"
                      min={1}
                      step={1}
                      placeholder={labels.latestVersion}
                      value={v.version}
                      onChange={(e) => set(i, { version: e.target.value })}
                    />
                  )}
                </div>
              )}
              {(!offerings || v.pick === "json") && (
                <Textarea
                  aria-label={labels.variantValue(i)}
                  className="font-mono sm:col-span-3"
                  rows={2}
                  value={v.json}
                  onChange={(e) => set(i, { json: e.target.value })}
                  {...invalid(`v${i}value`)}
                />
              )}
              {[`v${i}key`, `v${i}weight`, `v${i}value`].map((k) => (
                <FieldError key={k} id={`${id}${k}`}>
                  {errors[k]}
                </FieldError>
              ))}
            </div>
          ))}
          <FieldError id={`${id}variants`}>{errors.variants}</FieldError>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={variants.length >= 10}
            onClick={() =>
              setVariants((vs) => [
                ...vs,
                { key: `variant-${vs.length + 1}`, weight: "50", pick: "", version: "", json: "" },
              ])
            }
          >
            <Plus data-icon="inline-start" aria-hidden />
            {labels.addVariant}
          </Button>
        </fieldset>
        <Button type="submit" className="self-start">
          {labels.save}
        </Button>
      </fieldset>
      <p role="status" className="text-sm text-text-secondary empty:hidden">
        {phase === "pending"
          ? labels.working
          : phase === "failed"
            ? labels.failed
            : phase === "done"
              ? labels.saved
              : ""}
      </p>
    </form>
  )
}

// ---------------------------------------------------------- pricing readout

/** signet-db `PricingVariantReadout`, or its JSON. */
export type PricingVariantView = VariantResultView & {
  offering?: { offering: string; version?: number } | null
  trials: number
  trialConverted: number
  trialConversion: number | null
  revenue: Readonly<Record<string, number>>
  revenuePerExposed: Readonly<Record<string, number>>
  approximate?: boolean
  ltv?: {
    estimate: true
    perCurrency: Readonly<Record<string, number>>
    churn: number
    expectedPayments: number
  } | null
}

/** signet-db `PricingReadout`, or its JSON from `GET /pricing/:experiment`. */
export type PricingReadoutView = {
  placements: readonly string[]
  alpha: number
  control: string
  variants: readonly PricingVariantView[]
}

const money = (m: Readonly<Record<string, number>> | undefined) => {
  const parts = Object.entries(m ?? {}).map(([c, n]) => formatMoney(Math.round(n), c))
  return parts.length ? parts.join(" · ") : "–"
}

export type PricingExperimentResultsProps = Omit<
  React.ComponentProps<"section">,
  "children" | "results"
> & {
  experiment: ExperimentView
  readout: PricingReadoutView
  /** POST `/pricing/:experiment/rollout` { variant }: the placement serves it; the experiment stops. */
  onRollout?: (variant: string) => unknown
  onStart?: () => unknown
  onStop?: () => unknown
  labels?: Partial<ExperimentLabels>
}

/**
 * A pricing experiment's readout: per variant, the offering it serves,
 * exposures, conversion with lift and p-value against the control, trial
 * conversion, revenue per exposed user and an LTV estimate, with one-click
 * rollout of a variant's offering to the placement.
 */
export function PricingExperimentResults({
  experiment,
  readout,
  onRollout,
  onStart,
  onStop,
  labels: labelsProp,
  className,
  ...props
}: PricingExperimentResultsProps) {
  const labels = useLabels(labelsProp)
  const headingId = React.useId()
  const [phase, run] = useAction()
  const { status } = experiment
  const busy = phase === "pending"
  const byKey = new Map(readout.variants.map((v) => [v.key, v]))
  const canRollout =
    onRollout && readout.placements.length > 0 && (status === "running" || status === "stopped")
  return (
    <section
      data-slot="pricing-experiment-results"
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
          <p data-slot="pricing-placements" className="text-xs text-text-muted">
            {labels.placements(readout.placements)}
          </p>
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
        <TableCaption>{labels.pricingCaption(readout.alpha)}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.variant}</TableHead>
            <TableHead>{labels.offering}</TableHead>
            <TableHead className="text-right">{labels.exposed}</TableHead>
            <TableHead className="text-right">{labels.conversion}</TableHead>
            <TableHead className="text-right">{labels.lift}</TableHead>
            <TableHead className="text-right">{labels.pValue}</TableHead>
            <TableHead className="text-right">{labels.trialConversion}</TableHead>
            <TableHead className="text-right">{labels.revenuePerExposed}</TableHead>
            <TableHead className="text-right">{labels.ltv}</TableHead>
            {canRollout && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {experiment.variants.map((v, i) => {
            const r = byKey.get(v.key)
            const isWinner = experiment.winner === v.key
            const off = r?.offering
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
                <TableCell className="text-text-secondary">
                  {off
                    ? `${off.offering}${off.version ? ` v${off.version}` : ""}`
                    : labels.placementOwn}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r ? r.exposed : "–"}</TableCell>
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
                    <span className="inline-flex items-center gap-1">
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
                <TableCell className="text-right tabular-nums">
                  {r?.trialConversion != null ? pct(r.trialConversion) : "–"}
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  title={r?.approximate ? labels.approximate : undefined}
                >
                  {money(r?.revenuePerExposed)}
                  {r?.approximate && "*"}
                </TableCell>
                <TableCell data-estimate="" className="text-right tabular-nums text-text-secondary">
                  {r?.ltv ? `~${money(r.ltv.perCurrency)}` : "–"}
                </TableCell>
                {canRollout && (
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={labels.rolloutOffering(v.key)}
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
      <p role="status" className="text-sm text-text-secondary empty:hidden">
        {phase === "pending" ? labels.working : phase === "failed" ? labels.failed : ""}
      </p>
    </section>
  )
}
