"use client"

import { Button } from "@dapplelight/signet-ui/components/button"
import { Stepper } from "@dapplelight/signet-ui/components/stepper"
import { useState } from "react"

const steps = [
  { title: "Cart", description: "3 items" },
  { title: "Shipping", description: "Address" },
  { title: "Payment", description: "Card details" },
  { title: "Review" },
]

export function StepperDemo() {
  return <Stepper aria-label="Checkout" steps={steps} current={1} />
}

export function StepperVerticalDemo() {
  return (
    <Stepper
      aria-label="Checkout"
      steps={steps}
      current={2}
      orientation="vertical"
      className="max-w-xs"
    />
  )
}

export function StepperControlledDemo() {
  const [current, setCurrent] = useState(0)
  return (
    <div className="w-full space-y-6">
      <Stepper aria-label="Checkout" steps={steps} current={current} />
      <div className="flex gap-2">
        <Button variant="outline" disabled={current === 0} onClick={() => setCurrent(current - 1)}>
          Back
        </Button>
        <Button disabled={current === steps.length} onClick={() => setCurrent(current + 1)}>
          {current === steps.length - 1 ? "Place order" : "Next"}
        </Button>
      </div>
    </div>
  )
}

export function StepperIndicatorDemo() {
  return (
    <Stepper
      aria-label="Checkout"
      steps={steps}
      current={1}
      renderIndicator={(i, status) => (status === "complete" ? "✓" : String.fromCharCode(65 + i))}
    />
  )
}
