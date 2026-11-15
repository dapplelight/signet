"use client"

// Notification screens: an in-app inbox (all or unread, mark read, archive,
// load more, an all-caught-up state) and a preferences centre, one switch per
// category and channel. Shapes match signet-server's notifier: `InboxItem`
// from `inbox.list`, `Prefs["channels"]` from `getPrefs` / `updatePrefs`.
// Wire the callbacks through `createRpcClient`.
// Recipe: controllable-state + selection + live-region
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { ArchiveIcon, BellIcon, CheckCheckIcon, LockIcon } from "lucide-react"
import * as React from "react"
import { useControllableState } from "../../behaviors/index.js"
import { cn } from "../../lib/utils.js"
import { Button } from "../ui/button.js"
import { Spinner } from "../ui/spinner.js"
import { Switch } from "../ui/switch.js"

/** signet-server's notify channels. */
export type NotifyChannel = "email" | "sms" | "whatsapp" | "push" | "telegram" | "inApp"

/** signet-server's `InboxItem`. */
export type InboxEntry = {
  id: string
  event?: string
  category?: string
  title: string
  body: string
  link?: string
  createdAt: string | number | Date
  readAt?: string | null
  archivedAt?: string | null
}

export type InboxFilter = "all" | "unread"

/** category → channel → allowed; absent means allowed. signet-server's `Prefs["channels"]`. */
export type ChannelPrefs = Record<string, Partial<Record<NotifyChannel, boolean>>>

export type PreferenceCategory = {
  id: string
  label: string
  /** One short line under the label. */
  description?: string
  /** The notifier's `required` categories (security, receipts): always on. */
  required?: boolean
}

/** Every string the notification screens show. Spread it and override what you need. */
export const DEFAULT_NOTIFICATION_LABELS = {
  inbox: "Notifications",
  filter: "Show",
  all: "All",
  unread: "Unread",
  unreadCount: (n: number) => `${n} unread`,
  markAllRead: "Mark all read",
  markRead: "Mark read",
  archive: (title: string) => `Archive ${title}`,
  loadMore: "Load more",
  empty: "You're all caught up",
  preferences: "Notification preferences",
  category: "Category",
  required: "Always on",
  channels: {
    email: "Email",
    sms: "SMS",
    whatsapp: "WhatsApp",
    push: "Push",
    telegram: "Telegram",
    inApp: "In app",
  } as Record<NotifyChannel, string>,
  toggle: (category: string, channel: string) => `${category}: ${channel}`,
  justNow: "just now",
  error: "Something went wrong. Try again.",
}

export type NotificationLabels = typeof DEFAULT_NOTIFICATION_LABELS

const toDate = (w: string | number | Date) => (w instanceof Date ? w : new Date(w))

/** "3 hours ago", in the browser's language unless `locale` says otherwise. */
function ago(w: string | number | Date, justNow: string, locale?: string, now = Date.now()) {
  const s = Math.round((toDate(w).getTime() - now) / 1000)
  if (Math.abs(s) < 60) return justNow
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" })
  for (const [unit, size] of [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit)
  }
  return justNow
}

const errorText = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback

// --- inbox -------------------------------------------------------------------

type InboxItemProps = Omit<useRender.ComponentProps<"button">, "onClick"> & {
  item: InboxEntry
  /** Called on click; the inbox also marks the item read. */
  onOpen?: (item: InboxEntry) => void
  locale?: string
  labels?: Partial<NotificationLabels>
}

/**
 * One notification: unread dot, title, body and age. A button by default;
 * `render={<a href={item.link} />}` makes it a link.
 */
function InboxItem({
  item,
  onOpen,
  locale,
  labels,
  className,
  render,
  children,
  ...props
}: InboxItemProps) {
  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(
      {
        type: render ? undefined : "button",
        onClick: () => onOpen?.(item),
        className: cn(
          "group/inbox-item grid w-full grid-cols-[0.5rem_1fr_auto] items-start gap-x-3 gap-y-0.5 rounded-lg px-3 py-3 text-left outline-none transition-colors hover:bg-bg-elevated focus-visible:ring-3 focus-visible:ring-ring",
          className,
        ),
        children: children ?? <InboxItemBody item={item} locale={locale} labels={labels} />,
      },
      props,
    ),
    // data-slot="inbox-item", data-unread when unread.
    state: { slot: "inbox-item", unread: !item.readAt },
  })
}

/** The body inside an InboxItem; split out so `render` keeps the layout. */
function InboxItemBody({
  item,
  locale,
  labels,
}: {
  item: InboxEntry
  locale?: string
  labels?: Partial<NotificationLabels>
}) {
  const l = { ...DEFAULT_NOTIFICATION_LABELS, ...labels }
  const unread = !item.readAt
  return (
    <>
      <span
        aria-hidden
        data-slot="inbox-dot"
        className={cn("mt-1.5 size-2 rounded-full", unread ? "bg-primary" : "bg-transparent")}
      />
      <span className="grid min-w-0 gap-0.5">
        <span
          className={cn(
            "truncate",
            unread ? "font-medium text-text-primary" : "text-text-secondary",
          )}
        >
          {unread ? <span className="sr-only">{`${l.unread}: `}</span> : null}
          {item.title}
        </span>
        <span className="line-clamp-2 text-text-muted">{item.body}</span>
      </span>
      <time
        dateTime={toDate(item.createdAt).toISOString()}
        className="pt-0.5 text-xs whitespace-nowrap text-text-hint tabular-nums"
      >
        {ago(item.createdAt, l.justNow, locale)}
      </time>
    </>
  )
}

