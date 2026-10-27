/**
 * Dark mode. Toggles the `.dark` class that every @dapplelight/signet-tokens theme keys off.
 *
 * Four products hand-wrote this (app-e, app-a, app-f, app-j). The
 * parts that are easy to get wrong and are handled here:
 *   - reads localStorage before first paint via a blocking script, so there is
 *     no flash of the wrong theme on load
 *   - follows the OS when set to "system", and keeps following it live
 *   - tolerates localStorage throwing (Safari private mode, blocked cookies)
 *   - keeps `<meta name="theme-color">` (the mobile browser chrome) in step
 *     with the theme, when the page has one — from `--background`, or from
 *     the app's own `themeColor`
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

export type Theme = "light" | "dark" | "system"

type ThemeContextValue = {
  theme: Theme
  /** What is actually applied right now — "system" resolved against the OS. */
  resolvedTheme: "light" | "dark"
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const prefersDark = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches

function read(storageKey: string, fallback: Theme): Theme {
  try {
    const v = localStorage.getItem(storageKey)
    return v === "light" || v === "dark" || v === "system" ? v : fallback
  } catch {
    return fallback
  }
}

/**
 * Set `<meta name="theme-color">` so the mobile browser bar matches the page
 * after a toggle: to `color` when given, otherwise to the theme's
 * `--background`. Does nothing when there is no DOM, no such meta tag, or
 * neither value is set. Exported for tests and for apps that switch themes
 * outside ThemeProvider.
 */
export function syncThemeColorMeta(
  doc: Document | undefined = globalThis.document,
  color?: string,
): void {
  if (!doc) return
  const meta = doc.querySelector('meta[name="theme-color"]')
  if (!meta) return
  const explicit = color?.trim()
  if (explicit) {
    meta.setAttribute("content", explicit)
    return
  }
  const view = doc.defaultView
  if (!view?.getComputedStyle) return
  const bg = view.getComputedStyle(doc.documentElement).getPropertyValue("--background").trim()
  if (bg) meta.setAttribute("content", bg)
}

export type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  /**
   * Update `<meta name="theme-color">` when the theme changes — from
   * `themeColor` if given, else from `--background`. Default true; a no-op
   * when the page has no such tag. `false` leaves the tag alone entirely,
   * `themeColor` included.
   */
  syncThemeColor?: boolean
  /**
   * The value for `<meta name="theme-color">`, instead of `--background`.
   * A string for both modes, or a function of the resolved theme:
   * `themeColor={(t) => (t === "dark" ? "#0b1a14" : "#f7f8f6")}`.
   * An empty result falls back to `--background`.
   */
  themeColor?: string | ((resolved: "light" | "dark") => string)
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "signet-theme",
  syncThemeColor = true,
  themeColor,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => read(storageKey, defaultTheme))
  const [systemDark, setSystemDark] = useState(prefersDark)

  // Keep following the OS while the setting is "system".
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)")
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme

  // Resolved to a string here so an inline arrow does not re-run the effect
  // on every render — only a change in the colour itself does.
  const metaColor = typeof themeColor === "function" ? themeColor(resolvedTheme) : themeColor

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark")
    document.documentElement.style.colorScheme = resolvedTheme
    if (syncThemeColor) syncThemeColorMeta(document, metaColor)
  }, [resolvedTheme, syncThemeColor, metaColor])

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next)
      try {
        localStorage.setItem(storageKey, next)
      } catch {
        // Private mode or blocked storage — the theme still applies for this session.
      }
    },
    [storageKey],
  )

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    }),
    [theme, resolvedTheme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

const noop = () => {}

/**
 * The theme context. Outside a <ThemeProvider> it returns the OS theme with
 * no-op setters instead of throwing, so a shared component (a chart reading
 * `resolvedTheme`) still renders in a tree, story or test that has no provider.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (ctx) return ctx
  return {
    theme: "system",
    resolvedTheme: prefersDark() ? "dark" : "light",
    setTheme: noop,
    toggleTheme: noop,
  }
}

/**
 * Inline this in <head> BEFORE any stylesheet to prevent a flash of the wrong
 * theme. React mounts too late to do it.
 *
 *   <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
 */
export function themeInitScript(storageKey = "signet-theme"): string {
  return `(function(){try{var t=localStorage.getItem(${JSON.stringify(storageKey)});var d=t==="dark"||((!t||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}})()`
}
