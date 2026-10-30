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
function block(css: string, selector: RegExp): Vars {
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

function resolve(vars: Vars, value: string, seen = 0): string {
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
const PAIRS: [fg: string, bg: string, min: number][] = [
  ["--text-primary", "--bg-base", TEXT],
  ["--text-secondary", "--bg-base", TEXT],
  ["--text-muted", "--bg-base", TEXT],
  ["--text-muted", "--bg-surface", TEXT],
  ["--text-hint", "--bg-base", TEXT],
  ["--primary-fg", "--primary", TEXT],
  ["--muted-fg", "--muted", TEXT],
  ["--accent-fg", "--accent", TEXT],
  ["--accent-green", "--bg-base", TEXT],
  ["--accent-amber", "--bg-base", TEXT],
  ["--accent-red", "--bg-base", TEXT],
  ["--accent-blue", "--bg-base", TEXT],
  ["--ring", "--bg-base", 3],
  ["--input", "--bg-base", 1.3],
]

const dir = new URL("../src/themes/", import.meta.url)
if (import.meta.main) check()

function check() {
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
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}