type NotificationInboxProps = {
  items: readonly InboxEntry[]
  /** Unread count for the badge. Default: unread among `items`. */
  unreadCount?: number
  /** "all" or "unread", controlled. */
  filter?: InboxFilter
  defaultFilter?: InboxFilter
  onFilterChange?: (filter: InboxFilter) => void
  /** `inbox.markRead(userId, ids)`. Opening an unread item calls it. */
  onMarkRead?: (ids: string[]) => unknown
  /** `inbox.markAllRead(userId)`. */
  onMarkAllRead?: () => unknown
  /** `inbox.archive(userId, id)`. Adds an archive button per item. */
  onArchive?: (item: InboxEntry) => unknown
  /** Follow the item's link, open a detail view. */
  onOpen?: (item: InboxEntry) => void
  /** Swap each item's element, e.g. `(item) => <a href={item.link} />`. */
  renderItem?: (item: InboxEntry) => React.ReactElement<Record<string, unknown>> | undefined
  /** `inbox.list`'s `nextCursor` is set. */
  hasMore?: boolean
  onLoadMore?: () => unknown
  locale?: string
  labels?: Partial<NotificationLabels>
  className?: string
  classNames?: Partial<Record<"header" | "filter" | "list" | "item" | "empty" | "more", string>>
}

