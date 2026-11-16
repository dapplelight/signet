"use client"
import { Kbd, KeySequence } from "@dapplelight/signet-ui/components/kbd"

export function KbdDemo() {
  return <Kbd>⌘K</Kbd>
}

export function KbdSequenceDemo() {
  return (
    <div className="flex flex-col gap-3">
      <KeySequence keys={["⌘", "⇧", "P"]} />
      <KeySequence keys={["G", "I"]} />
    </div>
  )
}

export function KbdInlineDemo() {
  return (
    <p className="text-sm">
      Press <Kbd>/</Kbd> to search invoices, or <KeySequence keys={["Ctrl", "Enter"]} /> to send.
    </p>
  )
}
