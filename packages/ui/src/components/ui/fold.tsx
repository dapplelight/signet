"use client"

// Recipe: disclosure + controllable-state
// One row — a title, a muted detail ("12 lines, written by the builder") and a
// "Show more" / "Show less" link — that opens its text in place, no popup.
// The body is Markdown, so it needs the optional peers `Markdown` needs; for
// that reason Fold is not in the barrel: import it from `components/fold`.
import * as React from "react"

import { useControllableState } from "../../behaviors/index.js"
import { useLabels } from "../../lib/labels.js"
import { cn } from "../../lib/utils.js"
import { Button } from "./button.js"
import { Markdown, type MarkdownProps } from "./markdown.js"

const FoldContext = React.createContext<{
  open: boolean
  toggle: () => void
  bodyId: string
} | null>(null)

function useFold() {
  const ctx = React.useContext(FoldContext)
  if (!ctx) throw new Error("Fold parts must be used inside <FoldRoot>")
  return ctx
}

type FoldRootProps = Omit<React.ComponentProps<"section">, "title"> & {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

/** The wrapper: owns the open state (controlled or not). `data-state="open|closed"`. */
function FoldRoot({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
  ...props
}: FoldRootProps) {
  const [open, setOpen] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  })
  const bodyId = React.useId()
  const ctx = React.useMemo(
    () => ({ open, bodyId, toggle: () => setOpen(!open) }),
    [open, bodyId, setOpen],
  )
  return (
    <FoldContext.Provider value={ctx}>
      <section
        data-slot="fold"
        data-state={open ? "open" : "closed"}
        className={cn("flex min-w-0 flex-col gap-2", className)}
        {...props}
      >
        {children}
      </section>
    </FoldContext.Provider>
  )
}

function FoldHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="fold-header"
      className={cn("flex min-w-0 items-baseline gap-x-3 gap-y-1 flex-wrap", className)}
      {...props}
    />
  )
}

function FoldTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="fold-title"
      className={cn("text-body font-medium text-text-primary", className)}
      {...props}
    />
  )
}

function FoldDetail({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="fold-detail"
      className={cn("text-caption text-text-muted", className)}
      {...props}
    />
  )
}

/** The link. Its words change with the state and `aria-expanded` announces it. */
function FoldToggle({
  className,
  children,
  showMoreLabel,
  showLessLabel,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "variant" | "size"> & {
  showMoreLabel?: string
  showLessLabel?: string
}) {
  const { open, toggle, bodyId } = useFold()
  const l = useLabels()
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      data-slot="fold-toggle"
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={toggle}
      className={cn("ml-auto h-auto px-0 py-0", className)}
      {...props}
    >
      {children ?? (open ? (showLessLabel ?? l.showLess) : (showMoreLabel ?? l.showMore))}
    </Button>
  )
}

/** The text. Rendered only while open; capped at about 66 characters wide. */
function FoldBody({ className, children, ...props }: React.ComponentProps<"div">) {
  const { open, bodyId } = useFold()
  return (
    <div
      id={bodyId}
      data-slot="fold-body"
      hidden={!open}
      className={cn("max-w-[66ch]", className)}
      {...props}
    >
      {open ? children : null}
    </div>
  )
}

type FoldProps = Omit<FoldRootProps, "title" | "children"> & {
  title: React.ReactNode
  /** Muted, beside the title: "12 lines, written by the builder". */
  detail?: React.ReactNode
  /** The long text, as Markdown. */
  children: string
  /** Replaces "Show more" / "Show less" (or set `labels.showMore` / `showLess` once for the app). */
  showMoreLabel?: string
  showLessLabel?: string
  /** Passed to the Markdown renderer (`images`, `idPrefix`, ...). */
  markdown?: Omit<MarkdownProps, "children">
  /** Class per part. */
  classNames?: {
    header?: string
    title?: string
    detail?: string
    toggle?: string
    body?: string
    markdown?: string
  }
}

/** Long text behind one row. Opens in place; Enter and Space work (it is a button). */
function Fold({
  title,
  detail,
  children,
  showMoreLabel,
  showLessLabel,
  markdown,
  classNames,
  ...props
}: FoldProps) {
  return (
    <FoldRoot {...props}>
      <FoldHeader className={classNames?.header}>
        <FoldTitle className={classNames?.title}>{title}</FoldTitle>
        {detail != null && <FoldDetail className={classNames?.detail}>{detail}</FoldDetail>}
        <FoldToggle
          className={classNames?.toggle}
          showMoreLabel={showMoreLabel}
          showLessLabel={showLessLabel}
        />
      </FoldHeader>
      <FoldBody className={classNames?.body}>
        <Markdown {...markdown} className={cn(markdown?.className, classNames?.markdown)}>
          {children}
        </Markdown>
      </FoldBody>
    </FoldRoot>
  )
}

export { Fold, FoldBody, FoldDetail, FoldHeader, type FoldProps, FoldRoot, FoldTitle, FoldToggle }
