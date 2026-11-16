"use client"
import { EmojiPicker } from "@dapplelight/signet-ui/components/emoji-picker"
import { useState } from "react"

export function EmojiPickerDemo() {
  const [icon, setIcon] = useState<string | null>("🎯")
  return <EmojiPicker value={icon} onChange={setIcon} label="Goal icon" />
}

export function EmojiPickerEmptyDemo() {
  const [icon, setIcon] = useState<string | null>(null)
  return <EmojiPicker value={icon} onChange={setIcon} label="Category icon" />
}

export function EmojiPickerCustomDemo() {
  const [icon, setIcon] = useState<string | null>("☕")
  return (
    <EmojiPicker
      value={icon}
      onChange={setIcon}
      label="Expense category"
      emojis={["☕", "🍽️", "🛒", "🚗", "🏠", "💡"]}
    />
  )
}
