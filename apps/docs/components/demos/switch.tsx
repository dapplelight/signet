"use client"

import { Label } from "@dapplelight/signet-ui/components/label"
import { Switch } from "@dapplelight/signet-ui/components/switch"
import { useState } from "react"

export function SwitchDemo() {
  return (
    <div className="flex items-center gap-2">
      <Switch id="email-alerts" />
      <Label htmlFor="email-alerts">Email alerts</Label>
    </div>
  )
}

export function SwitchSizeDemo() {
  return (
    <div className="flex items-center gap-4">
      <Switch size="sm" aria-label="Compact view" />
      <Switch aria-label="Compact view" />
    </div>
  )
}

export function SwitchControlledDemo() {
  const [autoRenew, setAutoRenew] = useState(true)
  return (
    <div className="flex items-center gap-2">
      <Switch id="auto-renew" checked={autoRenew} onCheckedChange={setAutoRenew} />
      <Label htmlFor="auto-renew">Auto-renew subscription: {autoRenew ? "on" : "off"}</Label>
    </div>
  )
}

export function SwitchDisabledDemo() {
  return (
    <div className="flex items-center gap-2">
      <Switch id="sso" disabled defaultChecked />
      <Label htmlFor="sso">Single sign-on (managed by your admin)</Label>
    </div>
  )
}

export function SwitchInvalidDemo() {
  return (
    <div className="flex items-center gap-2">
      <Switch id="terms" aria-invalid />
      <Label htmlFor="terms">Accept the terms</Label>
    </div>
  )
}
