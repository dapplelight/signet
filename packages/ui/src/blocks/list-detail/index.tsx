"use client"

// Block: list with filters and a detail pane. Search and a status filter above
// a paged list; picking a row fills the detail pane on desktop and opens it in
// a sheet on phones. Copy it in with `signet add block list-detail` and edit
// it: items, filters, labels and the detail renderer are props, every part has
// a data-slot, and the root takes className.
import * as React from "react"
import { Badge } from "../../components/ui/badge.js"
import { Button } from "../../components/ui/button.js"
import { Card, CardContent } from "../../components/ui/card.js"
import { EmptyState } from "../../components/ui/empty-state.js"
import { ErrorState } from "../../components/ui/error-state.js"
import { Pagination } from "../../components/ui/pagination.js"
import { PillGroup } from "../../components/ui/pill-group.js"
import { ResponsiveSheet } from "../../components/ui/responsive-sheet.js"
import { SearchInput } from "../../components/ui/search-input.js"
import { Skeleton } from "../../components/ui/skeleton.js"
import { DESKTOP_QUERY, useMediaQuery } from "../../hooks/use-media-query.js"
import { cn } from "../../lib/utils.js"
import type { ListDetailItem } from "./sample.js"

export type { ListDetailItem } from "./sample.js"
export { SAMPLE_ITEMS } from "./sample.js"

export type BlockState = "ready" | "loading" | "error"

/** Every string the block shows. Spread it and override what you need. */
export const DEFAULT_LIST_DETAIL_LABELS = {
  search: "Search projects",
  filter: "Filter by status",
  list: "Projects",
  noSelection: "Select a project to see its details.",
  noMatchesTitle: "No matches",
  noMatchesDescription: "Try another search or filter.",
  clearFilters: "Clear filters",
  emptyTitle: "No projects yet",
  emptyDescription: "Projects you create will show here.",
  errorMessage: "We could not load your projects.",
  loading: "Loading projects",
  pageRange: (from: number, to: number, total: number) => `${from}–${to} of ${total}`,
}

export type ListDetailLabels = typeof DEFAULT_LIST_DETAIL_LABELS

/** `value` "" is the "all" option. A row matches when its `status` equals `value`. */
export const DEFAULT_LIST_DETAIL_FILTERS = [
  { value: "", label: "All" },
  { value: "Active", label: "Active" },
  { value: "Paused", label: "Paused" },
  { value: "Archived", label: "Archived" },
]

type Part = "toolbar" | "list" | "detail"

export type ListDetailProps = {
  items?: ListDetailItem[]
  state?: BlockState
  onRetry?: () => void
  filters?: { value: string; label: string }[]
  /** Rows per page. */
  pageSize?: number
  /** Initially selected row (desktop shows it at once; a phone opens it only on tap). */
  defaultSelectedId?: string
  onSelect?: (item: ListDetailItem) => void
  /** Replaces the default detail content, in the pane and in the phone sheet. */
  renderDetail?: (item: ListDetailItem) => React.ReactNode
  labels?: Partial<ListDetailLabels>
  classNames?: Partial<Record<Part, string>>
  className?: string
}

