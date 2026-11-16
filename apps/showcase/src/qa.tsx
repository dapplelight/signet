// QA gallery: /qa.html?item=<id>&theme=<editorial|cinematic|finance>&mode=<light|dark>
// Renders exactly one registry item (qa-items.ts) with static fixtures, for screenshots.
// No network, a frozen clock, no motion (see qa.html). window.__qaReady flips to true once
// fonts and the item are painted.
import { ThemeProvider } from "@dapplelight/signet-ui/components/theme-provider"
import { type ReactNode, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { screensA } from "./qa-fixtures/screens-a"
import { screensB } from "./qa-fixtures/screens-b"
import { screensC } from "./qa-fixtures/screens-c"
import { QA_NOW } from "./qa-fixtures/shared"
import { uiA } from "./qa-fixtures/ui-a"
import { uiB } from "./qa-fixtures/ui-b"
import { uiC } from "./qa-fixtures/ui-c"
import { uiD } from "./qa-fixtures/ui-d"
import { QA_ITEMS, QA_MODES, type QaId } from "./qa-items"
import { applyTheme, THEMES } from "./themes"

declare global {
  interface Window {
    __qaReady?: boolean
  }
}

// Every id must have a fixture: a registry entry without one is a type error here.
const render: Record<QaId, () => ReactNode> = {
  ...uiA,
  ...uiB,
  ...uiC,
  ...uiD,
  ...screensA,
  ...screensB,
  ...screensC,
}

// `new Date()` and `Date.now()` answer with the fixed clock, so nothing reads as "3 minutes ago" tomorrow.
const RealDate = Date
class FrozenDate extends RealDate {
  constructor(...args: ConstructorParameters<typeof Date>) {
    super(...((args.length ? args : [QA_NOW]) as [number]))
  }
  static override now() {
    return QA_NOW
  }
}
globalThis.Date = FrozenDate

const params = new URLSearchParams(location.search)
const id = params.get("item") ?? ""
const item = QA_ITEMS.find((i) => i.id === id)
const requestedTheme = params.get("theme") ?? ""
const theme = THEMES.includes(requestedTheme) ? requestedTheme : "editorial"
const requestedMode = params.get("mode") ?? ""
const mode = QA_MODES.find((m) => m === requestedMode) ?? "light"

// Same order as applyTheme in packages/test/src/playwright.ts: store the mode first so
// ThemeProvider and ThemeToggle read it back instead of flipping it.
try {
  localStorage.setItem("signet-theme", mode)
} catch {}
document.documentElement.classList.toggle("dark", mode === "dark")
document.documentElement.style.colorScheme = mode
await applyTheme(theme)

const link = (itemId: string) => `?item=${encodeURIComponent(itemId)}&theme=${theme}&mode=${mode}`

function Unknown() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <p>Unknown QA item: {id}</p>
      <ul className="mt-4 space-y-1">
        {QA_ITEMS.map((i) => (
          <li key={i.id}>
            <a className="text-primary underline" href={link(i.id)}>
              {i.id}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Ready() {
  // Effects run after the item mounted: wait for fonts, then two frames so layout has painted.
  useEffect(() => {
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          window.__qaReady = true
        }),
      ),
    )
  }, [])
  return null
}

function App() {
  return (
    <ThemeProvider>
      <main className="min-h-dvh bg-bg-base text-text-primary">
        <h1 className="sr-only">Signet QA: {id}</h1>
        {item ? (
          item.kind === "screen" ? (
            render[item.id]()
          ) : (
            <div className="mx-auto max-w-3xl p-6">{render[item.id]()}</div>
          )
        ) : (
          <Unknown />
        )}
        <Ready />
      </main>
    </ThemeProvider>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element #root not found in qa.html")
createRoot(root).render(<App />)
