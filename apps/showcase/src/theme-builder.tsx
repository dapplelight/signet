// Theme builder: pick a brand colour, see the components in the theme it
// builds, light and dark, and download it as CSS, W3C Design Tokens or Figma
// Variables. ?brand=e11d48&base=cinematic&density=compact links straight to a theme.
import {
  type Base,
  buildTheme,
  type DensityLevel,
  toCss,
  toDesignTokens,
  toFigmaVariables,
} from "@dapplelight/signet-tokens/theme"
import { Alert, AlertDescription, AlertTitle } from "@dapplelight/signet-ui/components/alert"
import { Badge } from "@dapplelight/signet-ui/components/badge"
import { Button } from "@dapplelight/signet-ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@dapplelight/signet-ui/components/card"
import { Input } from "@dapplelight/signet-ui/components/input"
import { Progress } from "@dapplelight/signet-ui/components/progress"
import { Switch } from "@dapplelight/signet-ui/components/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dapplelight/signet-ui/components/tabs"
import { ThemeProvider } from "@dapplelight/signet-ui/components/theme-provider"
import { ThemeToggle } from "@dapplelight/signet-ui/components/theme-toggle"
import { StrictMode, useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { applyTheme } from "./themes"

const params = new URLSearchParams(location.search)
if (params.has("dark"))
  document.documentElement.classList.toggle("dark", params.get("dark") === "1")
const BASES: Base[] = ["editorial", "cinematic", "finance"]
const LEVELS: DensityLevel[] = ["compact", "comfortable", "spacious"]
const initialBase = (BASES as string[]).includes(params.get("base") ?? "")
  ? (params.get("base") as Base)
  : "editorial"
await applyTheme(initialBase)

const download = (name: string, text: string, type: string) => {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

const selectClass = "h-8 rounded-md border border-input bg-bg-base px-2 text-sm text-text-primary"

function Builder() {
  const [brand, setBrand] = useState(`#${(params.get("brand") ?? "e11d48").replace("#", "")}`)
  const [base, setBase] = useState<Base>(initialBase)
  const [density, setDensity] = useState<DensityLevel>(
    (LEVELS as string[]).includes(params.get("density") ?? "")
      ? (params.get("density") as DensityLevel)
      : "comfortable",
  )
  const [buttonDensity, setButtonDensity] = useState<DensityLevel>("comfortable")
  const valid = /^#[0-9a-f]{6}$/i.test(brand)

  const theme = useMemo(
    () =>
      valid
        ? buildTheme({
            brand,
            base,
            ...(density !== "comfortable" || buttonDensity !== "comfortable"
              ? {
                  density: {
                    ...(density !== "comfortable" ? { all: density } : {}),
                    ...(buttonDensity !== "comfortable" ? { button: buttonDensity } : {}),
                  },
                }
              : {}),
          })
        : null,
    [brand, base, density, buttonDensity, valid],
  )

  useEffect(() => {
    if (!theme) return
    let el = document.getElementById("brand-css")
    if (!el) {
      el = document.createElement("style")
      el.id = "brand-css"
      document.head.append(el)
    }
    el.textContent = toCss(theme, { importBase: false })
  }, [theme])

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-background px-6 py-3">
        <a href="./" className="mr-2 font-medium">
          Signet
        </a>
        <span className="text-text-secondary">Theme builder</span>
        <label className="ml-auto flex items-center gap-2 text-sm">
          Brand
          <input
            type="color"
            aria-label="Brand colour"
            value={valid ? brand : "#000000"}
            onChange={(e) => setBrand(e.target.value)}
            className="size-8 cursor-pointer rounded-md border border-input bg-transparent"
          />
          <Input
            aria-label="Brand hex"
            value={brand}
            onChange={(e) => setBrand(e.target.value.trim())}
            aria-invalid={!valid}
            className="w-24 font-mono"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Base
          <select
            className={selectClass}
            value={base}
            onChange={(e) => {
              const b = e.target.value as Base
              applyTheme(b).then(() => setBase(b))
            }}
          >
            {BASES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Density
          <select
            className={selectClass}
            value={density}
            onChange={(e) => setDensity(e.target.value as DensityLevel)}
          >
            {LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Buttons
          <select
            className={selectClass}
            value={buttonDensity}
            onChange={(e) => setButtonDensity(e.target.value as DensityLevel)}
          >
            {LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <ThemeToggle />
      </header>

      <main data-density={density} className="mx-auto grid max-w-5xl gap-6 p-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Delete</Button>
              <Button variant="link">Link</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>New</Badge>
              <Badge variant="secondary">Draft</Badge>
              <Badge variant="outline">Beta</Badge>
              <Badge variant="destructive">Failed</Badge>
            </div>
            <div className="flex items-center gap-3">
              <Switch defaultChecked aria-label="Notifications" />
              <Input placeholder="you@example.com" />
            </div>
            <Progress value={64} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Text and status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-text-primary">Primary text on the card.</p>
            <p className="text-text-secondary">Secondary text, for supporting lines.</p>
            <p className="text-text-muted">Muted text, for metadata.</p>
            <p className="text-text-hint">Hint text, the quietest that still reads.</p>
            <div className="flex flex-wrap gap-3 text-sm font-medium">
              <span className="text-accent-green">+12% good</span>
              <span className="text-accent-red">-3% bad</span>
              <span className="text-accent-amber">warning</span>
              <span className="text-accent-blue">info</span>
            </div>
            <Alert variant="destructive">
              <AlertTitle>Payment failed</AlertTitle>
              <AlertDescription>The card was declined. Try another one.</AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Charts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-32 items-end gap-2">
              {[70, 45, 90, 60, 35, 80].map((h, i) => (
                <div
                  key={h}
                  className="flex-1 rounded-t-md"
                  style={{ height: `${h}%`, background: `var(--chart-${i + 1})` }}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Export</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Tabs defaultValue="adjust">
              <TabsList>
                <TabsTrigger value="adjust">Adjustments</TabsTrigger>
                <TabsTrigger value="css">CSS</TabsTrigger>
              </TabsList>
              <TabsContent value="adjust" className="text-sm">
                {!theme ? (
                  <p className="text-accent-red">Enter a colour as #rrggbb.</p>
                ) : theme.adjustments.length === 0 ? (
                  <p className="text-text-secondary">None: every token met its floor as built.</p>
                ) : (
                  <ul className="flex flex-col gap-1 font-mono text-xs">
                    {theme.adjustments.map((a) => (
                      <li key={a.mode + a.token} className="flex items-center gap-2">
                        <span className="w-10 text-text-muted">{a.mode}</span>
                        <span className="flex-1">{a.token}</span>
                        <span className="size-3 rounded-sm" style={{ background: a.from }} />
                        {a.from} →{" "}
                        <span className="size-3 rounded-sm" style={{ background: a.to }} />
                        {a.to}
                        <span className="text-text-muted">{a.ratio}:1</span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="css">
                <pre className="max-h-48 overflow-auto rounded-md bg-bg-surface p-3 font-mono text-xs">
                  {theme ? toCss(theme) : ""}
                </pre>
              </TabsContent>
            </Tabs>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!theme}
                onClick={() => theme && download("brand.css", toCss(theme), "text/css")}
              >
                brand.css
              </Button>
              <Button
                variant="outline"
                disabled={!theme}
                onClick={() =>
                  theme &&
                  download(
                    "tokens.json",
                    JSON.stringify(toDesignTokens(theme), null, 2),
                    "application/json",
                  )
                }
              >
                Design Tokens
              </Button>
              <Button
                variant="outline"
                disabled={!theme}
                onClick={() =>
                  theme &&
                  download(
                    "figma-variables.json",
                    JSON.stringify(toFigmaVariables(theme), null, 2),
                    "application/json",
                  )
                }
              >
                Figma Variables
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element #root not found")
createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <Builder />
    </ThemeProvider>
  </StrictMode>,
)
