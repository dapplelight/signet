"use client"
import {
  AvatarStack,
  EditingBadge,
  type PresenceMemberView,
  RecordChangedBanner,
  TypingIndicator,
} from "@dapplelight/signet-ui/screens/realtime-screens"
import { useState } from "react"

const members: PresenceMemberView[] = [
  { userId: "u1", name: "Asha Rao" },
  { userId: "u2", name: "Marcus Lee", editing: "amount", typing: true },
  { userId: "u3", name: "Priya Nair" },
  { userId: "u4", name: "Dev Patel" },
  { userId: "u5", name: "Sara Khan" },
  { userId: "u6", name: "Tom Becker" },
]

export function AvatarStackDemo() {
  return <AvatarStack members={members} selfId="u1" max={4} />
}

export function EditingBadgeDemo() {
  return <EditingBadge members={members} selfId="u1" field="amount" fieldLabel="the amount" />
}

export function TypingIndicatorDemo() {
  return <TypingIndicator members={members} selfId="u1" />
}

export function RecordChangedBannerDemo() {
  const [changed, setChanged] = useState(true)
  return (
    <div className="w-full max-w-lg">
      <RecordChangedBanner
        changed={changed}
        by="Marcus Lee"
        onReload={() => setChanged(false)}
        onDismiss={() => setChanged(false)}
      />
    </div>
  )
}
