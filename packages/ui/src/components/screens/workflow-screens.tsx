"use client"

// Workflow screens on signet-db's durable workflows: a run timeline (each
// step, its status, retries, and who or what the run is waiting on) and an
// approval inbox card with Approve / Reject. Data comes in as props shaped
// like signet-db's `wf.get(id)` and `wf.pendingApprovals(user)` (or the
// JSON from signet-server's `workflowRoutes`); actions go out as callbacks.
// Recipe: roving-focus (timeline) + live-region + field-wiring
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import {
  Check,
  Clock,
  Hourglass,
  Mail,
  Play,
  RotateCw,
  ShieldCheck,
  Square,
  UserCheck,
  X,
} from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import { Field, FieldControl, FieldLabel } from "../ui/field.js"
import {
  Timeline,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from "../ui/timeline.js"

type When = Date | string

export type RunStatus =
  | "queued"
  | "running"
  | "sleeping"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"

/** signet-db's `WorkflowRun` (dates may be ISO strings over HTTP). */
export type WorkflowRunView = {
  id: string
  workflow: string
  status: RunStatus
  error?: string | null
  createdBy?: string | null
  createdAt: When
  finishedAt?: When | null
  waitingOn?: {
    step: string
    kind: "sleep" | "retry" | "event" | "approval"
    until: When
    event?: string
    approvers?: string[]
  } | null
}

/** signet-db's `WorkflowStep`. */
export type WorkflowStepView = {
  stepId: string
  kind: "run" | "sleep" | "event" | "approval"
  status: "running" | "retrying" | "sleeping" | "waiting" | "completed" | "failed"
  attempts?: number
  error?: string | null
  wakeAt?: When | null
  event?: string | null
  approvers?: string[] | null
  summary?: string | null
  decidedBy?: string | null
  output?: unknown
  startedAt: When
  finishedAt?: When | null
}

/** signet-db's `PendingWorkflowApproval`. */
export type WorkflowApprovalView = {
  runId: string
  stepId: string
  workflow: string
  summary?: string | null
  approvers: string[]
  requestedAt: When
  expiresAt?: When | null
}

const timeText = (d: When) =>
  new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

/** Every string the workflow screens show, in English. Spread and override for another language. */
export const DEFAULT_WORKFLOW_LABELS = {
  run: "Run",
  steps: "Steps",
  status: {
    queued: "Queued",
    running: "Running",
    sleeping: "Sleeping",
    waiting: "Waiting",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  } as Record<string, string>,
  stepStatus: {
    running: "Running",
    retrying: "Retrying",
    sleeping: "Sleeping",
    waiting: "Waiting",
    completed: "Done",
    failed: "Failed",
  } as Record<string, string>,
  started: (d: When) => `Started ${timeText(d)}`,
  waitingOnPeople: (who: string[]) => `Waiting on ${who.join(", ")}`,
  waitingOnEvent: (event: string) => `Waiting for ${event}`,
  sleepingUntil: (d: When) => `Sleeping until ${timeText(d)}`,
  retryingAt: (d: When) => `Retrying at ${timeText(d)}`,
  until: (d: When) => `Until ${timeText(d)}`,
  attempts: (n: number) => `${n} attempts`,
  approvedBy: (who: string) => `Approved by ${who}`,
  rejectedBy: (who: string) => `Rejected by ${who}`,
  timedOut: "Timed out",
  noSteps: "No steps yet",
  cancel: "Cancel run",
  cancelling: "Cancelling…",
  // inbox
  inboxTitle: "Approvals",
  inboxEmpty: "Nothing waiting on you",
  requested: (d: When) => `Requested ${timeText(d)}`,
  expires: (d: When) => `Expires ${timeText(d)}`,
  reason: "Reason (optional)",
  approve: "Approve",
  reject: "Reject",
  deciding: "Saving…",
  approved: "Approved",
  rejected: "Rejected",
  decideFailed: "Couldn't save. Try again.",
}

export type WorkflowLabels = typeof DEFAULT_WORKFLOW_LABELS

function useLabels(labels?: Partial<WorkflowLabels>): WorkflowLabels {
  return React.useMemo(() => ({ ...DEFAULT_WORKFLOW_LABELS, ...labels }), [labels])
}

type PartProps<T extends keyof React.JSX.IntrinsicElements> = useRender.ComponentProps<T>

/** One part element: `render` swaps it, `className` merges over the defaults, `state` becomes `data-*`. */
function usePart<T extends keyof React.JSX.IntrinsicElements>(
  tag: T,
  slot: string,
  base: string,
  { className, render, ...props }: PartProps<T>,
  extra: Record<string, unknown> = {},
  state: Record<string, unknown> = {},
) {
  return useRender({
    defaultTagName: tag,
    render: render as useRender.RenderProp,
    state: { slot, ...state },
    props: mergeProps<"div">(
      { ...extra, className: cn(base, className as string) } as never,
      props as never,
    ),
  })
}

const CARD = "flex flex-col gap-4 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default"

const TONE: Record<string, string> = {
  completed: "bg-accent-green-subtle text-accent-green",
  failed: "bg-accent-red-subtle text-accent-red",
  cancelled: "bg-bg-elevated text-text-muted",
  waiting: "bg-accent-amber-subtle text-accent-amber",
  retrying: "bg-accent-amber-subtle text-accent-amber",
  sleeping: "bg-accent-blue-subtle text-accent-blue",
  running: "bg-accent-blue-subtle text-accent-blue",
  queued: "bg-bg-elevated text-text-secondary",
}

const ACTIVE = new Set(["queued", "running", "sleeping", "waiting"])

/** One line on what a run is blocked on, or null. */
export function waitingText(
  run: WorkflowRunView,
  labels: WorkflowLabels = DEFAULT_WORKFLOW_LABELS,
) {
  const w = run.waitingOn
  if (!w || !ACTIVE.has(run.status)) return null
  if (w.kind === "approval") return labels.waitingOnPeople(w.approvers ?? [])
  if (w.kind === "event") return labels.waitingOnEvent(w.event ?? w.step)
  if (w.kind === "retry") return labels.retryingAt(w.until)
  return labels.sleepingUntil(w.until)
}

const KIND_ICON = { run: Play, sleep: Clock, event: Mail, approval: ShieldCheck }

function stepDetail(step: WorkflowStepView, labels: WorkflowLabels): string | null {
  if (step.kind === "approval") {
    const d = step.output as { approved?: boolean; by?: string; timedOut?: boolean } | null
    if (step.status === "completed" && d) {
      if (d.timedOut) return labels.timedOut
      return d.approved ? labels.approvedBy(d.by ?? "") : labels.rejectedBy(d.by ?? "")
    }
    if (step.status === "waiting") return labels.waitingOnPeople(step.approvers ?? [])
  }
  if (step.kind === "event" && step.status === "waiting")
    return labels.waitingOnEvent(step.event ?? step.stepId)
  if (step.kind === "event" && step.status === "completed" && step.output === null)
    return labels.timedOut
  if (step.status === "retrying" && step.wakeAt) return labels.retryingAt(step.wakeAt)
  if (step.status === "sleeping" && step.wakeAt) return labels.until(step.wakeAt)
  return null
}

// -------------------------------------------------------------- run timeline

export type WorkflowRunTimelineProps = PartProps<"section"> & {
  run: WorkflowRunView
  steps: WorkflowStepView[]
  /** Shows a Cancel button while the run is active: `POST /runs/:id/cancel`. */
  onCancel?: () => Promise<unknown> | unknown
  title?: React.ReactNode
  labels?: Partial<WorkflowLabels>
}

/** A run: its status, what it waits on, and every step in order with retries and decisions. */
export function WorkflowRunTimeline({
  run,
  steps,
  onCancel,
  title,
  labels: labelsProp,
  ...props
}: WorkflowRunTimelineProps) {
  const labels = useLabels(labelsProp)
  const [cancelling, setCancelling] = React.useState(false)
  const headingId = React.useId()
  const waiting = waitingText(run, labels)
  const cancel = async () => {
    setCancelling(true)
    try {
      await onCancel?.()
    } finally {
      setCancelling(false)
    }
  }
  const children = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="text-lg font-semibold tracking-tight text-text-primary">
            {title ?? run.workflow}
          </h2>
          <span className="text-xs text-text-muted">{labels.started(run.createdAt)}</span>
        </div>
        <Badge data-slot="workflow-run-status" variant="secondary" className={TONE[run.status]}>
          {labels.status[run.status] ?? run.status}
        </Badge>
      </div>
      {waiting && (
        <p
          role="status"
          data-slot="workflow-run-waiting"
          className="flex items-center gap-2 rounded-lg bg-bg-elevated px-3 py-2 text-sm text-text-secondary"
        >
          {run.waitingOn?.kind === "approval" ? (
            <UserCheck className="size-4 shrink-0" aria-hidden />
          ) : (
            <Hourglass className="size-4 shrink-0" aria-hidden />
          )}
          {waiting}
        </p>
      )}
      {run.status === "failed" && run.error && (
        <p className="rounded-lg bg-accent-red-subtle px-3 py-2 text-sm text-accent-red">
          {run.error}
        </p>
      )}
      {steps.length === 0 ? (
        <p className="text-sm text-text-muted">{labels.noSteps}</p>
      ) : (
        <Timeline aria-label={labels.steps}>
          {steps.map((step) => {
            const Icon =
              step.status === "completed"
                ? Check
                : step.status === "failed"
                  ? X
                  : step.status === "retrying"
                    ? RotateCw
                    : KIND_ICON[step.kind]
            const detail = stepDetail(step, labels)
            return (
              <TimelineItem
                key={step.stepId}
                data-step-status={step.status}
                status={
                  step.status === "completed"
                    ? "complete"
                    : step.status === "failed"
                      ? "upcoming"
                      : "current"
                }
              >
                <TimelineMarker
                  className={cn(
                    step.status === "failed" && "border-accent-red bg-accent-red text-bg-surface",
                  )}
                >
                  <Icon aria-hidden />
                </TimelineMarker>
                <TimelineTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[0.8125rem]">{step.summary ?? step.stepId}</span>
                  <span className={cn("rounded px-1.5 py-0.5 text-[0.6875rem]", TONE[step.status])}>
                    {labels.stepStatus[step.status] ?? step.status}
                  </span>
                  {(step.attempts ?? 0) > 1 && (
                    <span className="text-xs text-text-muted">
                      {labels.attempts(step.attempts ?? 0)}
                    </span>
                  )}
                </TimelineTitle>
                <TimelineTime dateTime={new Date(step.startedAt).toISOString()}>
                  {timeText(step.startedAt)}
                </TimelineTime>
                {(detail || step.error) && (
                  <TimelineDescription>
                    {detail}
                    {step.error && step.status !== "completed" && (
                      <span className="block text-accent-red">{step.error}</span>
                    )}
                  </TimelineDescription>
                )}
              </TimelineItem>
            )
          })}
        </Timeline>
      )}
      {onCancel && ACTIVE.has(run.status) && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={cancel} disabled={cancelling}>
            <Square data-icon="inline-start" aria-hidden />
            {cancelling ? labels.cancelling : labels.cancel}
          </Button>
        </div>
      )}
    </>
  )
  return usePart(
    "section",
    "workflow-run",
    CARD,
    props,
    { "aria-labelledby": headingId, children },
    { status: run.status },
  )
}

