"use client"

// The public status page, on signet-db's createStatus and signet-server's
// statusRoutes: the overall status, a maintenance notice, every component
// with its status, and recent incidents with their updates. Data comes in
// as props shaped like `status.summary()` (or its JSON). `StatusAdmin` is
// the admin side over statusAdminRoutes: the maintenance switch with message
// and until, component statuses, and incidents opened, updated and resolved
// (updates are append-only); actions go out as callbacks.
// Recipe: live-region + field-wiring + roving-focus (timeline)
import { CircleAlert, CircleCheck, CircleX, Wrench } from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import { Input } from "../ui/input.js"
import { Switch } from "../ui/switch.js"
import { Textarea } from "../ui/textarea.js"
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

// ------------------------------------------------------------------- admin

const COMPONENT_STATUSES: readonly ComponentStatus[] = [
  "operational",
  "maintenance",
  "degraded",
  "partial_outage",
  "major_outage",
]
const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const
const IMPACTS = ["minor", "major", "critical"] as const

/** Every string the status admin shows, in English, on top of the status page's. */
export const DEFAULT_STATUS_ADMIN_LABELS = {
  ...DEFAULT_STATUS_LABELS,
  adminTitle: "Status and maintenance",
  maintenance: "Maintenance mode",
  maintenanceHint:
    "While on, API routes answer 503 with this message; admins and health checks pass.",
  maintenanceMessage: "Message",
  untilField: "Until",
  componentStatus: (name: string) => `${name} status`,
  noComponents: "No components yet.",
  newIncident: "Open an incident",
  incidentTitle: "Title",
  incidentImpact: "Impact",
  incidentStatusField: "Status",
  incidentComponents: "Affected components",
  incidentMessage: "Message",
  open: "Open incident",
  openIncidents: "Open incidents",
  postUpdate: "Post update",
  updateStatus: (title: string) => `New status for ${title}`,
  updateMessage: (title: string) => `Update for ${title}`,
  resolve: "Resolve",
  resolvedNote: "Resolved incidents cannot change.",
  save: "Save",
  saved: "Saved.",
  working: "Saving…",
  failed: "Could not save. Try again.",
}

export type StatusAdminLabels = typeof DEFAULT_STATUS_ADMIN_LABELS

function useAdminLabels(labels?: Partial<StatusAdminLabels>): StatusAdminLabels {
  return React.useMemo(() => ({ ...DEFAULT_STATUS_ADMIN_LABELS, ...labels }), [labels])
}

function useAction() {
  const [phase, setPhase] = React.useState<"idle" | "pending" | "done" | "failed">("idle")
  const run = async (fn: () => unknown) => {
    setPhase("pending")
    try {
      const r = await fn()
      setPhase(r === false ? "failed" : "done")
      return r !== false
    } catch {
      setPhase("failed")
      return false
    }
  }
  return [phase, run] as const
}

function Live({ phase, labels }: { phase: string; labels: StatusAdminLabels }) {
  return (
    <p role="status" className="text-sm text-text-secondary empty:hidden">
      {phase === "pending"
        ? labels.working
        : phase === "failed"
          ? labels.failed
          : phase === "done"
            ? labels.saved
            : ""}
    </p>
  )
}

const card = "flex flex-col gap-3 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default"
const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50 dark:bg-input/30"
const fieldLabel = "flex flex-col gap-1 text-xs text-text-muted"

