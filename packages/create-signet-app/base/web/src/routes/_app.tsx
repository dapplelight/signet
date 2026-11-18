import { Badge } from "@dapplelight/signet-ui/components/badge" // @notifications
import { Button } from "@dapplelight/signet-ui/components/button" // @auth
import { ThemeToggle } from "@dapplelight/signet-ui/components/theme-toggle"
import { OrgSwitcher } from "@dapplelight/signet-ui/screens/org-screens" // @orgs
import { useQuery } from "@tanstack/react-query" // @orgs
// !orgs:begin
import { useQuery } from "@tanstack/react-query" // @notifications
// !orgs:end
import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router" // @orgs
import { createFileRoute, Link, Outlet } from "@tanstack/react-router" // @!orgs
// auth:begin
import { api, currentOrgQuery, meQuery, orgsQuery, switchOrg } from "../lib/api" // @admin
// !admin:begin
import { api, currentOrgQuery, orgsQuery, switchOrg } from "../lib/api" // @orgs
import { api } from "../lib/api" // @!orgs
// !admin:end
// auth:end

// The signed-in shell. Every page under routes/_app/ renders inside it; a // @auth
// 401 from any of their queries sends the browser to /login (main.tsx). // @auth
// The app's shell. Every page under routes/_app/ renders inside it. // @!auth
export const Route = createFileRoute("/_app")({
  component: AppLayout,
})

const NAV = [
  { to: "/", label: "Home" }, // your product
  { to: "/notifications", label: "Inbox" }, // @notifications
  { to: "/billing", label: "Billing" }, // @payments
  { to: "/account", label: "Account" }, // @account
  { to: "/privacy", label: "Privacy" }, // @privacy
  { to: "/approvals", label: "Approvals" }, // @workflows
  { to: "/org", label: "Org" }, // @orgs
] as const

function AppLayout() {
  const me = useQuery(meQuery) // @admin
  // notifications:begin
  const unread = useQuery({
    queryKey: ["notifications", "count"],
    queryFn: async () => (await api.notifications.$get({ query: {} })).json(),
  }).data?.unreadCount
  // notifications:end
  const staff = me.data && me.data.user.role !== "user" // @admin
  // orgs:begin
  const navigate = useNavigate()
  const orgs = useQuery(orgsQuery).data?.orgs ?? []
  const current = useQuery({ ...currentOrgQuery, retry: false }).data
  // orgs:end

  return (
    <>
      <header className="flex flex-wrap items-center gap-4 border-b border-border px-6 py-3">
        <Link to="/" className="font-medium">
          __APP_NAME__
        </Link>
        {/* orgs:begin */}
        {/* Every org you belong to; switching reloads into the other one. */}
        <OrgSwitcher
          className="w-48"
          orgs={orgs}
          currentId={current?.org.id ?? null}
          onSwitch={(id) => switchOrg(id)}
          onCreate={() => navigate({ to: "/org/new" })}
        />
        {/* orgs:end */}
        <nav className="flex flex-1 flex-wrap items-center gap-1 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="rounded-md px-2 py-1 text-muted-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
            >
              {n.label}
              {/* notifications:begin */}
              {n.to === "/notifications" && unread ? (
                <Badge className="ml-1">{unread}</Badge>
              ) : null}
              {/* notifications:end */}
            </Link>
          ))}
          {/* admin:begin */}
          {staff ? (
            <Link
              to="/admin"
              className="rounded-md px-2 py-1 text-muted-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
            >
              Admin
            </Link>
          ) : null}
          {/* admin:end */}
        </nav>
        <ThemeToggle />
        {/* auth:begin */}
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await api.auth["sign-out"].$post()
            window.location.assign("/login")
          }}
        >
          Sign out
        </Button>
        {/* auth:end */}
      </header>
      <main className="mx-auto max-w-3xl p-6">
        <Outlet />
      </main>
    </>
  )
}
