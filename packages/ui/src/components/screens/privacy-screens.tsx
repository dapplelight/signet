"use client"

// Privacy screens for India's DPDP Act: a consent list where withdrawing is
// one switch, as easy as giving, and data export / erasure requests with
// their status. Shapes match signet-db's privacy module (`Consent`,
// `DataRequest`); dates may be Date objects or JSON strings. Wire the
// callbacks to your routes through `createRpcClient`. Erasure confirms first.
// Recipe: controllable-state + popup + focus-trap + dismiss + live-region
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { DownloadIcon, FileDownIcon, TrashIcon } from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import { Spinner } from "../ui/spinner.js"
import { Switch } from "../ui/switch.js"

type When = Date | string | number

/** signet-db's `Consent`: one record per purpose and notice version. */
export type ConsentRecord = {
  id?: string
  purpose: string
  noticeVersion?: string
  givenAt: When
  withdrawnAt?: When | null
}

/** signet-db's `DataRequest`. */
export type DataRequestRow = {
  id: string
  kind: "export" | "erasure"
  status: "pending" | "completed" | "rejected"
  requestedAt: When
  dueAt?: When | null
  closedAt?: When | null
  note?: string | null
}

export type ConsentPurpose = {
  id: string
  label: string
  /** One short line: what agreeing allows. */
  description?: string
}

/** Every string the privacy screens show. Spread it and override what you need. */
export const DEFAULT_PRIVACY_LABELS = {
  consents: "Consents",
  givenOn: (date: string) => `Agreed ${date}`,
  withdrawnOn: (date: string) => `Withdrawn ${date}`,
  notice: (version: string) => `Notice ${version}`,
  toggle: (purpose: string) => purpose,
  noConsents: "Nothing to agree to",
  yourData: "Your data",
  exportData: "Export",
  exportHint: "A copy of everything",
  eraseData: "Delete",
  eraseHint: "Erase your account",
  eraseTitle: "Delete all your data?",
  eraseDescription: "This can't be undone.",
  eraseConfirm: "Delete everything",
  cancel: "Cancel",
  download: "Download",
  kind: { export: "Export", erasure: "Deletion" } as Record<DataRequestRow["kind"], string>,
  status: { pending: "In progress", completed: "Done", rejected: "Declined" } as Record<
    DataRequestRow["status"],
    string
  >,
  requested: (date: string) => `Requested ${date}`,
  due: (date: string) => `due ${date}`,
  error: "Something went wrong. Try again.",
}

export type PrivacyLabels = typeof DEFAULT_PRIVACY_LABELS

const toDate = (w: When) => (w instanceof Date ? w : new Date(w))
const errorText = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback

/** The latest record per purpose: what is in force now. */
function current(consents: readonly ConsentRecord[]): Map<string, ConsentRecord> {
  const out = new Map<string, ConsentRecord>()
  for (const c of consents) {
    const prev = out.get(c.purpose)
    if (!prev || toDate(c.givenAt) > toDate(prev.givenAt)) out.set(c.purpose, c)
  }
  return out
}

/** A titled card. `render` swaps its element (a `<section>` by default). */
function PrivacySection({ className, render, ...props }: useRender.ComponentProps<"section">) {
  return useRender({
    defaultTagName: "section",
    render,
    props: mergeProps<"section">(
      {
        className: cn(
          "flex flex-col gap-3 rounded-xl bg-bg-surface p-4 text-sm text-text-primary ring-1 ring-foreground/10",
          className,
        ),
      },
      props,
    ),
    state: { slot: "privacy-section" },
  })
}

// --- consents ----------------------------------------------------------------

