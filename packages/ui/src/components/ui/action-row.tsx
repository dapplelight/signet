// One item that waits on the user: an icon, a title, one plain sentence and
// the buttons that settle it ("Merge PR #482", "Approve deploy"). Wide: the
// buttons sit on the right. Narrow: they move under the text, full width and
// at least 44px tall. Amber for "look at this", never red: red means destructive.
import * as React from "react"

import { cn } from "../../lib/utils.js"

type ActionRowTone = "neutral" | "ask" | "warn"

function ActionRowRoot({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"div"> & { tone?: ActionRowTone }) {
  return (
    <div
      data-slot="action-row"
      data-tone={tone}
      className={cn(
        "group/action-row flex min-w-0 flex-col gap-3 rounded-xl border bg-bg-surface p-4 sm:flex-row sm:items-center sm:gap-4",
        tone === "neutral" && "border-border-subtle",
        tone === "ask" && "border-primary/40 bg-primary/5",
        tone === "warn" && "border-accent-amber/50 bg-accent-amber-subtle",
        className,
      )}
      {...props}
    />
  )
}

function ActionRowIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="action-row-icon"
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center text-text-muted [&_svg:not([class*='size-'])]:size-5",
        "group-data-[tone=ask]/action-row:text-primary group-data-[tone=warn]/action-row:text-accent-amber",
        className,
      )}
      {...props}
    />
  )
}

function ActionRowBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="action-row-body" className={cn("min-w-0 flex-1", className)} {...props} />
}

function ActionRowTitle({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="action-row-title"
      className={cn("text-body font-medium text-text-primary", className)}
      {...props}
    />
  )
}

function ActionRowDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="action-row-description"
      className={cn("text-caption text-text-secondary", className)}
      {...props}
    />
  )
}

/** Stacked and full width on narrow screens, every button at least 44px tall. */
function ActionRowActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="action-row-actions"
      className={cn(
        "flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center",
        "max-sm:[&_[data-slot=button]]:min-h-11 max-sm:[&_[data-slot=button]]:w-full",
        className,
      )}
      {...props}
    />
  )
}

interface ActionRowProps extends Omit<React.ComponentProps<"div">, "title"> {
  /** neutral (default), ask (the app needs an answer) or warn (amber, needs a look). */
  tone?: ActionRowTone
  /** Leading icon, e.g. `<GitMergeIcon />`. */
  icon?: React.ReactNode
  /** What waits on the user: "Merge PR #482". */
  title: React.ReactNode
  /** One plain sentence: why, and what the buttons do. */
  description?: React.ReactNode
  /** The buttons, e.g. `<Button>Merge</Button>`. */
  actions?: React.ReactNode
  /** Class per part. */
  classNames?: {
    icon?: string
    body?: string
    title?: string
    description?: string
    actions?: string
  }
}

function ActionRow({
  tone,
  icon,
  title,
  description,
  actions,
  classNames,
  className,
  ...props
}: ActionRowProps) {
  const titleId = React.useId()
  return (
    <ActionRowRoot
      role="group"
      aria-labelledby={titleId}
      tone={tone}
      className={className}
      {...props}
    >
      {icon && <ActionRowIcon className={classNames?.icon}>{icon}</ActionRowIcon>}
      <ActionRowBody className={classNames?.body}>
        <ActionRowTitle id={titleId} className={classNames?.title}>
          {title}
        </ActionRowTitle>
        {description && (
          <ActionRowDescription className={classNames?.description}>
            {description}
          </ActionRowDescription>
        )}
      </ActionRowBody>
      {actions && <ActionRowActions className={classNames?.actions}>{actions}</ActionRowActions>}
    </ActionRowRoot>
  )
}

export {
  ActionRow,
  ActionRowActions,
  ActionRowBody,
  ActionRowDescription,
  ActionRowIcon,
  type ActionRowProps,
  ActionRowRoot,
  ActionRowTitle,
  type ActionRowTone,
}
