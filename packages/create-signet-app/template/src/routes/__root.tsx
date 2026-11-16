import { SkipLink } from "@dapplelight/signet-ui/components/skip-link"
import { ThemeToggle } from "@dapplelight/signet-ui/components/theme-toggle"
import { createRootRoute, Link, Outlet } from "@tanstack/react-router"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <SkipLink />
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <Link to="/" className="font-medium">
          __APP_NAME__
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl p-6 outline-none">
        <Outlet />
      </main>
    </div>
  )
}
