/**
 * Every theme's tokens as plain JS for React Native (and anything else that
 * cannot read CSS variables): colours as `#rrggbb` or `rgba(r, g, b, a)`
 * strings, lengths as numbers (px at a 16px root).
 *
 *   import { nativeTheme } from "@dapplelight/signet-tokens/native"
 *   const t = nativeTheme("editorial", colorScheme ?? "light")
 *   <View style={{ backgroundColor: t.colors.background, borderRadius: t.radius.md }} />
 *
 * Generated from the theme CSS by `scripts/gen-native.ts`; never edit
 * `native-themes.ts` by hand.
 */

import data from "./native-themes.js"

export type ThemeName = keyof typeof data
export type Mode = "light" | "dark"
/** Contract colour names in camelCase (`--color-card-foreground` -> `cardForeground`). */
export type NativeColors = Record<keyof (typeof data)["editorial"]["light"], string> &
  Record<string, string>
export type NativeTokens = {
  light: NativeColors
  dark: NativeColors
  radius: {
    default: number
    sm: number
    md: number
    lg: number
    xl: number
    "2xl": number
    "4xl": number
    full: number
  }
  /** The density unit: `p-4` is `4 * spacing`. */
  spacing: number
  fontSize: { xs: number; sm: number; base: number; lg: number; xl: number }
}

export const NATIVE_THEMES = data as Record<ThemeName, NativeTokens>
export const THEME_NAMES = Object.keys(data) as ThemeName[]

/** One theme in one mode: `colors` for that mode plus the mode-free scales. */
export function nativeTheme(name: ThemeName, mode: Mode = "light") {
  const t = NATIVE_THEMES[name]
  if (!t) throw new Error(`Unknown theme "${name}". Use ${THEME_NAMES.join(", ")}.`)
  return { colors: t[mode], radius: t.radius, spacing: t.spacing, fontSize: t.fontSize }
}
