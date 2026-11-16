"use client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@dapplelight/signet-ui/components/alert-dialog"
import { Button } from "@dapplelight/signet-ui/components/button"
import * as React from "react"

export function AlertDialogDemo() {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" />}>Delete project</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "Q4 Planning"?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the project and its 38 tasks. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function AlertDialogControlledDemo() {
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState("Subscription active")
  return (
    <div className="flex items-center gap-3">
      <AlertDialog
        open={open}
        onOpenChange={(next, details) => {
          setOpen(next)
          if (!next && details.returnValue === "confirm") setStatus("Subscription cancelled")
        }}
      >
        <AlertDialogTrigger render={<Button variant="outline" />}>
          Cancel subscription
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel your Pro plan?</AlertDialogTitle>
            <AlertDialogDescription>You keep access until 30 Nov 2026.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep plan</AlertDialogCancel>
            <AlertDialogAction>Cancel plan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <span className="text-sm text-text-muted">{status}</span>
    </div>
  )
}

export function AlertDialogAsyncDemo() {
  const [status, setStatus] = React.useState("3 pending refunds")
  return (
    <div className="flex items-center gap-3">
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="outline" />}>Issue refunds</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refund 3 orders?</AlertDialogTitle>
            <AlertDialogDescription>
              $186.40 returns to the customers' cards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              action={async () => {
                await new Promise((resolve) => setTimeout(resolve, 1200))
                setStatus("Refunds issued")
              }}
            >
              Refund
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <span className="text-sm text-text-muted">{status}</span>
    </div>
  )
}
