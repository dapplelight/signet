"use client"
import { Input } from "@dapplelight/signet-ui/components/input"
import { Label } from "@dapplelight/signet-ui/components/label"

export function InputDemo() {
  return (
    <Input className="max-w-sm" type="email" placeholder="name@company.com" aria-label="Email" />
  )
}

export function InputWithLabelDemo() {
  return (
    <div className="grid w-full max-w-sm gap-2">
      <Label htmlFor="invoice-ref">Reference</Label>
      <Input id="invoice-ref" placeholder="PO-20931" />
    </div>
  )
}

export function InputFileDemo() {
  return (
    <div className="grid w-full max-w-sm gap-2">
      <Label htmlFor="receipt">Receipt</Label>
      <Input id="receipt" type="file" />
    </div>
  )
}

export function InputDisabledDemo() {
  return <Input className="max-w-sm" disabled defaultValue="INV-1042" aria-label="Invoice number" />
}

export function InputInvalidDemo() {
  return <Input className="max-w-sm" aria-invalid defaultValue="12/31/26" aria-label="Due date" />
}
