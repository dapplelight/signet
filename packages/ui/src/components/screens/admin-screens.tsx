"use client"

// An admin panel generated from signet-db's `defineAdmin` metadata, served by
// signet-server's `adminRoutes`: a table list, a server-driven table (sort,
// filters, search, cursor pages, soft-deleted rows), a record panel with a
// form built from the column types, create, bulk delete, row actions and the
// audit trail. `AdminScreen` is the whole thing; every part is exported for
// an app that lays it out differently, and `useAdmin()` reads the state.
// Recipe: selection + controllable-state + popup + focus-trap + dismiss + roving-focus (tabs) + field-wiring
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  History,
  ListFilter,
  MoreHorizontal,
  Plus,
  RotateCw,
  Search,
  Trash2,
  X,
} from "lucide-react"
import * as React from "react"
import { useControllableState } from "../../behaviors/index.js"
import { cn } from "../../lib/utils.js"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import { Checkbox } from "../ui/checkbox.js"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js"
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from "../ui/field.js"
import { Input } from "../ui/input.js"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js"
import { Skeleton } from "../ui/skeleton.js"
import { Switch } from "../ui/switch.js"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.js"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js"
import { Textarea } from "../ui/textarea.js"

// ---------------------------------------------------------------- data model
// Structural copies of signet-db's admin metadata, so signet-ui does not
// depend on signet-db. `GET <mount>/` returns `AdminMeta` as it is.

export type AdminFilterOp =
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "contains"
  | "startsWith"
  | "isNull"

export type AdminColumn = {
  name: string
  key: string
  type: string
  notNull: boolean
  primaryKey: boolean
  unique: boolean
  hasDefault: boolean
  enum?: string[]
  moneyCurrency?: string
  readonly: boolean
  list: boolean
  sortable: boolean
  filterable: boolean
  searchable: boolean
  operators: AdminFilterOp[]
}

export type AdminOp = "list" | "get" | "create" | "update" | "delete" | "action"

export type AdminTableMeta = {
  name: string
  primaryKey: string[]
  softDelete: boolean
  ops: AdminOp[]
  actions: { name: string; description: string; destructive: boolean }[]
  columns: AdminColumn[]
  relations: { columns: string[]; references: string; referencedColumns: string[] }[]
  defaultSort: { sort: string; order: "asc" | "desc" }
}

export type AdminMeta = { tables: AdminTableMeta[] }
export type AdminRow = Record<string, unknown>
export type AdminFilter = Record<string, Partial<Record<AdminFilterOp, unknown>>>

export type AdminListQuery = {
  limit?: number
  cursor?: string
  sort?: string
  order?: "asc" | "desc"
  filter?: AdminFilter
  q?: string
  withDeleted?: boolean
}

export type AdminListResult = { rows: AdminRow[]; nextCursor: string | null }

/** What the panel calls. `createAdminApi` implements it over HTTP; a test or a custom transport can too. */
export interface AdminApi {
  meta(): Promise<AdminMeta>
  list(table: string, query: AdminListQuery): Promise<AdminListResult>
  get(table: string, id: string, options?: { withDeleted?: boolean }): Promise<AdminRow>
  create(table: string, values: AdminRow): Promise<AdminRow>
  update(table: string, id: string, values: AdminRow): Promise<AdminRow>
  remove(table: string, id: string): Promise<{ id: unknown; soft: boolean }>
  bulkDelete(table: string, ids: string[]): Promise<{ ids: unknown[]; soft: boolean }>
  action(table: string, id: string, name: string, input?: AdminRow): Promise<unknown>
}

/** A failed admin call, from the Signet error envelope. `fieldErrors` maps a column key to its messages. */
export class AdminApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly fieldErrors: Record<string, string[]>
  constructor(
    status: number,
    message: string,
    code?: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message)
    this.name = "AdminApiError"
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors ?? {}
  }
}

export type AdminApiOptions = {
  /** Where `adminRoutes` is mounted, e.g. "/admin" or "https://api.example.com/admin". Default "/admin". */
  baseUrl?: string
  /** Default `globalThis.fetch`. Pass your own to add auth or reuse a configured client's fetch. */
  fetch?: typeof fetch
  /** Extra headers per request, e.g. a bearer token. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>
}

/**
 * The `AdminApi` for signet-server's `adminRoutes`, over fetch. Cookies are
 * sent (`credentials: "include"`); errors become `AdminApiError`.
 */
export function createAdminApi(options: AdminApiOptions = {}): AdminApi {
  const base = (options.baseUrl ?? "/admin").replace(/\/$/, "")
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a))
  const enc = encodeURIComponent
  const call = async <T,>(
    method: string,
    path: string,
    init: { query?: Record<string, string | undefined>; body?: unknown } = {},
  ): Promise<T> => {
    const qs = new URLSearchParams(
      Object.entries(init.query ?? {}).filter((e): e is [string, string] => e[1] !== undefined),
    ).toString()
    const headers: Record<string, string> = { accept: "application/json" }
    if (init.body !== undefined) headers["content-type"] = "application/json"
    Object.assign(headers, (await options.headers?.()) ?? {})
    const res = await doFetch(`${base}${path}${qs ? `?${qs}` : ""}`, {
      method,
      credentials: "include",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      const details = data?.details as { fieldErrors?: Record<string, string[]> } | undefined
      throw new AdminApiError(
        res.status,
        typeof data?.error === "string" ? data.error : res.statusText,
        typeof data?.code === "string" ? data.code : undefined,
        details?.fieldErrors,
      )
    }
    return data as T
  }
  return {
    meta: () => call("GET", ""),
    list: (table, q) =>
      call("GET", `/${enc(table)}`, {
        query: {
          limit: q.limit?.toString(),
          cursor: q.cursor,
          sort: q.sort,
          order: q.order,
          q: q.q || undefined,
          filter: q.filter && Object.keys(q.filter).length ? JSON.stringify(q.filter) : undefined,
          withDeleted: q.withDeleted ? "true" : undefined,
        },
      }),
    get: (table, id, o) =>
      call("GET", `/${enc(table)}/${enc(id)}`, {
        query: { withDeleted: o?.withDeleted ? "true" : undefined },
      }),
    create: (table, values) => call("POST", `/${enc(table)}`, { body: values }),
    update: (table, id, values) => call("PATCH", `/${enc(table)}/${enc(id)}`, { body: values }),
    remove: (table, id) => call("DELETE", `/${enc(table)}/${enc(id)}`),
    bulkDelete: (table, ids) => call("POST", `/${enc(table)}/bulk-delete`, { body: { ids } }),
    action: (table, id, name, input) =>
      call("POST", `/${enc(table)}/${enc(id)}/${enc(name)}`, { body: input ?? {} }),
  }
}

// -------------------------------------------------------------------- labels

