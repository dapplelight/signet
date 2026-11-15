"use client"

// A board of columns with cards that move between them. Pointer: drag a card
// (native drag and drop) onto a column. Keyboard: focus a card, Space or Enter
// picks it up, arrows move it (Up/Down within the column, Left/Right across
// columns), Space or Enter drops, Escape puts it back. Every pick-up, move and
// drop is announced in a live region. The board is a plain
// `{ [column]: itemId[] }` object, controlled or uncontrolled.
// Recipe: controllable-state + live-region + drag (pointer and keyboard)
import type * as React from "react"
import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useControllableState } from "../../behaviors/index.js"
import { cn } from "../../lib/utils.js"

/** Column id -> item ids, in order. */
type KanbanBoard = Record<string, readonly string[]>

interface KanbanMove {
  item: string
  from: string
  to: string
  /** The item's new index in `to`. */
  index: number
}

interface KanbanMessages {
  /** Read when a card is focused. */
  instructions: string
  /** Read by screen readers as the card's role, like "draggable card". */
  itemRoleDescription: string
  lifted: (item: string, column: string, position: number, total: number) => string
  moved: (item: string, column: string, position: number, total: number) => string
  dropped: (item: string, column: string, position: number, total: number) => string
  cancelled: (item: string) => string
}

const DEFAULT_MESSAGES: KanbanMessages = {
  instructions:
    "Press Space to pick up. Use the arrow keys to move, Space to drop, Escape to cancel.",
  itemRoleDescription: "draggable card",
  lifted: (item, column, p, n) => `Picked up ${item}. ${column}, position ${p} of ${n}.`,
  moved: (item, column, p, n) => `${item}: ${column}, position ${p} of ${n}.`,
  dropped: (item, column, p, n) => `Dropped ${item} in ${column}, position ${p} of ${n}.`,
  cancelled: (item) => `Cancelled. ${item} is back where it was.`,
}

/** Where `item` is, or undefined. */
function findItem(board: KanbanBoard, item: string): [string, number] | undefined {
  for (const [column, ids] of Object.entries(board)) {
    const i = ids.indexOf(item)
    if (i >= 0) return [column, i]
  }
  return undefined
}

/** A new board with `item` moved to `to` at `index` (clamped). The input is not changed. */
function moveItem(board: KanbanBoard, item: string, to: string, index: number): KanbanBoard {
  const next: Record<string, string[]> = {}
  for (const [column, ids] of Object.entries(board)) next[column] = ids.filter((id) => id !== item)
  const target = next[to] ?? []
  target.splice(Math.max(0, Math.min(index, target.length)), 0, item)
  next[to] = target
  return next
}

type RenderProp = React.ReactElement<Record<string, unknown>>

/** `render` swaps the element, keeping the props; classes from both are merged. */
function renderAs(
  render: RenderProp | undefined,
  Tag: "div" | "li" | "ul" | "h3",
  props: Record<string, unknown> & { className?: string },
) {
  if (!render) return <Tag {...props} />
  return cloneElement(render, {
    ...props,
    className: cn(props.className, render.props.className as string),
  })
}

interface KanbanContextValue {
  liftedId: string | null
  draggingId: string | null
  overColumn: string | null
  messages: KanbanMessages
  instructionsId: string
  onItemKeyDown: (event: React.KeyboardEvent<HTMLElement>, item: string) => void
  onDragStart: (item: string) => void
  onDragEnd: () => void
  onDragOver: (column: string) => void
  onDrop: (column: string, index: number) => void
}

const KanbanContext = createContext<KanbanContextValue | null>(null)

function useKanban(part: string) {
  const ctx = useContext(KanbanContext)
  if (!ctx) throw new Error(`${part} must be inside <Kanban>.`)
  return ctx
}

const ColumnContext = createContext<{ value: string; titleId: string } | null>(null)

interface KanbanProps extends Omit<React.ComponentProps<"div">, "children" | "defaultValue"> {
  value?: KanbanBoard
  defaultValue?: KanbanBoard
  /** The whole board after a card is dropped somewhere new. */
  onValueChange?: (board: KanbanBoard) => void
  /** The single move behind each `onValueChange`, for saving to a server. */
  onItemMove?: (move: KanbanMove) => void
  /** Text for screen readers; every entry has an English default. */
  messages?: Partial<KanbanMessages>
  /** Columns and cards; a function gets the board as it is now (use it uncontrolled). */
  children: React.ReactNode | ((board: KanbanBoard) => React.ReactNode)
  /** Class for the visually hidden live region. */
  liveRegionClassName?: string
}

