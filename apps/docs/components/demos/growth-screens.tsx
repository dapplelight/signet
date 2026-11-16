"use client"
import {
  type ChangelogEntry,
  FeedbackForm,
  FeedbackWidget,
  InviteAccept,
  OnboardingChecklist,
  ReferralCard,
  WaitlistJoin,
  WhatsNew,
} from "@dapplelight/signet-ui/screens/growth-screens"
import { useState } from "react"

export function WaitlistJoinDemo() {
  return (
    <WaitlistJoin
      className="w-full max-w-sm"
      onJoin={(email) => ({ email, position: 412, joined: true })}
    />
  )
}

export function InviteAcceptDemo() {
  return (
    <InviteAccept
      className="w-full max-w-sm"
      invite={{
        inviterName: "Asha Rao",
        scopeName: "Northwind Studio",
        role: "editor",
        email: "marcus@example.com",
        expiresAt: "2026-12-01",
      }}
      onAccept={() => ({ ok: true })}
      onDecline={() => undefined}
    />
  )
}

export function InviteAcceptExpiredDemo() {
  return (
    <InviteAccept
      className="w-full max-w-sm"
      invite={{ scopeName: "Northwind Studio" }}
      error="expired"
      onAccept={() => ({ ok: false, reason: "expired" })}
    />
  )
}

export function ReferralCardDemo() {
  return (
    <ReferralCard
      className="w-full max-w-sm"
      code="ASHA20"
      url="https://app.example.com/?ref=ASHA20"
      stats={{ referred: 14, converted: 5, rewarded: 3 }}
    />
  )
}

export function OnboardingChecklistDemo() {
  const [done, setDone] = useState<string[]>(["profile"])
  return (
    <OnboardingChecklist
      className="w-full max-w-sm"
      done={done}
      onDoneChange={setDone}
      onStepSelect={(step) => setDone((d) => (d.includes(step.key) ? d : [...d, step.key]))}
      steps={[
        {
          key: "profile",
          title: "Complete your profile",
          description: "Add a photo and your team name.",
        },
        {
          key: "invite",
          title: "Invite a teammate",
          description: "Work together on the same board.",
        },
        {
          key: "import",
          title: "Import your invoices",
          description: "Upload a CSV from your old tool.",
        },
      ]}
    />
  )
}

export function FeedbackFormDemo() {
  return (
    <FeedbackForm
      className="w-full max-w-sm"
      rating
      onSubmit={() => new Promise((resolve) => setTimeout(resolve, 400))}
    />
  )
}

export function FeedbackWidgetDemo() {
  return <FeedbackWidget rating onSubmit={() => undefined} />
}

const entries: ChangelogEntry[] = [
  {
    id: "1",
    date: "2026-11-12",
    title: "Recurring invoices",
    tag: "New",
    body: "Bill clients every month automatically.",
  },
  {
    id: "2",
    date: "2026-11-03",
    title: "Faster CSV import",
    tag: "Improved",
    body: "Imports of 10k rows now finish in seconds.",
  },
  { id: "3", date: "2026-10-21", title: "Fixed duplicate reminders", tag: "Fix" },
]

export function WhatsNewDemo() {
  const [unseen, setUnseen] = useState(2)
  return <WhatsNew entries={entries} unseen={unseen} onOpen={() => setUnseen(0)} />
}