function DefaultDetail({ item }: { item: ListDetailItem }) {
  return (
    <div data-slot="list-detail-content" className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-callout font-semibold text-text-primary" title={item.title}>
            {item.title}
          </h2>
          {item.subtitle && <p className="truncate text-text-muted">{item.subtitle}</p>}
        </div>
        <Badge variant={item.tone ?? "default"}>{item.status}</Badge>
      </div>
      {item.description && <p className="text-text-secondary">{item.description}</p>}
      {item.fields && item.fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          {item.fields.map((f) => (
            <React.Fragment key={f.label}>
              <dt className="text-text-muted">{f.label}</dt>
              <dd className="m-0 min-w-0 truncate text-text-primary" title={f.value}>
                {f.value}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  )
}

export function ListDetail({
  items = [],
  state = "ready",
  onRetry,
  filters = DEFAULT_LIST_DETAIL_FILTERS,
  pageSize = 20,
  defaultSelectedId,
  onSelect,
  renderDetail,
  labels: labelOverrides,
  classNames,
  className,
}: ListDetailProps) {
  const l = { ...DEFAULT_LIST_DETAIL_LABELS, ...labelOverrides }
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const [query, setQuery] = React.useState("")
  const [filter, setFilter] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [selectedId, setSelectedId] = React.useState(defaultSelectedId)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const rows = React.useRef(new Map<string, HTMLButtonElement>())

  const q = query.trim().toLowerCase()
  const matches = items.filter(
    (it) =>
      (!filter || it.status === filter) &&
      (!q || `${it.title} ${it.subtitle ?? ""}`.toLowerCase().includes(q)),
  )
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize))
  const current = Math.min(page, totalPages)
  const shown = matches.slice((current - 1) * pageSize, current * pageSize)
  const selected = items.find((it) => it.id === selectedId)
  const filtering = !!q || !!filter
  const detail = (it: ListDetailItem) => renderDetail?.(it) ?? <DefaultDetail item={it} />

  const pick = (it: ListDetailItem) => {
    setSelectedId(it.id)
    setSheetOpen(true)
    onSelect?.(it)
  }
  const closeSheet = () => {
    setSheetOpen(false)
    // Sheets restore focus on close in most browsers; this makes it certain.
    const id = selectedId
    setTimeout(() => id && rows.current.get(id)?.focus(), 0)
  }
  const clear = () => {
    setQuery("")
    setFilter("")
    setPage(1)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    e.preventDefault()
    buttons[
      Math.min(buttons.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))
    ]?.focus()
  }

  return (
    <section
      data-block="list-detail"
      data-state={state}
      aria-busy={state === "loading" || undefined}
      className={cn("mx-auto w-full max-w-7xl p-4 md:p-6", className)}
    >
      {state === "error" ? (
        <Card data-slot="list-detail-error">
          <CardContent>
            <ErrorState message={l.errorMessage} onRetry={onRetry} />
          </CardContent>
        </Card>
      ) : state === "loading" ? (
        <ListDetailSkeleton label={l.loading} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[360px_minmax(0,1fr)] md:items-start md:gap-6">
          <Card data-slot="list-detail-list" className={cn("gap-0 py-0", classNames?.list)}>
            <div
              data-slot="list-detail-toolbar"
              className={cn(
                "flex flex-col gap-3 border-b border-border-subtle p-3",
                classNames?.toolbar,
              )}
            >
              <SearchInput
                aria-label={l.search}
                placeholder={l.search}
                value={query}
                containerClassName="h-11 md:h-8"
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(1)
                }}
              />
              <fieldset aria-label={l.filter} className="m-0 min-w-0 border-0 p-0">
                <PillGroup
                  options={filters}
                  value={filter}
                  onChange={(v) => {
                    setFilter(v)
                    setPage(1)
                  }}
                  className="[&_button]:min-h-11 [&_button]:px-4 md:[&_button]:min-h-0 md:[&_button]:px-3"
                />
              </fieldset>
            </div>

            {shown.length === 0 ? (
              <div data-slot="list-detail-empty" className="px-4 [&>div]:min-h-0 [&>div]:py-12">
                {filtering ? (
                  <EmptyState
                    title={l.noMatchesTitle}
                    description={l.noMatchesDescription}
                    action={
                      <Button variant="outline" size="touch" onClick={clear}>
                        {l.clearFilters}
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState title={l.emptyTitle} description={l.emptyDescription} />
                )}
              </div>
            ) : (
              <ul
                aria-label={l.list}
                onKeyDown={onKeyDown}
                className="m-0 flex list-none flex-col divide-y divide-border-subtle p-0"
              >
                {shown.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) rows.current.set(it.id, el)
                        else rows.current.delete(it.id)
                      }}
                      aria-current={it.id === selectedId ? "true" : undefined}
                      onClick={() => pick(it)}
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left outline-none transition-colors hover:bg-bg-elevated/50 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset aria-[current=true]:bg-bg-elevated"
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate font-medium text-text-primary"
                          title={it.title}
                        >
                          {it.title}
                        </span>
                        {it.subtitle && (
                          <span className="block truncate text-text-muted">{it.subtitle}</span>
                        )}
                      </span>
                      <Badge variant={it.tone ?? "default"}>{it.status}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {matches.length > 0 && (
              <div className="flex items-center justify-between gap-3 border-t border-border-subtle p-3">
                <span className="text-text-muted">
                  {l.pageRange(
                    (current - 1) * pageSize + 1,
                    Math.min(current * pageSize, matches.length),
                    matches.length,
                  )}
                </span>
                <Pagination
                  page={current}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  className="[&_button]:size-11 [&_span]:size-11 md:[&_button]:size-7 md:[&_span]:size-7"
                />
              </div>
            )}
          </Card>

          {isDesktop && (
            <Card
              data-slot="list-detail-detail"
              className={cn("md:sticky md:top-4", classNames?.detail)}
            >
              <CardContent>
                {selected ? (
                  detail(selected)
                ) : (
                  <p className="py-12 text-center text-text-muted">{l.noSelection}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!isDesktop && sheetOpen && selected && (
        <ResponsiveSheet
          title={selected.title}
          description={selected.subtitle}
          onClose={closeSheet}
        >
          {detail(selected)}
        </ResponsiveSheet>
      )}
    </section>
  )
}

/** Same shapes as the real content: toolbar, eight rows and the detail card. */
function ListDetailSkeleton({ label }: { label: string }) {
  return (
    <div
      data-slot="list-detail-skeleton"
      role="status"
      aria-label={label}
      className="grid grid-cols-1 gap-4 md:grid-cols-[360px_minmax(0,1fr)] md:items-start md:gap-6"
    >
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b border-border-subtle p-3">
          <Skeleton className="h-11 w-full md:h-8" />
          <Skeleton className="h-11 w-full md:h-6" />
        </div>
        <div className="flex flex-col gap-2 p-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </Card>
      <Skeleton className="hidden h-72 md:block" />
    </div>
  )
}
