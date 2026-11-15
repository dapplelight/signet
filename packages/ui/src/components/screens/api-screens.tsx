"use client"

// Public API screens: an endpoint reference rendered from an OpenAPI 3.1
// document (signet-server's `openApiSpec`, served at /openapi.json), and the
// webhook delivery log (signet-db's `createWebhooks().deliveries`, through
// signet-server's `webhookRoutes`) with status filter, response details and
// redeliver. Data in as props, actions out as callbacks.
// Recipe: controllable-state + live-region
import { ChevronRight, RotateCcw } from "lucide-react"
import * as React from "react"
import { useControllableState } from "../../behaviors/index.js"
import { cn } from "../../lib/utils.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import { Spinner } from "../ui/spinner.js"

// ---------------------------------------------------------------- data model

type JsonSchema = Record<string, unknown>

export type ApiParameter = {
  name: string
  in: string
  required?: boolean
  description?: string
  schema?: JsonSchema
}

export type ApiOperation = {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  parameters?: ApiParameter[]
  requestBody?: { content?: Record<string, { schema?: JsonSchema }> }
  responses?: Record<
    string,
    { description?: string; $ref?: string; content?: Record<string, { schema?: JsonSchema }> }
  >
  /** `[]` means no auth. */
  security?: Record<string, string[]>[]
}

/** The parts of an OpenAPI 3.1 document the reference reads. */
export type ApiSpec = {
  info: { title: string; version: string; description?: string }
  paths: Record<string, Record<string, ApiOperation>>
  components?: { securitySchemes?: Record<string, Record<string, unknown>> }
}

/** One row of signet-db's webhook delivery log. */
export type WebhookDeliveryEntry = {
  id: string
  endpointId: string
  eventId: string
  type: string
  status: "pending" | "retrying" | "delivered" | "failed" | "skipped" | (string & {})
  attempts: number
  responseStatus?: number | null
  responseBody?: string | null
  error?: string | null
  body?: string
  durationMs?: number | null
  createdAt: string | number | Date
  lastAttemptAt?: string | number | Date | null
}

export type WebhookStatusFilter = "all" | "failed" | "retrying" | "delivered"

/** Every string the API screens show. Spread it and override what you need. */
export const DEFAULT_API_LABELS = {
  reference: "API reference",
  parameters: "Parameters",
  name: "Name",
  in: "In",
  type: "Type",
  required: "Required",
  body: "Request body",
  responses: "Responses",
  errorEnvelope: "Error envelope",
  noAuth: "No authentication",
  deprecated: "Deprecated",
  untagged: "Endpoints",
  authentication: "Authentication",
  deliveries: "Webhook deliveries",
  filter: "Status",
  filters: { all: "All", failed: "Failed", retrying: "Retrying", delivered: "Delivered" } as Record<
    WebhookStatusFilter,
    string
  >,
  event: "Event",
  endpoint: "Endpoint",
  status: "Status",
  attempts: "Attempts",
  response: "Response",
  when: "When",
  details: (type: string) => `Details for ${type}`,
  redeliver: "Redeliver",
  redeliverLabel: (type: string, id: string) => `Redeliver ${type} ${id}`,
  redelivered: "Redelivery queued",
  sentBody: "Sent body",
  responseBody: "Response body",
  error: "Error",
  loadMore: "Load more",
  empty: "No deliveries yet",
  failedAction: "Something went wrong. Try again.",
}

export type ApiLabels = typeof DEFAULT_API_LABELS

const METHOD_TONE: Record<string, string> = {
  get: "bg-accent-blue-subtle text-text-primary",
  post: "bg-accent-green-subtle text-text-primary",
  put: "bg-accent-amber-subtle text-text-primary",
  patch: "bg-accent-amber-subtle text-text-primary",
  delete: "bg-accent-red-subtle text-text-primary",
}

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      data-slot="api-method"
      data-method={method}
      className={cn(
        "inline-flex min-w-14 justify-center rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold uppercase",
        METHOD_TONE[method] ?? "bg-bg-elevated text-text-primary",
      )}
    >
      {method}
    </span>
  )
}

