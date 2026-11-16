"use client"

// Block: empty page. Wraps EmptyState with an icon, a title, a description and
// an action. Pass `action` (any node) or `onAction` for the default button.
// The folder is `empty-page` because `empty-state` is already the component's
// name in the registry. Copy it in with `signet add block empty-page` and edit it.
import { FolderIcon } from "lucide-react"
import type * as React from "react"
import { Button } from "../../components/ui/button.js"
import { Card, CardContent } from "../../components/ui/card.js"
import { EmptyState } from "../../components/ui/empty-state.js"
import { ErrorState } from "../../components/ui/error-state.js"
import { Skeleton } from "../../components/ui/skeleton.js"
import { cn } from "../../lib/utils.js"

export type BlockState = "ready" | "loading" | "error"

/** Every string the block shows. Spread it and override what you need. */
export const DEFAULT_EMPTY_PAGE_LABELS = {
  title: "No projects yet",
  description: "Create your first project to get started.",
  action: "New project",
  errorMessage: "We could not load this page.",
  loading: "Loading",
}

export type EmptyPageLabels = typeof DEFAULT_EMPTY_PAGE_LABELS

export type EmptyPageProps = {
  /** Above the title. Default a folder; pass `null` for none. */
  icon?: React.ReactNode
  title?: string
  description?: string
  /** Replaces the default button. */
  action?: React.ReactNode
  /** Runs when the default button is pressed. Without `action` or `onAction` no button shows. */
  onAction?: () => void
  state?: BlockState
  onRetry?: () => void
  labels?: Partial<EmptyPageLabels>
  classNames?: Partial<Record<"content", string>>
  className?: string
}

export function EmptyPage({
  icon,
  title,
  description,
  action,
  onAction,
  state = "ready",
  onRetry,
  labels: labelOverrides,
  classNames,
  className,
}: EmptyPageProps) {
  const l = { ...DEFAULT_EMPTY_PAGE_LABELS, ...labelOverrides }
  const button =
    action ??
    (onAction ? (
      <Button type="button" size="touch" className="md:h-8" onClick={onAction}>
        {l.action}
      </Button>
    ) : null)
  return (
    <section
      data-block="empty-page"
      data-state={state}
      aria-busy={state === "loading" || undefined}
      className={cn("mx-auto w-full max-w-7xl p-4 md:p-6", className)}
    >
      {state === "error" ? (
        <Card data-slot="empty-page-error">
          <CardContent>
            <ErrorState message={l.errorMessage} onRetry={onRetry} />
          </CardContent>
        </Card>
      ) : state === "loading" ? (
        <div
          data-slot="empty-page-skeleton"
          role="status"
          aria-label={l.loading}
          className="flex min-h-[60vh] flex-col items-center justify-center gap-3"
        >
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-11 w-32 md:h-8" />
        </div>
      ) : (
        <div data-slot="empty-page-content" className={classNames?.content}>
          <EmptyState
            icon={icon === undefined ? <FolderIcon aria-hidden="true" className="size-10" /> : icon}
            title={title ?? l.title}
            description={description ?? l.description}
            action={button}
          />
        </div>
      )}
    </section>
  )
}
