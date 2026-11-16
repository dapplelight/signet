"use client"

// A spreadsheet-like grid on the same react-table core and Table parts as
// DataTable: inline editing (text, number, select, date, checkbox), keyboard
// navigation with one tab stop, range copy and paste as TSV, row selection,
// column sort and resize, optimistic saves with an error per cell, and
// virtualised rows for 10k+ rows.
// Recipe: roving-focus + selection + controllable-state + live-region
import {
  type ColumnDef,
  columnResizingFeature,
  columnSizingFeature,
  createSortedRowModel,
  flexRender,
  type RowSelectionState,
  rowSelectionFeature,
  rowSortingFeature,
  type SortingState,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import type * as React from "react"
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { parseCsv, toCsv } from "../../lib/csv.js"
import { cn } from "../../lib/utils.js"
import { Checkbox } from "./checkbox.js"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.js"

const MIN_COLUMN_PX = 40
const SELECT_ID = "__select__"

const gridFeatures = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic, text: sortFn_text },
})
type GridFeatures = typeof gridFeatures

export type DataGridCellType = "text" | "number" | "select" | "date" | "checkbox"

export type DataGridColumn<T> = {
  /** The row key this column reads and writes. */
  id: keyof T & string
  header: string
  /** Editor and paste parsing. Default "text". Dates are `YYYY-MM-DD` strings. */
  type?: DataGridCellType
  /** Choices for `type: "select"`. Pasted text matches a value or a label. */
  options?: ReadonlyArray<{ value: string; label: string }>
  /** Default true. */
  editable?: boolean
  /** Default true. */
  sortable?: boolean
  /** Starting width in px. Default 160. */
  width?: number
  minWidth?: number
  /** How the value shows when not editing. */
  format?: (value: unknown, row: T) => React.ReactNode
  /** Text (typed or pasted) to a value. Return `{ error }` to refuse it. Default: by `type`. */
  parse?: (text: string, row: T) => { value: unknown } | { error: string }
  /** A message to refuse a parsed value before it is saved. */
  validate?: (value: unknown, row: T) => string | undefined
}

export type DataGridChange<T> = { rowId: string; columnId: string; value: unknown; row: T }

/** A change `onChange` could not save, and why. */
export type DataGridFailure = { rowId: string; columnId: string; error: string }

const nf = new Intl.NumberFormat()

export const DEFAULT_DATA_GRID_LABELS = {
  empty: "No rows.",
  selectAll: "Select all rows",
  selectRow: (rowId: string) => `Select row ${rowId}`,
  selected: (n: number) => `${nf.format(n)} selected`,
  resize: (header: string) => `Resize column ${header}`,
  saveFailed: "Couldn't save. Try again.",
  notNumber: "Enter a number.",
  notDate: "Enter a date as YYYY-MM-DD.",
  notOption: (labels: string) => `Choose one of: ${labels}.`,
  notBoolean: "Enter true or false.",
  failedAnnouncement: (header: string, error: string) => `${header}: ${error}`,
}
export type DataGridLabels = typeof DEFAULT_DATA_GRID_LABELS

type Part = "root" | "table" | "header" | "headerCell" | "row" | "cell" | "editor" | "error"

export type DataGridProps<T extends object> = {
  columns: ReadonlyArray<DataGridColumn<T>>
  rows: T[]
  getRowId: (row: T, index: number) => string
  /**
   * Edits, pastes and clears, as a batch. The grid shows the new values at
   * once; a throw puts them back with the error on each cell, and returned
   * failures do that for just those cells. Apply successful changes to `rows`.
   */
  onChange?: (
    changes: DataGridChange<T>[],
  ) => Promise<DataGridFailure[] | undefined> | DataGridFailure[] | undefined
  /** A checkbox column and Shift+Space to select rows. */
  selectable?: boolean
  selectedRowIds?: readonly string[]
  onSelectedRowIdsChange?: (ids: string[]) => void
  /** Row height in px; rows are one line. Default 36. */
  rowHeight?: number
  /** Height of the scrolling body. Default 480. */
  height?: number | string
  overscan?: number
  "aria-label"?: string
  "aria-labelledby"?: string
  labels?: Partial<DataGridLabels>
  className?: string
  classNames?: Partial<Record<Part, string>>
}

