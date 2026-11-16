"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import {
  AcceptInvitePage,
  InviteDialog,
  MembersList,
  type OrgInvitation,
  type OrgMember,
  OrgSettings,
  OrgSwitcher,
} from "@dapplelight/signet-ui/screens/org-screens"
import { useState } from "react"

const orgs = [
  { org: { id: "o1", name: "Northwind Studio" }, role: "owner" },
  { org: { id: "o2", name: "Acme Logistics" }, role: "member" },
]

export function OrgSwitcherDemo() {
  const [current, setCurrent] = useState("o1")
  return (
    <OrgSwitcher orgs={orgs} currentId={current} onSwitch={setCurrent} onCreate={() => undefined} />
  )
}

export function MembersListDemo() {
  const [members, setMembers] = useState<OrgMember[]>([
    { userId: "u1", role: "owner", user: { name: "Asha Rao", email: "asha@example.com" } },
    { userId: "u2", role: "admin", user: { name: "Marcus Lee", email: "marcus@example.com" } },
    { userId: "u3", role: "member", user: { name: "Priya Nair", email: "priya@example.com" } },
  ])
  const [invites, setInvites] = useState<OrgInvitation[]>([
    { id: "i1", email: "dev@example.com", role: "member", expiresAt: "2026-12-01" },
  ])
  return (
    <MembersList
      className="w-full max-w-xl"
      members={members}
      roles={["owner", "admin", "member"]}
      currentUserId="u1"
      canManage
      onRoleChange={(m, role) =>
        setMembers((l) => l.map((x) => (x.userId === m.userId ? { ...x, role } : x)))
      }
      onRemove={(m) => setMembers((l) => l.filter((x) => x.userId !== m.userId))}
      invitations={invites}
      onRevokeInvite={(i) => setInvites((l) => l.filter((x) => x.id !== i.id))}
      onInvite={() => undefined}
    />
  )
}

export function InviteDialogDemo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Invite teammate</Button>
      <InviteDialog
        open={open}
        onOpenChange={setOpen}
        roles={["member", "admin"]}
        onInvite={async ({ email }) => ({
          link: `https://app.example.com/invite/${email ? "k7qx92pd" : "m3zt81la"}`,
        })}
      />
    </>
  )
}

export function AcceptInvitePageDemo() {
  return (
    <AcceptInvitePage
      className="min-h-0 w-full"
      org={{ id: "o1", name: "Northwind Studio", brandColor: "#2563eb" }}
      invite={{ inviterName: "Asha Rao", scopeName: "Northwind Studio", role: "member" }}
      onAccept={() => ({ ok: true })}
      onDecline={() => undefined}
    />
  )
}

export function OrgSettingsDemo() {
  return (
    <OrgSettings
      className="w-full max-w-md"
      org={{ name: "Northwind Studio", theme: "finance", brandColor: "#2563eb" }}
      onSave={() => undefined}
    />
  )
}