function SchemaBlock({ schema }: { schema: unknown }) {
  return (
    <pre
      data-slot="api-schema"
      className="max-h-80 overflow-auto rounded-md border border-border-subtle bg-bg-base p-2 font-mono text-xs text-text-secondary"
    >
      {typeof schema === "string" ? schema : JSON.stringify(schema, null, 2)}
    </pre>
  )
}

const typeOf = (s?: JsonSchema): string =>
  !s
    ? ""
    : s.type === "array"
      ? `${typeOf(s.items as JsonSchema) || "any"}[]`
      : Array.isArray(s.enum)
        ? s.enum.map(String).join(" | ")
        : String(s.type ?? (s.const !== undefined ? JSON.stringify(s.const) : ""))

// ---------------------------------------------------------------- reference

export type ApiReferenceProps = React.ComponentProps<"section"> & {
  spec: ApiSpec
  labels?: Partial<ApiLabels>
  /** Operations whose `operationId` is here start open. */
  defaultOpen?: string[]
}

/** The endpoint reference: operations grouped by tag, each with parameters, body and responses. */
export function ApiReference({
  spec,
  labels: l,
  defaultOpen = [],
  className,
  ...props
}: ApiReferenceProps) {
  const labels = { ...DEFAULT_API_LABELS, ...l }
  const headingId = React.useId()
  const groups = new Map<string, { path: string; method: string; op: ApiOperation }[]>()
  for (const [path, methods] of Object.entries(spec.paths))
    for (const [method, op] of Object.entries(methods)) {
      const tag = op.tags?.[0] ?? labels.untagged
      groups.set(tag, [...(groups.get(tag) ?? []), { path, method, op }])
    }
  const schemes = Object.entries(spec.components?.securitySchemes ?? {})
  return (
    <section
      data-slot="api-reference"
      aria-labelledby={headingId}
      className={cn("flex flex-col gap-6 text-text-primary", className)}
      {...props}
    >
      <header className="flex flex-col gap-1">
        <h2 id={headingId} className="text-xl font-semibold">
          {spec.info.title}{" "}
          <span className="text-sm font-normal text-text-muted">{spec.info.version}</span>
        </h2>
        {spec.info.description ? (
          <p className="text-sm text-text-secondary">{spec.info.description}</p>
        ) : null}
      </header>
      {schemes.length ? (
        <div data-slot="api-auth" className="flex flex-col gap-1 text-sm">
          <h3 className="font-medium">{labels.authentication}</h3>
          <ul className="flex flex-col gap-0.5 text-text-secondary">
            {schemes.map(([k, s]) => (
              <li key={k}>
                <code className="font-mono">{k}</code>:{" "}
                {s.in === "cookie"
                  ? `cookie ${String(s.name)}`
                  : String(s.description ?? `${s.type} ${s.scheme ?? ""}`)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {[...groups].map(([tag, ops]) => (
        <div key={tag} data-slot="api-group" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-muted">{tag}</h3>
          {ops.map(({ path, method, op }) => (
            <details
              key={`${method} ${path}`}
              data-slot="api-operation"
              data-method={method}
              data-deprecated={op.deprecated ? "" : undefined}
              open={op.operationId ? defaultOpen.includes(op.operationId) : undefined}
              className="group rounded-lg border border-border-default bg-bg-surface"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 p-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="size-4 shrink-0 text-text-muted transition-transform group-open:rotate-90"
                  aria-hidden
                />
                <MethodBadge method={method} />
                <code className={cn("font-mono text-sm", op.deprecated && "line-through")}>
                  {path}
                </code>
                {op.summary ? (
                  <span className="truncate text-sm text-text-secondary">{op.summary}</span>
                ) : null}
                {op.deprecated ? <Badge variant="outline">{labels.deprecated}</Badge> : null}
              </summary>
              <div className="flex flex-col gap-4 border-t border-border-subtle p-3 text-sm">
                {op.description ? <p className="text-text-secondary">{op.description}</p> : null}
                {op.security && op.security.length === 0 ? (
                  <p className="text-text-muted">{labels.noAuth}</p>
                ) : null}
                {op.parameters?.length ? (
                  <div className="flex flex-col gap-1">
                    <h4 className="font-medium">{labels.parameters}</h4>
                    <table data-slot="api-parameters" className="w-full text-left">
                      <thead className="text-xs text-text-muted">
                        <tr>
                          <th className="py-1 font-medium">{labels.name}</th>
                          <th className="py-1 font-medium">{labels.in}</th>
                          <th className="py-1 font-medium">{labels.type}</th>
                          <th className="py-1 font-medium">{labels.required}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {op.parameters.map((p) => (
                          <tr
                            key={`${p.in}:${p.name}`}
                            className="border-t border-border-subtle align-top"
                          >
                            <td className="py-1">
                              <code className="font-mono">{p.name}</code>
                              {p.description ? (
                                <div className="text-xs text-text-muted">{p.description}</div>
                              ) : null}
                            </td>
                            <td className="py-1 text-text-secondary">{p.in}</td>
                            <td className="py-1 font-mono text-text-secondary">
                              {typeOf(p.schema)}
                            </td>
                            <td className="py-1">{p.required ? "✓" : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {Object.entries(op.requestBody?.content ?? {}).map(([type, c]) => (
                  <div key={type} className="flex flex-col gap-1">
                    <h4 className="font-medium">
                      {labels.body} <span className="font-normal text-text-muted">{type}</span>
                    </h4>
                    <SchemaBlock schema={c.schema} />
                  </div>
                ))}
                <div className="flex flex-col gap-1">
                  <h4 className="font-medium">{labels.responses}</h4>
                  <ul data-slot="api-responses" className="flex flex-col gap-2">
                    {Object.entries(op.responses ?? {}).map(([status, r]) => (
                      <li key={status} data-status={status} className="flex flex-col gap-1">
                        <span>
                          <code className="font-mono font-semibold">{status}</code>{" "}
                          <span className="text-text-secondary">
                            {r.$ref ? labels.errorEnvelope : r.description}
                          </span>
                        </span>
                        {r.content?.["application/json"]?.schema ? (
                          <SchemaBlock schema={r.content["application/json"].schema} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </details>
          ))}
        </div>
      ))}
    </section>
  )
}

// ---------------------------------------------------------------- delivery log

const toDate = (w: string | number | Date) => (w instanceof Date ? w : new Date(w))

function statusVariant(s: string) {
  if (s === "failed") return "destructive" as const
  if (s === "delivered") return "secondary" as const
  if (s === "retrying") return "default" as const
  return "outline" as const
}

export type WebhookDeliveryLogProps = Omit<React.ComponentProps<"section">, "children"> & {
  deliveries: WebhookDeliveryEntry[]
  /** Endpoint id → url, to show where each went. */
  endpoints?: Record<string, string>
  /** Controlled filter; leave out for uncontrolled. Changing it calls `onStatusChange`, e.g. to refetch with `?status=`. */
  status?: WebhookStatusFilter
  defaultStatus?: WebhookStatusFilter
  onStatusChange?: (status: WebhookStatusFilter) => void
  /** Shown on failed, retrying and skipped deliveries. */
  onRedeliver?: (delivery: WebhookDeliveryEntry) => unknown | Promise<unknown>
  onLoadMore?: () => void
  hasMore?: boolean
  labels?: Partial<ApiLabels>
  /** Format a timestamp. Default: the browser's locale. */
  formatTime?: (d: Date) => string
}

/** The webhook delivery log: one row per delivery, its attempts and last response, with redeliver. */
export function WebhookDeliveryLog({
  deliveries,
  endpoints = {},
  status: statusProp,
  defaultStatus = "all",
  onStatusChange,
  onRedeliver,
  onLoadMore,
  hasMore,
  labels: l,
  formatTime = (d) => d.toLocaleString(),
  className,
  ...props
}: WebhookDeliveryLogProps) {
  const labels = { ...DEFAULT_API_LABELS, ...l }
  const headingId = React.useId()
  const [status, setStatus] = useControllableState<WebhookStatusFilter>({
    value: statusProp,
    defaultValue: defaultStatus,
    onChange: onStatusChange,
  })
  const [busy, setBusy] = React.useState<string | null>(null)
  const [announce, setAnnounce] = React.useState("")
  const [open, setOpen] = React.useState<string | null>(null)
  const rows = status === "all" ? deliveries : deliveries.filter((d) => d.status === status)

  const redeliver = async (d: WebhookDeliveryEntry) => {
    if (!onRedeliver) return
    setBusy(d.id)
    setAnnounce("")
    try {
      await onRedeliver(d)
      setAnnounce(labels.redelivered)
    } catch {
      setAnnounce(labels.failedAction)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      data-slot="webhook-deliveries"
      data-status={status}
      aria-labelledby={headingId}
      className={cn("flex flex-col gap-3 text-text-primary", className)}
      {...props}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {labels.deliveries}
        </h2>
        <fieldset className="flex gap-1" data-slot="webhook-status-filter">
          <legend className="sr-only">{labels.filter}</legend>
          {(Object.keys(labels.filters) as WebhookStatusFilter[]).map((f) => (
            <Button
              key={f}
              size="xs"
              variant={status === f ? "secondary" : "ghost"}
              aria-pressed={status === f}
              onClick={() => setStatus(f)}
            >
              {labels.filters[f]}
            </Button>
          ))}
        </fieldset>
      </div>
      <span role="status" className="sr-only">
        {announce}
      </span>
      {rows.length === 0 ? (
        <p
          data-slot="webhook-deliveries-empty"
          className="py-8 text-center text-sm text-text-muted"
        >
          {labels.empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-elevated text-xs text-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{labels.event}</th>
                <th className="px-3 py-2 font-medium">{labels.endpoint}</th>
                <th className="px-3 py-2 font-medium">{labels.status}</th>
                <th className="px-3 py-2 text-right font-medium">{labels.attempts}</th>
                <th className="px-3 py-2 font-medium">{labels.response}</th>
                <th className="px-3 py-2 font-medium">{labels.when}</th>
                <th className="px-3 py-2">
                  <span className="sr-only">{labels.redeliver}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <React.Fragment key={d.id}>
                  <tr
                    data-slot="webhook-delivery"
                    data-status={d.status}
                    className="border-t border-border-subtle align-top"
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        aria-expanded={open === d.id}
                        aria-label={labels.details(d.type)}
                        onClick={() => setOpen(open === d.id ? null : d.id)}
                        className="flex items-center gap-1 rounded text-left font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 text-text-muted transition-transform",
                            open === d.id && "rotate-90",
                          )}
                          aria-hidden
                        />
                        {d.type}
                      </button>
                      <div className="font-mono text-xs text-text-muted">{d.eventId}</div>
                    </td>
                    <td
                      className="max-w-56 truncate px-3 py-2 text-text-secondary"
                      title={endpoints[d.endpointId]}
                    >
                      {endpoints[d.endpointId] ?? d.endpointId}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.attempts}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {d.responseStatus ??
                        (d.error ? <span className="text-accent-red">{d.error}</span> : "—")}
                      {d.durationMs != null ? (
                        <span className="text-text-muted"> · {d.durationMs} ms</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-text-muted">
                      {formatTime(toDate(d.lastAttemptAt ?? d.createdAt))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {onRedeliver && d.status !== "delivered" && d.status !== "pending" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          aria-label={labels.redeliverLabel(d.type, d.id)}
                          disabled={busy === d.id}
                          onClick={() => redeliver(d)}
                        >
                          {busy === d.id ? <Spinner /> : <RotateCcw aria-hidden />}
                          {labels.redeliver}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                  {open === d.id ? (
                    <tr data-slot="webhook-delivery-details" className="bg-bg-base">
                      <td colSpan={7} className="px-3 py-2">
                        <div className="flex flex-col gap-2">
                          {d.error ? (
                            <p className="text-accent-red">
                              {labels.error}: {d.error}
                            </p>
                          ) : null}
                          {d.responseBody ? (
                            <div className="flex flex-col gap-1">
                              <h3 className="text-xs font-medium text-text-muted">
                                {labels.responseBody}
                              </h3>
                              <SchemaBlock schema={d.responseBody} />
                            </div>
                          ) : null}
                          {d.body ? (
                            <div className="flex flex-col gap-1">
                              <h3 className="text-xs font-medium text-text-muted">
                                {labels.sentBody}
                              </h3>
                              <SchemaBlock schema={safeJson(d.body)} />
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && onLoadMore ? (
        <Button variant="outline" className="self-center" onClick={onLoadMore}>
          {labels.loadMore}
        </Button>
      ) : null}
    </section>
  )
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
