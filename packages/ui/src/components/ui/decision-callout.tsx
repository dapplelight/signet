// A tinted note inside a timeline step: one bold line for what was decided,
// one quieter line for why, with the numbers. A plain div, not an Alert, so
// screen readers do not announce every decision as it renders.
import type * as React from "react"
import { cn } from "../../lib/utils.js"

/** Put it inside a TimelineItem, after the step's text; it sits under it. */
function DecisionCallout({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="decision-callout"
      className={cn("col-start-2 mt-2 rounded-md bg-accent-primary-subtle px-3 py-2", className)}
      {...props}
    />
  )
}

/** What was decided. */
function DecisionCalloutTitle({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="decision-callout-title"
      className={cn("text-sm font-semibold text-text-primary", className)}
      {...props}
    />
  )
}

/** Why, with the numbers. */
function DecisionCalloutReason({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="decision-callout-reason"
      className={cn("text-xs text-text-secondary tabular-nums", className)}
      {...props}
    />
  )
}

export { DecisionCallout, DecisionCalloutReason, DecisionCalloutTitle }
