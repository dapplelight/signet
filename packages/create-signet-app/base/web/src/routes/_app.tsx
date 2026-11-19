import { Badge } from "@dapplelight/signet-ui/components/badge" // @notifications
import { Button } from "@dapplelight/signet-ui/components/button" // @auth
// dashboard:begin
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@dapplelight/signet-ui/components/sidebar"
// dashboard:end
import { ThemeToggle } from "@dapplelight/signet-ui/components/theme-toggle"
import { OrgSwitcher } from "@dapplelight/signet-ui/screens/org-screens" // @orgs
import { useQuery } from "@tanstack/react-query" // @orgs
// !orgs:begin
import { useQuery } from "@tanstack/react-query" // @notifications
// !orgs:end
import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router" // @orgs
import { createFileRoute, Link, Outlet } from "@tanstack/react-router" // @!orgs
import { InstallButton } from "../components/install-button" // @pwa
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

  const link =
    "rounded-md px-2 py-1 text-muted-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
  const nav = (
    <>
      {NAV.map((n) => (
        <Link key={n.to} to={n.to} className={link}>
          {n.label}
          {/* notifications:begin */}
          {n.to === "/notifications" && unread ? <Badge className="ml-1">{unread}</Badge> : null}
          {/* notifications:end */}
        </Link>
      ))}
      {/* admin:begin */}
      {staff ? (
        <Link to="/admin" className={link}>
          Admin
        </Link>
      ) : null}
      {/* admin:end */}
    </>
  )
  // orgs:begin
  // Every org you belong to; switching reloads into the other one.
  const switcher = (
    <OrgSwitcher
      className="w-48"
      orgs={orgs}
      currentId={current?.org.id ?? null}
      onSwitch={(id) => switchOrg(id)}
      onCreate={() => navigate({ to: "/org/new" })}
    />
  )
  // orgs:end
  const actions = (
    <>
      <InstallButton /> {/* @pwa */}
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
    </>
  )

  // dashboard:begin
  // The nav in a sidebar: a drawer on phones, collapsed with Ctrl+B / Cmd+B.
  return (
    <SidebarProvider>
      <Sidebar collapsible="offcanvas" aria-label="Main">
        <SidebarHeader className="px-4 py-3">
          <Link to="/" className="font-medium">
            __APP_NAME__
          </Link>
          {switcher} {/* @orgs */}
        </SidebarHeader>
        <SidebarContent>
          <nav className="flex flex-col gap-1 p-2 text-sm">{nav}</nav>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <SidebarTrigger />
          <div className="flex flex-1 items-center justify-end gap-2">{actions}</div>
        </header>
        <div className="mx-auto w-full max-w-6xl p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
  // dashboard:end
  // !dashboard:begin
  return (
    <>
      {/* On phones the nav drops to its own row under the name and actions. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-6">
        <Link to="/" className="font-medium">
          __APP_NAME__
        </Link>
        {switcher} {/* @orgs */}
        <nav className="order-last flex w-full items-center gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto sm:flex-1">
          {nav}
        </nav>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <main className="mx-auto max-w-3xl p-6">
        <Outlet />
      </main>
    </>
  )
  // !dashboard:end
}