/** A Date or ISO string as a datetime-local value in the viewer's time zone. */
const localInput = (d: Date | string | null | undefined) => {
  if (!d) return ""
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return ""
  return new Date(t.getTime() - t.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** What `MaintenanceForm` sends: the body of `PUT /maintenance`. */
export type MaintenanceInput = { on: boolean; message: string | null; until: string | null }

export type MaintenanceFormProps = Omit<React.ComponentProps<"form">, "onSubmit" | "children"> & {
  maintenance: StatusSummaryView["maintenance"]
  onSave: (input: MaintenanceInput) => unknown
  labels?: Partial<StatusAdminLabels>
}

/** The maintenance switch with its message and expected end. Saves on submit. */
export function MaintenanceForm({
  maintenance,
  onSave,
  labels: labelsProp,
  className,
  ...props
}: MaintenanceFormProps) {
  const labels = useAdminLabels(labelsProp)
  const id = React.useId()
  const [on, setOn] = React.useState(maintenance.on)
  const [message, setMessage] = React.useState(maintenance.message ?? "")
  const [until, setUntil] = React.useState(localInput(maintenance.until))
  const [phase, run] = useAction()
  return (
    <form
      data-slot="maintenance-form"
      data-on={on ? "" : undefined}
      aria-labelledby={`${id}h`}
      className={cn(card, className)}
      onSubmit={(e) => {
        e.preventDefault()
        run(() =>
          onSave({
            on,
            message: message.trim() || null,
            until: until ? new Date(until).toISOString() : null,
          }),
        )
      }}
      {...props}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id={`${id}h`} className="text-sm font-semibold text-text-primary">
            {labels.maintenance}
          </h2>
          <p id={`${id}d`} className="text-xs text-text-muted">
            {labels.maintenanceHint}
          </p>
        </div>
        <Switch
          checked={on}
          onCheckedChange={setOn}
          aria-labelledby={`${id}h`}
          aria-describedby={`${id}d`}
        />
      </div>
      <label htmlFor={`${id}m-msg`} className={fieldLabel}>
        {labels.maintenanceMessage}
        <Input
          id={`${id}m-msg`}
          value={message}
          maxLength={500}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      <label htmlFor={`${id}m-until`} className={fieldLabel}>
        {labels.untilField}
        <Input
          id={`${id}m-until`}
          type="datetime-local"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
        />
      </label>
      <Button type="submit" size="sm" className="self-start" disabled={phase === "pending"}>
        {labels.save}
      </Button>
      <Live phase={phase} labels={labels} />
    </form>
  )
}

export type ComponentStatusListProps = Omit<React.ComponentProps<"section">, "children"> & {
  components: StatusSummaryView["components"]
  /** `PUT /components/:key` with `{ status }`. */
  onStatus: (key: string, status: ComponentStatus) => unknown
  labels?: Partial<StatusAdminLabels>
}

/** Every component with a status picker; a change saves at once. */
export function ComponentStatusList({
  components,
  onStatus,
  labels: labelsProp,
  className,
  ...props
}: ComponentStatusListProps) {
  const labels = useAdminLabels(labelsProp)
  const [phase, run] = useAction()
  return (
    <section
      data-slot="component-status-list"
      aria-label={labels.components}
      className={cn(card, className)}
      {...props}
    >
      <h2 className="text-sm font-semibold text-text-primary">{labels.components}</h2>
      {components.length === 0 ? (
        <p className="text-sm text-text-muted">{labels.noComponents}</p>
      ) : (
        <ul className="divide-y divide-border-default">
          {components.map((c) => (
            <li
              key={c.key}
              data-slot="status-component"
              data-status={c.status}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="text-sm text-text-primary">{c.name}</span>
              <select
                aria-label={labels.componentStatus(c.name)}
                className={cn(selectClass, "w-44", TONE[c.status])}
                value={c.status}
                disabled={phase === "pending"}
                onChange={(e) => run(() => onStatus(c.key, e.target.value as ComponentStatus))}
              >
                {COMPONENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {labels.status[s]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
      <Live phase={phase} labels={labels} />
    </section>
  )
}

/** What `IncidentForm` sends: the body of `POST /incidents`. */
export type IncidentInput = {
  title: string
  impact: (typeof IMPACTS)[number]
  status: Exclude<(typeof INCIDENT_STATUSES)[number], "resolved">
  components: string[]
  message: string
}

export type IncidentFormProps = Omit<React.ComponentProps<"form">, "onSubmit" | "children"> & {
  components: StatusSummaryView["components"]
  onOpen: (input: IncidentInput) => unknown
  labels?: Partial<StatusAdminLabels>
}

/** Open an incident: title, impact, status, affected components and the first update. */
export function IncidentForm({
  components,
  onOpen,
  labels: labelsProp,
  className,
  ...props
}: IncidentFormProps) {
  const labels = useAdminLabels(labelsProp)
  const id = React.useId()
  const [title, setTitle] = React.useState("")
  const [impact, setImpact] = React.useState<IncidentInput["impact"]>("minor")
  const [status, setStatus] = React.useState<IncidentInput["status"]>("investigating")
  const [picked, setPicked] = React.useState<string[]>([])
  const [message, setMessage] = React.useState("")
  const [phase, run] = useAction()
  const valid = !!title.trim() && !!message.trim()
  return (
    <form
      data-slot="incident-form"
      aria-labelledby={`${id}h`}
      className={cn(card, className)}
      onSubmit={async (e) => {
        e.preventDefault()
        if (!valid) return
        const ok = await run(() =>
          onOpen({
            title: title.trim(),
            impact,
            status,
            components: picked,
            message: message.trim(),
          }),
        )
        if (ok) {
          setTitle("")
          setMessage("")
          setPicked([])
        }
      }}
      {...props}
    >
      <h2 id={`${id}h`} className="text-sm font-semibold text-text-primary">
        {labels.newIncident}
      </h2>
      <label htmlFor={`${id}i-title`} className={fieldLabel}>
        {labels.incidentTitle}
        <Input
          id={`${id}i-title`}
          value={title}
          maxLength={200}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={fieldLabel}>
          {labels.incidentImpact}
          <select
            className={selectClass}
            value={impact}
            onChange={(e) => setImpact(e.target.value as IncidentInput["impact"])}
          >
            {IMPACTS.map((i) => (
              <option key={i} value={i}>
                {labels.impact[i] ?? i}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabel}>
          {labels.incidentStatusField}
          <select
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as IncidentInput["status"])}
          >
            {INCIDENT_STATUSES.filter((s) => s !== "resolved").map((s) => (
              <option key={s} value={s}>
                {labels.incidentStatus[s] ?? s}
              </option>
            ))}
          </select>
        </label>
      </div>
      {components.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs text-text-muted">{labels.incidentComponents}</legend>
          <div className="flex flex-wrap gap-3">
            {components.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5 text-sm text-text-primary">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={picked.includes(c.key)}
                  onChange={(e) =>
                    setPicked((p) =>
                      e.target.checked ? [...p, c.key] : p.filter((k) => k !== c.key),
                    )
                  }
                />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label htmlFor={`${id}i-msg`} className={fieldLabel}>
        {labels.incidentMessage}
        <Textarea
          id={`${id}i-msg`}
          value={message}
          maxLength={5000}
          required
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      <Button
        type="submit"
        size="sm"
        className="self-start"
        disabled={!valid || phase === "pending"}
      >
        {labels.open}
      </Button>
      <Live phase={phase} labels={labels} />
    </form>
  )
}

export type IncidentUpdateFormProps = Omit<
  React.ComponentProps<"form">,
  "onSubmit" | "children"
> & {
  incident: StatusIncidentView
  /** `POST /incidents/:id/updates` with `{ status, message }`; "resolved" closes it. */
  onUpdate: (id: string, input: { status: string; message: string }) => unknown
  labels?: Partial<StatusAdminLabels>
}

/**
 * One incident with its updates (oldest kept, never edited) and a form to
 * append the next one or resolve it. A resolved incident shows no form.
 */
export function IncidentUpdateForm({
  incident,
  onUpdate,
  labels: labelsProp,
  className,
  ...props
}: IncidentUpdateFormProps) {
  const labels = useAdminLabels(labelsProp)
  const [status, setStatus] = React.useState(
    incident.status === "resolved" ? "monitoring" : incident.status,
  )
  const [message, setMessage] = React.useState("")
  const [phase, run] = useAction()
  const resolved = !!incident.resolvedAt
  const send = async (s: string) => {
    if (!message.trim()) return
    if (await run(() => onUpdate(incident.id, { status: s, message: message.trim() })))
      setMessage("")
  }
  return (
    <form
      data-slot="incident-update-form"
      data-resolved={resolved ? "" : undefined}
      aria-label={incident.title}
      className={cn(card, className)}
      onSubmit={(e) => {
        e.preventDefault()
        send(status)
      }}
      {...props}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{incident.title}</h3>
        <Badge variant={resolved ? "secondary" : "destructive"}>
          {labels.incidentStatus[incident.status] ?? incident.status}
        </Badge>
        <Badge variant="outline">{labels.impact[incident.impact] ?? incident.impact}</Badge>
      </header>
      <Timeline aria-label={incident.title}>
        {[...incident.updates].reverse().map((u) => {
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
      {resolved ? (
        <p className="text-xs text-text-muted">{labels.resolvedNote}</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <select
              aria-label={labels.updateStatus(incident.title)}
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {INCIDENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {labels.incidentStatus[s] ?? s}
                </option>
              ))}
            </select>
            <Input
              aria-label={labels.updateMessage(incident.title)}
              value={message}
              maxLength={5000}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!message.trim() || phase === "pending"}>
              {labels.postUpdate}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!message.trim() || phase === "pending"}
              onClick={() => send("resolved")}
            >
              {labels.resolve}
            </Button>
          </div>
        </>
      )}
      <Live phase={phase} labels={labels} />
    </form>
  )
}

export type StatusAdminProps = Omit<React.ComponentProps<"section">, "children"> & {
  /** `status.summary()` or `GET /components`, `/incidents` and `/maintenance` together. */
  summary: Omit<StatusSummaryView, "status">
  onMaintenance: MaintenanceFormProps["onSave"]
  onComponentStatus: ComponentStatusListProps["onStatus"]
  onOpenIncident: IncidentFormProps["onOpen"]
  onUpdateIncident: IncidentUpdateFormProps["onUpdate"]
  labels?: Partial<StatusAdminLabels>
}

/**
 * The admin screen for the status page and maintenance mode: the switch,
 * component statuses, a form to open an incident, and every incident with
 * its append-only updates. Each part is exported for your own layout.
 */
export function StatusAdmin({
  summary,
  onMaintenance,
  onComponentStatus,
  onOpenIncident,
  onUpdateIncident,
  labels: labelsProp,
  className,
  ...props
}: StatusAdminProps) {
  const labels = useAdminLabels(labelsProp)
  const headingId = React.useId()
  return (
    <section
      data-slot="status-admin"
      aria-labelledby={headingId}
      className={cn("flex w-full max-w-3xl flex-col gap-4", className)}
      {...props}
    >
      <h1 id={headingId} className="text-xl font-semibold tracking-tight text-text-primary">
        {labels.adminTitle}
      </h1>
      <MaintenanceForm
        maintenance={summary.maintenance}
        onSave={onMaintenance}
        labels={labelsProp}
      />
      <ComponentStatusList
        components={summary.components}
        onStatus={onComponentStatus}
        labels={labelsProp}
      />
      <IncidentForm components={summary.components} onOpen={onOpenIncident} labels={labelsProp} />
      <section aria-label={labels.incidents} className="flex flex-col gap-3">
        <h2 className="text-xs font-medium text-text-muted">{labels.incidents}</h2>
        {summary.incidents.length === 0 ? (
          <p className="text-sm text-text-muted">{labels.noIncidents}</p>
        ) : (
          summary.incidents.map((inc) => (
            <IncidentUpdateForm
              key={`${inc.id}-${inc.updates.length}`}
              incident={inc}
              onUpdate={onUpdateIncident}
              labels={labelsProp}
            />
          ))
        )}
      </section>
    </section>
  )
}
