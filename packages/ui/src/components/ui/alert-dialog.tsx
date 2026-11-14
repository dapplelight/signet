"use client"

// A confirmation dialog on UI SDK's alert-dialog behaviour: always modal,
// never closed by an outside press, focus on the least destructive answer.
// The surface matches Dialog's.
// Recipe: popup + focus-trap + dismiss
import {
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent as AlertDialogContentPrimitive,
  AlertDialogDescription as AlertDialogDescriptionPrimitive,
  AlertDialog as AlertDialogPrimitive,
  AlertDialogTitle as AlertDialogTitlePrimitive,
  AlertDialogTrigger as AlertDialogTriggerPrimitive,
} from "@ui-sdk/react/alert-dialog"
import type { VariantProps } from "class-variance-authority"
import type * as React from "react"
import { cn } from "../../lib/utils.js"
import { buttonVariants } from "./button.js"

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive>) {
  return <AlertDialogPrimitive {...props} />
}

function AlertDialogTrigger(props: React.ComponentProps<typeof AlertDialogTriggerPrimitive>) {
  return <AlertDialogTriggerPrimitive {...props} />
}

function AlertDialogContent({
  className,
  backdropClassName,
  ...props
}: React.ComponentProps<typeof AlertDialogContentPrimitive> & { backdropClassName?: string }) {
  return (
    <>
      <AlertDialogBackdrop
        className={cn(
          "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-ending-style:animate-out data-ending-style:fade-out-0",
          backdropClassName,
        )}
      />
      <AlertDialogContentPrimitive
        className={cn(
          "fixed top-1/2 left-1/2 z-50 m-0 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border-0 bg-bg-surface p-4 text-sm text-text-primary ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-ending-style:animate-out data-ending-style:fade-out-0 data-ending-style:zoom-out-95",
          className,
        )}
        {...props}
      />
    </>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-bg-elevated/50 p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogTitlePrimitive>) {
  return (
    <AlertDialogTitlePrimitive
      className={cn("text-base leading-none font-medium", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogDescriptionPrimitive>) {
  return (
    <AlertDialogDescriptionPrimitive
      className={cn("text-sm text-text-muted", className)}
      {...props}
    />
  )
}

type CloseProps = React.ComponentProps<typeof AlertDialogClose> &
  Pick<VariantProps<typeof buttonVariants>, "variant" | "size">

/**
 * The agreeing answer. Closes with `returnValue` "confirm". An `action` that
 * returns a Promise keeps the dialog open, the button pending, until it settles.
 */
function AlertDialogAction({ className, variant = "default", size, ...props }: CloseProps) {
  return (
    <AlertDialogClose
      value="confirm"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

/** The safe answer. Put it first: it takes focus when the dialog opens. */
function AlertDialogCancel({ className, variant = "outline", size, ...props }: CloseProps) {
  return (
    <AlertDialogClose
      value="cancel"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
}
