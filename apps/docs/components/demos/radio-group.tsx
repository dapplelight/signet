// biome-ignore-all lint/a11y/noLabelWithoutControl: RadioGroupItem is a form control that biome cannot see
"use client"
import { Label } from "@dapplelight/signet-ui/components/label"
import { RadioGroup, RadioGroupItem } from "@dapplelight/signet-ui/components/radio-group"
import { useState } from "react"

const plans = [
  { value: "starter", label: "Starter", note: "$9 per month" },
  { value: "team", label: "Team", note: "$49 per month" },
  { value: "scale", label: "Scale", note: "$199 per month" },
]

export function RadioGroupDemo() {
  return (
    <RadioGroup defaultValue="team" aria-label="Plan">
      {plans.map((p) => (
        <label key={p.value} className="flex items-center gap-2 text-sm">
          <RadioGroupItem value={p.value} />
          {p.label}
        </label>
      ))}
    </RadioGroup>
  )
}

export function RadioGroupControlledDemo() {
  const [plan, setPlan] = useState("starter")
  return (
    <div className="flex flex-col gap-3">
      <RadioGroup value={plan} onValueChange={(v) => setPlan(v ?? "")} aria-label="Plan">
        {plans.map((p) => (
          <label key={p.value} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={p.value} />
            <span>
              {p.label} <span className="text-text-muted">{p.note}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
      <p className="text-sm text-text-muted">Selected: {plan}</p>
    </div>
  )
}

export function RadioGroupDisabledDemo() {
  return (
    <RadioGroup defaultValue="card" aria-label="Payment method">
      <label className="flex items-center gap-2 text-sm">
        <RadioGroupItem value="card" />
        Card
      </label>
      <label className="flex items-center gap-2 text-sm opacity-50">
        <RadioGroupItem value="wire" disabled />
        Wire transfer
      </label>
    </RadioGroup>
  )
}

export function RadioGroupFormDemo() {
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => e.preventDefault()}>
      <Label id="radio-delivery">Delivery</Label>
      <RadioGroup name="delivery" defaultValue="standard" required aria-labelledby="radio-delivery">
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="standard" />
          Standard (3 to 5 days)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="express" />
          Express (next day)
        </label>
      </RadioGroup>
    </form>
  )
}
