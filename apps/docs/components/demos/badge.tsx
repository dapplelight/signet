"use client"
import { Badge } from "@dapplelight/signet-ui/components/badge"
import { CheckIcon } from "lucide-react"

export function BadgeDemo() {
  return <Badge>Paid</Badge>
}

export function BadgeVariantsDemo() {
  return (
    <>
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Overdue</Badge>
      <Badge variant="outline">Draft</Badge>
      <Badge variant="ghost">Ghost</Badge>
      <Badge variant="link">Link</Badge>
    </>
  )
}

export function BadgeIconDemo() {
  return (
    <Badge variant="secondary">
      <CheckIcon data-icon="inline-start" />
      Verified
    </Badge>
  )
}

export function BadgeLinkDemo() {
  return <Badge render={<a href="#invoices" />}>12 open invoices</Badge>
}