/** Every string the panel shows, in English. Spread and override for another language. */
export const DEFAULT_ADMIN_LABELS = {
  title: "Admin",
  tables: "Tables",
  tableName: (table: string) => humanize(table),
  columnName: (column: AdminColumn) => humanize(column.key),
  search: "Search",
  searchPlaceholder: "Search…",
  filter: "Filter",
  addFilter: "Add filter",
  removeFilter: (label: string) => `Remove filter ${label}`,
  filterColumn: "Column",
  filterOperator: "Condition",
  filterValue: "Value",
  operators: {
    eq: "is",
    ne: "is not",
    lt: "<",
    lte: "≤",
    gt: ">",
    gte: "≥",
    in: "is any of",
    contains: "contains",
    startsWith: "starts with",
    isNull: "is empty",
  } satisfies Record<AdminFilterOp, string>,
  showDeleted: "Deleted",
  deleted: "Deleted",
  create: "New",
  createTitle: (table: string) => `New ${humanize(table, true)}`,
  refresh: "Refresh",
  selectAll: "Select all rows",
  selectRow: (id: string) => `Select row ${id}`,
  selected: (n: number) => `${n} selected`,
  clearSelection: "Clear",
  bulkDelete: "Delete",
  bulkDeleteTitle: (n: number) => `Delete ${n} ${n === 1 ? "row" : "rows"}?`,
  bulkDeleteBody: (soft: boolean) =>
    soft ? "They can be restored from the deleted view." : "This cannot be undone.",
  sortBy: (column: string) => `Sort by ${column}`,
  rowActions: "Row actions",
  open: "Open",
  delete: "Delete",
  deleteTitle: "Delete this row?",
  deleteBody: (soft: boolean) =>
    soft ? "It moves to the deleted view." : "It is removed for good. This cannot be undone.",
  cancel: "Cancel",
  confirm: "Confirm",
  actionTitle: (name: string) => `${humanize(name)}?`,
  previous: "Previous page",
  next: "Next page",
  page: (n: number) => `Page ${n}`,
  empty: "Nothing here yet",
  emptyFiltered: "No rows match",
  clearFilters: "Clear filters",
  error: "Couldn't load",
  retry: "Try again",
  details: "Details",
  history: "History",
  save: "Save",
  saving: "Saving…",
  close: "Close",
  noHistory: "No changes recorded",
  historyAction: {
    insert: "Created",
    update: "Updated",
    delete: "Deleted",
    delete_user: "Erased",
  } as Record<string, string>,
  by: (actor: string) => `by ${actor}`,
  yes: "Yes",
  no: "No",
  none: "—",
  optional: "Optional",
  noTables: "No tables you can open",
}

export type AdminLabels = typeof DEFAULT_ADMIN_LABELS

// -------------------------------------------------------------------- helpers

/** "createdAt" / "user_profiles" -> "Created at" / "User profiles". */
function humanize(key: string, lower = false): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
  return lower ? words : words.charAt(0).toUpperCase() + words.slice(1)
}

type FieldKind = "enum" | "boolean" | "number" | "money" | "datetime" | "json" | "longtext" | "text"

const DATE_KEY = /(At|_at|Date|_date|^at|^date)$/
const NUM_TYPE = /int|real|numeric|decimal|double|float|serial/i

/** The input a column gets. SQL types alone are ambiguous on SQLite, so the key and the value help. */
function kindOf(col: AdminColumn, value?: unknown): FieldKind {
  if (col.enum?.length) return "enum"
  if (col.moneyCurrency) return "money"
  if (/bool/i.test(col.type) || typeof value === "boolean") return "boolean"
  if (/timestamp|date|time/i.test(col.type) || DATE_KEY.test(col.key)) return "datetime"
  if (/json/i.test(col.type) || (value !== null && typeof value === "object")) return "json"
  if (NUM_TYPE.test(col.type)) return "number"
  if (/description|body|message|notes?|content|bio|summary/i.test(col.key)) return "longtext"
  return "text"
}

const fractionDigits = (currency: string) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits as number
  } catch {
    return 2
  }
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v
  if (typeof v === "number" && v > 1e11) return new Date(v)
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

const idOf = (meta: AdminTableMeta, row: AdminRow) => String(row[meta.primaryKey[0] ?? "id"] ?? "")

/** The audit table, if the metadata has one (signet-db's `auditLog()` shape). */
const auditTableOf = (meta: AdminMeta | null) =>
  meta?.tables.find((t) =>
    ["actorType", "actorId", "action", "tableName", "rowId"].every((k) =>
      t.columns.some((c) => c.key === k),
    ),
  )

/** Renders one cell value for display. */
function CellValue({
  value,
  column,
  row,
  labels,
}: {
  value: unknown
  column: AdminColumn
  row: AdminRow
  labels: AdminLabels
}) {
  if (value === null || value === undefined || value === "")
    return <span className="text-text-hint">{labels.none}</span>
  const kind = kindOf(column, value)
  if (kind === "boolean")
    return value ? (
      <span className="inline-flex items-center gap-1 text-accent-green">
        <Check className="size-3.5" aria-hidden />
        <span className="sr-only">{labels.yes}</span>
      </span>
    ) : (
      <span className="text-text-muted">{labels.no}</span>
    )
  if (kind === "enum")
    return (
      <Badge variant="secondary" data-value={String(value)}>
        {String(value)}
      </Badge>
    )
  if (kind === "money" && typeof value === "number") {
    const currency = String(row[column.moneyCurrency as string] ?? "USD")
    return (
      <span className="tabular-nums">
        {new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
          value / 10 ** fractionDigits(currency),
        )}
      </span>
    )
  }
  if (kind === "datetime") {
    const d = asDate(value)
    if (d)
      return (
        <time dateTime={d.toISOString()} className="whitespace-nowrap tabular-nums">
          {d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </time>
      )
  }
  if (kind === "json")
    return (
      <code className="block max-w-64 truncate font-mono text-xs text-text-muted">
        {JSON.stringify(value)}
      </code>
    )
  if (kind === "number") return <span className="tabular-nums">{String(value)}</span>
  if (column.primaryKey || /Id$|_id$/.test(column.key))
    return <span className="font-mono text-xs text-text-secondary">{String(value)}</span>
  return <span className="block max-w-80 truncate">{String(value)}</span>
}

// -------------------------------------------------------------------- context

type Page = { rows: AdminRow[]; nextCursor: string | null }
type Status = "idle" | "loading" | "error"
/** `null`: closed. `{ id: null }`: a new row. */
export type AdminRecordTarget = { id: string | null } | null

