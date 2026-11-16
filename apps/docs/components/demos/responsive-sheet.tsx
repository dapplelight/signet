"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import { Input } from "@dapplelight/signet-ui/components/input"
import { Label } from "@dapplelight/signet-ui/components/label"
import { ResponsiveSheet } from "@dapplelight/signet-ui/components/responsive-sheet"
import { useState } from "react"

function ExpenseForm({ onDone }: { onDone: () => void }) {
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onDone()
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="expense-merchant">Merchant</Label>
        <Input id="expense-merchant" defaultValue="Blue Bottle Coffee" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="expense-amount">Amount</Label>
        <Input id="expense-amount" type="number" defaultValue="18.50" />
      </div>
      <Button type="submit">Save expense</Button>
    </form>
  )
}

export function ResponsiveSheetDemo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add expense</Button>
      {open && (
        <ResponsiveSheet
          title="Add expense"
          description="Log a purchase against this month's budget."
          onClose={() => setOpen(false)}
        >
          <ExpenseForm onDone={() => setOpen(false)} />
        </ResponsiveSheet>
      )}
    </>
  )
}

export function ResponsiveSheetEditDemo() {
  const [editing, setEditing] = useState<string | null>(null)
  const orders = ["ORD-2041", "ORD-2042", "ORD-2043"]
  return (
    <>
      <ul className="w-full max-w-xs divide-y rounded-lg border text-sm">
        {orders.map((id) => (
          <li key={id} className="flex items-center justify-between px-3 py-2">
            {id}
            <Button variant="ghost" size="sm" onClick={() => setEditing(id)}>
              Edit
            </Button>
          </li>
        ))}
      </ul>
      {editing && (
        <ResponsiveSheet title={`Edit ${editing}`} onClose={() => setEditing(null)}>
          <ExpenseForm onDone={() => setEditing(null)} />
        </ResponsiveSheet>
      )}
    </>
  )
}

export function ResponsiveSheetBreakpointDemo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Dialog from 1024px
      </Button>
      {open && (
        <ResponsiveSheet
          title="Invite teammate"
          desktopQuery="(min-width: 1024px)"
          onClose={() => setOpen(false)}
        >
          <ExpenseForm onDone={() => setOpen(false)} />
        </ResponsiveSheet>
      )}
    </>
  )
}
