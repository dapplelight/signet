"use client"

// Toasts on UI SDK's toast behaviour: stacking, swipe, timers that pause on
// hover and focus, F6 to reach the region, and live-region announcements.
// The API mirrors sonner's (`toast()`, `toast.success()`, `<Toaster />`), so
// an app can switch by changing two imports. UI SDK stays an internal detail.
// Recipe: live-region + timers + swipe + dismiss + shortcut
import {
  toast as sdkToast,
  ToastAction as ToastActionPrimitive,
  ToastClose as ToastClosePrimitive,
  ToastDescription as ToastDescriptionPrimitive,
  Toast as ToastPrimitive,
  ToastRegion,
  ToastTitle as ToastTitlePrimitive,
} from "@ui-sdk/react/toast"
import {
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import type * as React from "react"
import { cn } from "../../lib/utils.js"
import { buttonVariants } from "./button.js"

type ToastMessage = React.ReactNode

interface ToastOptions {
  /** Reuse an id to update a toast that is still showing. */
  id?: string
  description?: React.ReactNode
  /** Milliseconds. Default 5000; `Infinity` keeps it until dismissed. */
  duration?: number
  /** Whether swiping, Escape and the close button can dismiss it. Default true. */
  dismissible?: boolean
  /** A button such as Undo. A returned Promise keeps the toast open until it settles. */
  action?: { label: React.ReactNode; onClick: () => unknown }
  /** A second button that only dismisses, such as Cancel. */
  cancel?: { label: React.ReactNode; onClick?: () => void }
  onDismiss?: () => void
}

type PromiseMessage<T> = ToastMessage | ((value: T) => ToastMessage)

function toSdk(message: ToastMessage, o: ToastOptions = {}) {
  const { action, cancel, onDismiss, ...rest } = o
  return {
    ...rest,
    title: message,
    action: action && { label: action.label, onAction: () => action.onClick() },
    cancel: cancel && { label: cancel.label, onCancel: () => cancel.onClick?.() },
    onDismiss: onDismiss && (() => onDismiss()),
  }
}

const typed =
  (kind: "success" | "info" | "warning" | "error" | "loading") =>
  (message: ToastMessage, options?: ToastOptions): string =>
    sdkToast[kind](toSdk(message, options))

/**
 * Shows a toast from anywhere and returns its id. Needs one `<Toaster />`
 * mounted near the app root.
 */
const toast = Object.assign(
  (message: ToastMessage, options?: ToastOptions): string => sdkToast(toSdk(message, options)),
  {
    success: typed("success"),
    info: typed("info"),
    warning: typed("warning"),
    error: typed("error"),
    loading: typed("loading"),
    /** A loading toast that becomes a success or error toast when the promise settles. */
    promise<T>(
      promise: Promise<T> | (() => Promise<T>),
      messages: {
        loading: ToastMessage
        success?: PromiseMessage<T>
        error?: PromiseMessage<unknown>
      },
      options?: ToastOptions,
    ): string {
      const wrap = <V,>(m: PromiseMessage<V> | undefined) =>
        m === undefined
          ? undefined
          : (v: V) => toSdk(typeof m === "function" ? (m as (v: V) => ToastMessage)(v) : m, options)
      return sdkToast.promise(promise, {
        loading: toSdk(messages.loading, options),
        success: wrap(messages.success),
        error: wrap(messages.error),
      })
    },
    /** Dismisses one toast, or every toast without an id. */
    dismiss: (id?: string): void => sdkToast.dismiss(id),
  },
)

type ToasterPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"

interface ToasterProps {
  /** Default "bottom-right". Left and right follow the writing direction. */
  position?: ToasterPosition
  /** Keep the stack expanded instead of expanding on hover and focus. */
  expand?: boolean
  /** How many toasts show at once; the rest wait. Default 3. */
  visibleToasts?: number
  /** Show a close button on every dismissible toast. */
  closeButton?: boolean
  /** Name of the region for screen readers. Default "Notifications". */
  label?: string
  /** Accessible name of the close button. Default "Close". */
  closeLabel?: string
  /** What screen readers hear while a slow action runs. Set it in the page's language. */
  pendingAnnouncement?: string
  /** Key that moves focus into the region and back. Default "F6"; null turns it off. */
  hotkey?: string | null
  className?: string
  /** Classes for each part of every toast, merged over the defaults. */
  classNames?: Partial<
    Record<
      "toast" | "icon" | "content" | "title" | "description" | "action" | "cancel" | "close",
      string
    >
  >
}

const ALIGN = { left: "start", center: "center", right: "end" } as const

const TYPE_ICON = [
  [CircleCheckIcon, "success", "text-accent-green"],
  [InfoIcon, "info", "text-accent-blue"],
  [TriangleAlertIcon, "warning", "text-accent-amber"],
  [OctagonXIcon, "error", "text-accent-red"],
  [LoaderCircleIcon, "loading", "animate-spin text-text-muted"],
] as const

/**
 * Where toasts appear. Mount once. The stack, its motion and the surface come
 * from the theme's popover, border and radius tokens.
 */
function Toaster({
  position = "bottom-right",
  expand,
  visibleToasts,
  closeButton = false,
  label,
  closeLabel = "Close",
  pendingAnnouncement,
  hotkey,
  className,
  classNames = {},
}: ToasterProps) {
  const [side, x] = position.split("-") as ["top" | "bottom", keyof typeof ALIGN]
  return (
    <ToastRegion
      side={side}
      align={ALIGN[x]}
      expanded={expand}
      maxVisible={visibleToasts}
      aria-label={label}
      pendingAnnouncement={pendingAnnouncement}
      shortcut={hotkey}
      className={cn(
        "group/toaster fixed z-[100] m-0 w-(--toaster-width,356px) max-w-[calc(100vw-2rem)] border-0 bg-transparent p-0 [--dir:-1] [&>ol]:m-0 [&>ol]:list-none [&>ol]:p-0",
        "h-(--toast-front-height) data-expanded:h-[calc(var(--toast-stack-height)+(var(--toast-count)-1)*0.5rem)]",
        "data-[side=bottom]:bottom-4 data-[side=top]:top-4 data-[side=top]:[--dir:1]",
        "data-[align=end]:end-4 data-[align=start]:start-4 data-[align=center]:left-1/2 data-[align=center]:-translate-x-1/2",
        className,
      )}
    >
      {() => (
        <ToastPrimitive
          className={cn(
            "group/toast absolute inset-x-0 flex h-(--toast-height) items-start gap-3 overflow-hidden rounded-lg border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg select-none outline-none focus-visible:ring-3 focus-visible:ring-ring",
            "group-data-[side=bottom]/toaster:bottom-0 group-data-[side=top]/toaster:top-0",
            "z-[calc(100-var(--toast-index))] [--y:calc(var(--toast-index)*0.75rem*var(--dir))] [scale:calc(1-var(--toast-index)*0.05)] [translate:var(--toast-swipe-x,0px)_calc(var(--y)+var(--toast-swipe-y,0px))]",
            "transition-[translate,scale,opacity,height] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-opacity",
            "[&:not([data-front]):not([data-expanded])]:h-(--toast-front-height)",
            "data-expanded:[--y:calc(var(--dir)*(var(--toast-offset)+var(--toast-index)*0.5rem))] data-expanded:[scale:1]",
            "data-starting-style:transition-none data-starting-style:data-front:[--y:calc(-100%*var(--dir))]",
            "data-ending-style:opacity-0 [&[data-starting-style]:not([data-front])]:opacity-0 data-swiping:transition-none",
            classNames.toast,
          )}
        >
          {TYPE_ICON.map(([Icon, type, tone]) => (
            <Icon
              key={type}
              aria-hidden="true"
              className={cn(
                "mt-0.5 hidden size-4 shrink-0",
                tone,
                classNames.icon,
                type === "success" && "group-data-[type=success]/toast:block",
                type === "info" && "group-data-[type=info]/toast:block",
                type === "warning" && "group-data-[type=warning]/toast:block",
                type === "error" && "group-data-[type=error]/toast:block",
                type === "loading" && "group-data-[type=loading]/toast:block",
              )}
            />
          ))}
          <div
            data-slot="toast-content"
            className={cn("flex min-w-0 flex-1 flex-col gap-0.5", classNames.content)}
          >
            <ToastTitlePrimitive className={cn("font-medium", classNames.title)} />
            <ToastDescriptionPrimitive className={cn("text-text-muted", classNames.description)} />
          </div>
          <ToastClosePrimitive
            className={cn(
              buttonVariants({ variant: "outline", size: "xs" }),
              "shrink-0 empty:hidden",
              classNames.cancel,
            )}
          />
          <ToastActionPrimitive
            className={cn(
              buttonVariants({ size: "xs" }),
              "shrink-0 empty:hidden",
              classNames.action,
            )}
          />
          {closeButton && (
            <ToastClosePrimitive
              aria-label={closeLabel}
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-xs" }),
                "-mt-1 -mr-2 shrink-0",
                classNames.close,
              )}
            >
              <XIcon />
            </ToastClosePrimitive>
          )}
        </ToastPrimitive>
      )}
    </ToastRegion>
  )
}

export { Toaster, type ToasterPosition, type ToasterProps, type ToastOptions, toast }