type ConsentListProps = {
  /** Every purpose you ask for, in order. */
  purposes: readonly ConsentPurpose[]
  /** `privacy.list(userId)` or similar: history is fine, the latest per purpose wins. */
  consents: readonly ConsentRecord[]
  /** `privacy.give(userId, purpose, { noticeVersion, source })`. Throwing puts the switch back. */
  onGive?: (purpose: string) => unknown
  /** `privacy.withdraw(userId, purpose)`. No confirm: withdrawing is as easy as giving. */
  onWithdraw?: (purpose: string) => unknown
  /** Date format. Default: the browser's medium date. */
  formatDate?: (date: Date) => string
  labels?: Partial<PrivacyLabels>
  className?: string
  classNames?: Partial<Record<"title" | "list" | "item" | "switch", string>>
}

/** One switch per purpose: on means agreed. Shows when and to which notice. */
function ConsentList({
  purposes,
  consents,
  onGive,
  onWithdraw,
  formatDate = (d) => d.toLocaleDateString(undefined, { dateStyle: "medium" }),
  labels,
  className,
  classNames = {},
}: ConsentListProps) {
  const l = { ...DEFAULT_PRIVACY_LABELS, ...labels }
  const live = current(consents)
  // Optimistic state per purpose while a save is in flight.
  const [optimistic, setOptimistic] = React.useState<Record<string, boolean>>({})
  const [error, setError] = React.useState<string | null>(null)
  const id = React.useId()
  return (
    <PrivacySection aria-labelledby={id} className={className}>
      <h2 id={id} className={cn("text-base leading-none font-medium", classNames.title)}>
        {l.consents}
      </h2>
      {purposes.length ? (
        <ul data-slot="consent-list" className={cn("divide-y divide-border", classNames.list)}>
          {purposes.map((p) => {
            const rec = live.get(p.id)
            const agreed = optimistic[p.id] ?? (!!rec && !rec.withdrawnAt)
            const descId = `${id}-${p.id}`
            return (
              <li
                key={p.id}
                data-slot="consent-item"
                data-state={agreed ? "given" : "withdrawn"}
                className={cn("flex items-center gap-3 py-3 first:pt-0 last:pb-0", classNames.item)}
              >
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-medium">{p.label}</span>
                  <span id={descId} className="text-xs text-text-muted">
                    {[
                      p.description,
                      rec?.withdrawnAt
                        ? l.withdrawnOn(formatDate(toDate(rec.withdrawnAt)))
                        : rec
                          ? l.givenOn(formatDate(toDate(rec.givenAt)))
                          : null,
                      rec?.noticeVersion ? l.notice(rec.noticeVersion) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <Switch
                  checked={agreed}
                  aria-label={l.toggle(p.label)}
                  aria-describedby={descId}
                  disabled={p.id in optimistic || !(agreed ? onWithdraw : onGive)}
                  className={classNames.switch}
                  onCheckedChange={async (on: boolean) => {
                    setError(null)
                    setOptimistic((o) => ({ ...o, [p.id]: on }))
                    try {
                      await (on ? onGive : onWithdraw)?.(p.id)
                    } catch (e) {
                      setError(errorText(e, l.error))
                    } finally {
                      setOptimistic(({ [p.id]: _, ...rest }) => rest)
                    }
                  }}
                />
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="py-4 text-center text-text-muted">{l.noConsents}</p>
      )}
      <p role="alert" className="text-sm text-destructive empty:hidden">
        {error}
      </p>
    </PrivacySection>
  )
}

// --- data requests -----------------------------------------------------------

const STATUS_VARIANT = {
  pending: "outline",
  completed: "secondary",
  rejected: "destructive",
} as const

type DataRequestsProps = {
  requests: readonly DataRequestRow[]
  /** `privacy.requestExport(userId)`. Hidden while an export is pending. */
  onRequestExport?: () => unknown
  /** `privacy.requestErasure(userId)`. Confirms first; hidden while one is pending. */
  onRequestErasure?: () => unknown
  /** Fetch a completed export's file (`api.raw`). */
  onDownload?: (request: DataRequestRow) => unknown
  formatDate?: (date: Date) => string
  labels?: Partial<PrivacyLabels>
  className?: string
  classNames?: Partial<Record<"title" | "actions" | "list" | "item", string>>
}

/** Ask for a copy of your data or its erasure, and follow each request's status. */
function DataRequests({
  requests,
  onRequestExport,
  onRequestErasure,
  onDownload,
  formatDate = (d) => d.toLocaleDateString(undefined, { dateStyle: "medium" }),
  labels,
  className,
  classNames = {},
}: DataRequestsProps) {
  const l = { ...DEFAULT_PRIVACY_LABELS, ...labels }
  const [busy, setBusy] = React.useState<"export" | "erasure" | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const pending = (kind: DataRequestRow["kind"]) =>
    requests.some((r) => r.kind === kind && r.status === "pending")
  const run = async (kind: "export" | "erasure", fn?: () => unknown) => {
    setError(null)
    setBusy(kind)
    try {
      await fn?.()
    } catch (e) {
      setError(errorText(e, l.error))
    } finally {
      setBusy(null)
    }
  }
  const tile =
    "flex h-auto flex-1 flex-col items-start gap-1 rounded-lg p-3 text-left whitespace-normal"
  const id = React.useId()
  const sorted = [...requests].sort(
    (a, b) => toDate(b.requestedAt).getTime() - toDate(a.requestedAt).getTime(),
  )
  return (
    <PrivacySection aria-labelledby={id} className={className}>
      <h2 id={id} className={cn("text-base leading-none font-medium", classNames.title)}>
        {l.yourData}
      </h2>
      <div data-slot="data-request-actions" className={cn("flex gap-2", classNames.actions)}>
        {onRequestExport ? (
          <Button
            variant="outline"
            className={tile}
            disabled={pending("export") || busy !== null}
            onClick={() => run("export", onRequestExport)}
          >
            <span className="flex items-center gap-2 font-medium">
              {busy === "export" ? <Spinner /> : <FileDownIcon aria-hidden />}
              {l.exportData}
            </span>
            <span className="text-xs font-normal text-text-muted">{l.exportHint}</span>
          </Button>
        ) : null}
        {onRequestErasure ? (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  className={cn(tile, "hover:border-destructive/40")}
                  disabled={pending("erasure") || busy !== null}
                />
              }
            >
              <span className="flex items-center gap-2 font-medium text-destructive">
                {busy === "erasure" ? <Spinner /> : <TrashIcon aria-hidden />}
                {l.eraseData}
              </span>
              <span className="text-xs font-normal text-text-muted">{l.eraseHint}</span>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{l.eraseTitle}</AlertDialogTitle>
                <AlertDialogDescription>{l.eraseDescription}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{l.cancel}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  action={() => run("erasure", onRequestErasure)}
                >
                  {l.eraseConfirm}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
      {sorted.length ? (
        <ul data-slot="data-request-list" className={cn("divide-y divide-border", classNames.list)}>
          {sorted.map((r) => (
            <li
              key={r.id}
              data-slot="data-request-item"
              data-kind={r.kind}
              data-status={r.status}
              className={cn("flex items-center gap-3 py-3 last:pb-0", classNames.item)}
            >
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium">{l.kind[r.kind]}</span>
                <span className="text-xs text-text-muted">
                  {[
                    l.requested(formatDate(toDate(r.requestedAt))),
                    r.status === "pending" && r.dueAt ? l.due(formatDate(toDate(r.dueAt))) : null,
                    r.status === "rejected" ? r.note : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {onDownload && r.kind === "export" && r.status === "completed" ? (
                <Button variant="ghost" size="sm" onClick={() => onDownload(r)}>
                  <DownloadIcon aria-hidden />
                  {l.download}
                </Button>
              ) : (
                <Badge variant={STATUS_VARIANT[r.status]}>{l.status[r.status]}</Badge>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <p role="alert" className="text-sm text-destructive empty:hidden">
        {error}
      </p>
    </PrivacySection>
  )
}

export type { ConsentListProps, DataRequestsProps }
export { ConsentList, DataRequests, PrivacySection }
