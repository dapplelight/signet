/**
 * Generates `src/native-themes.ts` from the theme CSS, so `./native` and
 * `./ansi` never drift from the stylesheets. `bun run gen:native` rewrites it;
 * `test/native.ts` fails when the committed file differs from a fresh run.
 *
 * Colours: every `--color-*` that `@theme inline` maps to a runtime variable,
 * resolved through `var()` per mode, as `#rrggbb` or `rgba(r, g, b, a)`.
 * Lengths: rem at a 16px root, as numbers.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs"

const THEMES_DIR = new URL("../src/themes/", import.meta.url).pathname
const OUT = new URL("../src/native-themes.ts", import.meta.url).pathname

type Vars = Record<string, string>
type Blocks = { light: Vars; dark: Vars; theme: Vars }

const decls = (body: string): Vars =>
  Object.fromEntries(
    body
      .split(";")
      .map((d) => /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(d))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1] as string, (m[2] as string).replace(/\s+/g, " ")]),
  )

/** The theme's three variable blocks, following `@import "./x.css"` first. */
function blocks(file: string): Blocks {
  const css = readFileSync(`${THEMES_DIR}${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  const out: Blocks = { light: {}, dark: {}, theme: {} }
  for (const [, dep] of css.matchAll(/@import\s+"\.\/([\w-]+\.css)"/g)) {
    const b = blocks(dep as string)
    Object.assign(out.light, b.light)
    Object.assign(out.dark, b.dark)
    Object.assign(out.theme, b.theme)
  }
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const s = (selector as string).trim()
    const into = s.startsWith("@theme")
      ? out.theme
      : s.includes(":root")
        ? out.light
        : s.includes(".dark")
          ? out.dark
          : null
    if (into) Object.assign(into, decls(body as string))
  }
  return out
}

const hex = (h: string) =>
  `#${(h.length === 4 ? [...h.slice(1)].map((c) => c + c).join("") : h.slice(1)).toLowerCase()}`
const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16))

/** A colour value with every `var()` resolved, in a form React Native accepts. */
function color(value: string, vars: Vars, seen: string[] = []): string {
  const v = value.trim()
  const ref = /^var\((--[\w-]+)\)$/.exec(v)
  if (ref) {
    const name = ref[1] as string
    const next = vars[name]
    if (next === undefined || seen.includes(name))
      throw new Error(`unresolved ${name} (${seen.join(" -> ")})`)
    return color(next, vars, [...seen, name])
  }
  if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(v)) return hex(v)
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v)
  if (rgba) {
    const [r, g, b, a] = rgba.slice(1)
    return a === undefined
      ? hex(`#${[r, g, b].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`)
      : `rgba(${r}, ${g}, ${b}, ${Number(a)})`
  }
  const mix = /^color-mix\(in srgb, (.+) ([\d.]+)%, transparent\)$/.exec(v)
  if (mix) {
    const base = color(mix[1] as string, vars, seen)
    if (!base.startsWith("#")) throw new Error(`color-mix of a translucent colour: ${v}`)
    return `rgba(${rgb(base).join(", ")}, ${Number(mix[2]) / 100})`
  }
  throw new Error(`unsupported colour value: ${v}`)
}

const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())

/** `0.75rem` -> 12, `9999px` -> 9999, `calc(0.25rem * …)` -> 4 (the unit before density). */
function px(value: string | undefined, name: string): number {
  const m = /([\d.]+)(rem|px)/.exec(value ?? "")
  if (!m) throw new Error(`no length for ${name}: ${value}`)
  return Number(m[1]) * (m[2] === "rem" ? 16 : 1)
}

const RADII = ["", "sm", "md", "lg", "xl", "2xl", "4xl", "full"]
const FONT_SIZES = ["xs", "sm", "base", "lg", "xl"]

export function themeNames(): string[] {
  return readdirSync(THEMES_DIR)
    .filter((f) => f.endsWith(".css"))
    .map((f) => f.slice(0, -4))
    .sort()
}

export function nativeThemes() {
  return Object.fromEntries(
    themeNames().map((name) => {
      const b = blocks(`${name}.css`)
      const colors = (vars: Vars) =>
        Object.fromEntries(
          Object.entries(b.theme)
            .filter(([k, v]) => k.startsWith("--color-") && v.startsWith("var("))
            .map(([k, v]) => [camel(k.slice(8)), color(v, vars)]),
        )
      return [
        name,
        {
          light: colors(b.light),
          dark: colors({ ...b.light, ...b.dark }),
          radius: Object.fromEntries(
            RADII.map((r) => {
              const k = r ? `--radius-${r}` : "--radius"
              return [r || "default", px(b.theme[k], k)]
            }),
          ),
          spacing: px(b.theme["--spacing"], "--spacing"),
          fontSize: Object.fromEntries(
            FONT_SIZES.map((s) => [s, px(b.theme[`--text-${s}`], `--text-${s}`)]),
          ),
        },
      ]
    }),
  )
}

/** TypeScript source in Biome's format: bare keys where legal, trailing commas. */
function literal(v: unknown, indent = ""): string {
  if (typeof v !== "object" || v === null) return JSON.stringify(v)
  const inner = `${indent}  `
  const rows = Object.entries(v).map(
    ([k, x]) =>
      `${inner}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${literal(x, inner)},`,
  )
  return `{\n${rows.join("\n")}\n${indent}}`
}

export const render = () =>
  `// Generated by scripts/gen-native.ts from src/themes/*.css. Do not edit: run \`bun run gen:native\`.\n\nexport default ${literal(nativeThemes())}\n`

if (import.meta.main) {
  writeFileSync(OUT, render())
  console.log(`wrote ${OUT}`)
}
