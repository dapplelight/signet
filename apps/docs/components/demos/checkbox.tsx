"use client"
import { Checkbox } from "@dapplelight/signet-ui/components/checkbox"
import * as React from "react"

export function CheckboxDemo() {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id="terms" />
      <label htmlFor="terms" className="text-sm">
        Accept terms and conditions
      </label>
    </div>
  )
}

export function CheckboxCheckedDemo() {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id="receipts" defaultChecked />
      <label htmlFor="receipts" className="text-sm">
        Email me receipts
      </label>
    </div>
  )
}

export function CheckboxDisabledDemo() {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id="sso" disabled />
      <label htmlFor="sso" className="text-sm opacity-50">
        Enforce SSO (Enterprise plan)
      </label>
    </div>
  )
}

export function CheckboxControlledDemo() {
  const [selected, setSelected] = React.useState<string[]>(["INV-2041"])
  const invoices = ["INV-2039", "INV-2040", "INV-2041"]
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)))
  return (
    <div className="flex flex-col gap-2">
      {invoices.map((id) => (
        <div key={id} className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={selected.includes(id)}
            onCheckedChange={(v) => toggle(id, v === true)}
          />
          <label htmlFor={id} className="text-sm">
            {id}
          </label>
        </div>
      ))}
      <p className="text-xs text-text-muted">{selected.length} selected</p>
    </div>
  )
}
