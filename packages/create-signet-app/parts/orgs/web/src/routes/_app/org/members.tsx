import { InviteDialog, MembersList } from "@dapplelight/signet-ui/screens/org-screens"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { api, currentOrgQuery, meQuery } from "../../../lib/api"

export const Route = createFileRoute("/_app/org/members")({
  component: Members,
})

const can = (perms: string[], p: string) =>
  perms.includes("*") || perms.includes(p) || perms.includes(`${p.split(":")[0]}:*`)

// Members, their roles and pending invites of the current org. The API
// guards each call (members:read, members:manage, members:invite) and refuses
// a role with more permissions than your own; the page only hides what you
// cannot do.
function Members() {
  const qc = useQueryClient()
  const me = useQuery(meQuery).data
  const current = useQuery(currentOrgQuery).data
  const perms = current?.permissions ?? []
  const members = useQuery({
    queryKey: ["orgs", "members"],
    queryFn: async () => (await api.orgs.current.members.$get()).json(),
    enabled: can(perms, "members:read"),
  }).data
  const invites = useQuery({
    queryKey: ["orgs", "invites"],
    queryFn: async () => (await api.orgs.current.invites.$get()).json(),
    enabled: can(perms, "members:invite"),
  }).data
  const [inviting, setInviting] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ["orgs"] })
  if (!current) return null
  const roles = Object.keys(current.roles)
  return (
    <div className="space-y-4">
      <nav className="flex gap-3 text-sm">
        <Link to="/org" className="text-muted-foreground underline">
          Settings
        </Link>
        <span className="font-medium">Members and invites</span>
      </nav>
      <MembersList
        members={members?.members ?? []}
        roles={roles}
        currentUserId={me?.user.id}
        canManage={can(perms, "members:manage")}
        invitations={invites?.invitations ?? []}
        onInvite={can(perms, "members:invite") ? () => setInviting(true) : undefined}
        onRoleChange={async (m, role) => {
          // orgRoutes validates its own bodies, so the client types only the param.
          await api.orgs.current.members[":userId"].$patch({
            param: { userId: m.userId },
            json: { role },
          } as never)
          await refresh()
        }}
        onRemove={async (m) => {
          await api.orgs.current.members[":userId"].$delete({ param: { userId: m.userId } })
          if (m.userId === me?.user.id) window.location.assign("/")
          else await refresh()
        }}
        onRevokeInvite={async (i) => {
          await api.orgs.current.invites[":id"].$delete({ param: { id: i.id } })
          await refresh()
        }}
      />
      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        roles={roles.filter((r) => r !== "owner")}
        defaultRole="member"
        // Sign-in is by phone, so there is no verified email to bind an invite
        // to: invites are links. Send them yourself, or wire orgRoutes' onInvite.
        askEmail={false}
        onInvite={async ({ role }) => {
          const { token } = await (await api.orgs.current.invites.$post({ json: { role } })).json()
          await refresh()
          return { link: `${window.location.origin}/invite/${token}` }
        }}
      />
    </div>
  )
}
