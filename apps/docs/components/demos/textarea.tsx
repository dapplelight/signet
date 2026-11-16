"use client"

import { Label } from "@dapplelight/signet-ui/components/label"
import { Textarea } from "@dapplelight/signet-ui/components/textarea"
import { useState } from "react"

export function TextareaDemo() {
  return <Textarea placeholder="Add a note for the customer" className="max-w-sm" />
}

export function TextareaLabelDemo() {
  return (
    <div className="grid w-full max-w-sm gap-2">
      <Label htmlFor="note">Order note</Label>
      <Textarea id="note" placeholder="Leave at the front door" />
    </div>
  )
}

export function TextareaDisabledDemo() {
  return <Textarea disabled defaultValue="This ticket is closed." className="max-w-sm" />
}

export function TextareaInvalidDemo() {
  return (
    <div className="grid w-full max-w-sm gap-2">
      <Label htmlFor="reason">Refund reason</Label>
      <Textarea id="reason" aria-invalid defaultValue="n/a" />
      <p className="text-sm text-destructive">Give at least 20 characters.</p>
    </div>
  )
}

export function TextareaCounterDemo() {
  const [bio, setBio] = useState("")
  return (
    <div className="grid w-full max-w-sm gap-2">
      <Label htmlFor="bio">Bio</Label>
      <Textarea id="bio" value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} />
      <p className="text-right text-xs text-text-muted">{bio.length}/160</p>
    </div>
  )
}
