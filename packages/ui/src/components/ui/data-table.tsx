import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnResizeMode,
  type ColumnVisibilityState,
  columnFacetingFeature,
  columnFilteringFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFacetedRowModel,
  createFilteredRowModel,
  createSortedRowModel,
  flexRender,
  globalFilteringFeature,
  type Row,
  type RowData,
  type RowSelectionState,
  rowSelectionFeature,
  rowSortingFeature,
  type SortingState,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  type Table as TanstackTable,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter, X } from "lucide-react"
import type * as React from "react"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { cn } from "../../lib/utils.js"
import { Checkbox } from "./checkbox.js"
import { Popover, PopoverContent, PopoverTrigger } from "./popover.js"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.js"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip.js"

/** Smallest width keyboard resizing will shrink a column to. */
const MIN_COLUMN_PX = 40

/** Per-column options DataTable reads from `meta`. */
export type DataTableColumnMeta = {
  /**
   * Adds a filter for this column to the toolbar. "facet": pick values from
   * a list with a row count beside each. "text": a contains-search. Array
   * cell values facet by each element.
   */
  filter?: "facet" | "text"
  /** The filter's label. Default: the header when it is a string, else the column id. */
  filterLabel?: string
}

/**
 * react-table v9 made features opt-in: a table only carries the APIs for the
 * features it declares. This is the set DataTable uses, and it threads through
 * every generic below — v8's implicit "everything is always there" is gone.
 *
 * Exported so an app can type a column array it defines elsewhere:
 *   const columns: ColumnDef<DataTableFeatures, Row, unknown>[] = [...]
 */
export const dataTableFeatures = tableFeatures({
  columnSizingFeature,
  columnResizingFeature, // requires columnSizingFeature
  columnVisibilityFeature, // row.getVisibleCells()
  rowSelectionFeature, // row.getIsSelected()
  columnFilteringFeature,
  columnFacetingFeature,
  globalFilteringFeature, // the toolbar's search box, across every column
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  facetedRowModel: createFacetedRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  columnMeta: {} as DataTableColumnMeta,
})

export type DataTableFeatures = typeof dataTableFeatures

/**
 * The part of a table's state worth saving as a named view. Plain JSON: the
 * app stores it (localStorage, SQLite, the server) and passes it back.
 * Facet filter values are arrays of strings; text filter values are strings.
 */
export type DataTableView = {
  filters: Array<{ id: string; value: unknown }>
  sorting: Array<{ id: string; desc: boolean }>
  columnVisibility: Record<string, boolean>
  /** The global search box, across every column. Omit or "" for none. */
  search?: string
}

export const EMPTY_VIEW: DataTableView = {
  filters: [],
  sorting: [],
  columnVisibility: {},
  search: "",
}

/** A named view the toolbar can apply. */
export type SavedView = { id: string; name: string; view: DataTableView }

