// Demo page for the org screens (switcher, members, invite, accept invite,
// settings) on fake data. Open screens-orgs.html in `bun run dev`;
// ?theme=cinematic, ?dark=1 and ?screen=switcher|members|accept|settings
// pick what to show.
import {
  AcceptInvitePage,
  InviteDialog,
  MembersList,
  type OrgInvitation,
  type OrgMember,
  OrgSettings,
  OrgSwitcher,
} from "@dapplelight/signet-ui/screens/org-screens"
import { type ReactNode, StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { applyTheme, initialTheme } from "./themes"

const params = new URLSearchParams(location.search)
if (params.has("dark"))
  document.documentElement.classList.toggle("dark", params.get("dark") === "1")
await applyTheme(initialTheme())

const wait = (ms = 500) => new Promise((r) => setTimeout(r, ms))

const ORGS = [
  { org: { id: "a", name: "Acme Labs", slug: "acme", brandColor: "#12833c" }, role: "owner" },
  { org: { id: "b", name: "Bolt Studio", slug: "bolt", brandColor: "#5b4bdb" }, role: "admin" },
  { org: { id: "p", name: "Personal", slug: "personal" }, role: "owner" },
]

function Switcher() {
  const [current, setCurrent] = useState("a")
  return (
    <div className="w-64 rounded-xl bg-bg-surface p-2 ring-1 ring-border-default">
      <OrgSwitcher
        orgs={ORGS}
        currentId={current}
        onSwitch={async (id) => {
          await wait(200)
          setCurrent(id)
        }}
        onCreate={() => {}}
      />
    </div>
  )
}

function Members() {
  const [members, setMembers] = useState<OrgMember[]>([
    { userId: "u1", role: "owner", user: { name: "Asha Rao", email: "asha@example.com" } },
    { userId: "u2", role: "admin", user: { name: "Dev Patel", email: "dev@example.com" } },
    { userId: "u3", role: "member", user: { name: "Meera Iyer", email: "meera@example.com" } },
  ])
  const [invites, setInvites] = useState<OrgInvitation[]>([
    { id: "i1", email: "zed@example.com", role: "member", expiresAt: "2026-12-01" },
  ])
  const [open, setOpen] = useState(false)
  return (
    <div className="w-full max-w-xl">
      <MembersList
        members={members}
        roles={["owner", "admin", "member"]}
        currentUserId="u1"
        canManage
        onRoleChange={async (m, role) => {
          await wait()
          setMembers((all) => all.map((x) => (x.userId === m.userId ? { ...x, role } : x)))
        }}
        onRemove={async (m) => {
          await wait()
          if (m.userId === "u1") throw new Error("An organisation needs at least one owner.")
          setMembers((all) => all.filter((x) => x.userId !== m.userId))
        }}
        invitations={invites}
        onRevokeInvite={async (i) => {
          await wait()
          setInvites((all) => all.filter((x) => x.id !== i.id))
        }}
        onInvite={() => setOpen(true)}
      />
      <InviteDialog
        open={open}
        onOpenChange={setOpen}
        roles={["member", "admin"]}
        onInvite={async ({ email, role }) => {
          await wait()
          setInvites((all) => [
            ...all,
            { id: `i${all.length + 2}`, email: email ?? null, role, expiresAt: "2026-12-08" },
          ])
          return { link: "https://app.example.com/invite/0f3c9a7e" }
        }}
      />
    </div>
  )
}

const SCREENS: Record<string, () => ReactNode> = {
  switcher: () => <Switcher />,
  members: () => <Members />,
  accept: () => (
    <AcceptInvitePage
      className="min-h-0 w-full rounded-xl py-10"
      org={ORGS[0]?.org}
      invite={{ inviterName: "Asha Rao", role: "member", expiresAt: "2026-12-01" }}
      onAccept={async () => {
        await wait()
        return { ok: true }
      }}
      onDecline={() => {}}
    />
  ),
  settings: () => (
    <OrgSettings
      className="w-full max-w-xl"
      org={{
        name: "Acme Labs",
        theme: "editorial",
        brandColor: "#12833c",
      }}
      onSave={async () => {
        await wait()
      }}
    />
  ),
}

function Page() {
  const only = params.get("screen")
  const names = only && SCREENS[only] ? [only] : Object.keys(SCREENS)
  return (
    <main className="flex min-h-dvh flex-col items-center gap-10 bg-background p-8 text-foreground">
      <h1 className="sr-only">Signet screens: organisations</h1>
      <a href="./" className="self-start text-sm text-text-secondary underline">
        Showcase
      </a>
      {names.map((n) => (
        <div key={n} data-screen={n} className="flex w-full justify-center">
          {SCREENS[n]?.()}
        </div>
      ))}
    </main>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element #root not found")
createRoot(root).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
