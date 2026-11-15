"use client"

// Record collaboration screens on signet-db's `createCollab` (or the JSON
// from signet-server's `collabRoutes`): comment threads with replies, edit
// and delete; a textarea with an @mention picker; the record's activity
// feed; and a version history panel with a field diff and Restore.
// Data in as props, actions out as callbacks.
// Recipe: combobox (mention picker) + live-region + field-wiring
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { History, MessageSquare, Pencil, Reply, RotateCcw, Trash2, Undo2 } from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Avatar, AvatarFallback, AvatarImage, initials } from "../ui/avatar.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import { Textarea } from "../ui/textarea.js"

type When = Date | string

/** signet-db's `Person`. */
export type CollabPerson = {
  id: string
  name: string
  email?: string | null
  image?: string | null
}

/** signet-db's `Comment`. */
export type CollabComment = {
  id: string
  parentId?: string | null
  author: CollabPerson
  body: string
  createdAt: When
  editedAt?: When | null
  deleted?: boolean
}
export type CollabThread = CollabComment & { replies: CollabComment[] }

export type CollabFieldChange = { field: string; from: unknown; to: unknown; hidden?: boolean }

/** signet-db's `TimelineItem`. */
export type CollabTimelineItem = {
  kind: "change" | "comment"
  id: string
  at: When
  actor: { type?: string; id: string; name: string }
  summary: string
  action?: string
  changes?: CollabFieldChange[]
  comment?: CollabComment
}

/** signet-db's `RecordVersion`. */
export type CollabVersion = {
  version: number
  action: string
  actor: { id: string; name: string }
  at: When
  changes: CollabFieldChange[]
}

const timeText = (d: When) =>
  new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

/** Every string the collab screens show, in English. Spread and override for another language. */
export const DEFAULT_COLLAB_LABELS = {
  comments: "Comments",
  noComments: "No comments yet",
  placeholder: "Write a comment. Type @ to mention someone.",
  replyPlaceholder: "Reply…",
  send: "Comment",
  sending: "Sending…",
  reply: "Reply",
  edit: "Edit",
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
  edited: "edited",
  deleted: "Comment deleted",
  failed: "Couldn't save. Try again.",
  mentionList: "People to mention",
  noMatches: "No one matches",
  activity: "Activity",
  noActivity: "Nothing has happened yet",
  loadMore: "Load more",
  loading: "Loading…",
  history: "Version history",
  noVersions: "No versions yet",
  version: (n: number) => `Version ${n}`,
  latest: "Latest",
  action: {
    insert: "Created",
    update: "Edited",
    delete: "Deleted",
    restore: "Restored",
    undo: "Undone",
  } as Record<string, string>,
  by: (name: string, d: When) => `${name} · ${timeText(d)}`,
  field: "Field",
  before: "Before",
  after: "After",
  hidden: "Hidden",
  empty: "(empty)",
  noChanges: "No field changes",
  restore: "Restore this version",
  restoring: "Restoring…",
  restored: (n: number) => `Restored as version ${n}`,
  undo: "Undo last change",
  undone: "Undone",
  fieldLabel: (key: string) =>
    key
      .replace(/_/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/^./, (c) => c.toUpperCase()),
}

export type CollabLabels = typeof DEFAULT_COLLAB_LABELS

function useLabels(labels?: Partial<CollabLabels>): CollabLabels {
  return React.useMemo(() => ({ ...DEFAULT_COLLAB_LABELS, ...labels }), [labels])
}

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

const CARD = "flex flex-col gap-4 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default"

// ------------------------------------------------------------------ mentions

// Must match signet-db's MENTION_PATTERN.
const MENTION = /@\[([^\]\n]{1,100})\]\(user:([A-Za-z0-9_.:-]{1,80})\)/g

/** A stored body's mentions as `@Name`, and the names picked, for editing. */
export function mentionsToText(body: string): { text: string; picked: Record<string, string> } {
  const picked: Record<string, string> = {}
  const text = body.replace(MENTION, (_, name: string, id: string) => {
    picked[`@${name}`] = id
    return `@${name}`
  })
  return { text, picked }
}