/** The in-app inbox: newest first, unread marked, filter to unread, mark read, archive. */
function NotificationInbox({
  items,
  unreadCount,
  filter: filterProp,
  defaultFilter = "all",
  onFilterChange,
  onMarkRead,
  onMarkAllRead,
  onArchive,
  onOpen,
  renderItem,
  hasMore,
  onLoadMore,
  locale,
  labels,
  className,
  classNames = {},
}: NotificationInboxProps) {
  const l = { ...DEFAULT_NOTIFICATION_LABELS, ...labels }
  const [filter, setFilter] = useControllableState({
    value: filterProp,
    defaultValue: defaultFilter,
    onChange: onFilterChange,
  })
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const unread = unreadCount ?? items.filter((i) => !i.readAt && !i.archivedAt).length
  const shown = items.filter((i) => !i.archivedAt && (filter === "all" || !i.readAt))
  const id = React.useId()
  const attempt = async (fn: (() => unknown) | undefined) => {
    setError(null)
    try {
      await fn?.()
    } catch (e) {
      setError(errorText(e, l.error))
    }
  }
  return (
    <section
      aria-labelledby={id}
      data-slot="notification-inbox"
      data-filter={filter}
      className={cn(
        "flex flex-col gap-2 rounded-xl bg-bg-surface p-2 text-sm text-text-primary ring-1 ring-foreground/10",
        className,
      )}
    >
      <div
        data-slot="inbox-header"
        className={cn("flex items-center justify-between gap-2 px-2 pt-2", classNames.header)}
      >
        <h2 id={id} className="flex items-center gap-2 text-base leading-none font-medium">
          {l.inbox}
          {unread ? (
            <span
              data-slot="inbox-count"
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums"
            >
              <span aria-hidden>{unread}</span>
              <span className="sr-only">{l.unreadCount(unread)}</span>
            </span>
          ) : null}
        </h2>
        {onMarkAllRead && unread ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => attempt(onMarkAllRead)}
            className="text-text-muted"
          >
            <CheckCheckIcon aria-hidden />
            {l.markAllRead}
          </Button>
        ) : null}
      </div>
      <fieldset data-slot="inbox-filter" className={cn("flex gap-1 px-2", classNames.filter)}>
        <legend className="sr-only">{l.filter}</legend>
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className="rounded-full border border-transparent px-3 py-1 text-xs font-medium text-text-muted transition-colors outline-none hover:bg-bg-elevated focus-visible:ring-3 focus-visible:ring-ring aria-pressed:border-primary/40 aria-pressed:bg-primary/15 aria-pressed:text-text-primary"
          >
            {f === "all" ? l.all : l.unread}
          </button>
        ))}
      </fieldset>
      {shown.length ? (
        <ul data-slot="inbox-list" className={cn("flex flex-col", classNames.list)}>
          {shown.map((item) => (
            <li key={item.id} className="group/row relative">
              <InboxItem
                item={item}
                locale={locale}
                labels={labels}
                render={renderItem?.(item)}
                className={cn(onArchive && "pr-12", classNames.item)}
                onOpen={(it) => {
                  if (!it.readAt) void attempt(() => onMarkRead?.([it.id]))
                  onOpen?.(it)
                }}
              />
              {onArchive ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={l.archive(item.title)}
                  onClick={() => attempt(() => onArchive(item))}
                  className="absolute top-2.5 right-2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                >
                  <ArchiveIcon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div
          data-slot="inbox-empty"
          className={cn("flex flex-col items-center gap-3 py-10 text-text-muted", classNames.empty)}
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-bg-elevated text-text-hint">
            <BellIcon aria-hidden className="size-5" />
          </span>
          {l.empty}
        </div>
      )}
      <p role="alert" className="px-2 text-sm text-destructive empty:hidden">
        {error}
      </p>
      {hasMore && onLoadMore ? (
        <Button
          variant="ghost"
          size="sm"
          className={cn("mx-2 mb-1", classNames.more)}
          disabled={loading}
          onClick={async () => {
            setLoading(true)
            await attempt(onLoadMore)
            setLoading(false)
          }}
        >
          {loading ? <Spinner aria-label={l.loadMore} /> : null}
          {l.loadMore}
        </Button>
      ) : null}
    </section>
  )
}

// --- preferences -------------------------------------------------------------

type NotificationPreferencesProps = {
  categories: readonly PreferenceCategory[]
  /** Columns, in order. Default email, push and in-app. */
  channels?: readonly NotifyChannel[]
  /** Controlled prefs. */
  value?: ChannelPrefs
  defaultValue?: ChannelPrefs
  /** Every change, with the full next value. */
  onValueChange?: (value: ChannelPrefs) => void
  /**
   * Save one change: `updatePrefs(userId, { channels: { [category]: { [channel]: on } } })`.
   * Throwing puts the switch back.
   */
  onToggle?: (change: { category: string; channel: NotifyChannel; on: boolean }) => unknown
  labels?: Partial<NotificationLabels>
  className?: string
  classNames?: Partial<Record<"table" | "row" | "switch", string>>
}

/** One switch per category and channel. Required categories show locked on. */
function NotificationPreferences({
  categories,
  channels = ["email", "push", "inApp"],
  value,
  defaultValue = {},
  onValueChange,
  onToggle,
  labels,
  className,
  classNames = {},
}: NotificationPreferencesProps) {
  const l = { ...DEFAULT_NOTIFICATION_LABELS, ...labels }
  const names = { ...DEFAULT_NOTIFICATION_LABELS.channels, ...labels?.channels }
  const [prefs, setPrefs] = useControllableState({
    value,
    defaultValue,
    onChange: onValueChange,
  })
  // Latest prefs for the rollback after an awaited save.
  const latest = React.useRef(prefs)
  latest.current = prefs
  const [error, setError] = React.useState<string | null>(null)
  const set = (category: string, channel: NotifyChannel, on: boolean) => {
    const cur = latest.current
    const next = { ...cur, [category]: { ...cur[category], [channel]: on } }
    latest.current = next
    setPrefs(next)
    return next
  }
  const id = React.useId()
  return (
    <section
      aria-labelledby={id}
      data-slot="notification-preferences"
      className={cn(
        "flex flex-col gap-3 rounded-xl bg-bg-surface p-4 text-sm text-text-primary ring-1 ring-foreground/10",
        className,
      )}
    >
      <h2 id={id} className="text-base leading-none font-medium">
        {l.preferences}
      </h2>
      <table data-slot="preferences-table" className={cn("w-full", classNames.table)}>
        <thead>
          <tr className="text-xs text-text-muted">
            <th scope="col" className="py-2 text-left font-normal">
              <span className="sr-only">{l.category}</span>
            </th>
            {channels.map((c) => (
              <th key={c} scope="col" className="w-16 py-2 text-center font-normal">
                {names[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {categories.map((cat) => (
            <tr
              key={cat.id}
              data-slot="preferences-row"
              data-required={cat.required ? "" : undefined}
              className={classNames.row}
            >
              <th scope="row" className="py-3 pr-2 text-left font-normal">
                <span className="flex items-center gap-1.5 font-medium">
                  {cat.label}
                  {cat.required ? (
                    <LockIcon aria-label={l.required} className="size-3 text-text-hint" />
                  ) : null}
                </span>
                {cat.description ? (
                  <span className="block text-xs text-text-muted">{cat.description}</span>
                ) : null}
              </th>
              {channels.map((ch) => {
                const on = cat.required || prefs[cat.id]?.[ch] !== false
                return (
                  <td key={ch} className="py-3 text-center">
                    <Switch
                      checked={on}
                      disabled={cat.required}
                      aria-label={l.toggle(cat.label, names[ch])}
                      data-channel={ch}
                      className={classNames.switch}
                      onCheckedChange={async (next: boolean) => {
                        setError(null)
                        set(cat.id, ch, next)
                        try {
                          await onToggle?.({ category: cat.id, channel: ch, on: next })
                        } catch (e) {
                          set(cat.id, ch, !next)
                          setError(errorText(e, l.error))
                        }
                      }}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p role="alert" className="text-sm text-destructive empty:hidden">
        {error}
      </p>
    </section>
  )
}

export type { InboxItemProps, NotificationInboxProps, NotificationPreferencesProps }
export { InboxItem, InboxItemBody, NotificationInbox, NotificationPreferences }
