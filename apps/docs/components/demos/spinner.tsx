"use client"

import { Button } from "@dapplelight/signet-ui/components/button"
import { Spinner } from "@dapplelight/signet-ui/components/spinner"

export function SpinnerDemo() {
  return <Spinner />
}

export function SpinnerSizeDemo() {
  return (
    <div className="flex items-center gap-4">
      <Spinner className="size-3" />
      <Spinner />
      <Spinner className="size-6" />
      <Spinner className="size-8" />
    </div>
  )
}

export function SpinnerButtonDemo() {
  return (
    <Button disabled>
      <Spinner aria-label="Saving" className="text-current" />
      Saving invoice
    </Button>
  )
}

export function SpinnerColorDemo() {
  return <Spinner className="size-6 text-primary" aria-label="Syncing orders" />
}