/** The text with each picked `@Name` written as signet-db's `@[Name](user:<id>)`. */
export function textToMentions(text: string, picked: Record<string, string>): string {
  let out = text
  // Longest first, so "@Asha Rao" is not cut short by "@Asha".
  for (const at of Object.keys(picked).sort((a, b) => b.length - a.length)) {
    out = out.split(at).join(`@[${at.slice(1)}](user:${picked[at]})`)
  }
  return out
}

/** A comment body: text with mentions as chips. */
export function CommentBody({ body, className }: { body: string; className?: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of body.matchAll(MENTION)) {
    if (m.index > last) parts.push(body.slice(last, m.index))
    parts.push(
      <span
        key={`${m.index}`}
        data-slot="mention"
        data-user-id={m[2]}
        className="rounded bg-accent-blue-subtle px-1 font-medium text-accent-blue"
      >
        @{m[1]}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < body.length) parts.push(body.slice(last))
  return (
    <p className={cn("text-sm whitespace-pre-wrap break-words text-text-primary", className)}>
      {parts}
    </p>
  )
}

export type MentionTextareaProps = Omit<
  React.ComponentProps<"textarea">,
  "value" | "onChange" | "defaultValue"
> & {
  /** The body with mentions as `@[Name](user:<id>)`, the form signet-db stores. */
  value: string
  onValueChange: (body: string) => void
  /** Org members matching `query`: `GET /mentions?q=`. */
  onSearch: (query: string) => Promise<CollabPerson[]> | CollabPerson[]
  labels?: Partial<CollabLabels>
}

/** A textarea that opens a member picker on `@`; picked people are stored by id. */
export function MentionTextarea({
  value,
  onValueChange,
  onSearch,
  labels: labelsProp,
  className,
  onKeyDown,
  ...props
}: MentionTextareaProps) {
  const labels = useLabels(labelsProp)
  const listId = React.useId()
  const ref = React.useRef<HTMLTextAreaElement>(null)
  // What the person sees is `@Name`; `picked` remembers which id each name is.
  const initial = React.useMemo(() => mentionsToText(value), [value])
  const [picked, setPicked] = React.useState(initial.picked)
  const [query, setQuery] = React.useState<{ start: number; text: string } | null>(null)
  const [options, setOptions] = React.useState<CollabPerson[]>([])
  const [active, setActive] = React.useState(0)

  React.useEffect(() => {
    if (!query) return
    let live = true
    Promise.resolve(onSearch(query.text)).then(
      (people) => {
        if (!live) return
        setOptions(people)
        setActive(0)
      },
      () => live && setOptions([]),
    )
    return () => {
      live = false
    }
  }, [query, onSearch])

  const text = initial.text
  const change = (next: string, caret: number, names = picked) => {
    const before = next.slice(0, caret)
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before)
    setQuery(m ? { start: caret - (m[2]?.length ?? 0) - 1, text: m[2] ?? "" } : null)
    onValueChange(textToMentions(next, names))
  }
  const choose = (p: CollabPerson) => {
    if (!query) return
    const caret = ref.current?.selectionStart ?? text.length
    const at = `@${p.name.replace(/[[\]\n]/g, "")}`
    const next = `${text.slice(0, query.start)}${at} ${text.slice(caret)}`
    const names = { ...picked, [at]: p.id }
    setPicked(names)
    setQuery(null)
    onValueChange(textToMentions(next, names))
    const pos = query.start + at.length + 1
    requestAnimationFrame(() => ref.current?.setSelectionRange(pos, pos))
  }
  const open = !!query
  return (
    <div data-slot="mention-textarea" className="relative">
      <Textarea
        ref={ref}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        value={text}
        onChange={(e) => change(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onKeyDown={(e) => {
          if (open && options.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              const step = e.key === "ArrowDown" ? 1 : -1
              setActive((i) => (i + step + options.length) % options.length)
              return
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault()
              choose(options[active] as CollabPerson)
              return
            }
          }
          if (open && e.key === "Escape") {
            e.preventDefault()
            setQuery(null)
            return
          }
          onKeyDown?.(e)
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        className={className}
        {...props}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={labels.mentionList}
          className="absolute z-50 mt-1 max-h-56 w-64 overflow-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-border-default"
        >
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-text-muted">{labels.noMatches}</div>
          ) : (
            options.map((p, i) => (
              // biome-ignore lint/a11y/useFocusableInteractive: combobox pattern, focus stays in the textarea and aria-activedescendant points here
              <div
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                data-highlighted={i === active ? "" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(p)
                }}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm data-highlighted:bg-bg-elevated"
              >
                <PersonAvatar person={p} />
                <span className="truncate">{p.name}</span>
                {p.email && <span className="truncate text-xs text-text-muted">{p.email}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function PersonAvatar({ person }: { person: CollabPerson }) {
  return (
    <Avatar size="sm">
      {person.image && <AvatarImage src={person.image} alt="" />}
      <AvatarFallback>{initials(person.name)}</AvatarFallback>
    </Avatar>
  )
}

// ------------------------------------------------------------------ comments

export type CommentThreadsProps = PartProps<"section"> & {
  threads: CollabThread[]
  /** The signed-in user, to show Edit and Delete on their own comments. */
  currentUserId?: string
  /** Show Delete on everyone's comments (`comments:moderate`). */
  canModerate?: boolean
  /** `POST /:table/:id/comments` with `{ body, parentId? }`. A throw keeps the text and shows a retry message. */
  onAdd: (input: { body: string; parentId?: string }) => Promise<unknown> | unknown
  /** `PATCH /comments/:id`. */
  onEdit?: (comment: CollabComment, body: string) => Promise<unknown> | unknown
  /** `DELETE /comments/:id`. */
  onDelete?: (comment: CollabComment) => Promise<unknown> | unknown
  /** `GET /mentions?q=`. */
  onSearchPeople: MentionTextareaProps["onSearch"]
  title?: React.ReactNode
  labels?: Partial<CollabLabels>
}

/** A record's comment threads: replies, edit and delete, and a composer with @mentions. */
export function CommentThreads({
  threads,
  currentUserId,
  canModerate,
  onAdd,
  onEdit,
  onDelete,
  onSearchPeople,
  title,
  labels: labelsProp,
  ...props
}: CommentThreadsProps) {
  const labels = useLabels(labelsProp)
  const headingId = React.useId()
  const ctx = { currentUserId, canModerate, onAdd, onEdit, onDelete, onSearchPeople, labels }
  const children = (
    <>
      <h2
        id={headingId}
        className="flex items-center gap-2 text-lg font-semibold tracking-tight text-text-primary"
      >
        <MessageSquare className="size-4" aria-hidden />
        {title ?? labels.comments}
      </h2>
      {threads.length === 0 ? (
        <p className="text-sm text-text-muted">{labels.noComments}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {threads.map((t) => (
            <li key={t.id} data-slot="comment-thread" className="flex flex-col gap-3">
              <CommentItem comment={t} {...ctx} canReply />
              {t.replies.length > 0 && (
                <ul className="ml-8 flex flex-col gap-3 border-l border-border-default pl-4">
                  {t.replies.map((r) => (
                    <li key={r.id}>
                      <CommentItem comment={r} {...ctx} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <Composer onSubmit={(body) => onAdd({ body })} onSearch={onSearchPeople} labels={labels} />
    </>
  )
  return usePart(
    "section",
    "comment-threads",
    CARD,
    props,
    { "aria-labelledby": headingId, children },
    { empty: threads.length === 0 },
  )
}

function Composer({
  onSubmit,
  onSearch,
  labels,
  initial = "",
  placeholder,
  submitLabel,
  onCancel,
  autoFocus,
}: {
  onSubmit: (body: string) => Promise<unknown> | unknown
  onSearch: MentionTextareaProps["onSearch"]
  labels: CollabLabels
  initial?: string
  placeholder?: string
  submitLabel?: string
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const [body, setBody] = React.useState(initial)
  const [key, setKey] = React.useState(0)
  const [state, setState] = React.useState<"idle" | "pending" | "error">("idle")
  const submit = async () => {
    if (!body.trim()) return
    setState("pending")
    try {
      await onSubmit(body.trim())
      setBody("")
      setKey((k) => k + 1) // a fresh textarea forgets the picked names
      setState("idle")
    } catch {
      setState("error")
    }
  }
  return (
    <form
      data-slot="comment-composer"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <MentionTextarea
        key={key}
        value={body}
        onValueChange={setBody}
        onSearch={onSearch}
        labels={labels}
        placeholder={placeholder ?? labels.placeholder}
        aria-label={placeholder ?? labels.placeholder}
        disabled={state === "pending"}
        autoFocus={autoFocus}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <span role="status" className="mr-auto text-sm text-accent-red">
          {state === "error" ? labels.failed : ""}
        </span>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {labels.cancel}
          </Button>
        )}
        <Button type="submit" size="sm" disabled={state === "pending" || !body.trim()}>
          {state === "pending" ? labels.sending : (submitLabel ?? labels.send)}
        </Button>
      </div>
    </form>
  )
}

function CommentItem({
  comment: c,
  currentUserId,
  canModerate,
  canReply,
  onAdd,
  onEdit,
  onDelete,
  onSearchPeople,
  labels,
}: Pick<
  CommentThreadsProps,
  "currentUserId" | "canModerate" | "onAdd" | "onEdit" | "onDelete" | "onSearchPeople"
> & { comment: CollabComment; canReply?: boolean; labels: CollabLabels }) {
  const [mode, setMode] = React.useState<"view" | "edit" | "reply">("view")
  const [failed, setFailed] = React.useState(false)
  const mine = !!currentUserId && c.author.id === currentUserId
  if (c.deleted)
    return (
      <p data-slot="comment" data-deleted="" className="text-sm text-text-muted italic">
        {labels.deleted}
      </p>
    )
  return (
    <article data-slot="comment" data-mine={mine ? "" : undefined} className="flex gap-3">
      <PersonAvatar person={c.author} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-2 text-xs text-text-muted">
          <span className="text-sm font-medium text-text-primary">{c.author.name}</span>
          <time dateTime={new Date(c.createdAt).toISOString()}>{timeText(c.createdAt)}</time>
          {c.editedAt && <span data-slot="comment-edited">({labels.edited})</span>}
        </div>
        {mode === "edit" && onEdit ? (
          <Composer
            initial={c.body}
            onSubmit={async (body) => {
              await onEdit(c, body)
              setMode("view")
            }}
            onSearch={onSearchPeople}
            labels={labels}
            submitLabel={labels.save}
            onCancel={() => setMode("view")}
            autoFocus
          />
        ) : (
          <CommentBody body={c.body} />
        )}
        {mode !== "edit" && (
          <div className="flex gap-1">
            {canReply && (
              <Button variant="ghost" size="xs" onClick={() => setMode("reply")}>
                <Reply data-icon="inline-start" aria-hidden />
                {labels.reply}
              </Button>
            )}
            {mine && onEdit && (
              <Button variant="ghost" size="xs" onClick={() => setMode("edit")}>
                <Pencil data-icon="inline-start" aria-hidden />
                {labels.edit}
              </Button>
            )}
            {(mine || canModerate) && onDelete && (
              <Button
                variant="ghost"
                size="xs"
                onClick={async () => {
                  try {
                    await onDelete(c)
                  } catch {
                    setFailed(true)
                  }
                }}
              >
                <Trash2 data-icon="inline-start" aria-hidden />
                {labels.delete}
              </Button>
            )}
            {failed && (
              <span role="status" className="text-sm text-accent-red">
                {labels.failed}
              </span>
            )}
          </div>
        )}
        {mode === "reply" && (
          <Composer
            onSubmit={async (body) => {
              await onAdd({ body, parentId: c.id })
              setMode("view")
            }}
            onSearch={onSearchPeople}
            labels={labels}
            placeholder={labels.replyPlaceholder}
            submitLabel={labels.reply}
            onCancel={() => setMode("view")}
            autoFocus
          />
        )}
      </div>
    </article>
  )
}

// ------------------------------------------------------------------ activity

export type ActivityFeedProps = PartProps<"section"> & {
  items: CollabTimelineItem[]
  /** Shows Load more: fetch `GET /:table/:id/timeline?before=<nextCursor>` and append. */
  onLoadMore?: () => Promise<unknown> | unknown
  hasMore?: boolean
  title?: React.ReactNode
  labels?: Partial<CollabLabels>
}

/** What happened to a record, newest first: "Asha changed status to Done", comments, restores. */
export function ActivityFeed({
  items,
  onLoadMore,
  hasMore,
  title,
  labels: labelsProp,
  ...props
}: ActivityFeedProps) {
  const labels = useLabels(labelsProp)
  const headingId = React.useId()
  const [loading, setLoading] = React.useState(false)
  const more = async () => {
    setLoading(true)
    try {
      await onLoadMore?.()
    } finally {
      setLoading(false)
    }
  }
  const children = (
    <>
      <h2 id={headingId} className="text-lg font-semibold tracking-tight text-text-primary">
        {title ?? labels.activity}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-text-muted">{labels.noActivity}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((it) => (
            <li
              key={`${it.kind}:${it.id}`}
              data-slot="activity-item"
              data-kind={it.kind}
              className="flex gap-3"
            >
              <Avatar size="sm">
                <AvatarFallback>{initials(it.actor.name)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm text-text-primary">{it.summary}</span>
                <time dateTime={new Date(it.at).toISOString()} className="text-xs text-text-muted">
                  {timeText(it.at)}
                </time>
                {it.comment && !it.comment.deleted && (
                  <CommentBody
                    body={it.comment.body}
                    className="mt-1 rounded-lg bg-bg-elevated px-3 py-2 text-text-secondary"
                  />
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {hasMore && onLoadMore && (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          onClick={more}
          disabled={loading}
        >
          {loading ? labels.loading : labels.loadMore}
        </Button>
      )}
    </>
  )
  return usePart("section", "activity-feed", CARD, props, {
    "aria-labelledby": headingId,
    "aria-busy": loading || undefined,
    children,
  })
}

// ------------------------------------------------------------------ versions

const shown = (v: unknown, labels: CollabLabels) =>
  v === null || v === undefined || v === ""
    ? labels.empty
    : typeof v === "string"
      ? v
      : JSON.stringify(v)

/** A field-by-field table of changes. */
export function VersionDiff({
  changes,
  labels: labelsProp,
  className,
}: {
  changes: CollabFieldChange[]
  labels?: Partial<CollabLabels>
  className?: string
}) {
  const labels = useLabels(labelsProp)
  if (!changes.length) return <p className="text-sm text-text-muted">{labels.noChanges}</p>
  return (
    <table data-slot="version-diff" className={cn("w-full text-left text-sm", className)}>
      <thead className="text-xs text-text-muted">
        <tr>
          <th className="py-1 pr-3 font-medium">{labels.field}</th>
          <th className="py-1 pr-3 font-medium">{labels.before}</th>
          <th className="py-1 font-medium">{labels.after}</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.field} className="border-t border-border-default align-top">
            <th scope="row" className="py-1.5 pr-3 font-medium text-text-primary">
              {labels.fieldLabel(c.field)}
            </th>
            {c.hidden ? (
              <td colSpan={2} className="py-1.5 text-text-muted italic">
                {labels.hidden}
              </td>
            ) : (
              <>
                <td className="py-1.5 pr-3">
                  <del className="rounded bg-accent-red-subtle px-1 text-accent-red no-underline">
                    {shown(c.from, labels)}
                  </del>
                </td>
                <td className="py-1.5">
                  <ins className="rounded bg-accent-green-subtle px-1 text-accent-green no-underline">
                    {shown(c.to, labels)}
                  </ins>
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export type VersionHistoryProps = PartProps<"section"> & {
  /** Newest first, as `GET /:table/:id/versions` returns them. */
  versions: CollabVersion[]
  /** `POST /:table/:id/versions/:n/restore`; returns the new version. A throw shows its message. */
  onRestore?: (version: CollabVersion) => Promise<{ version: number } | unknown> | unknown
  /** `POST /:table/:id/undo` with `{ expected: latest }`. A 409 throw shows its message. */
  onUndo?: (latest: CollabVersion) => Promise<unknown> | unknown
  /** The version to show first. Default the latest. */
  defaultSelected?: number
  title?: React.ReactNode
  labels?: Partial<CollabLabels>
}

/** A record's versions; pick one to see what it changed, then Restore it or undo the latest. */
export function VersionHistory({
  versions,
  onRestore,
  onUndo,
  defaultSelected,
  title,
  labels: labelsProp,
  ...props
}: VersionHistoryProps) {
  const labels = useLabels(labelsProp)
  const headingId = React.useId()
  const [selected, setSelected] = React.useState(defaultSelected ?? versions[0]?.version)
  const [status, setStatus] = React.useState<{
    tone: "ok" | "error" | "busy"
    text: string
  } | null>(null)
  const latest = versions[0]
  const current = versions.find((v) => v.version === selected) ?? latest
  const run = async (fn: () => Promise<unknown> | unknown, done: (r: unknown) => string) => {
    setStatus({ tone: "busy", text: labels.restoring })
    try {
      setStatus({ tone: "ok", text: done(await fn()) })
    } catch (e) {
      setStatus({ tone: "error", text: (e as Error)?.message || labels.failed })
    }
  }
  const children = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={headingId}
          className="flex items-center gap-2 text-lg font-semibold tracking-tight text-text-primary"
        >
          <History className="size-4" aria-hidden />
          {title ?? labels.history}
        </h2>
        {onUndo && latest && versions.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            disabled={status?.tone === "busy"}
            onClick={() =>
              run(
                () => onUndo(latest),
                () => labels.undone,
              )
            }
          >
            <Undo2 data-icon="inline-start" aria-hidden />
            {labels.undo}
          </Button>
        )}
      </div>
      {versions.length === 0 ? (
        <p className="text-sm text-text-muted">{labels.noVersions}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <div role="listbox" aria-label={labels.history} className="flex flex-col gap-1">
            {versions.map((v) => (
              <button
                key={v.version}
                type="button"
                role="option"
                aria-selected={v.version === current?.version}
                data-selected={v.version === current?.version ? "" : undefined}
                onClick={() => setSelected(v.version)}
                className="flex flex-col items-start rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-bg-elevated focus-visible:ring-3 focus-visible:ring-ring data-selected:bg-bg-elevated"
              >
                <span className="flex items-center gap-2 font-medium text-text-primary">
                  {labels.version(v.version)}
                  {v === latest && <Badge variant="secondary">{labels.latest}</Badge>}
                </span>
                <span className="text-xs text-text-muted">
                  {labels.action[v.action] ?? v.action} · {labels.by(v.actor.name, v.at)}
                </span>
              </button>
            ))}
          </div>
          {current && (
            <div data-slot="version-detail" className="flex min-w-0 flex-col gap-3">
              <VersionDiff changes={current.changes} labels={labels} />
              {onRestore && current !== latest && (
                <Button
                  size="sm"
                  className="self-start"
                  disabled={status?.tone === "busy"}
                  onClick={() =>
                    run(
                      () => onRestore(current),
                      (r) =>
                        typeof (r as { version?: unknown })?.version === "number"
                          ? labels.restored((r as { version: number }).version)
                          : labels.restored(current.version),
                    )
                  }
                >
                  <RotateCcw data-icon="inline-start" aria-hidden />
                  {labels.restore}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <p
        role="status"
        data-tone={status?.tone}
        className={cn("text-sm", status?.tone === "error" ? "text-accent-red" : "text-text-muted")}
      >
        {status?.text ?? ""}
      </p>
    </>
  )
  return usePart("section", "version-history", CARD, props, {
    "aria-labelledby": headingId,
    children,
  })
}
