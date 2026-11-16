"use client"

import { ThemeProvider } from "@dapplelight/signet-ui/components/theme-provider"
import { ThemeToggle, ThemeToggleButton } from "@dapplelight/signet-ui/components/theme-toggle"

export function ThemeToggleDemo() {
  return (
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  )
}

export function ThemeToggleLabelsDemo() {
  return (
    <ThemeProvider>
      <ThemeToggle showLabels />
    </ThemeProvider>
  )
}

export function ThemeToggleButtonDemo() {
  return (
    <ThemeProvider>
      <ThemeToggleButton />
    </ThemeProvider>
  )
}
