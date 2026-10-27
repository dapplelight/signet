import { onAuthErrorRedirect, queryDefaults } from "@dapplelight/signet-lib/api/query-client"
import { ThemeProvider } from "@dapplelight/signet-ui/components/theme-provider"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "./components/toaster"
import { createAppRouter } from "./router"
import "./app.css"

const queryClient = new QueryClient({ defaultOptions: queryDefaults() })
const router = createAppRouter()

// One redirect on session expiry, however many requests fail at once. A full
// page load, not router.navigate: it drops every cached query of the old
// session, and it re-arms this one-shot handler for the next session.
// buildLocation types "/login" against the route tree, so removing the route
// fails typecheck. In production the host must serve index.html for unknown
// paths (SPA fallback) or this reload 404s.
onAuthErrorRedirect(queryClient, () => {
  window.location.assign(router.buildLocation({ to: "/login" }).href)
})

const rootElement = document.getElementById("root")
if (!rootElement) throw new Error("Root element #root not found in index.html")

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
