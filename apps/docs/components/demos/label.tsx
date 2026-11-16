"use client"
import { Checkbox } from "@dapplelight/signet-ui/components/checkbox"
import { Input } from "@dapplelight/signet-ui/components/input"
import { Label } from "@dapplelight/signet-ui/components/label"

export function LabelDemo() {
  return (
    <div className="grid w-full max-w-sm gap-2">
      <Label htmlFor="customer">Customer</Label>
      <Input id="customer" defaultValue="Northwind Traders" />
    </div>
  )
}

export function LabelCheckboxDemo() {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id="reminders" defaultChecked />
      <Label htmlFor="reminders">Send payment reminders</Label>
    </div>
  )
}

export function LabelDisabledDemo() {
  return (
    <div className="grid w-full max-w-sm gap-2">
      <Label htmlFor="invoice-no" className="opacity-50">
        Invoice number
      </Label>
      <Input id="invoice-no" disabled defaultValue="INV-1042" />
    </div>
  )
}