type AdminState = {
  api: AdminApi
  labels: AdminLabels
  meta: AdminMeta | null
  metaStatus: Status
  /** The table the caller picked, with its metadata. */
  table: AdminTableMeta | null
  setTable: (name: string) => void
  /** Text search across the table's search columns. */
  search: string
  setSearch: (q: string) => void
  filters: AdminFilter
  setFilters: (f: AdminFilter) => void
  sort: { sort: string; order: "asc" | "desc" } | null
  setSort: (s: { sort: string; order: "asc" | "desc" }) => void
  withDeleted: boolean
  setWithDeleted: (v: boolean) => void
  page: Page
  pageIndex: number
  status: Status
  error: string | null
  next: () => void
  previous: () => void
  refresh: () => void
  selected: string[]
  setSelected: (ids: string[]) => void
  record: AdminRecordTarget
  openRecord: (target: AdminRecordTarget) => void
  /** Columns the table view shows. */
  listColumns: AdminColumn[]
  auditTable: AdminTableMeta | undefined
  pageSize: number
}

const AdminContext = React.createContext<AdminState | null>(null)

/** The panel's state and actions, for a custom part inside `AdminPanel`. */
export function useAdmin(): AdminState {
  const ctx = React.useContext(AdminContext)
  if (!ctx) throw new Error("useAdmin must be used inside <AdminPanel>.")
  return ctx
}

export type AdminPanelProps = Omit<useRender.ComponentProps<"div">, "children"> & {
  api: AdminApi
  /** Metadata you already have; otherwise `api.meta()` is fetched. */
  meta?: AdminMeta
  /** The open table (controlled). */
  table?: string
  defaultTable?: string
  onTableChange?: (table: string) => void
  /** The open record (controlled): `{ id }`, `{ id: null }` for a new row, or `null`. */
  record?: AdminRecordTarget
  defaultRecord?: AdminRecordTarget
  onRecordChange?: (record: AdminRecordTarget) => void
  /** Rows per page. Default 25 (signet-db caps at its `maxRows`, 100 by default). */
  pageSize?: number
  labels?: Partial<AdminLabels>
  children?: React.ReactNode
}

/** Holds the panel's state; renders its children (the parts) inside a grid. */
export function AdminPanel({
  api,
  meta: metaProp,
  table: tableProp,
  defaultTable,
  onTableChange,
  record: recordProp,
  defaultRecord = null,
  onRecordChange,
  pageSize = 25,
  labels: labelsProp,
  className,
  render,
  children,
  ...props
}: AdminPanelProps) {
  const labels = React.useMemo(() => ({ ...DEFAULT_ADMIN_LABELS, ...labelsProp }), [labelsProp])
  const [meta, setMeta] = React.useState<AdminMeta | null>(metaProp ?? null)
  const [metaStatus, setMetaStatus] = React.useState<Status>(metaProp ? "idle" : "loading")
  React.useEffect(() => {
    if (metaProp) {
      setMeta(metaProp)
      setMetaStatus("idle")
      return
    }
    let live = true
    setMetaStatus("loading")
    api.meta().then(
      (m) => {
        if (!live) return
        setMeta(m)
        setMetaStatus("idle")
      },
      () => live && setMetaStatus("error"),
    )
    return () => {
      live = false
    }
  }, [api, metaProp])

  const [tableName, setTableName] = useControllableState({
    value: tableProp,
    defaultValue: defaultTable ?? "",
    onChange: onTableChange,
  })
  const table =
    meta?.tables.find((t) => t.name === tableName) ??
    meta?.tables.find((t) => t.ops.includes("list")) ??
    null
  const [record, openRecord] = useControllableState<AdminRecordTarget>({
    value: recordProp,
    defaultValue: defaultRecord,
    onChange: onRecordChange,
  })

  const [search, setSearchRaw] = React.useState("")
  const [debounced, setDebounced] = React.useState("")
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])
  const [filters, setFiltersRaw] = React.useState<AdminFilter>({})
  const [sort, setSortRaw] = React.useState<AdminState["sort"]>(null)
  const [withDeleted, setWithDeletedRaw] = React.useState(false)
  const [cursors, setCursors] = React.useState<(string | undefined)[]>([undefined])
  const [page, setPage] = React.useState<Page>({ rows: [], nextCursor: null })
  const [status, setStatus] = React.useState<Status>("loading")
  const [error, setError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string[]>([])
  const [nonce, setNonce] = React.useState(0)

  // A new table, search, filter, sort or deleted toggle starts again at page 1.
  const resetPaging = React.useCallback(() => {
    setCursors([undefined])
    setSelected([])
  }, [])
  const tableKey = table?.name
  // biome-ignore lint/correctness/useExhaustiveDependencies: tableKey is the trigger; the state it resets is not read
  React.useEffect(() => {
    setFiltersRaw({})
    setSortRaw(null)
    setSearchRaw("")
    setDebounced("")
    setWithDeletedRaw(false)
    resetPaging()
  }, [tableKey, resetPaging])

  const cursor = cursors[cursors.length - 1]
  const effectiveSort = sort ?? table?.defaultSort ?? null
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce forces a refetch
  React.useEffect(() => {
    if (!table?.ops.includes("list")) return
    let live = true
    setStatus("loading")
    api
      .list(table.name, {
        limit: pageSize,
        ...(cursor ? { cursor } : {}),
        ...(effectiveSort?.sort ? effectiveSort : {}),
        ...(Object.keys(filters).length ? { filter: filters } : {}),
        ...(debounced ? { q: debounced } : {}),
        ...(withDeleted ? { withDeleted: true } : {}),
      })
      .then(
        (p) => {
          if (!live) return
          setPage(p)
          setStatus("idle")
          setError(null)
        },
        (e: unknown) => {
          if (!live) return
          setStatus("error")
          setError(e instanceof Error ? e.message : String(e))
        },
      )
    return () => {
      live = false
    }
  }, [
    api,
    table,
    cursor,
    effectiveSort?.sort,
    effectiveSort?.order,
    filters,
    debounced,
    withDeleted,
    pageSize,
    nonce,
  ])

  const state: AdminState = {
    api,
    labels,
    meta,
    metaStatus,
    table,
    setTable: (name) => {
      setTableName(name)
      openRecord(null)
    },
    search,
    setSearch: (q) => {
      setSearchRaw(q)
      resetPaging()
    },
    filters,
    setFilters: (f) => {
      setFiltersRaw(f)
      resetPaging()
    },
    sort: effectiveSort,
    setSort: (s) => {
      setSortRaw(s)
      resetPaging()
    },
    withDeleted,
    setWithDeleted: (v) => {
      setWithDeletedRaw(v)
      resetPaging()
    },
    page,
    pageIndex: cursors.length - 1,
    status,
    error,
    next: () => page.nextCursor && setCursors((c) => [...c, page.nextCursor as string]),
    previous: () => setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c)),
    refresh: () => setNonce((n) => n + 1),
    selected,
    setSelected,
    record,
    openRecord,
    listColumns: table?.columns.filter((c) => c.list) ?? [],
    auditTable: auditTableOf(meta),
    pageSize,
  }

  const element = useRender({
    defaultTagName: "div",
    render,
    state: { slot: "admin-panel" },
    props: mergeProps<"div">(
      {
        className: cn(
          "grid min-h-128 overflow-hidden rounded-xl bg-bg-base text-sm text-text-primary ring-1 ring-border-default md:grid-cols-[minmax(11rem,14rem)_1fr]",
          className,
        ),
        children,
      },
      props,
    ),
  })
  return <AdminContext.Provider value={state}>{element}</AdminContext.Provider>
}