// ------------------------------------------------------------ approval inbox

export type ApprovalInboxCardProps = PartProps<"section"> & {
  approvals: WorkflowApprovalView[]
  /** `POST /runs/:runId/steps/:stepId/approve`. A throw shows a retry message. */
  onApprove: (approval: WorkflowApprovalView, reason?: string) => Promise<unknown> | unknown
  /** `POST /runs/:runId/steps/:stepId/reject`. */
  onReject: (approval: WorkflowApprovalView, reason?: string) => Promise<unknown> | unknown
  /** Ask for a reason with each decision. Default true. */
  withReason?: boolean
  /** Make the summary a link, e.g. to the run timeline. */
  href?: (approval: WorkflowApprovalView) => string
  title?: React.ReactNode
  labels?: Partial<WorkflowLabels>
}

/** Approval steps waiting on the signed-in person, each with Approve and Reject. */
export function ApprovalInboxCard({
  approvals,
  onApprove,
  onReject,
  withReason = true,
  href,
  title,
  labels: labelsProp,
  ...props
}: ApprovalInboxCardProps) {
  const labels = useLabels(labelsProp)
  const headingId = React.useId()
  const children = (
    <>
      <h2 id={headingId} className="text-lg font-semibold tracking-tight text-text-primary">
        {title ?? labels.inboxTitle}
        {approvals.length > 0 && (
          <Badge variant="secondary" className="ml-2 align-middle">
            {approvals.length}
          </Badge>
        )}
      </h2>
      {approvals.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-muted">{labels.inboxEmpty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-default">
          {approvals.map((a) => (
            <ApprovalItem
              key={`${a.runId}:${a.stepId}`}
              approval={a}
              onApprove={onApprove}
              onReject={onReject}
              withReason={withReason}
              href={href}
              labels={labels}
            />
          ))}
        </ul>
      )}
    </>
  )
  return usePart(
    "section",
    "approval-inbox",
    CARD,
    props,
    { "aria-labelledby": headingId, children },
    { empty: approvals.length === 0 },
  )
}

