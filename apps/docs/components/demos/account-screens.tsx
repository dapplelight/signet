"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import {
  AccountSection,
  AccountSectionHeader,
  ApiKeyReveal,
  type ApiKeyRow,
  ApiKeysManager,
  ProfileCard,
  SessionItem,
  type SessionRow,
  SessionsList,
} from "@dapplelight/signet-ui/screens/account-screens"
import { useState } from "react"

const hoursAgo = (h: number) => Date.now() - h * 3600_000

const initialSessions: SessionRow[] = [
  { id: "s1", device: "Chrome on macOS", ip: "103.21.4.18", lastSeenAt: Date.now(), current: true },
  { id: "s2", device: "Safari on iPhone", ip: "49.36.12.7", lastSeenAt: hoursAgo(3) },
  { id: "s3", device: "Firefox on Windows", ip: "122.172.9.40", lastSeenAt: hoursAgo(72) },
]

const initialKeys: ApiKeyRow[] = [
  {
    id: "k1",
    name: "CI deploy",
    start: "app_1a2b3c",
    createdAt: hoursAgo(24 * 30),
    lastUsedAt: hoursAgo(2),
  },
  {
    id: "k2",
    name: "Analytics export",
    start: "app_9f8e7d",
    createdAt: hoursAgo(24 * 90),
    lastUsedAt: null,
  },
]

export function ProfileCardDemo() {
  const [name, setName] = useState("Asha Verma")
  return (
    <div className="w-full max-w-md">
      <ProfileCard
        profile={{ name, email: "asha@acme.example", phone: "+91 98765 43210" }}
        onSave={async (patch) => setName(patch.name)}
        action={
          <Button variant="outline" size="sm">
            Change photo
          </Button>
        }
      />
    </div>
  )
}

export function SessionsListDemo() {
  const [sessions, setSessions] = useState(initialSessions)
  return (
    <div className="w-full max-w-md">
      <SessionsList
        sessions={sessions}
        onRevoke={(s) => setSessions((list) => list.filter((x) => x.id !== s.id))}
        onRevokeOthers={() => setSessions((list) => list.filter((x) => x.current))}
      />
    </div>
  )
}

export function SessionItemDemo() {
  return (
    <ul className="w-full max-w-md list-none p-0">
      <SessionItem session={initialSessions[1] as SessionRow} onRevoke={() => undefined} />
    </ul>
  )
}

export function ApiKeysManagerDemo() {
  const [keys, setKeys] = useState(initialKeys)
  return (
    <div className="w-full max-w-md">
      <ApiKeysManager
        keys={keys}
        onCreate={({ name }) => {
          const token = `app_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 18)}`
          setKeys((list) => [
            ...list,
            { id: token, name, start: token.slice(0, 10), createdAt: Date.now(), lastUsedAt: null },
          ])
          return { token }
        }}
        onRevoke={(key) => setKeys((list) => list.filter((k) => k.id !== key.id))}
      />
    </div>
  )
}

export function ApiKeyRevealDemo() {
  return (
    <div className="w-full max-w-md">
      <ApiKeyReveal token="app_1a2b3c4d5e6f7g8h9i0jklmnopqrstuv" />
    </div>
  )
}

export function AccountSectionDemo() {
  return (
    <div className="w-full max-w-md">
      <AccountSection>
        <AccountSectionHeader
          title="Notifications"
          action={
            <Button size="sm" variant="outline">
              Edit
            </Button>
          }
        />
        <p className="text-neutral-500">
          Weekly digest and billing emails go to asha@acme.example.
        </p>
      </AccountSection>
    </div>
  )
}