type Pos = { r: number; c: number }
type Editing = Pos & { draft: string; error?: string }

const keyOf = (rowId: string, colId: string) => `${rowId}\u0000${colId}`
const read = (row: object, id: string) => (row as Record<string, unknown>)[id]

const TRUE = /^(true|1|yes|y|x|on|✓)$/i
const FALSE = /^(false|0|no|n|off|)$/i

/** Text to a value for a column type. */
export function parseCell(
  type: DataGridCellType,
  text: string,
  options: DataGridColumn<unknown>["options"] = [],
  labels: DataGridLabels = DEFAULT_DATA_GRID_LABELS,
): { value: unknown } | { error: string } {
  const t = text.trim()
  switch (type) {
    case "number": {
      if (t === "") return { value: null }
      const n = Number(t.replace(/[,\s_]/g, ""))
      return Number.isFinite(n) ? { value: n } : { error: labels.notNumber }
    }
    case "date": {
      if (t === "") return { value: null }
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
      const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null
      return d && d.toISOString().slice(0, 10) === t ? { value: t } : { error: labels.notDate }
    }
    case "checkbox":
      if (TRUE.test(t)) return { value: true }
      if (FALSE.test(t)) return { value: false }
      return { error: labels.notBoolean }
    case "select": {
      if (t === "") return { value: null }
      const lower = t.toLowerCase()
      const o = options.find((o) => o.value === t || o.label.toLowerCase() === lower)
      return o
        ? { value: o.value }
        : { error: labels.notOption(options.map((o) => o.label).join(", ")) }
    }
    default:
      return { value: text }
  }
}

