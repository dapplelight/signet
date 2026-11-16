import { ThemeProvider } from "@dapplelight/signet-ui/components/theme-provider"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./app.css"

const rootElement = document.getElementById("root")
if (!rootElement) throw new Error("Root element #root not found in index.html")

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