interface DataTableProps<TData extends RowData> {
  /**
   * v9's useTable is typed against ColumnDef<..., unknown>, so the per-column
   * value generic v8 carried is gone from the public surface. Column-level
   * typing still flows through each accessor.
   */
  columns: ColumnDef<DataTableFeatures, TData, unknown>[]
  data: TData[]
  onRowClick?: (row: TData) => void
  emptyMessage?: string
  className?: string
  /** Expose the table instance for external control (e.g. row selection) */
  tableRef?: React.MutableRefObject<TanstackTable<DataTableFeatures, TData> | undefined>
  /** Stable row ids (for `activeRowId` and selection). Default: the row index. */
  getRowId?: (row: TData, index: number) => string
  /**
   * Render only the rows in view, for large lists. Rows get a fixed
   * `rowHeight` (px, so cells should stay one line: TruncatedCell) and the
   * body scrolls inside `height`, under a sticky header.
   */
  virtual?: { rowHeight: number; height: number | string; overscan?: number }
  /** Click a header to sort; shift-click adds a column. Off by default. */
  sortable?: boolean
  /** Controlled view: filters, sorting and column visibility. */
  view?: DataTableView
  /** Starting view when uncontrolled. */
  defaultView?: DataTableView
  onViewChange?: (view: DataTableView) => void
  /**
   * Counts per facet value, from the server: `{ status: { applied: 12 } }`.
   * Replaces the counts DataTable computes from `data` for those columns.
   */
  facetCounts?: Record<string, Record<string, number>>
  /**
   * The server filters and sorts: `data` is shown as given, and the view is
   * only reported through `onViewChange`. Pair with `facetCounts` and `total`.
   */
  manual?: boolean
  /** The unfiltered row count, for "12 of 10,000". Default: `data.length`. */
  total?: number
  /** Named views to choose from in the toolbar, and how to save or delete one. */
  savedViews?: {
    views: SavedView[]
    onSave: (name: string, view: DataTableView) => void
    onDelete?: (id: string) => void
  }
  /**
   * The row to mark as current (`data-active`), e.g. from j/k navigation.
   * It is scrolled into view when it changes.
   */
  activeRowId?: string
  /**
   * Accessible name for a clickable row ("Open Engineer at Acme"), read by
   * screen readers instead of the row's raw cell text. Without it, a
   * clickable row is still focusable and works with Enter/Space; only its
   * announced name is less specific.
   */
  getRowLabel?: (row: TData) => string
  /** A checkbox column, header select-all, and a bulk-actions bar over the toolbar. */
  selectable?: boolean
  /** The selected rows' ids, and to change them (e.g. to clear from outside). */
  selectedRowIds?: readonly string[]
  onSelectedRowIdsChange?: (ids: string[]) => void
  /**
   * Rendered in the bulk-actions bar while rows are selected, e.g.
   * `<Button onClick={() => del(selected)}>Delete</Button>`. Gets the
   * selected rows' original data.
   */
  bulkActions?: (selected: TData[]) => React.ReactNode
  /** A search box in the toolbar, filtering across every visible column's cell text. Off by default. */
  searchable?: boolean | { placeholder?: string }
  /** A "Columns" menu in the toolbar for showing/hiding columns. Give each column a `header` string to name it there. */
  columnsMenu?: boolean
  /**
   * A "Export CSV" button in the toolbar, downloading the current view
   * (filtered, sorted, visible columns) as a file named `${exportFilename}.csv`.
   */
  exportFilename?: string
}

/** Cell wrapper that shows a tooltip when content is truncated. */
function TruncatedCell({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [isTruncated, setIsTruncated] = useState(false)

  // Measure truncation in an effect, not during render — reading scrollWidth in
  // the render body is unsafe (the ref isn't attached yet, and it mutates nothing
  // observable), and breaks under strict/concurrent mode. Re-check on resize (#73 Q14).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setIsTruncated(el.scrollWidth > el.clientWidth)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const content = (
    <div ref={ref} className={cn("truncate", className)}>
      {children}
    </div>
  )

  if (typeof children !== "string" && typeof children !== "number") return content

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      {isTruncated && <TooltipContent>{children}</TooltipContent>}
    </Tooltip>
  )
}

/** Values a cell holds, for faceting: arrays by element, empties dropped. */
function facetKeys(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value]
  return list.filter((v) => v !== null && v !== undefined && v !== "").map((v) => String(v))
}

function facetFilterFn<TData extends RowData>(
  row: Row<DataTableFeatures, TData>,
  columnId: string,
  selected: unknown,
): boolean {
  if (!Array.isArray(selected) || selected.length === 0) return true
  const keys = facetKeys(row.getValue(columnId))
  return keys.some((k) => selected.includes(k))
}
facetFilterFn.autoRemove = (v: unknown) => !Array.isArray(v) || v.length === 0

function textFilterFn<TData extends RowData>(
  row: Row<DataTableFeatures, TData>,
  columnId: string,
  query: unknown,
): boolean {
  const q = String(query ?? "")
    .trim()
    .toLowerCase()
  if (!q) return true
  return String(row.getValue(columnId) ?? "")
    .toLowerCase()
    .includes(q)
}
textFilterFn.autoRemove = (v: unknown) => !String(v ?? "").trim()

