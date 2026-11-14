"use client"

// Progress through numbered steps. UI SDK ships no stepper, so this is its
// horizontal timeline behaviour (one tab stop, Left/Right between steps,
// aria-current="step" on the current one) with a numbered indicator.
import {
  TimelineConnector,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  Timeline as TimelinePrimitive,
  TimelineTitle,
} from "@ui-sdk/react/timeline"
import { CheckIcon } from "lucide-react"
import type * as React from "react"
import { cn } from "../../lib/utils.js"

type StepStatus = "complete" | "current" | "upcoming"

interface StepperStep {
  title: React.ReactNode
  description?: React.ReactNode
}

interface StepperProps extends Omit<React.ComponentProps<"div">, "children"> {
  steps: readonly StepperStep[]
  /** Index of the current step, from 0. Earlier steps show as complete. Past the end, all are. */
  current: number
  /** Names the steps for screen readers, like "Checkout". */
  "aria-label": string
  orientation?: "horizontal" | "vertical"
  /** Classes for each step's parts, merged over the defaults. */
  classNames?: Partial<Record<"item" | "indicator" | "connector" | "title" | "description", string>>
  /** Replaces the number / check in each step's indicator. */
  renderIndicator?: (index: number, status: StepStatus) => React.ReactNode
}

const statusOf = (i: number, current: number): StepStatus =>
  i < current ? "complete" : i === current ? "current" : "upcoming"

function Stepper({
  steps,
  current,
  orientation = "horizontal",
  classNames = {},
  renderIndicator,
  className,
  ...props
}: StepperProps) {
  const vertical = orientation === "vertical"
  return (
    <TimelinePrimitive
      orientation={orientation}
      loop={false}
      className={cn("flex", vertical ? "flex-col" : "flex-row items-start", className)}
      {...props}
    >
      {steps.map((step, i) => {
        const status = statusOf(i, current)
        return (
          <TimelineItem
            key={i}
            status={status}
            className={cn(
              "group/step relative flex min-w-0 flex-1 gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring",
              vertical ? "flex-row pb-6 last:pb-0" : "flex-col items-center text-center",
              classNames.item,
            )}
          >
            <TimelineMarker
              className={cn(
                "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
                "border-border-default bg-bg-surface text-text-muted",
                "data-current:border-primary data-current:text-primary",
                "data-complete:border-primary data-complete:bg-primary data-complete:text-primary-foreground",
                classNames.indicator,
              )}
            >
              {renderIndicator ? (
                renderIndicator(i, status)
              ) : status === "complete" ? (
                <CheckIcon className="size-3.5" strokeWidth={3} />
              ) : (
                i + 1
              )}
            </TimelineMarker>
            <TimelineConnector
              className={cn(
                "absolute bg-border group-last/step:hidden data-complete:bg-primary",
                vertical
                  ? "top-8 bottom-1 left-[calc(0.875rem-0.5px)] w-px"
                  : "top-3.5 left-[calc(50%+1.25rem)] h-px w-[calc(100%-2.5rem)]",
                classNames.connector,
              )}
            />
            <div className={cn("flex min-w-0 flex-col gap-0.5", !vertical && "px-2")}>
              <TimelineTitle
                className={cn(
                  "text-sm font-medium text-text-primary group-data-upcoming/step:text-text-muted",
                  classNames.title,
                )}
              >
                {step.title}
              </TimelineTitle>
              {step.description != null && (
                <TimelineDescription
                  className={cn("text-xs text-text-muted", classNames.description)}
                >
                  {step.description}
                </TimelineDescription>
              )}
            </div>
          </TimelineItem>
        )
      })}
    </TimelinePrimitive>
  )
}

export { Stepper, type StepperProps, type StepperStep, type StepStatus }
