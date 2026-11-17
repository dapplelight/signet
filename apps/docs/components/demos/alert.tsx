"use client"
import { Alert, AlertDescription, AlertTitle } from "@dapplelight/signet-ui/components/alert"
import { AlertTriangleIcon, CircleAlertIcon, InfoIcon } from "lucide-react"

/** The homepage alerts tile ("Card declined"), also the Alert composition. */
export function AlertStackDemo() {
  return (
    <div className="grid gap-4">
      <Alert>
        <AlertTitle>Deploy succeeded</AlertTitle>
        <AlertDescription>production · 41s · commit 9f3c2e1</AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <AlertTitle>Card declined</AlertTitle>
        <AlertDescription>Ask the customer for another payment method.</AlertDescription>
      </Alert>
    </div>
  )
}

export function AlertDemo() {
  return (
    <Alert className="max-w-md">
      <InfoIcon className="size-4" />
      <AlertTitle>Invoice INV-2041 sent</AlertTitle>
      <AlertDescription>Acme Corp was emailed a payment link for $4,200.00.</AlertDescription>
    </Alert>
  )
}

export function AlertDestructiveDemo() {
  return (
    <Alert variant="destructive" className="max-w-md">
      <CircleAlertIcon className="size-4" />
      <AlertTitle>Payment failed</AlertTitle>
      <AlertDescription>
        The card ending 4242 was declined. Update it to keep your plan.
      </AlertDescription>
    </Alert>
  )
}

export function AlertWarningDemo() {
  return (
    <Alert variant="warning" className="max-w-md">
      <AlertTriangleIcon className="size-4" />
      <AlertTitle>Usage at 92%</AlertTitle>
      <AlertDescription>You have used 9,200 of 10,000 API calls this month.</AlertDescription>
    </Alert>
  )
}

export function AlertNoIconDemo() {
  return (
    <Alert className="max-w-md">
      <AlertTitle>Scheduled maintenance</AlertTitle>
      <AlertDescription>
        Reports will be unavailable on Sunday from 02:00 to 03:00 UTC.
      </AlertDescription>
    </Alert>
  )
}
