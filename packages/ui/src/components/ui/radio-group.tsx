"use client"

// A radio group on UI SDK's radio behaviour: one tab stop, arrow keys move
// and check, a hidden native radio takes part in forms. Styled like Checkbox.
// Recipe: selection + roving-focus
import {
  RadioGroup as RadioGroupPrimitive,
  RadioIndicator,
  Radio as RadioPrimitive,
} from "@ui-sdk/react/radio"
import type * as React from "react"
import { cn } from "../../lib/utils.js"

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive>) {
  return <RadioGroupPrimitive className={cn("grid gap-2", className)} {...props} />
}

/** One option. Wrap it with its text in a `<label>`, or give it `aria-label`. */
function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioPrimitive>) {
  return (
    <RadioPrimitive
      className={cn(
        "peer inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-default bg-transparent p-0 transition-colors outline-none",
        "data-checked:border-primary",
        "focus-visible:ring-1 focus-visible:ring-primary/50",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioIndicator className="size-2 rounded-full bg-primary" />
    </RadioPrimitive>
  )
}

export { RadioGroup, RadioGroupItem }
