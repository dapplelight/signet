import { OrgSettings } from "@dapplelight/signet-ui/screens/org-screens"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { api, currentOrgQuery } from "../../../lib/api"

export const Route = createFileRoute("/_app/org/")({
  component: OrgPage,
})

// The current org's settings: name, custom domain, theme, brand colour. The
// API (/api/orgs/current) checks membership and org:update; without it the
// form is read-only. Point a custom domain's DNS at this app and the API
// resolves the org from the host (api/app.ts, tenant()).
function OrgPage() {
  const qc = useQueryClient()
  const current = useQuery(currentOrgQuery).data
  if (!current) return null
  const canEdit = current.permissions.includes("*") || current.permissions.includes("org:update")
  return (
    <div className="space-y-4">
      <nav className="flex gap-3 text-sm">
        <span className="font-medium">Settings</span>
        <Link to="/org/members" className="text-muted-foreground underline">
          Members and invites
        </Link>
      </nav>
      <OrgSettings
        key={current.org.id}
        org={current.org}
        readOnly={!canEdit}
        onSave={async (changes) => {
          await api.orgs.current.$patch({ json: changes })
          await qc.invalidateQueries({ queryKey: ["orgs"] })
        }}
      />
    </div>
  )
}