// ---------------------------------------------------------------- the parts

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

/** The table list: one button per table this caller may list. */
export function AdminNav(props: PartProps<"nav">) {
  const { meta, metaStatus, table, setTable, labels, auditTable } = useAdmin()
  const tables = meta?.tables.filter((t) => t.ops.includes("list")) ?? []
  const children = (
    <>
      <div className="flex items-center gap-2 px-3 pt-4 pb-2 md:px-4">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Database className="size-3.5" aria-hidden />
        </span>
        <span className="font-semibold text-text-primary">{labels.title}</span>
      </div>
      <p className="hidden px-4 pt-3 pb-1 text-xs font-medium text-text-muted md:block">
        {labels.tables}
      </p>
      {metaStatus === "loading" ? (
        <div className="flex flex-col gap-1.5 px-3 py-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-7 rounded-md bg-bg-elevated" />
          ))}
        </div>
      ) : tables.length === 0 ? (
        <p className="px-4 py-2 text-xs text-text-muted">{labels.noTables}</p>
      ) : (
        <ul className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:overflow-visible">
          {tables.map((t) => {
            const active = t.name === table?.name
            const Icon = t.name === auditTable?.name ? History : Database
            return (
              <li key={t.name} className="shrink-0">
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  data-active={active || undefined}
                  onClick={() => setTable(t.name)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-text-secondary transition-colors outline-none hover:bg-bg-elevated hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring data-active:bg-bg-elevated data-active:font-medium data-active:text-text-primary"
                >
                  <Icon className="size-3.5 shrink-0 text-text-muted" aria-hidden />
                  <span className="truncate">{labels.tableName(t.name)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
  return usePart(
    "nav",
    "admin-nav",
    "flex flex-col border-b border-border-default bg-bg-surface md:border-r md:border-b-0",
    props,
    { "aria-label": labels.tables, children },
  )
}

/** The main column: header, toolbar, table, pager. Lay out your own parts as its children. */
export function AdminMain(props: PartProps<"div">) {
  return usePart("div", "admin-main", "flex min-w-0 flex-col gap-3 p-3 md:p-5", props)
}

/** The table's name and the New button. */
export function AdminHeader(props: PartProps<"header">) {
  const { table, labels, openRecord, refresh, status } = useAdmin()
  const children = table && (
    <>
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold tracking-tight text-text-primary">
          {labels.tableName(table.name)}
        </h2>
        <p className="font-mono text-xs text-text-muted">{table.name}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label={labels.refresh}
          onClick={refresh}
          data-loading={status === "loading" || undefined}
          className="[&[data-loading]_svg]:animate-spin"
        >
          <RotateCw aria-hidden />
        </Button>
        {table.ops.includes("create") && (
          <Button onClick={() => openRecord({ id: null })}>
            <Plus data-icon="inline-start" aria-hidden />
            {labels.create}
          </Button>
        )}
      </div>
    </>
  )
  return usePart("header", "admin-header", "flex items-start justify-between gap-3", props, {
    children,
  })
}

/** Search, filters, the deleted toggle; the bulk bar while rows are selected. */
export function AdminToolbar(props: PartProps<"div">) {
  return useAdmin().table ? <AdminToolbarInner {...props} /> : null
}

function AdminToolbarInner(props: PartProps<"div">) {
  const s = useAdmin()
  const { labels } = s
  const table = s.table as AdminTableMeta
  const searchId = React.useId()
  const searchable = table.columns.some((c) => c.searchable)
  const children =
    s.selected.length > 0 ? (
      <AdminBulkBar />
    ) : (
      <>
        {searchable && (
          <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border-default bg-bg-surface px-2.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring sm:max-w-72">
            <Search className="size-3.5 shrink-0 text-text-muted" aria-hidden />
            <label htmlFor={searchId} className="sr-only">
              {labels.search}
            </label>
            <input
              id={searchId}
              type="search"
              value={s.search}
              onChange={(e) => s.setSearch(e.target.value)}
              placeholder={labels.searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>
        )}
        <AdminFilterButton />
        {table.softDelete && (
          // biome-ignore lint/a11y/noLabelWithoutControl: Switch renders the control inside the label
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
            <Switch checked={s.withDeleted} onCheckedChange={(v) => s.setWithDeleted(v)} />
            {labels.showDeleted}
          </label>
        )}
      </>
    )
  return usePart(
    "div",
    "admin-toolbar",
    "flex min-h-9 flex-wrap items-center gap-2",
    props,
    { role: "toolbar", "aria-label": labels.filter, children },
    { selecting: s.selected.length > 0 },
  )
}

function AdminBulkBar() {
  const { table, labels, selected, setSelected, api, refresh } = useAdmin()
  if (!table) return null
  return (
    <div
      data-slot="admin-bulk-bar"
      className="flex w-full items-center gap-2 rounded-lg bg-primary/10 px-3 py-1"
    >
      <span className="text-sm font-medium text-text-primary tabular-nums" aria-live="polite">
        {labels.selected(selected.length)}
      </span>
      <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
        {labels.clearSelection}
      </Button>
      {table.ops.includes("delete") && (
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="destructive" size="sm" className="ml-auto" />}
          >
            <Trash2 data-icon="inline-start" aria-hidden />
            {labels.bulkDelete}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>{labels.bulkDeleteTitle(selected.length)}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.bulkDeleteBody(table.softDelete)}
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                action={async () => {
                  await api.bulkDelete(table.name, selected)
                  setSelected([])
                  refresh()
                }}
              >
                {labels.bulkDelete}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

const OPS_WITH_NO_VALUE: AdminFilterOp[] = ["isNull"]

/** "Filter" button: a popover to add `{ column: { op: value } }`, with the active filters as chips beside it. */
export function AdminFilterButton({ className }: { className?: string }) {
  const { table, labels, filters, setFilters } = useAdmin()
  const cols = table?.columns.filter((c) => c.filterable && c.operators.length) ?? []
  const [open, setOpen] = React.useState(false)
  const [colKey, setColKey] = React.useState("")
  const [op, setOp] = React.useState<AdminFilterOp>("eq")
  const [value, setValue] = React.useState("")
  const ids = React.useId()
  const col = cols.find((c) => c.key === colKey) ?? cols[0]
  if (!table || cols.length === 0) return null
  const chips = Object.entries(filters).flatMap(([k, spec]) =>
    Object.entries(spec).map(([o, v]) => ({ k, o: o as AdminFilterOp, v })),
  )
  const colLabel = (k: string) => {
    const c = table.columns.find((x) => x.key === k)
    return c ? labels.columnName(c) : k
  }
  const apply = (e: React.FormEvent) => {
    e.preventDefault()
    if (!col) return
    const kind = kindOf(col)
    let v: unknown = value
    if (op === "isNull") v = true
    else if (op === "in")
      v = value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    else if (kind === "number" || kind === "money") v = Number(value)
    else if (kind === "boolean") v = value === "true"
    setFilters({ ...filters, [col.key]: { ...filters[col.key], [op]: v } })
    setValue("")
    setOpen(false)
  }
  const selectClass =
    "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring dark:bg-input/30"
  return (
    <div data-slot="admin-filters" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" data-active={chips.length > 0 || undefined}>
            <ListFilter data-icon="inline-start" aria-hidden />
            {labels.filter}
            {chips.length > 0 && (
              <span className="rounded bg-primary px-1 text-xs text-primary-foreground tabular-nums">
                {chips.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <form onSubmit={apply} className="flex flex-col gap-2.5">
            <label htmlFor={`${ids}c`} className="text-xs font-medium text-text-muted">
              {labels.filterColumn}
            </label>
            <select
              id={`${ids}c`}
              className={selectClass}
              value={col?.key}
              onChange={(e) => {
                setColKey(e.target.value)
                setOp("eq")
              }}
            >
              {cols.map((c) => (
                <option key={c.key} value={c.key}>
                  {labels.columnName(c)}
                </option>
              ))}
            </select>
            <label htmlFor={`${ids}o`} className="text-xs font-medium text-text-muted">
              {labels.filterOperator}
            </label>
            <select
              id={`${ids}o`}
              className={selectClass}
              value={op}
              onChange={(e) => setOp(e.target.value as AdminFilterOp)}
            >
              {col?.operators.map((o) => (
                <option key={o} value={o}>
                  {labels.operators[o]}
                </option>
              ))}
            </select>
            {!OPS_WITH_NO_VALUE.includes(op) && (
              <>
                <label htmlFor={`${ids}v`} className="text-xs font-medium text-text-muted">
                  {labels.filterValue}
                </label>
                {col?.enum?.length && op !== "in" ? (
                  <select
                    id={`${ids}v`}
                    className={selectClass}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      {labels.none}
                    </option>
                    {col.enum.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={`${ids}v`}
                    value={value}
                    required
                    onChange={(e) => setValue(e.target.value)}
                    type={col && kindOf(col) === "number" ? "number" : "text"}
                  />
                )}
              </>
            )}
            <Button type="submit" className="mt-1">
              {labels.addFilter}
            </Button>
          </form>
        </PopoverContent>
      </Popover>
      {chips.map(({ k, o, v }) => {
        const text = `${colLabel(k)} ${labels.operators[o]}${o === "isNull" ? "" : ` ${Array.isArray(v) ? v.join(", ") : String(v)}`}`
        return (
          <span
            key={`${k}.${o}`}
            data-slot="admin-filter-chip"
            className="inline-flex h-7 items-center gap-1 rounded-full bg-bg-elevated pr-1 pl-2.5 text-xs text-text-primary"
          >
            {text}
            <button
              type="button"
              aria-label={labels.removeFilter(text)}
              onClick={() => {
                const { [o]: _drop, ...rest } = filters[k] ?? {}
                const next = { ...filters }
                if (Object.keys(rest).length) next[k] = rest
                else delete next[k]
                setFilters(next)
              }}
              className="flex size-5 items-center justify-center rounded-full text-text-muted outline-none hover:bg-bg-surface hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        )
      })}
    </div>
  )
}

export type AdminTableProps = PartProps<"div"> & {
  /** Replaces a cell's rendering. Return undefined to keep the default. */
  renderCell?: (args: { value: unknown; column: AdminColumn; row: AdminRow }) => React.ReactNode
}

/** The rows: sortable headers, a checkbox column when delete is allowed, row actions. */
export function AdminTable(props: AdminTableProps) {
  return useAdmin().table ? <AdminTableInner {...props} /> : null
}

function AdminTableInner({ renderCell, ...props }: AdminTableProps) {
  const s = useAdmin()
  const { labels, page, status, listColumns, selected, setSelected } = s
  const table = s.table as AdminTableMeta
  const canSelect = table.ops.includes("delete")
  const ids = page.rows.map((r) => idOf(table, r))
  const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id))
  const filtered = Object.keys(s.filters).length > 0 || s.search !== ""
  const sortLabel = (c: AdminColumn) => labels.columnName(c)

  let body: React.ReactNode
  if (status === "error") {
    body = (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={listColumns.length + 2} className="py-12 text-center">
          <div role="alert" className="flex flex-col items-center gap-2">
            <p className="font-medium text-text-primary">{labels.error}</p>
            {s.error && <p className="text-xs text-text-muted">{s.error}</p>}
            <Button variant="outline" size="sm" onClick={s.refresh}>
              {labels.retry}
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  } else if (status === "loading" && page.rows.length === 0) {
    body = [0, 1, 2, 3, 4].map((i) => (
      <TableRow key={i} className="hover:bg-transparent">
        <TableCell colSpan={listColumns.length + 2}>
          <Skeleton className="h-5 rounded-md bg-bg-elevated" />
        </TableCell>
      </TableRow>
    ))
  } else if (page.rows.length === 0) {
    body = (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={listColumns.length + 2} className="py-14 text-center">
          <div className="flex flex-col items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-bg-elevated text-text-muted">
              {filtered ? (
                <Search className="size-4" aria-hidden />
              ) : (
                <Database className="size-4" aria-hidden />
              )}
            </span>
            <p className="text-sm font-medium text-text-primary">
              {filtered ? labels.emptyFiltered : labels.empty}
            </p>
            {filtered ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  s.setFilters({})
                  s.setSearch("")
                }}
              >
                {labels.clearFilters}
              </Button>
            ) : (
              table.ops.includes("create") && (
                <Button size="sm" onClick={() => s.openRecord({ id: null })}>
                  <Plus data-icon="inline-start" aria-hidden />
                  {labels.create}
                </Button>
              )
            )}
          </div>
        </TableCell>
      </TableRow>
    )
  } else {
    body = page.rows.map((row) => {
      const id = idOf(table, row)
      const isSelected = selected.includes(id)
      const deleted = table.softDelete && row.deletedAt != null
      return (
        <TableRow
          key={id}
          data-selected={isSelected || undefined}
          data-deleted={deleted || undefined}
          className="cursor-pointer data-deleted:text-text-muted data-selected:bg-primary/5 [&[data-deleted]_td]:line-through [&[data-deleted]_td]:decoration-text-hint"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button,a,input,[role=checkbox],[role=menuitem]"))
              return
            s.openRecord({ id })
          }}
        >
          {canSelect && (
            <TableCell className="w-8 pr-0">
              <Checkbox
                checked={isSelected}
                aria-label={labels.selectRow(id)}
                onCheckedChange={(v) =>
                  setSelected(v ? [...selected, id] : selected.filter((x) => x !== id))
                }
              />
            </TableCell>
          )}
          {listColumns.map((c, i) => {
            const custom = renderCell?.({ value: row[c.key], column: c, row })
            const cell =
              custom !== undefined ? (
                custom
              ) : (
                <CellValue value={row[c.key]} column={c} row={row} labels={labels} />
              )
            return (
              <TableCell key={c.key} className="text-sm whitespace-nowrap" data-column={c.key}>
                {i === 0 ? (
                  <button
                    type="button"
                    onClick={() => s.openRecord({ id })}
                    className="rounded-sm text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
                    aria-label={`${labels.open} ${id}`}
                  >
                    {cell}
                  </button>
                ) : (
                  cell
                )}
              </TableCell>
            )
          })}
          <TableCell className="w-10 text-right">
            <AdminRowActions row={row} />
          </TableCell>
        </TableRow>
      )
    })
  }

  const children = (
    <Table aria-busy={status === "loading" || undefined}>
      <TableHeader className="sticky top-0 z-10 bg-bg-surface">
        <TableRow className="hover:bg-transparent">
          {canSelect && (
            <TableHead className="w-8 pr-0">
              <Checkbox
                checked={allSelected ? true : selected.length > 0 ? "indeterminate" : false}
                aria-label={labels.selectAll}
                disabled={ids.length === 0}
                onCheckedChange={(v) => setSelected(v ? ids : [])}
              />
            </TableHead>
          )}
          {listColumns.map((c) => {
            const active = s.sort?.sort === c.key
            const dir = active ? s.sort?.order : undefined
            return (
              <TableHead
                key={c.key}
                className="h-9 text-xs font-medium tracking-normal normal-case text-text-muted"
                aria-sort={
                  c.sortable
                    ? dir === "asc"
                      ? "ascending"
                      : dir === "desc"
                        ? "descending"
                        : "none"
                    : undefined
                }
              >
                {c.sortable ? (
                  <button
                    type="button"
                    aria-label={labels.sortBy(sortLabel(c))}
                    onClick={() =>
                      s.setSort({ sort: c.key, order: active && dir === "desc" ? "asc" : "desc" })
                    }
                    data-active={active || undefined}
                    className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring data-active:text-text-primary"
                  >
                    {sortLabel(c)}
                    {dir === "asc" ? (
                      <ArrowUp className="size-3" aria-hidden />
                    ) : dir === "desc" ? (
                      <ArrowDown className="size-3" aria-hidden />
                    ) : (
                      <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                    )}
                  </button>
                ) : (
                  sortLabel(c)
                )}
              </TableHead>
            )
          })}
          <TableHead className="w-10">
            <span className="sr-only">{labels.rowActions}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{body}</TableBody>
    </Table>
  )
  return usePart(
    "div",
    "admin-table",
    "overflow-x-auto rounded-lg border border-border-default bg-bg-surface",
    props,
    { children },
    { loading: status === "loading" },
  )
}

/** The ⋯ menu on a row: open, the table's actions, delete. */
export function AdminRowActions({ row, className }: { row: AdminRow; className?: string }) {
  const { table, labels, openRecord, api, refresh } = useAdmin()
  const [confirm, setConfirm] = React.useState<null | { name: string; destructive: boolean }>(null)
  if (!table) return null
  const id = idOf(table, row)
  const run = async () => {
    if (!confirm) return
    if (confirm.name === "") await api.remove(table.name, id)
    else await api.action(table.name, id, confirm.name)
    refresh()
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={labels.rowActions}
            className={className}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onSelect={() => openRecord({ id })}>{labels.open}</DropdownMenuItem>
          {table.actions.map((a) => (
            <DropdownMenuItem
              key={a.name}
              title={a.description}
              onSelect={() => setConfirm({ name: a.name, destructive: a.destructive })}
            >
              {humanize(a.name)}
            </DropdownMenuItem>
          ))}
          {table.ops.includes("delete") && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-accent-red focus:text-accent-red"
                onSelect={() => setConfirm({ name: "", destructive: true })}
              >
                <Trash2 aria-hidden />
                {labels.delete}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm !== null} onOpenChange={(o: boolean) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {confirm?.name ? labels.actionTitle(confirm.name) : labels.deleteTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirm?.name
              ? (table.actions.find((a) => a.name === confirm.name)?.description ?? "")
              : labels.deleteBody(table.softDelete)}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm?.destructive ? "destructive" : "default"}
              action={run}
            >
              {confirm?.name ? labels.confirm : labels.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Previous / next over cursor pages. */
export function AdminPager(props: PartProps<"nav">) {
  return useAdmin().table ? <AdminPagerInner {...props} /> : null
}

function AdminPagerInner(props: PartProps<"nav">) {
  const { labels, page, pageIndex, next, previous, status } = useAdmin()
  const children = (
    <>
      <span className="text-xs text-text-muted tabular-nums">{labels.page(pageIndex + 1)}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={labels.previous}
          disabled={pageIndex === 0 || status === "loading"}
          onClick={previous}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={labels.next}
          disabled={!page.nextCursor || status === "loading"}
          onClick={next}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </>
  )
  return usePart("nav", "admin-pager", "flex items-center justify-end gap-3", props, {
    "aria-label": labels.page(pageIndex + 1),
    children,
  })
}

// ------------------------------------------------------------------ record

type Draft = Record<string, string | boolean>

const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function toDraft(cols: AdminColumn[], row: AdminRow): Draft {
  const out: Draft = {}
  for (const c of cols) {
    const v = row[c.key]
    const kind = kindOf(c, v)
    if (kind === "boolean") out[c.key] = Boolean(v)
    else if (v === null || v === undefined) out[c.key] = ""
    else if (kind === "datetime")
      out[c.key] = asDate(v) ? toLocalInput(asDate(v) as Date) : String(v)
    else if (kind === "json") out[c.key] = JSON.stringify(v, null, 2)
    else if (kind === "money" && typeof v === "number") {
      const cur = String(row[c.moneyCurrency as string] ?? "USD")
      out[c.key] = String(v / 10 ** fractionDigits(cur))
    } else out[c.key] = String(v)
  }
  return out
}

/** Draft values back to what signet-db validates: numbers, booleans, ISO dates, parsed JSON, null for empty optional fields. */
function fromDraft(
  cols: AdminColumn[],
  draft: Draft,
  initial: Draft,
  all: Draft,
): { values: AdminRow; errors: Record<string, string> } {
  const values: AdminRow = {}
  const errors: Record<string, string> = {}
  for (const c of cols) {
    const raw = draft[c.key]
    if (raw === initial[c.key]) continue
    const kind = kindOf(c, typeof raw === "boolean" ? raw : undefined)
    if (typeof raw === "boolean") values[c.key] = raw
    else if (raw === "") values[c.key] = c.notNull ? "" : null
    else if (kind === "number") values[c.key] = Number(raw)
    else if (kind === "money") {
      const cur = String(all[c.moneyCurrency as string] || "USD")
      values[c.key] = Math.round(Number(raw) * 10 ** fractionDigits(cur))
    } else if (kind === "datetime") values[c.key] = new Date(raw).toISOString()
    else if (kind === "json") {
      try {
        values[c.key] = JSON.parse(raw)
      } catch {
        errors[c.key] = "JSON"
      }
    } else values[c.key] = raw
  }
  return { values, errors }
}

export type AdminRecordFormProps = {
  /** The row being edited, or undefined for a new one. */
  row?: AdminRow
  onSaved?: (row: AdminRow) => void
  className?: string
  /** Replaces one field's control. Return undefined to keep the default. */
  renderField?: (args: {
    column: AdminColumn
    value: string | boolean
    onChange: (v: string | boolean) => void
    id: string
  }) => React.ReactNode
}

/** A form built from the table's columns: create when `row` is absent, update otherwise. */
export function AdminRecordForm({ row, onSaved, className, renderField }: AdminRecordFormProps) {
  const { table, labels, api, refresh } = useAdmin()
  const creating = row === undefined
  const cols = React.useMemo(
    () =>
      table?.columns.filter((c) =>
        creating ? (!c.readonly || c.key === "userId") && !(c.primaryKey && c.hasDefault) : true,
      ) ?? [],
    [table, creating],
  )
  const initial = React.useMemo(() => toDraft(cols, row ?? {}), [cols, row])
  const [draft, setDraft] = React.useState<Draft>(initial)
  React.useEffect(() => setDraft(initial), [initial])
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const uid = React.useId()
  if (!table) return null
  const canWrite = creating ? table.ops.includes("create") : table.ops.includes("update")
  const editable = cols.filter((c) => canWrite && (!c.readonly || (creating && c.key === "userId")))
  const dirty = editable.some((c) => draft[c.key] !== initial[c.key])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { values, errors: local } = fromDraft(editable, draft, creating ? {} : initial, draft)
    if (Object.keys(local).length) {
      setErrors(Object.fromEntries(Object.entries(local).map(([k, m]) => [k, [m]])))
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const saved = creating
        ? await api.create(table.name, values)
        : await api.update(table.name, idOf(table, row as AdminRow), values)
      setErrors({})
      refresh()
      onSaved?.(saved)
    } catch (err) {
      if (err instanceof AdminApiError && Object.keys(err.fieldErrors).length)
        setErrors(err.fieldErrors)
      else setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      data-slot="admin-record-form"
      data-mode={creating ? "create" : "update"}
      onSubmit={submit}
      className={cn("flex flex-col gap-4", className)}
      noValidate
    >
      {formError && (
        <p
          role="alert"
          className="rounded-lg bg-accent-red-subtle px-3 py-2 text-sm text-accent-red"
        >
          {formError}
        </p>
      )}
      {cols.map((c) => {
        const id = `${uid}-${c.key}`
        const disabled = !editable.includes(c)
        const value = draft[c.key] ?? ""
        const set = (v: string | boolean) => setDraft((d) => ({ ...d, [c.key]: v }))
        const kind = kindOf(c, value)
        const custom = renderField?.({ column: c, value, onChange: set, id })
        if (disabled && !creating) {
          return (
            <div key={c.key} data-slot="admin-record-value" className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">{labels.columnName(c)}</span>
              <span className="min-h-5 text-sm text-text-primary">
                <CellValue value={row?.[c.key]} column={c} row={row ?? {}} labels={labels} />
              </span>
            </div>
          )
        }
        const required = c.notNull && !c.hasDefault && kind !== "boolean"
        return (
          <Field
            key={c.key}
            errors={errors[c.key]}
            disabled={disabled}
            className="gap-1.5"
            data-kind={kind}
          >
            {kind === "boolean" ? (
              // biome-ignore lint/a11y/noLabelWithoutControl: Switch renders the control inside the label
              <label className="flex items-center justify-between gap-3 text-sm font-medium">
                {labels.columnName(c)}
                {custom ?? (
                  <Switch
                    checked={value === true}
                    onCheckedChange={(v) => set(v)}
                    disabled={disabled}
                  />
                )}
              </label>
            ) : (
              <>
                <FieldLabel>
                  {labels.columnName(c)}
                  {!required && (
                    <span className="text-xs font-normal text-text-secondary">
                      {labels.optional}
                    </span>
                  )}
                </FieldLabel>
                {custom ??
                  (kind === "enum" ? (
                    <FieldControl
                      render={
                        <select className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring dark:bg-input/30" />
                      }
                      value={value as string}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value)}
                      required={required}
                    >
                      {!required && <option value="">{labels.none}</option>}
                      {required && value === "" && (
                        <option value="" disabled>
                          {labels.none}
                        </option>
                      )}
                      {c.enum?.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </FieldControl>
                  ) : kind === "json" || kind === "longtext" ? (
                    <FieldControl
                      render={
                        <Textarea className={cn(kind === "json" && "font-mono text-xs")} rows={4} />
                      }
                      value={value as string}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value)}
                      required={required}
                    />
                  ) : (
                    <FieldControl
                      type={
                        kind === "number" || kind === "money"
                          ? "number"
                          : kind === "datetime"
                            ? "datetime-local"
                            : "text"
                      }
                      step={kind === "money" ? "0.01" : undefined}
                      value={value as string}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value)}
                      required={required}
                    />
                  ))}
                {kind === "money" && c.moneyCurrency && (
                  <FieldDescription className="text-xs text-text-secondary">
                    {String(draft[c.moneyCurrency] || row?.[c.moneyCurrency] || "")}
                  </FieldDescription>
                )}
                <FieldError />
              </>
            )}
          </Field>
        )
      })}
      {canWrite && (
        <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 bg-bg-surface px-1 pt-2 pb-1">
          <Button type="submit" disabled={saving || (!creating && !dirty)}>
            {saving ? labels.saving : creating ? labels.create : labels.save}
          </Button>
        </div>
      )}
    </form>
  )
}

/** Changes to one row from the audit table, newest first, with what changed. */
export function AdminAuditTrail({
  table: tableName,
  id,
  className,
}: {
  table: string
  id: string
  className?: string
}) {
  const { api, auditTable, labels } = useAdmin()
  const [rows, setRows] = React.useState<AdminRow[] | null>(null)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => {
    if (!auditTable) return
    let live = true
    const sortKey = auditTable.columns.find((c) => c.key === "at" || c.key === "createdAt")?.key
    api
      .list(auditTable.name, {
        limit: 50,
        filter: { tableName: { eq: tableName }, rowId: { eq: id } },
        ...(sortKey ? { sort: sortKey, order: "desc" as const } : {}),
      })
      .then(
        (p) => live && setRows(p.rows),
        () => live && setFailed(true),
      )
    return () => {
      live = false
    }
  }, [api, auditTable, tableName, id])
  if (!auditTable) return null
  if (failed)
    return (
      <p role="alert" className="text-sm text-text-muted">
        {labels.error}
      </p>
    )
  if (!rows)
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 rounded-lg bg-bg-elevated" />
        ))}
      </div>
    )
  if (rows.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-text-muted">
        <History className="size-5" aria-hidden />
        {labels.noHistory}
      </div>
    )
  return (
    <ol
      data-slot="admin-audit-trail"
      className={cn("relative flex flex-col gap-4 pl-5", className)}
    >
      <span aria-hidden className="absolute top-1 bottom-1 left-[5px] w-px bg-border-default" />
      {rows.map((r) => {
        const before = (r.before ?? {}) as AdminRow
        const after = (r.after ?? {}) as AdminRow
        const action = String(r.action ?? "")
        const changed =
          action === "update"
            ? Object.keys(after).filter(
                (k) => k !== "updatedAt" && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
              )
            : []
        const at = asDate(r.at ?? r.createdAt)
        return (
          <li key={String(r.id)} data-action={action} className="relative">
            <span
              aria-hidden
              className="absolute top-1.5 -left-5 size-2.5 rounded-full border-2 border-bg-surface bg-primary ring-1 ring-border-default data-[action=delete]:bg-accent-red"
              data-action={action}
            />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-text-primary">
                {labels.historyAction[action] ?? humanize(action)}
              </span>
              <span className="text-xs text-text-muted">
                {labels.by(`${String(r.actorType ?? "")}:${String(r.actorId ?? "")}`)}
              </span>
              {at && (
                <time
                  dateTime={at.toISOString()}
                  className="ml-auto text-xs text-text-hint tabular-nums"
                >
                  {at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </time>
              )}
            </div>
            {changed.length > 0 && (
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-bg-elevated px-3 py-2 text-xs">
                {changed.map((k) => (
                  <React.Fragment key={k}>
                    <dt className="text-text-muted">{humanize(k)}</dt>
                    <dd className="min-w-0 truncate">
                      <span className="text-text-hint line-through">{fmt(before[k])}</span>{" "}
                      <span aria-hidden>→</span>{" "}
                      <span className="text-text-primary">{fmt(after[k])}</span>
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
          </li>
        )
      })}
    </ol>
  )
}

const fmt = (v: unknown) =>
  v === null || v === undefined ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v)

export type AdminRecordSheetProps = {
  className?: string
  /** Replaces one field's control in the form. */
  renderField?: AdminRecordFormProps["renderField"]
}

/** The open record in a side panel (full screen on phones): details form, history, delete. */
export function AdminRecordSheet({ className, renderField }: AdminRecordSheetProps) {
  const { table, record, openRecord, api, labels, withDeleted, auditTable, refresh } = useAdmin()
  const [row, setRow] = React.useState<AdminRow | null>(null)
  const [failed, setFailed] = React.useState<string | null>(null)
  const id = record?.id ?? null
  React.useEffect(() => {
    setRow(null)
    setFailed(null)
    if (!table || id === null || id === undefined) return
    let live = true
    api.get(table.name, id, { withDeleted: withDeleted || table.softDelete }).then(
      (r) => live && setRow(r),
      (e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [api, table, id, withDeleted])
  if (!table) return null
  const open = record !== null
  const creating = open && id === null
  const title = creating ? labels.createTitle(table.name) : labels.tableName(table.name)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && openRecord(null)}>
      <DialogContent
        showCloseButton={false}
        data-slot="admin-record-sheet"
        data-mode={creating ? "create" : "view"}
        className={cn(
          "top-0 right-0 left-auto flex h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-lg data-open:slide-in-from-right-8 data-open:zoom-in-100",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
            <DialogDescription className="mt-1 truncate font-mono text-xs">
              {creating ? table.name : id}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1">
            {!creating && table.ops.includes("delete") && row && row.deletedAt == null && (
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button variant="ghost" size="icon-sm" aria-label={labels.delete} />}
                >
                  <Trash2 aria-hidden className="text-accent-red" />
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>{labels.deleteTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {labels.deleteBody(table.softDelete)}
                  </AlertDialogDescription>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      action={async () => {
                        await api.remove(table.name, id as string)
                        refresh()
                        openRecord(null)
                      }}
                    >
                      {labels.delete}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <DialogClose
              render={<Button variant="ghost" size="icon-sm" aria-label={labels.close} />}
            >
              <X aria-hidden />
            </DialogClose>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {creating ? (
            <AdminRecordForm renderField={renderField} onSaved={() => openRecord(null)} />
          ) : failed ? (
            <p role="alert" className="text-sm text-accent-red">
              {failed}
            </p>
          ) : !row ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg bg-bg-elevated" />
              ))}
            </div>
          ) : (
            <Tabs defaultValue="details">
              <TabsList variant="line" className="mb-3">
                <TabsTrigger value="details" className="text-text-secondary">
                  {labels.details}
                </TabsTrigger>
                {auditTable && (
                  <TabsTrigger value="history" className="text-text-secondary">
                    {labels.history}
                  </TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="details">
                {row.deletedAt != null && (
                  <Badge variant="destructive" className="mb-3">
                    {labels.deleted}
                  </Badge>
                )}
                <AdminRecordForm row={row} renderField={renderField} onSaved={(r) => setRow(r)} />
              </TabsContent>
              {auditTable && (
                <TabsContent value="history">
                  <AdminAuditTrail table={table.name} id={id as string} />
                </TabsContent>
              )}
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------- screen

export type AdminScreenProps = Omit<AdminPanelProps, "children"> & {
  /** Classes per part, merged over the defaults. */
  classNames?: Partial<
    Record<"nav" | "main" | "header" | "toolbar" | "table" | "pager" | "sheet", string>
  >
  renderCell?: AdminTableProps["renderCell"]
  renderField?: AdminRecordFormProps["renderField"]
}

/**
 * The whole admin panel, ready to drop in:
 *
 * ```tsx
 * <AdminScreen api={createAdminApi({ baseUrl: "/admin" })} />
 * ```
 */
export function AdminScreen({
  classNames = {},
  renderCell,
  renderField,
  ...props
}: AdminScreenProps) {
  return (
    <AdminPanel {...props}>
      <AdminNav className={classNames.nav} />
      <AdminMain className={classNames.main}>
        <AdminHeader className={classNames.header} />
        <AdminToolbar className={classNames.toolbar} />
        <AdminTable className={classNames.table} {...(renderCell ? { renderCell } : {})} />
        <AdminPager className={classNames.pager} />
      </AdminMain>
      <AdminRecordSheet className={classNames.sheet} {...(renderField ? { renderField } : {})} />
    </AdminPanel>
  )
}
