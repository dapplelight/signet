"use client"

// Real-time pieces for a record page: an avatar stack of who is viewing, an
// "editing" badge, a typing indicator, and a "this record changed, reload?"
// banner. Members come in as props shaped like signet-server's presence
// (`useChannel(...).members` from hooks/use-channel); actions go out as callbacks.
// Recipe: live-region + image-loading
import { RefreshCw, X } from "lucide-react"
import type * as React from "react"
import { cn } from "../../lib/utils.js"
import { Avatar, AvatarFallback, AvatarImage, initials } from "../ui/avatar.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"

/** signet-server's `PresenceMember`. */
export type PresenceMemberView = {
  userId: string
  name?: string
  avatar?: string
  typing?: boolean
  editing?: string | null
}

/** Every string these components show, in English. Spread and override for another language. */
export const DEFAULT_REALTIME_LABELS = {
  viewing: (names: string[]) =>
    names.length === 0 ? "Nobody else here" : `Viewing: ${names.join(", ")}`,
  more: (n: number) => `+${n}`,
  editing: (name: string, field?: string) =>
    field ? `${name} is editing ${field}` : `${name} is editing`,
  typing: (names: string[]) =>
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : `${names.length} people are typing…`,
  changedTitle: "This record changed",
  changedBy: (name: string) => `${name} updated it. Reload to see the latest version.`,
  changedAnon: "Someone updated it. Reload to see the latest version.",
  reload: "Reload",
  dismiss: "Dismiss",
}
export type RealtimeLabels = typeof DEFAULT_REALTIME_LABELS

const nameOf = (m: PresenceMemberView) => m.name || m.userId
const others = (members: PresenceMemberView[], selfId?: string) =>
  members.filter((m) => m.userId !== selfId)

export type AvatarStackProps = React.ComponentProps<"div"> & {
  members: PresenceMemberView[]
  /** Leave yourself out of the stack. */
  selfId?: string
  /** Avatars shown before "+n". Default 4. */
  max?: number
  size?: "sm" | "default" | "lg"
  labels?: Partial<RealtimeLabels>
}

/** Overlapping avatars of who is in the channel, with a "+n" for the rest. */
function AvatarStack({
  members,
  selfId,
  max = 4,
  size = "default",
  labels,
  className,
  ...props
}: AvatarStackProps) {
  const L = { ...DEFAULT_REALTIME_LABELS, ...labels }
  const list = others(members, selfId)
  const shown = list.slice(0, max)
  const rest = list.length - shown.length
  return (
    <div
      data-slot="avatar-stack"
      role="img"
      aria-label={L.viewing(list.map(nameOf))}
      className={cn("flex items-center -space-x-2", className)}
      {...props}
    >
      {shown.map((m) => (
        <Avatar
          key={m.userId}
          size={size}
          title={nameOf(m)}
          data-user-id={m.userId}
          data-typing={m.typing ? "" : undefined}
          className="ring-2 ring-bg-surface"
        >
          {m.avatar && <AvatarImage src={m.avatar} alt="" />}
          <AvatarFallback aria-hidden>{initials(nameOf(m))}</AvatarFallback>
        </Avatar>
      ))}
      {rest > 0 && (
        <span
          data-slot="avatar-stack-more"
          aria-hidden
          className={cn(
            "relative inline-flex items-center justify-center rounded-full bg-bg-elevated font-medium text-text-secondary ring-2 ring-bg-surface",
            size === "sm"
              ? "size-6 text-xs"
              : size === "lg"
                ? "size-10 text-base"
                : "size-8 text-sm",
          )}
        >
          {L.more(rest)}
        </span>
      )}
    </div>
  )
}

export type EditingBadgeProps = Omit<React.ComponentProps<typeof Badge>, "children"> & {
  members: PresenceMemberView[]
  selfId?: string
  /** Only someone editing this field. Default: anyone editing anything. */
  field?: string
  /** A readable name for the field in the text. Default the field itself. */
  fieldLabel?: string
  labels?: Partial<RealtimeLabels>
}

/** "Asha is editing": shown while another member edits (this field). Renders nothing otherwise. */
function EditingBadge({
  members,
  selfId,
  field,
  fieldLabel,
  labels,
  className,
  ...props
}: EditingBadgeProps) {
  const L = { ...DEFAULT_REALTIME_LABELS, ...labels }
  const editor = others(members, selfId).find((m) =>
    field === undefined ? !!m.editing : m.editing === field,
  )
  if (!editor) return null
  return (
    <Badge
      variant="secondary"
      data-slot="editing-badge"
      className={cn("gap-1.5", className)}
      {...props}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-accent-amber" />
      {L.editing(nameOf(editor), field === undefined ? undefined : (fieldLabel ?? field))}
    </Badge>
  )
}

export type TypingIndicatorProps = React.ComponentProps<"p"> & {
  members: PresenceMemberView[]
  selfId?: string
  labels?: Partial<RealtimeLabels>
}

/** "Asha is typing…", in a polite live region that stays mounted so screen readers hear it. */
function TypingIndicator({ members, selfId, labels, className, ...props }: TypingIndicatorProps) {
  const L = { ...DEFAULT_REALTIME_LABELS, ...labels }
  const typing = others(members, selfId).filter((m) => m.typing)
  return (
    <p
      data-slot="typing-indicator"
      aria-live="polite"
      className={cn("min-h-5 text-xs text-text-muted", className)}
      {...props}
    >
      {typing.length > 0 && (
        <>
          <span aria-hidden className="mr-1.5 inline-flex gap-0.5 align-middle">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1 animate-pulse rounded-full bg-text-muted"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
          {L.typing(typing.map(nameOf))}
        </>
      )}
    </p>
  )
}

export type RecordChangedBannerProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Show the banner. */
  changed: boolean
  /** Who changed it, if known. */
  by?: string
  onReload: () => void
  onDismiss?: () => void
  labels?: Partial<RealtimeLabels>
}

/** "This record changed, reload?" Pair with `useRecordChanges`. Renders nothing while unchanged. */
function RecordChangedBanner({
  changed,
  by,
  onReload,
  onDismiss,
  labels,
  className,
  ...props
}: RecordChangedBannerProps) {
  const L = { ...DEFAULT_REALTIME_LABELS, ...labels }
  if (!changed) return null
  return (
    <div
      role="status"
      data-slot="record-changed-banner"
      className={cn(
        "flex items-center gap-3 rounded-lg border border-accent-amber/50 bg-accent-amber/10 px-4 py-3 text-sm text-text-primary",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{L.changedTitle}</p>
        <p className="text-xs text-text-secondary">{by ? L.changedBy(by) : L.changedAnon}</p>
      </div>
      <Button size="sm" onClick={onReload}>
        <RefreshCw aria-hidden />
        {L.reload}
      </Button>
      {onDismiss && (
        <Button size="icon-sm" variant="ghost" aria-label={L.dismiss} onClick={onDismiss}>
          <X aria-hidden />
        </Button>
      )}
    </div>
  )
}

export { AvatarStack, EditingBadge, RecordChangedBanner, TypingIndicator }
