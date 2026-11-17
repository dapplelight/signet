"use client"
import { Badge } from "@dapplelight/signet-ui/components/badge"
import { Button } from "@dapplelight/signet-ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@dapplelight/signet-ui/components/card"
import { Progress } from "@dapplelight/signet-ui/components/progress"

/** The homepage "Monthly revenue" tile, also the Card composition. */
export function RevenueCardDemo() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly revenue</CardTitle>
        <CardDescription>October 2026</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="text-3xl font-semibold tracking-tight">₹4,82,15,300</div>
        <div className="flex gap-2">
          <Badge>+12.4%</Badge>
          <Badge variant="outline">1,284 subscriptions</Badge>
        </div>
        <Progress value={72} />
        <p className="text-sm text-text-muted">72% of the quarterly target</p>
      </CardContent>
    </Card>
  )
}

export function CardDemo() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Monthly revenue</CardTitle>
        <CardDescription>November 2026</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold">$48,200</p>
        <p className="text-sm text-text-muted">+12% from October</p>
      </CardContent>
    </Card>
  )
}

export function CardWithActionDemo() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Team members</CardTitle>
        <CardDescription>8 of 10 seats used</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline">
            Invite
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm">Priya Nair, Marcus Chen, Sofia Alvarez and 5 others.</p>
      </CardContent>
    </Card>
  )
}

export function CardWithFooterDemo() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Invoice INV-2041</CardTitle>
        <CardDescription>Acme Corp, due 30 Nov 2026</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">$4,200.00</p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline">Download</Button>
        <Button>Send reminder</Button>
      </CardFooter>
    </Card>
  )
}

export function CardSmallDemo() {
  return (
    <Card size="sm" className="w-full max-w-xs">
      <CardHeader>
        <CardTitle>Open tickets</CardTitle>
        <CardDescription>Support queue</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">17</p>
      </CardContent>
    </Card>
  )
}
