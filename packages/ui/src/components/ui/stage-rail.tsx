// A thin row of equal segments, one per stage of a run: done filled, current
// filled and pulsing, later ones empty. Sits above a Stepper or Timeline.
// Not interactive; each segment carries sr-only text ("Plan: done").
import type * as React from "react"
import { useLabels } from "../../lib/labels.js"
import { cn } from "../../lib/utils.js"
import type { StepStatus } from "./stepper.js"

interface StageRailProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** One title per stage, read out by screen readers. */
  stages: readonly React.ReactNode[]
  /** Index of the current stage, from 0. Earlier stages are done. Past the end, all are; below 0, none. */
  current: number
  /** Names the rail for screen readers, like "Run progress". */
  "aria-label": string
  /** Classes for each segment and its screen-reader text, merged over the defaults. */
  classNames?: Partial<Record<"segment" | "label", string>>
}

function StageRail({ stages, current, classNames = {}, className, ...props }: StageRailProps) {
  const l = useLabels()
  if (stages.length === 0) return null
  const words: Record<StepStatus, string> = {
    complete: l.stageDone,
    current: l.stageCurrent,
    upcoming: l.stageUpcoming,
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings UA border, padding and min-width that fight the layout; role="group" gives the same semantics
    <div data-slot="stage-rail" role="group" className={cn("flex gap-1", className)} {...props}>
      {stages.map((title, i) => {
        // Same rule as Stepper's statusOf.
        const status: StepStatus = i < current ? "complete" : i === current ? "current" : "upcoming"
        return (
          <div
            key={i}
            data-slot="stage-rail-segment"
            data-status={status}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              status === "upcoming" ? "bg-bg-elevated" : "bg-primary",
              status === "current" && "animate-pulse motion-reduce:animate-none",
              classNames.segment,
            )}
          >
            <span className={cn("sr-only", classNames.label)}>
              {title}: {words[status]}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export { StageRail, type StageRailProps }
