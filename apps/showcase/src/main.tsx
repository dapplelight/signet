import { ThemeProvider } from "@dapplelight/signet-ui/components/theme-provider"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app"
import { applyTheme, initialTheme } from "./themes"

const root = document.getElementById("root")
if (!root) throw new Error("Root element #root not found in index.html")

// Load the stylesheet before first render so there is no unstyled flash.
const theme = initialTheme()
await applyTheme(theme)

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App initial={theme} />
    </ThemeProvider>
  </StrictMode>,
)