function ApprovalItem({
  approval: a,
  onApprove,
  onReject,
  withReason,
  href,
  labels,
}: {
  approval: WorkflowApprovalView
  onApprove: ApprovalInboxCardProps["onApprove"]
  onReject: ApprovalInboxCardProps["onReject"]
  withReason: boolean
  href?: (approval: WorkflowApprovalView) => string
  labels: WorkflowLabels
}) {
  const [state, setState] = React.useState<"idle" | "pending" | "approved" | "rejected" | "error">(
    "idle",
  )
  const [reason, setReason] = React.useState("")
  const summary = a.summary ?? a.workflow
  const decide = async (approve: boolean) => {
    setState("pending")
    try {
      await (approve ? onApprove : onReject)(a, reason.trim() || undefined)
      setState(approve ? "approved" : "rejected")
    } catch {
      setState("error")
    }
  }
  const decided = state === "approved" || state === "rejected"
  return (
    <li
      data-slot="approval-item"
      data-state={state}
      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
    >
      <div className="flex flex-col gap-0.5">
        {href ? (
          <a href={href(a)} className="text-sm font-medium text-text-primary hover:underline">
            {summary}
          </a>
        ) : (
          <span className="text-sm font-medium text-text-primary">{summary}</span>
        )}
        <span className="text-xs text-text-muted">
          {a.workflow} · {labels.requested(a.requestedAt)}
          {a.expiresAt && ` · ${labels.expires(a.expiresAt)}`}
        </span>
      </div>
      {!decided && withReason && (
        <Field className="gap-1.5">
          <FieldLabel className="text-xs">{labels.reason}</FieldLabel>
          <FieldControl
            value={reason}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
            disabled={state === "pending"}
            className="h-9"
          />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!decided && (
          <>
            <Button size="sm" onClick={() => decide(true)} disabled={state === "pending"}>
              <Check data-icon="inline-start" aria-hidden />
              {labels.approve}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => decide(false)}
              disabled={state === "pending"}
            >
              <X data-icon="inline-start" aria-hidden />
              {labels.reject}
            </Button>
          </>
        )}
        <span
          role="status"
          className={cn(
            "text-sm",
            state === "error"
              ? "text-accent-red"
              : decided
                ? "text-text-primary"
                : "text-text-muted",
          )}
        >
          {state === "pending"
            ? labels.deciding
            : state === "approved"
              ? labels.approved
              : state === "rejected"
                ? labels.rejected
                : state === "error"
                  ? labels.decideFailed
                  : ""}
        </span>
      </div>
    </li>
  )
}