/** A value as text, for copying and for the editor's starting draft. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

export function DataGrid<T extends object>({
  columns,
  rows,
  getRowId,
  onChange,
  selectable = false,
  selectedRowIds,
  onSelectedRowIdsChange,
  rowHeight = 36,
  height = 480,
  overscan = 8,
  labels: labelsProp,
  className,
  classNames = {},
  ...aria
}: DataGridProps<T>) {
  const labels = useMemo(() => ({ ...DEFAULT_DATA_GRID_LABELS, ...labelsProp }), [labelsProp])
  const uid = useId()

  // --- optimistic values, saves in flight, errors ---
  const [overlay, setOverlay] = useState<Map<string, { value: unknown; seq: number }>>(new Map())
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [announcement, setAnnouncement] = useState("")
  const seq = useRef(0)
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  // New rows from the app mean saved values are in them: drop settled overlays.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the app passes new rows
  useEffect(() => {
    setOverlay((o) => {
      if (o.size === 0) return o
      const next = new Map([...o].filter(([k]) => pendingRef.current.has(k)))
      return next.size === o.size ? o : next
    })
  }, [rows])

  const cellValue = (row: T, rowId: string, colId: string) => {
    const o = overlay.get(keyOf(rowId, colId))
    return o ? o.value : read(row, colId)
  }

  // --- react-table: sort, sizing, selection ---
  const [sorting, setSorting] = useState<SortingState>([])
  const [ownSelection, setOwnSelection] = useState<RowSelectionState>({})
  const rowSelection =
    selectedRowIds !== undefined
      ? Object.fromEntries(selectedRowIds.map((id) => [id, true as const]))
      : ownSelection
  const setRowSelection = (next: RowSelectionState) => {
    if (selectedRowIds === undefined) setOwnSelection(next)
    onSelectedRowIdsChange?.(Object.keys(next).filter((k) => next[k]))
  }

  const defs = useMemo(() => {
    const data: ColumnDef<GridFeatures, T, unknown>[] = columns.map((c) => ({
      id: c.id,
      accessorFn: (row: T) => read(row, c.id),
      header: c.header,
      size: c.width ?? 160,
      minSize: c.minWidth ?? MIN_COLUMN_PX,
      enableSorting: c.sortable !== false,
      sortFn: c.type === "number" || c.type === "checkbox" ? "basic" : "alphanumeric",
      sortUndefined: "last",
      sortDescFirst: false,
    }))
    if (!selectable) return data
    return [
      {
        id: SELECT_ID,
        header: "",
        size: 40,
        minSize: 40,
        enableResizing: false,
        enableSorting: false,
      } as ColumnDef<GridFeatures, T, unknown>,
      ...data,
    ]
  }, [columns, selectable])

  const table = useTable({
    features: gridFeatures,
    data: rows,
    columns: defs,
    columnResizeMode: "onChange",
    enableRowSelection: selectable,
    getRowId,
    state: { sorting, rowSelection },
    onSortingChange: (u) => setSorting(typeof u === "function" ? u(sorting) : u),
    onRowSelectionChange: (u) => setRowSelection(typeof u === "function" ? u(rowSelection) : u),
  })
  const shownRows = table.getRowModel().rows
  const leaf = table.getAllLeafColumns()
  /** Column index -> the app's column, undefined for the checkbox column. */
  const colAt = (c: number) => columns.find((x) => x.id === leaf[c]?.id)
  const firstDataCol = selectable ? 1 : 0

  // --- position, range, editing ---
  const [active, setActive] = useState<Pos>({ r: 0, c: firstDataCol })
  const [anchor, setAnchor] = useState<Pos>(active)
  const [editing, setEditingState] = useState<Editing | null>(null)
  // Mirrors `editing` synchronously, so a blur right after Enter or Escape finds it closed.
  const editingRef = useRef<Editing | null>(null)
  const setEditing = (e: Editing | null) => {
    editingRef.current = e
    setEditingState(e)
  }
  const focusNext = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(typeof height === "number" ? height : 480)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const measure = () => el.clientHeight > 0 && setViewport(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const maxR = shownRows.length - 1
  const maxC = leaf.length - 1
  const clampPos = (p: Pos): Pos => ({
    r: Math.max(0, Math.min(maxR, p.r)),
    c: Math.max(0, Math.min(maxC, p.c)),
  })
  // Keep the cursor inside the grid when rows or columns go away.
  if (shownRows.length > 0 && (active.r > maxR || active.c > maxC)) {
    const p = clampPos(active)
    setActive(p)
    setAnchor(p)
  }

  const range = {
    r0: Math.min(active.r, anchor.r),
    r1: Math.max(active.r, anchor.r),
    c0: Math.min(active.c, anchor.c),
    c1: Math.max(active.c, anchor.c),
  }
  const inRange = (r: number, c: number) =>
    r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1

  const header = scrollRef.current?.querySelector("thead")?.getBoundingClientRect().height ?? 0
  const scrollToRow = (r: number) => {
    const el = scrollRef.current
    if (!el) return
    const top = r * rowHeight
    const view = (el.clientHeight || viewport) - header
    let next = el.scrollTop
    if (top < next) next = top
    else if (top + rowHeight > next + view) next = top + rowHeight - view
    if (next !== el.scrollTop) {
      el.scrollTop = next
      setScrollTop(next)
    }
  }

  const moveTo = (p: Pos, extend = false) => {
    const next = clampPos(p)
    setActive(next)
    if (!extend) setAnchor(next)
    focusNext.current = true
    scrollToRow(next.r)
  }

  // Focus follows the active cell after it renders (it may have scrolled in).
  useLayoutEffect(() => {
    if (!focusNext.current || editing) return
    focusNext.current = false
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-row-index="${active.r}"] [data-col-index="${active.c}"]`)
      ?.focus()
  })

  // --- saving ---
  const save = async (changes: DataGridChange<T>[]) => {
    if (changes.length === 0) return
    const mine = ++seq.current
    const keys = changes.map((ch) => keyOf(ch.rowId, ch.columnId))
    setOverlay((o) => {
      const n = new Map(o)
      for (const ch of changes) n.set(keyOf(ch.rowId, ch.columnId), { value: ch.value, seq: mine })
      return n
    })
    setPending((p) => new Set([...p, ...keys]))
    setErrors((e) => {
      const n = new Map(e)
      for (const k of keys) n.delete(k)
      return n
    })
    let failed: DataGridFailure[] = []
    try {
      failed = (await onChange?.(changes)) ?? []
    } catch (e) {
      const error = (e instanceof Error && e.message) || labels.saveFailed
      failed = changes.map((ch) => ({ rowId: ch.rowId, columnId: ch.columnId, error }))
    }
    if (failed.length) {
      // Put back only values this save still owns; a later edit wins.
      setOverlay((o) => {
        const n = new Map(o)
        for (const f of failed) {
          const k = keyOf(f.rowId, f.columnId)
          if (n.get(k)?.seq === mine) n.delete(k)
        }
        return n
      })
      setErrors((e) => {
        const n = new Map(e)
        for (const f of failed) n.set(keyOf(f.rowId, f.columnId), f.error || labels.saveFailed)
        return n
      })
      const first = failed[0] as DataGridFailure
      const col = columns.find((c) => c.id === first.columnId)
      setAnnouncement(labels.failedAnnouncement(col?.header ?? first.columnId, first.error))
    }
    setPending((p) => {
      const n = new Set(p)
      for (const k of keys) n.delete(k)
      return n
    })
  }

  const parse = (col: DataGridColumn<T>, text: string, row: T) => {
    const r = col.parse
      ? col.parse(text, row)
      : parseCell(col.type ?? "text", text, col.options, labels)
    if ("error" in r) return r
    const invalid = col.validate?.(r.value, row)
    return invalid ? { error: invalid } : r
  }

  const setCellError = (rowId: string, colId: string, error: string | undefined) =>
    setErrors((e) => {
      const n = new Map(e)
      if (error) n.set(keyOf(rowId, colId), error)
      else n.delete(keyOf(rowId, colId))
      return n
    })

  const isEditable = (col: DataGridColumn<T> | undefined): col is DataGridColumn<T> =>
    !!col && col.editable !== false && !!onChange

  /** Close the editor, saving its draft. False (editor stays open) when the draft is refused. */
  const commit = (e: Editing): boolean => {
    const row = shownRows[e.r]
    const col = colAt(e.c)
    if (!row || !col) return true
    const r = parse(col, e.draft, row.original)
    if ("error" in r) {
      setEditing({ ...e, error: r.error })
      return false
    }
    setEditing(null)
    if (!Object.is(r.value, cellValue(row.original, row.id, col.id)))
      void save([{ rowId: row.id, columnId: col.id, value: r.value, row: row.original }])
    return true
  }

  const startEdit = (p: Pos, draft?: string) => {
    const row = shownRows[p.r]
    const col = colAt(p.c)
    if (!row) return
    if (!col) {
      row.toggleSelected()
      return
    }
    if (!isEditable(col)) return
    if (col.type === "checkbox") {
      void save([
        {
          rowId: row.id,
          columnId: col.id,
          value: !cellValue(row.original, row.id, col.id),
          row: row.original,
        },
      ])
      return
    }
    setEditing({ ...p, draft: draft ?? cellText(cellValue(row.original, row.id, col.id)) })
  }

  const clearRange = () => {
    const changes: DataGridChange<T>[] = []
    for (let r = range.r0; r <= range.r1; r++) {
      const row = shownRows[r]
      if (!row) continue
      for (let c = range.c0; c <= range.c1; c++) {
        const col = colAt(c)
        if (!isEditable(col)) continue
        const value = col.type === "checkbox" ? false : col.type === "text" || !col.type ? "" : null
        if (!Object.is(value, cellValue(row.original, row.id, col.id)))
          changes.push({ rowId: row.id, columnId: col.id, value, row: row.original })
      }
    }
    void save(changes)
  }

  const copyText = () => {
    const out: string[][] = []
    for (let r = range.r0; r <= range.r1; r++) {
      const row = shownRows[r]
      if (!row) continue
      const line: string[] = []
      for (let c = range.c0; c <= range.c1; c++) {
        const col = colAt(c)
        if (col) line.push(cellText(cellValue(row.original, row.id, col.id)))
      }
      if (line.length) out.push(line)
    }
    return toCsv(out, "\t")
  }

  const paste = (text: string) => {
    const grid = parseCsv(text.replace(/\r?\n$/, ""), { delimiter: "\t" })
    if (grid.length === 0) return
    // One value into a selected range fills it; otherwise the block starts at the top-left cell.
    const fill = grid.length === 1 && grid[0]?.length === 1
    const rowsN = fill ? range.r1 - range.r0 + 1 : grid.length
    const colsN = fill ? range.c1 - range.c0 + 1 : Math.max(...grid.map((g) => g.length))
    const changes: DataGridChange<T>[] = []
    for (let i = 0; i < rowsN; i++) {
      const row = shownRows[range.r0 + i]
      if (!row) break
      for (let j = 0; j < colsN; j++) {
        const col = colAt(range.c0 + j)
        const text = fill ? grid[0]?.[0] : grid[i]?.[j]
        if (text === undefined || !isEditable(col)) continue
        const r = parse(col, text, row.original)
        if ("error" in r) setCellError(row.id, col.id, r.error)
        else changes.push({ rowId: row.id, columnId: col.id, value: r.value, row: row.original })
      }
    }
    void save(changes)
    setActive({ r: range.r0, c: range.c0 })
    setAnchor(clampPos({ r: range.r0 + rowsN - 1, c: range.c0 + colsN - 1 }))
  }

  const pageRows = Math.max(1, Math.floor((viewport - header) / rowHeight) - 1)

  const onKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    if (editing || !(e.target as HTMLElement).closest?.("[data-col-index]")) return
    if ((e.target as HTMLElement).closest("[data-slot='data-grid-editor']")) return
    const { key, shiftKey } = e
    const mod = e.metaKey || e.ctrlKey
    const go = (p: Pos) => {
      e.preventDefault()
      moveTo(p, shiftKey)
    }
    switch (key) {
      case "ArrowUp":
        return go({ r: mod ? 0 : active.r - 1, c: active.c })
      case "ArrowDown":
        return go({ r: mod ? maxR : active.r + 1, c: active.c })
      case "ArrowLeft":
        return go({ r: active.r, c: mod ? 0 : active.c - 1 })
      case "ArrowRight":
        return go({ r: active.r, c: mod ? maxC : active.c + 1 })
      case "Home":
        return go({ r: mod ? 0 : active.r, c: 0 })
      case "End":
        return go({ r: mod ? maxR : active.r, c: maxC })
      case "PageUp":
        return go({ r: active.r - pageRows, c: active.c })
      case "PageDown":
        return go({ r: active.r + pageRows, c: active.c })
      case "Tab": {
        const c = active.c + (shiftKey ? -1 : 1)
        if (c < 0 || c > maxC) return // leave the grid
        e.preventDefault()
        return moveTo({ r: active.r, c })
      }
      case "Escape":
        e.preventDefault()
        return setAnchor(active)
      case "Enter":
      case "F2":
        e.preventDefault()
        return startEdit(active)
      case " ":
        e.preventDefault()
        if (shiftKey) return shownRows[active.r]?.toggleSelected()
        if (!colAt(active.c) || colAt(active.c)?.type === "checkbox") startEdit(active)
        return
      case "Delete":
      case "Backspace":
        e.preventDefault()
        return clearRange()
    }
    if (mod && key.toLowerCase() === "a") {
      e.preventDefault()
      setAnchor({ r: 0, c: 0 })
      setActive({ r: maxR, c: maxC })
      return
    }
    if (key.length === 1 && !mod && !e.altKey) {
      const col = colAt(active.c)
      if (isEditable(col) && (!col.type || col.type === "text" || col.type === "number")) {
        e.preventDefault()
        startEdit(active, key)
      }
    }
  }

  const finishEdit = (move: Pos | null, e: Editing) => {
    if (!commit(e)) return
    focusNext.current = true
    if (move) moveTo(move)
    else setActive({ r: e.r, c: e.c })
  }

  const editorKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!editing) return
    e.stopPropagation()
    if (e.key === "Escape") {
      e.preventDefault()
      setEditing(null)
      focusNext.current = true
      setActive({ r: editing.r, c: editing.c })
    } else if (e.key === "Enter") {
      e.preventDefault()
      finishEdit({ r: editing.r + (e.shiftKey ? -1 : 1), c: editing.c }, editing)
    } else if (e.key === "Tab") {
      e.preventDefault()
      finishEdit({ r: editing.r, c: editing.c + (e.shiftKey ? -1 : 1) }, editing)
    }
  }

  // --- virtual window ---
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(shownRows.length, Math.ceil((scrollTop + viewport) / rowHeight) + overscan)
  const windowRows = shownRows.slice(start, end)
  const selectedIds = Object.keys(rowSelection)

  const renderEditor = (col: DataGridColumn<T>, e: Editing) => {
    const cls = cn(
      "absolute inset-0 h-full w-full bg-bg-surface px-2 text-sm text-text-primary outline-none ring-2 ring-ring ring-inset aria-invalid:ring-destructive",
      classNames.editor,
    )
    const common = {
      "data-slot": "data-grid-editor",
      "aria-label": col.header,
      "aria-invalid": e.error ? true : undefined,
      "aria-describedby": e.error ? `${uid}-editor-error` : undefined,
      autoFocus: true,
      onKeyDown: editorKeyDown,
      onBlur: () => {
        const cur = editingRef.current
        if (cur && cur.r === e.r && cur.c === e.c) commit(cur)
      },
      className: cls,
    }
    if (col.type === "select")
      return (
        <select
          {...common}
          value={e.draft}
          onChange={(ev) => finishEdit(null, { ...e, draft: ev.target.value })}
        >
          <option value="" />
          {col.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    return (
      <input
        {...common}
        type={col.type === "date" ? "date" : "text"}
        inputMode={col.type === "number" ? "decimal" : undefined}
        value={e.draft}
        onChange={(ev) => setEditing({ ...e, draft: ev.target.value, error: undefined })}
      />
    )
  }

  const display = (col: DataGridColumn<T>, value: unknown, row: T, label: string) => {
    if (col.format) return col.format(value, row)
    switch (col.type) {
      case "checkbox":
        return (
          <Checkbox
            tabIndex={-1}
            aria-label={label}
            checked={!!value}
            disabled={!isEditable(col)}
            onCheckedChange={() => undefined}
            className="pointer-events-none"
          />
        )
      case "number":
        return typeof value === "number" ? nf.format(value) : cellText(value)
      case "select":
        return col.options?.find((o) => o.value === value)?.label ?? cellText(value)
      default:
        return cellText(value)
    }
  }

  return (
    <div
      ref={rootRef}
      data-slot="data-grid"
      className={cn("relative flex flex-col gap-2", classNames.root, className)}
    >
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{ height }}
        className="overflow-auto rounded-lg border border-border-default"
      >
        <Table
          role="grid"
          {...aria}
          aria-rowcount={shownRows.length + 1}
          aria-colcount={leaf.length}
          aria-multiselectable
          data-slot="data-grid-table"
          className={cn("table-fixed", classNames.table)}
          style={{ width: Math.max(table.getCenterTotalSize(), 0) || "100%" }}
          onKeyDown={onKeyDown}
          onCopy={(e) => {
            if (editing) return
            e.preventDefault()
            e.clipboardData?.setData("text/plain", copyText())
          }}
          onPaste={(e) => {
            if (editing || !onChange) return
            e.preventDefault()
            paste(e.clipboardData?.getData("text/plain") ?? "")
          }}
        >
          <TableHeader
            data-slot="data-grid-header"
            className={cn("sticky top-0 z-10 bg-bg-surface", classNames.header)}
          >
            <TableRow aria-rowindex={1} className="hover:bg-transparent">
              {table.getHeaderGroups()[0]?.headers.map((h, c) => {
                const isSelect = h.column.id === SELECT_ID
                const canSort = h.column.getCanSort()
                const sorted = h.column.getIsSorted()
                const text = String(h.column.columnDef.header ?? "")
                return (
                  <TableHead
                    key={h.id}
                    role="columnheader"
                    aria-colindex={c + 1}
                    aria-sort={
                      canSort
                        ? sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                    data-slot="data-grid-header-cell"
                    style={{ width: h.getSize() }}
                    className={cn("relative select-none", classNames.headerCell)}
                  >
                    {isSelect ? (
                      <Checkbox
                        aria-label={labels.selectAll}
                        checked={
                          table.getIsAllRowsSelected()
                            ? true
                            : table.getIsSomeRowsSelected()
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(v) => table.toggleAllRowsSelected(v === true)}
                      />
                    ) : canSort ? (
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 uppercase hover:text-text-primary"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3" aria-hidden />
                        ) : (
                          <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                        )}
                      </button>
                    ) : (
                      text
                    )}
                    {h.column.getCanResize() && (
                      // biome-ignore lint/a11y/useSemanticElements: a focusable, resizable separator is WAI-ARIA's window-splitter pattern; <hr> cannot take focus or keys
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={labels.resize(text)}
                        aria-valuenow={h.getSize()}
                        aria-valuemin={h.column.columnDef.minSize ?? MIN_COLUMN_PX}
                        tabIndex={0}
                        data-slot="data-grid-resize"
                        data-resizing={h.column.getIsResizing() || undefined}
                        onMouseDown={h.getResizeHandler()}
                        onTouchStart={h.getResizeHandler()}
                        onDoubleClick={() => h.column.resetSize()}
                        onKeyDown={(e) => {
                          if (e.key === "Home") {
                            e.preventDefault()
                            h.column.resetSize()
                            return
                          }
                          const step = e.shiftKey ? 50 : 10
                          const delta =
                            e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0
                          if (!delta) return
                          e.preventDefault()
                          const min = h.column.columnDef.minSize ?? MIN_COLUMN_PX
                          table.setColumnSizing((old) => ({
                            ...old,
                            [h.column.id]: Math.max(min, h.getSize() + delta),
                          }))
                        }}
                        className="absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none opacity-0 hover:opacity-100 focus-visible:border-r focus-visible:border-ring focus-visible:opacity-100 focus-visible:outline-none data-resizing:border-r data-resizing:border-dashed data-resizing:border-primary data-resizing:opacity-100"
                      />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shownRows.length === 0 ? (
              <TableRow>
                <TableCell
                  role="gridcell"
                  colSpan={Math.max(leaf.length, 1)}
                  className="h-24 text-center text-text-muted"
                >
                  {labels.empty}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {start > 0 && (
                  <tr
                    aria-hidden
                    data-slot="data-grid-spacer"
                    style={{ height: start * rowHeight }}
                  />
                )}
                {windowRows.map((row, i) => {
                  const r = start + i
                  const selected = row.getIsSelected()
                  return (
                    <TableRow
                      key={row.id}
                      aria-rowindex={r + 2}
                      aria-selected={selectable ? selected : undefined}
                      data-row-index={r}
                      data-state={selected ? "selected" : undefined}
                      data-slot="data-grid-row"
                      style={{ height: rowHeight }}
                      className={cn("hover:bg-transparent", classNames.row)}
                    >
                      {leaf.map((l, c) => {
                        const col = colAt(c)
                        const isActive = active.r === r && active.c === c
                        const k = col ? keyOf(row.id, col.id) : ""
                        const err = col ? errors.get(k) : undefined
                        const edit = editing && editing.r === r && editing.c === c ? editing : null
                        const value = col ? cellValue(row.original, row.id, col.id) : undefined
                        const label = col ? `${col.header}, ${row.id}` : labels.selectRow(row.id)
                        return (
                          <TableCell
                            key={l.id}
                            role="gridcell"
                            aria-colindex={c + 1}
                            aria-selected={inRange(r, c) || undefined}
                            aria-readonly={col && !isEditable(col) ? true : undefined}
                            aria-invalid={err ? true : undefined}
                            aria-describedby={err ? `${uid}-${r}-${c}-error` : undefined}
                            tabIndex={isActive && !edit ? 0 : -1}
                            title={err}
                            data-slot="data-grid-cell"
                            data-col-index={c}
                            data-active={isActive || undefined}
                            data-in-range={
                              inRange(r, c) && (range.r0 !== range.r1 || range.c0 !== range.c1)
                                ? ""
                                : undefined
                            }
                            data-editing={edit ? "" : undefined}
                            data-pending={pending.has(k) || undefined}
                            data-error={err ? "" : undefined}
                            data-type={col?.type ?? (col ? "text" : "select-row")}
                            onFocus={() => {
                              if (!edit && (active.r !== r || active.c !== c)) {
                                setActive({ r, c })
                                setAnchor({ r, c })
                              }
                            }}
                            onMouseDown={(e) => {
                              if (edit) return
                              if (e.shiftKey) e.preventDefault()
                              setActive({ r, c })
                              if (!e.shiftKey) setAnchor({ r, c })
                              focusNext.current = true
                            }}
                            onClick={() => {
                              if (!col) row.toggleSelected()
                              else if (col.type === "checkbox") startEdit({ r, c })
                            }}
                            onDoubleClick={() =>
                              col && col.type !== "checkbox" && startEdit({ r, c })
                            }
                            style={{ width: l.getSize(), height: rowHeight }}
                            className={cn(
                              "relative truncate py-0 outline-none",
                              "data-active:ring-2 data-active:ring-ring data-active:ring-inset",
                              "data-in-range:bg-accent-primary-subtle data-pending:text-text-muted",
                              "data-error:bg-accent-red-subtle data-error:ring-1 data-error:ring-destructive data-error:ring-inset",
                              "data-[type=number]:text-right data-[type=number]:tabular-nums",
                              classNames.cell,
                            )}
                          >
                            {!col ? (
                              <Checkbox
                                tabIndex={-1}
                                aria-label={labels.selectRow(row.id)}
                                checked={selected}
                                onCheckedChange={() => undefined}
                                className="pointer-events-none"
                              />
                            ) : edit ? (
                              renderEditor(col, edit)
                            ) : (
                              display(col, value, row.original, label)
                            )}
                            {err && !edit && (
                              <span
                                id={`${uid}-${r}-${c}-error`}
                                data-slot="data-grid-error"
                                className={cn("sr-only", classNames.error)}
                              >
                                {err}
                              </span>
                            )}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  )
                })}
                {end < shownRows.length && (
                  <tr
                    aria-hidden
                    data-slot="data-grid-spacer"
                    style={{ height: (shownRows.length - end) * rowHeight }}
                  />
                )}
              </>
            )}
          </TableBody>
        </Table>
      </div>
      {editing?.error && (
        <p
          id={`${uid}-editor-error`}
          data-slot="data-grid-editor-message"
          className={cn("m-0 text-xs text-accent-red", classNames.error)}
        >
          {editing.error}
        </p>
      )}
      {selectable && selectedIds.length > 0 && (
        <span data-slot="data-grid-selection" className="text-xs text-text-muted">
          {labels.selected(selectedIds.length)}
        </span>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}