/** Name the board with `aria-label`. */
function Kanban({
  value,
  defaultValue = {},
  onValueChange,
  onItemMove,
  messages: messageOverrides,
  children,
  className,
  liveRegionClassName,
  ...props
}: KanbanProps) {
  const [board, setBoard] = useControllableState<KanbanBoard>({
    value,
    defaultValue,
    onChange: onValueChange,
  })
  const messages = { ...DEFAULT_MESSAGES, ...messageOverrides }
  const root = useRef<HTMLDivElement>(null)
  const instructionsId = useId()
  // Keyboard moves preview on a draft; it is committed on drop, dropped on Escape.
  const [draft, setDraft] = useState<KanbanBoard | null>(null)
  const [liftedId, setLiftedId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const focusAfter = useRef<string | null>(null)
  const shown = draft ?? board

  const itemEl = (item: string) =>
    [...(root.current?.querySelectorAll<HTMLElement>('[data-slot="kanban-item"]') ?? [])].find(
      (el) => el.dataset.value === item,
    )
  const columnEls = () => [
    ...(root.current?.querySelectorAll<HTMLElement>('[data-slot="kanban-column"]') ?? []),
  ]
  const itemLabel = (item: string) =>
    itemEl(item)?.dataset.label || itemEl(item)?.textContent?.trim() || item
  const columnLabel = (column: string) => {
    const el = columnEls().find((c) => c.dataset.value === column)
    return (
      el?.getAttribute("aria-label") ||
      el?.querySelector('[data-slot="kanban-column-title"]')?.textContent?.trim() ||
      column
    )
  }
  const say = (kind: "lifted" | "moved" | "dropped", b: KanbanBoard, item: string) => {
    const at = findItem(b, item)
    if (!at) return
    const [column, i] = at
    setAnnouncement(
      messages[kind](itemLabel(item), columnLabel(column), i + 1, b[column]?.length ?? 0),
    )
  }

  // A card that changed column is a new element; give it focus back.
  useLayoutEffect(() => {
    const id = focusAfter.current
    if (id === null) return
    focusAfter.current = null
    const el = itemEl(id)
    if (el && document.activeElement !== el) el.focus()
  })

  const commit = (next: KanbanBoard, item: string, from: string) => {
    const at = findItem(next, item)
    const before = findItem(board, item)
    if (!at || (before && before[0] === at[0] && before[1] === at[1])) return
    setBoard(next)
    onItemMove?.({ item, from, to: at[0], index: at[1] })
  }

  const onItemKeyDown = (event: React.KeyboardEvent<HTMLElement>, item: string) => {
    if (event.target !== event.currentTarget) return
    const key = event.key
    if (liftedId !== item) {
      if (key === " " || key === "Enter") {
        event.preventDefault()
        setLiftedId(item)
        setDraft(board)
        say("lifted", board, item)
      }
      return
    }
    const b = draft ?? board
    const at = findItem(b, item)
    if (!at) return
    const [column, index] = at
    const finish = (keep: boolean) => {
      setLiftedId(null)
      setDraft(null)
      focusAfter.current = item
      if (keep) {
        commit(b, item, findItem(board, item)?.[0] ?? column)
        say("dropped", b, item)
      } else {
        setAnnouncement(messages.cancelled(itemLabel(item)))
      }
    }
    if (key === " " || key === "Enter") {
      event.preventDefault()
      finish(true)
    } else if (key === "Tab") {
      finish(true)
    } else if (key === "Escape") {
      event.preventDefault()
      finish(false)
    } else if (key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault()
      const to = index + (key === "ArrowUp" ? -1 : 1)
      if (to < 0 || to >= (b[column]?.length ?? 0)) return
      const next = moveItem(b, item, column, to)
      setDraft(next)
      focusAfter.current = item
      say("moved", next, item)
    } else if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault()
      const order = columnEls().map((c) => c.dataset.value as string)
      const target = order[order.indexOf(column) + (key === "ArrowLeft" ? -1 : 1)]
      if (target === undefined) return
      const next = moveItem(b, item, target, index)
      setDraft(next)
      focusAfter.current = item
      say("moved", next, item)
    }
  }

  const draggedRef = useRef<string | null>(null)
  const onDragStart = useCallback((item: string) => {
    draggedRef.current = item
    setDraggingId(item)
  }, [])
  const onDragEnd = useCallback(() => {
    draggedRef.current = null
    setDraggingId(null)
    setOverColumn(null)
  }, [])
  const onDragOver = useCallback((column: string) => {
    if (draggedRef.current) setOverColumn(column)
  }, [])
  const onDrop = (column: string, index: number) => {
    const item = draggedRef.current
    onDragEnd()
    if (!item) return
    const from = findItem(board, item)?.[0]
    if (from === undefined) return
    const next = moveItem(board, item, column, index)
    commit(next, item, from)
    say("dropped", next, item)
  }

  return (
    <KanbanContext.Provider
      value={{
        liftedId,
        draggingId,
        overColumn,
        messages,
        instructionsId,
        onItemKeyDown,
        onDragStart,
        onDragEnd,
        onDragOver,
        onDrop,
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a board is not a form; fieldset is for form controls */}
      <div
        ref={root}
        role="group"
        data-slot="kanban"
        className={cn("flex items-start gap-4 overflow-x-auto pb-2", className)}
        {...props}
      >
        {typeof children === "function" ? children(shown) : children}
        <span id={instructionsId} hidden>
          {messages.instructions}
        </span>
        <div
          role="status"
          aria-live="assertive"
          aria-atomic="true"
          className={cn("sr-only", liveRegionClassName)}
        >
          {announcement}
        </div>
      </div>
    </KanbanContext.Provider>
  )
}

interface KanbanColumnProps extends React.ComponentProps<"div"> {
  /** The column's key in the board. */
  value: string
  /** Accessible name; defaults to the KanbanColumnTitle's text. */
  label?: string
  render?: RenderProp
}

/** A column and drop target. `data-over` is set while a card is dragged over it. */
function KanbanColumn({ value, label, render, className, ...props }: KanbanColumnProps) {
  const { overColumn, onDragOver, onDrop } = useKanban("KanbanColumn")
  const titleId = useId()
  // Insert before the first card whose middle is below the pointer.
  const indexAt = (el: HTMLElement, y: number) => {
    const cards = [...el.querySelectorAll<HTMLElement>('[data-slot="kanban-item"]')].filter(
      (c) => c.dataset.dragging === undefined,
    )
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect()
      return y < r.top + r.height / 2
    })
    return i < 0 ? cards.length : i
  }
  return (
    <ColumnContext.Provider value={{ value, titleId }}>
      {renderAs(render, "div", {
        role: "group",
        "aria-label": label,
        "aria-labelledby": label ? undefined : titleId,
        "data-slot": "kanban-column",
        "data-value": value,
        "data-over": overColumn === value ? "" : undefined,
        onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
          e.preventDefault()
          onDragOver(value)
        },
        onDrop: (e: React.DragEvent<HTMLDivElement>) => {
          e.preventDefault()
          onDrop(value, indexAt(e.currentTarget, e.clientY))
        },
        className: cn(
          "flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border bg-muted p-2 transition-colors",
          "data-over:border-primary data-over:bg-accent-primary-subtle",
          className,
        ),
        ...props,
      })}
    </ColumnContext.Provider>
  )
}

function KanbanColumnHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="kanban-column-header"
      className={cn("flex items-center justify-between gap-2 px-1 py-0.5", className)}
      {...props}
    />
  )
}

function KanbanColumnTitle({
  className,
  render,
  ...props
}: React.ComponentProps<"h3"> & { render?: RenderProp }) {
  const column = useContext(ColumnContext)
  return renderAs(render, "h3", {
    id: column?.titleId,
    "data-slot": "kanban-column-title",
    className: cn("m-0 text-sm font-medium text-text-primary", className),
    ...props,
  })
}

/** The column's cards. */
function KanbanList({
  className,
  render,
  ...props
}: React.ComponentProps<"ul"> & { render?: RenderProp }) {
  return renderAs(render, "ul", {
    role: "list",
    "data-slot": "kanban-list",
    className: cn("m-0 flex min-h-12 list-none flex-col gap-2 p-0", className),
    ...props,
  })
}

interface KanbanItemProps extends React.ComponentProps<"li"> {
  /** The item's id in the board. */
  value: string
  /** Name used in announcements; defaults to the card's text. */
  label?: string
  render?: RenderProp
}

/** A card. `data-lifted` while picked up by keyboard, `data-dragging` while dragged. */
function KanbanItem({ value, label, render, className, onKeyDown, ...props }: KanbanItemProps) {
  const { liftedId, draggingId, messages, instructionsId, onItemKeyDown, onDragStart, onDragEnd } =
    useKanban("KanbanItem")
  return renderAs(render, "li", {
    tabIndex: 0,
    draggable: true,
    "aria-roledescription": messages.itemRoleDescription,
    "aria-describedby": instructionsId,
    "data-slot": "kanban-item",
    "data-value": value,
    "data-label": label,
    "data-lifted": liftedId === value ? "" : undefined,
    "data-dragging": draggingId === value ? "" : undefined,
    onKeyDown: (e: React.KeyboardEvent<HTMLLIElement>) => {
      onKeyDown?.(e)
      if (!e.defaultPrevented) onItemKeyDown(e, value)
    },
    onDragStart: (e: React.DragEvent<HTMLLIElement>) => {
      e.dataTransfer?.setData("text/plain", value)
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"
      onDragStart(value)
    },
    onDragEnd,
    className: cn(
      "cursor-grab rounded-md border border-border bg-card p-3 text-sm text-card-foreground shadow-xs outline-none transition-shadow",
      "focus-visible:ring-3 focus-visible:ring-ring active:cursor-grabbing",
      "data-lifted:shadow-md data-lifted:ring-2 data-lifted:ring-primary data-dragging:opacity-50",
      className,
    ),
    ...props,
  })
}

export {
  findItem,
  Kanban,
  type KanbanBoard,
  KanbanColumn,
  KanbanColumnHeader,
  type KanbanColumnProps,
  KanbanColumnTitle,
  KanbanItem,
  type KanbanItemProps,
  KanbanList,
  type KanbanMessages,
  type KanbanMove,
  type KanbanProps,
  moveItem,
}
