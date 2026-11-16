"use client"

// A command menu on UI SDK's command behaviour: typing filters and ranks,
// arrow keys move the highlight while focus stays in the input, Enter runs.
// CommandDialog puts it in Signet's Dialog and opens it with ⌘K / Ctrl+K.
// Recipe: selection + typeahead + filter; CommandDialog adds popup + focus-trap + dismiss + shortcut + controllable-state
import {
  CommandEmpty as CommandEmptyPrimitive,
  CommandGroupLabel,
  CommandGroup as CommandGroupPrimitive,
  CommandInput as CommandInputPrimitive,
  CommandItem as CommandItemPrimitive,
  CommandList as CommandListPrimitive,
  Command as CommandPrimitive,
  CommandSeparator as CommandSeparatorPrimitive,
  CommandShortcut as CommandShortcutPrimitive,
} from "@ui-sdk/react/command"
import { SearchIcon } from "lucide-react"
import type * as React from "react"
import { useControllableState, useShortcut } from "../../behaviors/index.js"
import { cn } from "../../lib/utils.js"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog.js"

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl bg-bg-surface text-text-primary",
        className,
      )}
      {...props}
    />
  )
}

function CommandInput({
  className,
  wrapperClassName,
  icon,
  ...props
}: React.ComponentProps<typeof CommandInputPrimitive> & {
  wrapperClassName?: string
  /** Replaces the search icon; null hides it. */
  icon?: React.ReactNode
}) {
  return (
    <div
      data-slot="command-input-wrapper"
      className={cn("flex h-10 items-center gap-2 border-b px-3", wrapperClassName)}
    >
      {icon === undefined ? (
        <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
      ) : (
        icon
      )}
      <CommandInputPrimitive
        className={cn(
          "h-10 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandListPrimitive>) {
  return (
    <CommandListPrimitive
      data-slot="command-list"
      className={cn("max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto p-1", className)}
      {...props}
    />
  )
}

function CommandEmpty({ className, ...props }: React.ComponentProps<typeof CommandEmptyPrimitive>) {
  return (
    <CommandEmptyPrimitive
      className={cn(
        "py-6 text-center text-sm text-text-muted [&:not([data-empty])]:hidden",
        className,
      )}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  heading,
  children,
  ...props
}: Omit<React.ComponentProps<typeof CommandGroupPrimitive>, "children"> & {
  heading?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <CommandGroupPrimitive className={cn("overflow-hidden py-1", className)} {...props}>
      {heading != null && (
        <CommandGroupLabel className="px-2 py-1.5 text-xs font-medium text-text-muted">
          {heading}
        </CommandGroupLabel>
      )}
      {children}
    </CommandGroupPrimitive>
  )
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandItemPrimitive>) {
  return (
    <CommandItemPrimitive
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-bg-elevated data-highlighted:text-text-primary data-disabled:pointer-events-none data-disabled:opacity-50 data-pending:opacity-70 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-text-muted",
        className,
      )}
      {...props}
    />
  )
}

/** Shows the item's `shortcut` (⌘P on Apple platforms, Ctrl+P elsewhere). */
function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<typeof CommandShortcutPrimitive>) {
  return (
    <CommandShortcutPrimitive
      className={cn("ml-auto text-xs tracking-widest text-text-muted", className)}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandSeparatorPrimitive>) {
  return (
    <CommandSeparatorPrimitive className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
  )
}

type CommandDialogProps = React.ComponentProps<typeof CommandPrimitive> & {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Toggles the dialog from anywhere on the page. Default "mod+k"; null turns it off. */
  shortcut?: string | null
  /** Names the dialog for screen readers. Shown only to them. */
  title?: React.ReactNode
  description?: React.ReactNode
  /** Close once a command runs. Default true. */
  closeOnAction?: boolean
  /** Classes for the dialog surface around the command. */
  contentClassName?: string
}

/** A command palette: Command inside a Dialog, opened with ⌘K / Ctrl+K. */
function CommandDialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  shortcut = "mod+k",
  title = "Command palette",
  description = "Search for a command to run.",
  closeOnAction = true,
  onAction,
  className,
  contentClassName,
  ...props
}: CommandDialogProps) {
  const [open, setOpen] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  })
  useShortcut(shortcut, (event) => {
    event.preventDefault()
    setOpen(!open)
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className={cn(
          // On a phone it is a bottom sheet with room for the list and the keyboard.
          "overflow-hidden p-0 max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:flex max-sm:h-[85dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:flex-col max-sm:rounded-b-none max-sm:[&_[data-slot=command-list]]:max-h-none max-sm:[&_[data-slot=command-list]]:flex-1",
          contentClassName,
        )}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command
          className={className}
          onAction={(value, details) => {
            const result = onAction?.(value, details)
            if (closeOnAction) setOpen(false)
            return result
          }}
          {...props}
        />
      </DialogContent>
    </Dialog>
  )
}

export {
  Command,
  CommandDialog,
  type CommandDialogProps,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
