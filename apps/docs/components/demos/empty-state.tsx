"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import { EmptyState } from "@dapplelight/signet-ui/components/empty-state"
import { InboxIcon, ReceiptIcon } from "lucide-react"

export function EmptyStateDemo() {
  return (
    <EmptyState
      icon={<InboxIcon className="size-8" />}
      title="No invoices yet"
      description="Create your first invoice and it will show up here."
      action={<Button>New invoice</Button>}
    />
  )
}

export function EmptyStateMinimalDemo() {
  return <EmptyState title="No results" />
}

export function EmptyStateDescriptionDemo() {
  return (
    <EmptyState
      icon={<ReceiptIcon className="size-8" />}
      title="Nothing matches your filters"
      description="Try a different status or widen the date range."
    />
  )
}
