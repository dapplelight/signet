"use client"

import type * as React from "react"

import { DESKTOP_QUERY, useMediaQuery } from "../../hooks/use-media-query.js"
import { cn } from "../../lib/utils.js"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog.js"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "./drawer.js"

interface ResponsiveSheetProps {
  title: React.ReactNode
  description?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  /** Put on the body wrapper, next to `data-sheet` ("drawer" | "dialog"). */
  testId?: string
  /** Where the Dialog takes over from the Drawer. Default: the `md` breakpoint. */
  desktopQuery?: string
  className?: string
}

/**
 * One container for an add / edit form: a swipeable bottom Drawer on phone and
 * a centred Dialog on desktop. It is always open. Mount it only while it
 * should show (`{editing && <ResponsiveSheet …/>}`), so the form inside starts
 * fresh each time. The body wrapper carries `data-sheet`, so a test can tell
 * which container rendered even when a primitive is mocked.
 */
function ResponsiveSheet({
  title,
  description,
  onClose,
  children,
  testId,
  desktopQuery = DESKTOP_QUERY,
  className,
}: ResponsiveSheetProps) {
  const isDesktop = useMediaQuery(desktopQuery)
  const onOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  if (!isDesktop) {
    return (
      <Drawer open onOpenChange={onOpenChange} showSwipeHandle>
        <DrawerContent>
          <DrawerHeader className="pb-3">
            <DrawerTitle>{title}</DrawerTitle>
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>
          <div
            data-testid={testId}
            data-sheet="drawer"
            className={cn(
              "flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]",
              className,
            )}
          >
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div data-testid={testId} data-sheet="dialog" className={cn("min-w-0", className)}>
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { ResponsiveSheet, type ResponsiveSheetProps }
