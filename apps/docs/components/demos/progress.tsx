"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import { Progress, ProgressLabel, ProgressValue } from "@dapplelight/signet-ui/components/progress"
import { useState } from "react"

export function ProgressDemo() {
  return (
    <div className="w-full max-w-sm">
      <Progress value={64} aria-label="Storage used" />
    </div>
  )
}

export function ProgressLabelledDemo() {
  return (
    <div className="w-full max-w-sm">
      <Progress value={72}>
        <ProgressLabel>Storage used</ProgressLabel>
        <ProgressValue />
      </Progress>
    </div>
  )
}

export function ProgressControlledDemo() {
  const [value, setValue] = useState(30)
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <Progress value={value}>
        <ProgressLabel>Uploading invoices</ProgressLabel>
        <ProgressValue />
      </Progress>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setValue((v) => (v >= 100 ? 0 : v + 25))}
      >
        {value >= 100 ? "Restart" : "Upload more"}
      </Button>
    </div>
  )
}

export function ProgressRangeDemo() {
  return (
    <div className="w-full max-w-sm">
      <Progress value={3} min={0} max={5}>
        <ProgressLabel>Onboarding steps</ProgressLabel>
        <ProgressValue>{(_, value) => `${value} of 5`}</ProgressValue>
      </Progress>
    </div>
  )
}

export function ProgressIndeterminateDemo() {
  return (
    <div className="w-full max-w-sm">
      <Progress value={null} aria-label="Syncing">
        <ProgressLabel>Syncing orders</ProgressLabel>
      </Progress>
    </div>
  )
}