/** One CSV field, quoted only when it needs to be (RFC 4180). */
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Downloads `rows` as a CSV file, one column per visible leaf column, in header order. */
function downloadCsv<TData extends RowData>(
  filename: string,
  columns: Array<{ label: string; get: (row: TData) => unknown }>,
  rows: TData[],
): void {
  const lines = [
    columns.map((c) => csvField(c.label)).join(","),
    ...rows.map((row) => columns.map((c) => csvField(c.get(row))).join(",")),
  ]
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function columnLabel<TData extends RowData>(column: Column<DataTableFeatures, TData, unknown>) {
  const meta = column.columnDef.meta
  if (meta?.filterLabel) return meta.filterLabel
  return typeof column.columnDef.header === "string" ? column.columnDef.header : column.id
}

const nf = new Intl.NumberFormat()

function DataTable<TData extends RowData>({
  columns,
  data,
  onRowClick,
  emptyMessage = "No data.",
  className,
  tableRef,
  getRowId,
  virtual,
  sortable = false,
  view,
  defaultView,
  onViewChange,
  facetCounts,
  manual = false,
  total,
  savedViews,
  activeRowId,
  getRowLabel,
  selectable = false,
  selectedRowIds,
  onSelectedRowIdsChange,
  bulkActions,
  searchable = false,
  columnsMenu = false,
  exportFilename,
}: DataTableProps<TData>) {
  const columnResizeMode: ColumnResizeMode = "onChange"
  // Each header is labelled by its own content: otherwise its accessible name
  // takes in the resize handle's label ("Name Resize column name").
  const uid = useId()

  const [ownView, setOwnView] = useState<DataTableView>(() => defaultView ?? EMPTY_VIEW)
  const current = view ?? ownView
  const setView = useCallback(
    (next: DataTableView) => {
      if (!view) setOwnView(next)
      onViewChange?.(next)
    },
    [view, onViewChange],
  )

  // A filterable column gets its filter function; everything else is as given.
  // `selectable` adds a checkbox column, first, sized and not resizable.
  const cols = useMemo(() => {
    const withFilterFn = columns.map((c) => {
      const kind = c.meta?.filter
      if (kind === "facet") return { filterFn: facetFilterFn, ...c }
      if (kind === "text") return { filterFn: textFilterFn, ...c }
      return c
    }) as ColumnDef<DataTableFeatures, TData, unknown>[]
    if (!selectable) return withFilterFn
    const selectColumn: ColumnDef<DataTableFeatures, TData, unknown> = {
      id: "__select__",
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all rows"
          checked={
            table.getIsAllRowsSelected()
              ? true
              : table.getIsSomeRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(v) => table.toggleAllRowsSelected(v === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Select row ${row.id}`}
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(v === true)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableResizing: false,
      enableSorting: false,
      size: 32,
      minSize: 32,
    }
    return [selectColumn, ...withFilterFn]
  }, [columns, selectable])

  // Selection: controlled by id, converted to/against the table's own
  // Record<id, true> shape. Kept separate from `view` — selection is
  // ephemeral per session, not something a saved view should restore.
  const [ownSelection, setOwnSelection] = useState<RowSelectionState>({})
  const rowSelection =
    selectedRowIds !== undefined
      ? Object.fromEntries(selectedRowIds.map((id) => [id, true as const]))
      : ownSelection
  const setRowSelection = useCallback(
    (next: RowSelectionState) => {
      if (selectedRowIds === undefined) setOwnSelection(next)
      onSelectedRowIdsChange?.(Object.keys(next))
    },
    [selectedRowIds, onSelectedRowIdsChange],
  )

  const searchColumns = useMemo(
    () => columns.filter((c) => c.meta?.filter !== "facet"), // facet values rarely help free-text search
    [columns],
  )
  const globalFilterFn = useCallback(
    (row: Row<DataTableFeatures, TData>, _columnId: string, query: unknown) => {
      const q = String(query ?? "")
        .trim()
        .toLowerCase()
      if (!q) return true
      return searchColumns.some((c) => {
        if (!("accessorKey" in c) || typeof c.accessorKey !== "string") return false
        return String(row.getValue(c.accessorKey) ?? "")
          .toLowerCase()
          .includes(q)
      })
    },
    [searchColumns],
  )

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns: cols,
    columnResizeMode,
    enableSorting: sortable,
    enableRowSelection: selectable,
    manualFiltering: manual,
    manualSorting: manual,
    globalFilterFn,
    ...(getRowId ? { getRowId } : {}),
    state: {
      columnFilters: current.filters as ColumnFiltersState,
      sorting: current.sorting as SortingState,
      columnVisibility: current.columnVisibility as ColumnVisibilityState,
      globalFilter: current.search ?? "",
      rowSelection,
    },
    onColumnFiltersChange: (u) => {
      const filters = typeof u === "function" ? u(current.filters as ColumnFiltersState) : u
      setView({ ...current, filters })
    },
    onSortingChange: (u) => {
      const sorting = typeof u === "function" ? u(current.sorting as SortingState) : u
      setView({ ...current, sorting })
    },
    onColumnVisibilityChange: (u) => {
      const columnVisibility =
        typeof u === "function" ? u(current.columnVisibility as ColumnVisibilityState) : u
      setView({ ...current, columnVisibility })
    },
    onGlobalFilterChange: (u) => {
      const search = typeof u === "function" ? u(current.search ?? "") : u
      setView({ ...current, search })
    },
    onRowSelectionChange: (u) => {
      setRowSelection(typeof u === "function" ? u(rowSelection) : u)
    },
  })

  // Expose the table instance via the ref in an effect, not during render
  // (render-body side-effects break strict/concurrent mode) (#73 Q14).
  useEffect(() => {
    if (tableRef) tableRef.current = table
  }, [tableRef, table])

  const rows = table.getRowModel().rows
  const filterColumns = table.getAllLeafColumns().filter((c) => c.columnDef.meta?.filter)
  const showToolbar =
    filterColumns.length > 0 || !!savedViews || !!searchable || columnsMenu || !!exportFilename
  const selectedCount = Object.keys(rowSelection).length

  // --- virtual window ---
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(() =>
    typeof virtual?.height === "number" ? virtual.height : 600,
  )
  useEffect(() => {
    const el = scrollRef.current
    if (!virtual || !el || typeof ResizeObserver === "undefined") return
    const measure = () => {
      if (el.clientHeight > 0) setViewport(el.clientHeight)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [virtual])

  const rowHeight = virtual?.rowHeight ?? 0
  const overscan = virtual?.overscan ?? 8
  const start = virtual ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan) : 0
  const end = virtual
    ? Math.min(rows.length, Math.ceil((scrollTop + viewport) / rowHeight) + overscan)
    : rows.length
  const shown = virtual ? rows.slice(start, end) : rows

  // Bring the active row into view when it changes.
  const activeIndex = activeRowId === undefined ? -1 : rows.findIndex((r) => r.id === activeRowId)
  useEffect(() => {
    if (activeIndex < 0) return
    const el = scrollRef.current
    if (virtual && el) {
      const header = el.querySelector("thead")?.getBoundingClientRect().height ?? 0
      const top = activeIndex * rowHeight
      const view = el.clientHeight > 0 ? el.clientHeight : viewport
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + rowHeight > el.scrollTop + view - header)
        el.scrollTop = top + rowHeight - view + header
      setScrollTop(el.scrollTop)
      return
    }
    const rowEl = el?.querySelector(`[data-row-index="${activeIndex}"]`) as HTMLElement | null
    rowEl?.scrollIntoView?.({ block: "nearest" })
  }, [activeIndex, virtual, rowHeight, viewport])

  const colSpan = Math.max(table.getVisibleLeafColumns().length, 1)
  const unfiltered = total ?? (manual ? data.length : table.getPreFilteredRowModel().rows.length)

  const exportCsv = () => {
    if (!exportFilename) return
    const visible = table.getVisibleLeafColumns().filter((c) => c.id !== "__select__")
    downloadCsv(
      exportFilename,
      visible.map((c) => ({
        label: columnLabel(c),
        get: (row: TData) =>
          "accessorKey" in c.columnDef && typeof c.columnDef.accessorKey === "string"
            ? (row as Record<string, unknown>)[c.columnDef.accessorKey]
            : "",
      })),
      rows.map((r) => r.original),
    )
  }

  return (
    <TooltipProvider>
      <div className={cn("flex flex-col gap-2", !showToolbar && !selectedCount && "contents")}>
        {selectable && selectedCount > 0 && (
          <div
            data-slot="data-table-bulk-bar"
            className="flex flex-wrap items-center gap-2 rounded-lg bg-bg-elevated px-3 py-1.5"
          >
            <span className="text-[12px] font-medium text-text-primary">
              {nf.format(selectedCount)} selected
            </span>
            <button
              type="button"
              onClick={() => setRowSelection({})}
              className="text-[12px] text-text-muted hover:text-text-primary"
            >
              Clear
            </button>
            <div className="ml-auto flex items-center gap-2">
              {bulkActions?.(table.getSelectedRowModel().rows.map((r) => r.original))}
            </div>
          </div>
        )}
        {showToolbar && (
          <div data-slot="data-table-toolbar" className="flex flex-wrap items-center gap-2">
            {searchable && (
              <input
                type="search"
                aria-label="Search"
                placeholder={
                  (typeof searchable === "object" && searchable.placeholder) || "Search…"
                }
                value={current.search ?? ""}
                onChange={(e) => table.setGlobalFilter(e.target.value)}
                className="h-8 w-48 rounded-lg border border-border-default bg-bg-elevated px-2.5 text-[13px] text-text-primary outline-none placeholder:text-text-muted focus-visible:border-ring"
              />
            )}
            {filterColumns.map((column) =>
              column.columnDef.meta?.filter === "text" ? (
                <TextFilter key={column.id} column={column} />
              ) : (
                <FacetFilter key={column.id} column={column} counts={facetCounts?.[column.id]} />
              ),
            )}
            {(current.filters.length > 0 || !!current.search) && (
              <button
                type="button"
                onClick={() => setView({ ...current, filters: [], search: "" })}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-text-muted hover:bg-bg-elevated hover:text-text-primary"
              >
                <X className="size-3.5" aria-hidden />
                Reset
              </button>
            )}
            <span
              data-slot="data-table-count"
              className="ml-auto text-[12px] text-text-muted tabular-nums"
            >
              {rows.length === unfiltered
                ? `${nf.format(unfiltered)} rows`
                : `${nf.format(rows.length)} of ${nf.format(unfiltered)}`}
            </span>
            {exportFilename && (
              <button
                type="button"
                onClick={exportCsv}
                className="inline-flex h-8 items-center rounded-lg border border-border-default px-2.5 text-[12px] text-text-secondary hover:bg-bg-elevated"
              >
                Export CSV
              </button>
            )}
            {columnsMenu && <ColumnsMenu table={table} />}
            {savedViews && <ViewPicker current={current} setView={setView} {...savedViews} />}
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
          style={virtual ? { height: virtual.height } : undefined}
          className={cn(
            "rounded-lg border border-border-default",
            virtual ? "overflow-auto" : "overflow-x-auto overflow-y-clip",
            className,
          )}
        >
          <Table
            className="table-fixed"
            style={{ width: Math.max(table.getCenterTotalSize(), 0) || "100%" }}
            {...(virtual ? { "aria-rowcount": rows.length + 1 } : {})}
          >
            <TableHeader className={cn(virtual && "sticky top-0 z-10 bg-bg-surface")}>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="bg-bg-surface/50 hover:bg-bg-surface/50"
                  {...(virtual ? { "aria-rowindex": 1 } : {})}
                >
                  {headerGroup.headers.map((header) => {
                    const canSort = !header.isPlaceholder && header.column.getCanSort()
                    const sorted = header.column.getIsSorted()
                    const label = header.isPlaceholder ? null : (
                      <span id={`${uid}-${header.id}`}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                    )
                    return (
                      <TableHead
                        key={header.id}
                        aria-labelledby={header.isPlaceholder ? undefined : `${uid}-${header.id}`}
                        aria-sort={
                          canSort
                            ? sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                                ? "descending"
                                : "none"
                            : undefined
                        }
                        style={{ width: header.getSize() }}
                        className="relative select-none"
                      >
                        {canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1 uppercase hover:text-text-primary"
                          >
                            {label}
                            {sorted === "asc" ? (
                              <ArrowUp className="size-3" aria-hidden />
                            ) : sorted === "desc" ? (
                              <ArrowDown className="size-3" aria-hidden />
                            ) : (
                              <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                            )}
                          </button>
                        ) : (
                          label
                        )}
                        {header.column.getCanResize() && (
                          <>
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col gap-[2px] items-center pointer-events-none opacity-30">
                              <div className="w-[3px] h-[3px] rounded-full bg-text-muted" />
                              <div className="w-[3px] h-[3px] rounded-full bg-text-muted" />
                              <div className="w-[3px] h-[3px] rounded-full bg-text-muted" />
                            </div>
                            {/* Keyboard: focus the handle, Arrow keys resize (Shift for bigger steps), Home resets. */}
                            {/* biome-ignore lint/a11y/useSemanticElements: a focusable, resizable separator is WAI-ARIA's window-splitter pattern; <hr> cannot take focus or keys */}
                            <div
                              role="separator"
                              aria-orientation="vertical"
                              aria-label={`Resize column ${header.column.id}`}
                              aria-valuenow={header.getSize()}
                              aria-valuemin={header.column.columnDef.minSize ?? MIN_COLUMN_PX}
                              tabIndex={0}
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              onDoubleClick={() => header.column.resetSize()}
                              onKeyDown={(e) => {
                                if (e.key === "Home") {
                                  e.preventDefault()
                                  header.column.resetSize()
                                  return
                                }
                                const step = e.shiftKey ? 50 : 10
                                const delta =
                                  e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0
                                if (!delta) return
                                e.preventDefault()
                                const min = header.column.columnDef.minSize ?? MIN_COLUMN_PX
                                const next = Math.max(min, header.getSize() + delta)
                                table.setColumnSizing((old) => ({
                                  ...old,
                                  [header.column.id]: next,
                                }))
                              }}
                              className={cn(
                                "absolute right-0 top-0 w-2 cursor-col-resize select-none touch-none transition-opacity",
                                "focus-visible:opacity-100 focus-visible:outline-none focus-visible:border-r focus-visible:border-ring",
                                header.column.getIsResizing()
                                  ? "opacity-100 border-r border-dashed border-primary"
                                  : "opacity-0 hover:opacity-100",
                                "h-[9999px]",
                              )}
                            />
                          </>
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.length ? (
                <>
                  {virtual && start > 0 && (
                    <tr
                      aria-hidden
                      data-slot="data-table-spacer"
                      style={{ height: start * rowHeight }}
                    />
                  )}
                  {shown.map((row, i) => {
                    const index = start + i
                    return (
                      <TableRow
                        key={row.id}
                        data-row-index={index}
                        data-active={row.id === activeRowId || undefined}
                        {...(virtual ? { "aria-rowindex": index + 2 } : {})}
                        style={virtual ? { height: rowHeight } : undefined}
                        onClick={() => onRowClick?.(row.original)}
                        // Keyboard access for clickable rows (#73 LOW): Enter/Space activate.
                        onKeyDown={
                          onRowClick
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault()
                                  onRowClick(row.original)
                                }
                              }
                            : undefined
                        }
                        // Focusable and activatable, but NOT role="button": that would
                        // replace the row's table semantics (its cell position and
                        // headers) with a button's — what a screen reader user loses
                        // navigating the table (#73 LOW originally chose button; this
                        // keeps <tr>'s own row role and names the row instead).
                        tabIndex={onRowClick ? 0 : undefined}
                        aria-label={onRowClick ? getRowLabel?.(row.original) : undefined}
                        className={cn(
                          onRowClick && "cursor-pointer",
                          "data-[active=true]:bg-bg-elevated",
                        )}
                        data-state={row.getIsSelected() && "selected"}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} style={{ width: cell.column.getSize() }}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    )
                  })}
                  {virtual && end < rows.length && (
                    <tr
                      aria-hidden
                      data-slot="data-table-spacer"
                      style={{ height: (rows.length - end) * rowHeight }}
                    />
                  )}
                </>
              ) : (
                <TableRow>
                  <TableCell colSpan={colSpan} className="h-24 text-center text-text-muted">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </TooltipProvider>
  )
}

function TextFilter<TData extends RowData>({
  column,
}: {
  column: Column<DataTableFeatures, TData, unknown>
}) {
  const label = columnLabel(column)
  return (
    <input
      type="search"
      aria-label={`Filter ${label}`}
      placeholder={`${label}…`}
      value={String(column.getFilterValue() ?? "")}
      onChange={(e) => column.setFilterValue(e.target.value)}
      className="h-8 w-44 rounded-lg border border-border-default bg-bg-elevated px-2.5 text-[13px] text-text-primary outline-none placeholder:text-text-muted focus-visible:border-ring"
    />
  )
}

function FacetFilter<TData extends RowData>({
  column,
  counts,
}: {
  column: Column<DataTableFeatures, TData, unknown>
  counts?: Record<string, number>
}) {
  const label = columnLabel(column)
  const uid = useId()
  const selected = (column.getFilterValue() as string[] | undefined) ?? []
  // Counts reflect every other filter, not this one: a value's count is how
  // many rows picking it would add.
  const options = useMemo(() => {
    let tally: Map<string, number>
    if (counts) tally = new Map(Object.entries(counts))
    else {
      tally = new Map()
      for (const row of column.getFacetedRowModel().rows)
        for (const k of facetKeys(row.getValue(column.id))) tally.set(k, (tally.get(k) ?? 0) + 1)
    }
    for (const s of selected) if (!tally.has(s)) tally.set(s, 0)
    return [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [counts, column, selected])

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value]
    column.setFilterValue(next.length ? next : undefined)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="data-table-facet"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border-default px-2.5 text-[12px] text-text-secondary hover:bg-bg-elevated",
            selected.length > 0 && "border-solid text-text-primary",
          )}
        >
          <ListFilter className="size-3.5" aria-hidden />
          {label}
          {selected.length > 0 && (
            <span className="rounded bg-bg-elevated px-1 tabular-nums">{selected.length}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <ul aria-label={`${label} values`} className="max-h-72 overflow-y-auto">
          {options.map(([value, count], i) => {
            const id = `${uid}-${i}`
            return (
              <li key={value}>
                <label
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-bg-elevated"
                >
                  <Checkbox
                    id={id}
                    aria-label={`${value} (${nf.format(count)})`}
                    checked={selected.includes(value)}
                    onCheckedChange={() => toggle(value)}
                  />
                  <span className="min-w-0 flex-1 truncate">{value}</span>
                  <span className="text-[11px] text-text-muted tabular-nums">
                    {nf.format(count)}
                  </span>
                </label>
              </li>
            )
          })}
          {options.length === 0 && (
            <li className="px-2 py-1.5 text-[13px] text-text-muted">No values</li>
          )}
        </ul>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => column.setFilterValue(undefined)}
            className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[12px] text-text-muted hover:bg-bg-elevated"
          >
            Clear {label}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Toggle which columns are visible. Skips the checkbox column and any column with `enableHiding: false`. */
function ColumnsMenu<TData extends RowData>({
  table,
}: {
  table: TanstackTable<DataTableFeatures, TData>
}) {
  const columns = table
    .getAllLeafColumns()
    .filter((c) => c.id !== "__select__" && c.columnDef.enableHiding !== false)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="data-table-columns"
          className="inline-flex h-8 items-center rounded-lg border border-border-default px-2.5 text-[12px] text-text-secondary hover:bg-bg-elevated"
        >
          Columns
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <ul aria-label="Toggle columns">
          {columns.map((column) => {
            const id = `col-${column.id}`
            return (
              <li key={column.id}>
                <label
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-bg-elevated"
                >
                  <Checkbox
                    id={id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(v) => column.toggleVisibility(v === true)}
                  />
                  <span className="min-w-0 flex-1 truncate">{columnLabel(column)}</span>
                </label>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function ViewPicker({
  current,
  setView,
  views,
  onSave,
  onDelete,
}: {
  current: DataTableView
  setView: (v: DataTableView) => void
  views: SavedView[]
  onSave: (name: string, view: DataTableView) => void
  onDelete?: (id: string) => void
}) {
  const [name, setName] = useState("")
  const [open, setOpen] = useState(false)
  const save = () => {
    const n = name.trim()
    if (!n) return
    onSave(n, current)
    setName("")
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="data-table-views"
          className="inline-flex h-8 items-center rounded-lg border border-border-default px-2.5 text-[12px] text-text-secondary hover:bg-bg-elevated"
        >
          Views
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <ul aria-label="Saved views">
          {views.map((v) => (
            <li key={v.id} className="flex items-center">
              <button
                type="button"
                onClick={() => {
                  setView(v.view)
                  setOpen(false)
                }}
                className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-bg-elevated"
              >
                {v.name}
              </button>
              {onDelete && (
                <button
                  type="button"
                  aria-label={`Delete view ${v.name}`}
                  onClick={() => onDelete(v.id)}
                  className="rounded-md p-1.5 text-text-muted hover:bg-bg-elevated hover:text-text-primary"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
          {views.length === 0 && (
            <li className="px-2 py-1.5 text-[13px] text-text-muted">No saved views</li>
          )}
        </ul>
        <form
          className="mt-1 flex gap-1 border-t border-border-subtle p-1 pt-2"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <input
            aria-label="View name"
            placeholder="Save current view as…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded-md border border-border-default bg-bg-elevated px-2 text-[12px] outline-none"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="h-7 rounded-md bg-primary/12 px-2 text-[12px] text-primary disabled:opacity-40"
          >
            Save
          </button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

export type { DataTableProps }
export { DataTable, TruncatedCell }
