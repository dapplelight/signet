import { Badge } from "@dapplelight/signet-ui/components/badge"
import { Button } from "@dapplelight/signet-ui/components/button"
import { ThemeToggle } from "@dapplelight/signet-ui/components/theme-toggle"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { api, meQuery } from "../lib/api"

// The signed-in shell. Every page under routes/_app/ renders inside it; a
// 401 from any of their queries sends the browser to /login (main.tsx).
export const Route = createFileRoute("/_app")({
  component: AppLayout,
})

const NAV = [
  { to: "/", label: "Home" },
  { to: "/notifications", label: "Inbox" },
  { to: "/billing", label: "Billing" },
  { to: "/account", label: "Account" },
  { to: "/privacy", label: "Privacy" },
] as const

function AppLayout() {
  const me = useQuery(meQuery)
  const unread = useQuery({
    queryKey: ["notifications", "count"],
    queryFn: async () => (await api.notifications.$get({ query: {} })).json(),
  }).data?.unreadCount
  const staff = me.data && me.data.user.role !== "user"

  return (
    <>
      <header className="flex flex-wrap items-center gap-4 border-b border-border px-6 py-3">
        <Link to="/" className="font-medium">
          __APP_NAME__
        </Link>
        <nav className="flex flex-1 flex-wrap items-center gap-1 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="rounded-md px-2 py-1 text-muted-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
            >
              {n.label}
              {n.to === "/notifications" && unread ? (
                <Badge className="ml-1">{unread}</Badge>
              ) : null}
            </Link>
          ))}
          {staff ? (
            <Link
              to="/admin"
              className="rounded-md px-2 py-1 text-muted-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
            >
              Admin
            </Link>
          ) : null}
        </nav>
        <ThemeToggle />
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
      </header>
      <main className="mx-auto max-w-3xl p-6">
        <Outlet />
      </main>
    </>
  )
}
