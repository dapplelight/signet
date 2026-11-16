"use client"
import { ErrorState } from "@dapplelight/signet-ui/components/error-state"
import { useState } from "react"

export function ErrorStateDemo() {
  return <ErrorState message="We couldn't load your invoices." onRetry={() => {}} />
}

export function ErrorStateRetryDemo() {
  const [tries, setTries] = useState(0)
  return (
    <ErrorState
      message={`Request timed out. Retried ${tries} time${tries === 1 ? "" : "s"}.`}
      onRetry={() => setTries((n) => n + 1)}
    />
  )
}

export function ErrorStateMinimalDemo() {
  return <ErrorState />
}
