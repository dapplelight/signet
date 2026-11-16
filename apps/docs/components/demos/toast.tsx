"use client"

import { Button } from "@dapplelight/signet-ui/components/button"
import { Toaster, toast } from "@dapplelight/signet-ui/components/toast"

export function ToastDemo() {
  return (
    <>
      <Toaster />
      <Button variant="outline" onClick={() => toast("Invoice INV-1042 sent")}>
        Send invoice
      </Button>
    </>
  )
}

export function ToastTypesDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => toast.success("Payment received")}>
        Success
      </Button>
      <Button variant="outline" onClick={() => toast.info("3 orders shipped today")}>
        Info
      </Button>
      <Button variant="outline" onClick={() => toast.warning("Card expires next month")}>
        Warning
      </Button>
      <Button variant="outline" onClick={() => toast.error("Could not reach the bank")}>
        Error
      </Button>
    </div>
  )
}

export function ToastActionDemo() {
  return (
    <Button
      variant="outline"
      onClick={() =>
        toast("Order #1042 archived", {
          description: "It moves out of your active list.",
          action: { label: "Undo", onClick: () => toast.success("Order restored") },
          cancel: { label: "Dismiss" },
        })
      }
    >
      Archive order
    </Button>
  )
}

export function ToastPromiseDemo() {
  return (
    <Button
      variant="outline"
      onClick={() =>
        toast.promise(new Promise((resolve) => setTimeout(resolve, 1500)), {
          loading: "Exporting orders...",
          success: "Export ready",
          error: "Export failed",
        })
      }
    >
      Export orders
    </Button>
  )
}
