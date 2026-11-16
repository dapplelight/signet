"use client"
import {
  type ChannelPrefs,
  type InboxEntry,
  InboxItem,
  NotificationInbox,
  NotificationPreferences,
} from "@dapplelight/signet-ui/screens/notification-screens"
import { useState } from "react"

const initial: InboxEntry[] = [
  {
    id: "n1",
    title: "Invoice INV-2041 was paid",
    body: "Northwind Studio paid $1,250.00.",
    createdAt: Date.now() - 12 * 60_000,
  },
  {
    id: "n2",
    title: "Asha mentioned you",
    body: "Can you confirm the tax line on the Q4 invoice?",
    createdAt: Date.now() - 3 * 3_600_000,
  },
  {
    id: "n3",
    title: "Weekly summary",
    body: "14 invoices sent, 11 paid, $9,430 collected.",
    createdAt: Date.now() - 2 * 86_400_000,
    readAt: "2026-11-15T09:00:00Z",
  },
]

export function NotificationInboxDemo() {
  const [items, setItems] = useState(initial)
  const now = new Date().toISOString()
  return (
    <NotificationInbox
      className="w-full max-w-lg"
      items={items}
      onMarkRead={(ids) =>
        setItems((l) => l.map((i) => (ids.includes(i.id) ? { ...i, readAt: now } : i)))
      }
      onMarkAllRead={() => setItems((l) => l.map((i) => ({ ...i, readAt: i.readAt ?? now })))}
      onArchive={(item) => setItems((l) => l.filter((i) => i.id !== item.id))}
    />
  )
}

export function NotificationInboxEmptyDemo() {
  return <NotificationInbox className="w-full max-w-lg" items={[]} />
}

export function InboxItemDemo() {
  return (
    <div className="w-full max-w-lg">
      <InboxItem item={initial[0]} onOpen={() => undefined} />
      <InboxItem item={initial[2]} onOpen={() => undefined} />
    </div>
  )
}

export function NotificationPreferencesDemo() {
  const [value, setValue] = useState<ChannelPrefs>({ marketing: { email: false } })
  return (
    <NotificationPreferences
      className="w-full max-w-xl"
      value={value}
      onValueChange={setValue}
      channels={["email", "push", "inApp"]}
      categories={[
        {
          id: "billing",
          label: "Billing",
          description: "Receipts and failed payments.",
          required: true,
        },
        { id: "mentions", label: "Mentions", description: "When someone @mentions you." },
        { id: "marketing", label: "Product news", description: "New features and tips." },
      ]}
    />
  )
}
