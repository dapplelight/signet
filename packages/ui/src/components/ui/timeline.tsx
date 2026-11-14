"use client"

// Dated events in order, on UI SDK's timeline behaviour: a named list with
// one tab stop and arrow keys between events. An item's optional `status`
// ("complete" | "current" | "upcoming") marks progress and sets aria-current.
import {
  TimelineConnector as TimelineConnectorPrimitive,
  TimelineDescription as TimelineDescriptionPrimitive,
  TimelineItem as TimelineItemPrimitive,
  TimelineMarker as TimelineMarkerPrimitive,
  Timeline as TimelinePrimitive,
  TimelineTime as TimelineTimePrimitive,
  TimelineTitle as TimelineTitlePrimitive,
} from "@ui-sdk/react/timeline"
import type * as React from "react"
import { cn } from "../../lib/utils.js"

/** Name it with `aria-label`. */
function Timeline({ className, ...props }: React.ComponentProps<typeof TimelinePrimitive>) {
  return <TimelinePrimitive className={cn("flex flex-col", className)} {...props} />
}

function TimelineItem({ className, ...props }: React.ComponentProps<typeof TimelineItemPrimitive>) {
  return (
    <TimelineItemPrimitive
      className={cn(
        "group/timeline-item relative grid grid-cols-[1rem_1fr] gap-x-3 gap-y-0.5 rounded-md pb-6 outline-none last:pb-0 focus-visible:ring-3 focus-visible:ring-ring data-last:pb-0",
        className,
      )}
      {...props}
    />
  )
}

/** The dot on the line. Pass an icon as children to replace it. */
function TimelineMarker({
  className,
  ...props
}: React.ComponentProps<typeof TimelineMarkerPrimitive>) {
  return (
    <TimelineMarkerPrimitive
      className={cn(
        "row-span-3 mt-1 flex size-4 items-center justify-center rounded-full border-2 border-border-strong bg-bg-surface [&_svg]:size-3",
        "data-complete:border-primary data-complete:bg-primary data-complete:text-primary-foreground data-current:border-primary",
        className,
      )}
      {...props}
    />
  )
}

function TimelineConnector({
  className,
  ...props
}: React.ComponentProps<typeof TimelineConnectorPrimitive>) {
  return (
    <TimelineConnectorPrimitive
      className={cn(
        "absolute top-6 bottom-1 left-[calc(0.5rem-1px)] w-0.5 bg-border group-last/timeline-item:hidden group-data-last/timeline-item:hidden data-complete:bg-primary",
        className,
      )}
      {...props}
    />
  )
}

function TimelineTitle({
  className,
  ...props
}: React.ComponentProps<typeof TimelineTitlePrimitive>) {
  return (
    <TimelineTitlePrimitive
      className={cn("col-start-2 text-sm font-medium text-text-primary", className)}
      {...props}
    />
  )
}

function TimelineTime({ className, ...props }: React.ComponentProps<typeof TimelineTimePrimitive>) {
  return (
    <TimelineTimePrimitive
      className={cn("col-start-2 text-xs text-text-muted tabular-nums", className)}
      {...props}
    />
  )
}

function TimelineDescription({
  className,
  ...props
}: React.ComponentProps<typeof TimelineDescriptionPrimitive>) {
  return (
    <TimelineDescriptionPrimitive
      className={cn("col-start-2 text-sm text-text-secondary", className)}
      {...props}
    />
  )
}

export {
  Timeline,
  TimelineConnector,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
}
