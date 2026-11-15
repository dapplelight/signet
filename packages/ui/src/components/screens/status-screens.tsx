"use client"

// The public status page, on signet-db's createStatus and signet-server's
// statusRoutes: the overall status, a maintenance notice, every component
// with its status, and recent incidents with their updates. Data comes in
// as props shaped like `status.summary()` (or its JSON).
import { CircleAlert, CircleCheck, CircleX, Wrench } from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Badge } from "../ui/badge.js"
import {
  Timeline,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from "../ui/timeline.js"

// ---------------------------------------------------------------- data model

export type ComponentStatus =
  | "operational"
  | "maintenance"
  | "degraded"
  | "partial_outage"
  | "major_outage"

export type StatusIncidentView = {
  id: string
  title: string
  status: string
  impact: string
  components: readonly string[]
  updates: readonly { at: Date | string; status: string; message: string }[]
  startedAt: Date | string
  resolvedAt: Date | string | null
}

/** signet-db `StatusSummary`, or its JSON from `GET /status`. */
export type StatusSummaryView = {
  status: ComponentStatus
  components: readonly {
    key: string
    name: string
    description?: string | null
    status: ComponentStatus
  }[]
  incidents: readonly StatusIncidentView[]
  maintenance: { on: boolean; message: string | null; until: Date | string | null }
}

// -------------------------------------------------------------------- labels

const timeText = (d: Date) =>
  d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

/** Every string the status page shows, in English. */
export const DEFAULT_STATUS_LABELS = {
  title: "System status",
  overall: {
    operational: "All systems operational",
    maintenance: "Scheduled maintenance in progress",
    degraded: "Some systems are degraded",
    partial_outage: "Partial outage",
    major_outage: "Major outage",
  } as Record<ComponentStatus, string>,
  status: {
    operational: "Operational",
    maintenance: "Maintenance",
    degraded: "Degraded",
    partial_outage: "Partial outage",
    major_outage: "Major outage",
  } as Record<ComponentStatus, string>,
  maintenanceUntil: (until: Date) => `Expected back by ${timeText(until)}.`,
  components: "Components",
  incidents: "Recent incidents",
  noIncidents: "No incidents in the last 7 days.",
  incidentStatus: {
    investigating: "Investigating",
    identified: "Identified",
    monitoring: "Monitoring",
    resolved: "Resolved",
  } as Record<string, string>,
  impact: { minor: "Minor", major: "Major", critical: "Critical" } as Record<string, string>,
  time: timeText,
}

export type StatusLabels = typeof DEFAULT_STATUS_LABELS

const TONE: Record<ComponentStatus, string> = {
  operational: "text-accent-green",
  maintenance: "text-primary",
  degraded: "text-accent-amber",
  partial_outage: "text-accent-amber",
  major_outage: "text-accent-red",
}
const ICON: Record<ComponentStatus, typeof CircleCheck> = {
  operational: CircleCheck,
  maintenance: Wrench,
  degraded: CircleAlert,
  partial_outage: CircleAlert,
  major_outage: CircleX,
}

export type StatusPageProps = Omit<React.ComponentProps<"section">, "children"> & {
  summary: StatusSummaryView
  labels?: Partial<StatusLabels>
}

/** The public status page: overall status, maintenance notice, components and recent incidents. */
export function StatusPage({ summary, labels: labelsProp, className, ...props }: StatusPageProps) {
  const labels = React.useMemo(() => ({ ...DEFAULT_STATUS_LABELS, ...labelsProp }), [labelsProp])
  const headingId = React.useId()
  const Overall = ICON[summary.status]
  const names = new Map(summary.components.map((c) => [c.key, c.name]))
  const m = summary.maintenance
  return (
    <section
      data-slot="status-page"
      data-status={summary.status}
      aria-labelledby={headingId}
      className={cn("mx-auto flex w-full max-w-2xl flex-col gap-6", className)}
      {...props}
    >
      <h1 id={headingId} className="text-xl font-semibold tracking-tight text-text-primary">
        {labels.title}
      </h1>
      <div
        data-slot="status-overall"
        role="status"
        className="flex items-center gap-3 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default"
      >
        <Overall className={cn("size-6 shrink-0", TONE[summary.status])} aria-hidden />
        <p className="text-base font-medium text-text-primary">{labels.overall[summary.status]}</p>
      </div>

      {m.on && (m.message || m.until) && (
        <div
          data-slot="status-maintenance"
          className="flex items-start gap-3 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default"
        >
          <Wrench className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="flex flex-col gap-1 text-sm text-text-secondary">
            {m.message && <p>{m.message}</p>}
            {m.until && <p>{labels.maintenanceUntil(new Date(m.until))}</p>}
          </div>
        </div>
      )}

      {summary.components.length > 0 && (
        <section aria-label={labels.components} className="flex flex-col">
          <h2 className="mb-2 text-xs font-medium text-text-muted">{labels.components}</h2>
          <ul className="divide-y divide-border-default rounded-xl bg-bg-surface ring-1 ring-border-default">
            {summary.components.map((c) => {
              const Icon = ICON[c.status]
              return (
                <li
                  key={c.key}
                  data-slot="status-component"
                  data-status={c.status}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium text-text-primary">{c.name}</span>
                    {c.description && (
                      <span className="text-xs text-text-muted">{c.description}</span>
                    )}
                  </span>
                  <span className={cn("flex items-center gap-1.5 text-sm", TONE[c.status])}>
                    <Icon className="size-4" aria-hidden />
                    {labels.status[c.status]}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section aria-label={labels.incidents} className="flex flex-col gap-3">
        <h2 className="text-xs font-medium text-text-muted">{labels.incidents}</h2>
        {summary.incidents.length === 0 ? (
          <p className="text-sm text-text-muted">{labels.noIncidents}</p>
        ) : (
          summary.incidents.map((inc) => (
            <article
              key={inc.id}
              data-slot="status-incident"
              data-resolved={inc.resolvedAt ? "" : undefined}
              className="flex flex-col gap-3 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default"
            >
              <header className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-text-primary">{inc.title}</h3>
                <Badge variant={inc.resolvedAt ? "secondary" : "destructive"}>
                  {labels.incidentStatus[inc.status] ?? inc.status}
                </Badge>
                <Badge variant="outline">{labels.impact[inc.impact] ?? inc.impact}</Badge>
                {inc.components.map((k) => (
                  <span key={k} className="text-xs text-text-muted">
                    {names.get(k) ?? k}
                  </span>
                ))}
              </header>
              <Timeline aria-label={inc.title}>
                {[...inc.updates].reverse().map((u) => {
                  const at = new Date(u.at)
                  return (
                    <TimelineItem key={`${u.at}-${u.status}`} data-status={u.status}>
                      <TimelineMarker />
                      <TimelineTitle>{labels.incidentStatus[u.status] ?? u.status}</TimelineTitle>
                      <TimelineTime dateTime={at.toISOString()}>{labels.time(at)}</TimelineTime>
                      <TimelineDescription>{u.message}</TimelineDescription>
                    </TimelineItem>
                  )
                })}
              </Timeline>
            </article>
          ))
        )}
      </section>
    </section>
  )
}
