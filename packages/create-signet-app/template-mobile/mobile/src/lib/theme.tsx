import { nativeTheme, THEME_NAMES, type ThemeName } from "@dapplelight/signet-tokens/native"
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react"
import { useColorScheme } from "react-native"
import { appStorage } from "./storage"

/** Light and dark follow the phone unless the person picks one in Settings. */
export type Appearance = "system" | "light" | "dark"
export const APPEARANCES: Appearance[] = ["system", "light", "dark"]
export const DEFAULT_THEME: ThemeName = "__THEME__"

type Prefs = { theme: ThemeName; appearance: Appearance }
type ThemeValue = ReturnType<typeof nativeTheme> & {
  prefs: Prefs
  dark: boolean
  setPrefs: (next: Partial<Prefs>) => void
}

const KEY = "theme"
const Ctx = createContext<ThemeValue | null>(null)

function parse(raw: string | null): Prefs {
  try {
    const p = JSON.parse(raw ?? "{}") as Partial<Prefs>
    return {
      theme: p.theme && THEME_NAMES.includes(p.theme) ? p.theme : DEFAULT_THEME,
      appearance: p.appearance && APPEARANCES.includes(p.appearance) ? p.appearance : "system",
    }
  } catch {
    return { theme: DEFAULT_THEME, appearance: "system" }
  }
}

/** Every colour, radius and size comes from Signet's tokens for the chosen theme and mode. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme()
  const [prefs, setState] = useState<Prefs>({ theme: DEFAULT_THEME, appearance: "system" })
  useEffect(() => {
    appStorage.get(KEY).then(
      (raw) => setState(parse(raw)),
      () => {},
    )
  }, [])
  const value = useMemo<ThemeValue>(() => {
    const mode = prefs.appearance === "system" ? scheme : prefs.appearance
    return {
      ...nativeTheme(prefs.theme, mode),
      prefs,
      dark: mode === "dark",
      setPrefs: (next) =>
        setState((p) => {
          const merged = { ...p, ...next }
          void appStorage.set(KEY, JSON.stringify(merged))
          return merged
        }),
    }
  }, [prefs, scheme])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeValue {
  const t = useContext(Ctx)
  if (!t) throw new Error("useTheme needs <ThemeProvider> (app/_layout.tsx).")
  return t
}
