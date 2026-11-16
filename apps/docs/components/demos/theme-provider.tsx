"use client"

import { Button } from "@dapplelight/signet-ui/components/button"
import { ThemeProvider, useTheme } from "@dapplelight/signet-ui/components/theme-provider"

function ThemeReadout() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Setting: <b>{theme}</b>, applied: <b>{resolvedTheme}</b>
      </p>
      <div className="flex gap-2">
        {(["light", "dark", "system"] as const).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={theme === t ? "default" : "outline"}
            onClick={() => setTheme(t)}
          >
            {t}
          </Button>
        ))}
      </div>
    </div>
  )
}

function FlipButton() {
  const { resolvedTheme, toggleTheme } = useTheme()
  return (
    <Button variant="outline" onClick={toggleTheme}>
      Switch to {resolvedTheme === "dark" ? "light" : "dark"}
    </Button>
  )
}

export function ThemeProviderDemo() {
  return (
    <ThemeProvider defaultTheme="system">
      <ThemeReadout />
    </ThemeProvider>
  )
}

export function ThemeToggleHookDemo() {
  return (
    <ThemeProvider>
      <FlipButton />
    </ThemeProvider>
  )
}
