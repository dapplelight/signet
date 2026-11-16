/**
 * Theme colours as ANSI escapes for CLIs: truecolor (24-bit) or the nearest
 * xterm 256-colour index. Translucent tokens (`rgba`) are flattened onto the
 * mode's `background`, since a terminal has no alpha.
 *
 *   import { ansi } from "@dapplelight/signet-tokens/ansi"
 *   const c = ansi("editorial", { mode: "dark", depth: process.env.COLORTERM ? "truecolor" : "256" })
 *   console.log(c.fg.primary("ok"), c.fg.textMuted("3 files"))
 *
 * Choosing the depth (and honouring NO_COLOR) is the CLI's call; this module
 * reads no environment.
 */

import { type Mode, NATIVE_THEMES, type ThemeName } from "./native.js"
import { over } from "./theme.js"

export const RESET = "\x1b[0m"
export type Depth = "truecolor" | "256"

const STEPS = [0, 95, 135, 175, 215, 255]

const rgbOf = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))

/** Nearest xterm 256-colour index (6×6×6 cube or the grey ramp) to a `#rrggbb`. */
export function nearest256(hex: string): number {
  const [r, g, b] = rgbOf(hex) as [number, number, number]
  const dist = ([x, y, z]: [number, number, number]) => (x - r) ** 2 + (y - g) ** 2 + (z - b) ** 2
  const step = (v: number) =>
    STEPS.reduce(
      (best, s, i) => (Math.abs(s - v) < Math.abs((STEPS[best] as number) - v) ? i : best),
      0,
    )
  const [ri, gi, bi] = [step(r), step(g), step(b)]
  const cube = [ri, gi, bi].map((i) => STEPS[i] as number) as [number, number, number]
  const grey = Math.min(23, Math.max(0, Math.round(((r + g + b) / 3 - 8) / 10)))
  const g8 = 8 + grey * 10
  return dist(cube) <= dist([g8, g8, g8]) ? 16 + 36 * ri + 6 * gi + bi : 232 + grey
}

/** `rgba(r, g, b, a)` over `bg`, or the hex itself. */
function opaque(value: string, bg: string): string {
  const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(value)
  if (!m) return value
  const hex = `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`
  return over(hex, bg, Number(m[4]))
}

/** The SGR escape that sets a colour, for the foreground or the background. */
export function ansiCode(hex: string, layer: "fg" | "bg", depth: Depth = "truecolor"): string {
  const base = layer === "fg" ? 38 : 48
  if (depth === "256") return `\x1b[${base};5;${nearest256(hex)}m`
  return `\x1b[${base};2;${rgbOf(hex).join(";")}m`
}

export type AnsiTheme = {
  /** Opaque `#rrggbb` per token, after flattening. */
  hex: Record<string, string>
  /** `fg.primary("text")`: the text in that colour, then a reset. */
  fg: Record<string, (text: string) => string>
  bg: Record<string, (text: string) => string>
}

export function ansi(name: ThemeName, opts: { mode?: Mode; depth?: Depth } = {}): AnsiTheme {
  const theme = NATIVE_THEMES[name]
  if (!theme) throw new Error(`Unknown theme "${name}".`)
  const colors = theme[opts.mode ?? "dark"]
  const depth = opts.depth ?? "truecolor"
  const hex = Object.fromEntries(
    Object.entries(colors).map(([k, v]) => [k, opaque(v, colors.background)]),
  )
  const paint = (layer: "fg" | "bg") =>
    Object.fromEntries(
      Object.entries(hex).map(([k, h]) => {
        const code = ansiCode(h, layer, depth)
        return [k, (text: string) => `${code}${text}${RESET}`]
      }),
    )
  return { hex, fg: paint("fg"), bg: paint("bg") }
}
