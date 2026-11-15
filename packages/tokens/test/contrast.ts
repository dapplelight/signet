/**
 * WCAG contrast for every theme, light and dark. Text pairs need 4.5:1 (AA),
 * focus rings 3:1 (1.4.11). Input borders only need to be visible here (1.3:1):
 * 3:1 borders would change every form, a design decision, not a fix.
 */
import { readFileSync } from "node:fs"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? pass++ : (fail++, console.log("  FAIL", n, d))
}

type Vars = Record<string, string>

/** Custom properties of the first block whose selector matches. */
export function block(css: string, selector: RegExp): Vars {
  const m = selector.exec(css)
  if (!m) return {}
  let depth = 0
  let i = css.indexOf("{", m.index)
  const start = i + 1
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++
    else if (css[i] === "}" && --depth === 0) break
  }
  const vars: Vars = {}
  for (const d of css.slice(start, i).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    vars[d[1]] = d[2].trim()
  return vars
}

export function resolve(vars: Vars, value: string, seen = 0): string {
  const m = /^var\((--[\w-]+)\)$/.exec(value)
  if (!m || seen > 10) return value
  return resolve(vars, vars[m[1]] ?? "", seen + 1)
}

function rgb(hex: string): [number, number, number] | null {
  const h = /^#([0-9a-f]{6})$/i.exec(hex)?.[1]
  return h
    ? ([0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number])
    : null
}

const lum = ([r, g, b]: [number, number, number]) => {
  const c = [r, g, b].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

export function ratio(a: string, b: string): number | null {
  const x = rgb(a)
  const y = rgb(b)
  if (!x || !y) return null
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT = 4.5
export const PAIRS: [fg: string, bg: string, min: number][] = [
  ["--text-primary", "--bg-base", TEXT],
  ["--text-secondary", "--bg-base", TEXT],
  ["--text-muted", "--bg-base", TEXT],
  ["--text-muted", "--bg-surface", TEXT],
  ["--text-hint", "--bg-base", TEXT],
  ["--primary-fg", "--primary", TEXT],
  ["--muted-fg", "--muted", TEXT],
  ["--accent-fg", "--accent", TEXT],
  ["--accent-green", "--bg-base", TEXT],
  // Green text sits on cards (stat-strip, trend-chip, amount's credit tone).
  ["--accent-green", "--bg-surface", TEXT],
  ["--accent-green", "--card", TEXT],
  ["--accent-amber", "--bg-base", TEXT],
  ["--accent-red", "--bg-base", TEXT],
  ["--accent-blue", "--bg-base", TEXT],
  ["--ring", "--bg-base", 3],
  ["--input", "--bg-base", 1.3],
]

/** `fg` at `alpha` over `bg`: what a Tailwind `/NN` opacity modifier paints. */
export function over(fg: string, bg: string, alpha: number): string {
  const a = rgb(fg)
  const b = rgb(bg)
  if (!a || !b) return fg
  return `#${a
    .map((v, i) =>
      Math.round(v * alpha + (b[i] as number) * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

// Text that components paint with an opacity modifier. The alphas are read
// from the component source, so a class change is checked as well as a token.
const ui = (f: string) =>
  readFileSync(new URL(`../../ui/src/components/ui/${f}`, import.meta.url), "utf8")
const alphaOf = (src: string, re: RegExp, name: string): number => {
  const m = re.exec(src)
  if (!m) throw new Error(`contrast: ${name} no longer matches ${re}`)
  return Number(m[1]) / 100
}
type Tinted = {
  name: string
  light: number
  dark: number
  text: string
  /** Each alpha applies to the text (tint false) or to a tint of the text colour behind it (tint true). */
  tint: boolean
  on: string[]
}
// Called from check() only: signet-mcp copies this file and must not read ui/.
const tinted = (): Tinted[] => [
  {
    name: "inactive TabsTrigger",
    light: alphaOf(ui("tabs.tsx"), /\stext-text-primary\/(\d+)\s/, "tabs"),
    dark: alphaOf(ui("tabs.tsx"), /\sdark:text-text-primary\/(\d+)\s/, "tabs"),
    text: "--text-primary",
    tint: false,
    on: ["--bg-elevated"],
  },
  ...(["badge.tsx", "button.tsx", "alert.tsx"] as const).map((f) => ({
    name: `destructive ${f.replace(".tsx", "")}`,
    light: alphaOf(ui(f), /\bbg-accent-red\/(\d+) text-accent-red/, f),
    dark: /dark:bg-accent-red\/(\d+)/.test(ui(f))
      ? alphaOf(ui(f), /\bdark:bg-accent-red\/(\d+)/, f)
      : alphaOf(ui(f), /\bbg-accent-red\/(\d+) text-accent-red/, f),
    text: "--accent-red",
    tint: true,
    on: ["--bg-base", "--bg-surface"],
  })),
]

const dir = new URL("../src/themes/", import.meta.url)
if (import.meta.main) check()

function check() {
  const TINTED = tinted()
  for (const [file, darkSel] of [
    ["editorial.css", /\.dark,\s*\[data-theme="ui"\]\s*\{/],
    ["cinematic.css", /\[data-theme="cinematic"\]\s*\{/],
  ] as const) {
    const css = readFileSync(new URL(file, dir), "utf8")
    const light = block(css, /:root\s*\{/)
    const modes: [string, Vars][] = [
      ["light", light],
      ["dark", { ...light, ...block(css, darkSel) }],
    ]
    for (const [mode, vars] of modes) {
      for (const [fg, bg, min] of PAIRS) {
        const a = resolve(vars, vars[fg] ?? "")
        const b = resolve(vars, vars[bg] ?? "")
        const r = ratio(a, b)
        if (r === null) continue // not a plain hex (rgba, color-mix): checked by eye
        ok(`${file} ${mode} ${fg} on ${bg} >= ${min}`, r >= min, `${a} on ${b} = ${r.toFixed(2)}`)
      }
      for (const t of TINTED) {
        const alpha = mode === "light" ? t.light : t.dark
        const text = resolve(vars, vars[t.text] ?? "")
        for (const on of t.on) {
          const base = resolve(vars, vars[on] ?? "")
          const [fgc, bgc] = t.tint
            ? [text, over(text, base, alpha)]
            : [over(text, base, alpha), base]
          const r = ratio(fgc, bgc)
          if (r === null) continue
          ok(
            `${file} ${mode} ${t.name} on ${on} >= ${TEXT}`,
            r >= TEXT,
            `${fgc} on ${bgc} = ${r.toFixed(2)}`,
          )
        }
      }
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}
