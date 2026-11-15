/**
 * The theme builder (src/theme.ts): contrast holds for any brand colour, JSON
 * round-trips, and density leaves every shipped theme's look exactly as it was.
 * Contrast is checked with `contrast.ts`'s own formula and pairs, not the
 * builder's, so the two implementations check each other.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { $ } from "bun"
import {
  type Base,
  buildTheme,
  DENSITY,
  DENSITY_SLOTS,
  fromDesignTokens,
  hexToOklch,
  normalizeHex,
  oklchToHex,
  toCss,
  toDesignTokens,
  toFigmaVariables,
} from "../src/theme"
import { block, over, PAIRS, ratio, resolve, tinted } from "./contrast"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? pass++ : (fail++, console.log("  FAIL", n, d))
}

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const BASES: Base[] = ["editorial", "cinematic", "finance"]

// --- colour math -------------------------------------------------------------
ok("#abc expands", normalizeHex("#ABC") === "#aabbcc")
let threw = false
try {
  buildTheme({ brand: "teal" })
} catch {
  threw = true
}
ok("a non-hex brand is refused", threw)
for (const hex of ["#12833c", "#6d28d9", "#ffffff", "#000000", "#e11d48", "#facc15"])
  ok(`${hex} survives OKLCH and back`, oklchToHex(hexToOklch(hex)) === hex)

// --- contrast across random brands -------------------------------------------
// Seeded, so a failure reproduces; the fixed list covers the edges.
let seed = 20261115
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31
  return seed / 2 ** 31
}
const brands = [
  "#ffffff",
  "#000000",
  "#808080",
  "#ffff00",
  "#00ffff",
  "#ff0000",
  "#0000ff",
  "#12833c",
  "#6d28d9",
  ...Array.from(
    { length: 150 },
    () =>
      `#${Math.floor(rand() * 0xffffff)
        .toString(16)
        .padStart(6, "0")}`,
  ),
]
const TINTED = tinted()
const misses: string[] = []
let checks = 0
for (const brand of brands) {
  for (const base of BASES) {
    const t = buildTheme({ brand, base })
    for (const mode of ["light", "dark"] as const) {
      const v = t[mode] ?? {}
      const need = (fg: string, bg: string, min: number, a = v[fg], b = v[bg]) => {
        checks++
        const r = ratio(resolve(v, a ?? ""), resolve(v, b ?? ""))
        if (r === null || r < min) misses.push(`${brand} ${base} ${mode} ${fg} on ${bg}: ${r}`)
      }
      for (const [fg, bg, min] of PAIRS) need(fg, bg, min)
      for (const x of TINTED) {
        const alpha = mode === "light" ? x.light : x.dark
        const text = v[x.text] as string
        for (const on of x.on) {
          const bg = v[on] as string
          const [f, b] = x.tint ? [text, over(text, bg, alpha)] : [over(text, bg, alpha), bg]
          need(`${x.name} (${x.text})`, on, 4.5, f, b)
        }
      }
      // Pairs the shipped themes pass by inspection, guaranteed here.
      for (const bg of ["--bg-surface", "--bg-elevated", "--card", "--popover"])
        for (const fg of ["--text-primary", "--text-secondary", "--text-muted"]) need(fg, bg, 4.5)
      need("--card-fg", "--card", 4.5)
      need("--popover-fg", "--popover", 4.5)
      need("--secondary-fg", "--secondary", 4.5)
      need("--foreground", "--background", 4.5)
      need("--primary", "--bg-base", 4.5) // link buttons paint it as text
      need(
        "--primary",
        "--primary/12",
        4.5,
        v["--primary"],
        over(v["--primary"] as string, v["--bg-base"] as string, 0.12),
      )
      need("--accent-red-fg", "--accent-red", 4.5)
      need("--focus-ring", "--bg-base", 3)
      for (let i = 1; i <= 6; i++) need(`--chart-${i}`, "--bg-base", 3)
      if (base === "finance") need("--money-credit", "--bg-base", 4.5)
    }
  }
}
ok(
  `contrast holds for ${brands.length} brands x ${BASES.length} bases x 2 modes (${checks} pairs)`,
  misses.length === 0,
  misses.slice(0, 5),
)

// --- shape -------------------------------------------------------------------
// Every colour variable a shipped theme sets (not overlay, shadow or --cat-*) is built.
for (const base of ["editorial", "cinematic"] as const) {
  const css = readFileSync(`${ROOT}/packages/tokens/src/themes/${base}.css`, "utf8")
  const want = Object.keys(block(css, /:root\s*\{/)).filter(
    (k) => !/^--(color-|shadow-|bg-overlay|cat-)/.test(k),
  )
  const t = buildTheme({ brand: "#e11d48", base })
  const missing = want.filter((k) => !t.light?.[k] || !t.dark?.[k])
  ok(`${base}: builds every colour variable the theme sets`, missing.length === 0, missing)
}
ok("money slots only on finance", !buildTheme({ brand: "#123456" }).light?.["--money-credit"])
ok(
  "finance has money slots",
  !!buildTheme({ brand: "#123456", base: "finance" }).dark?.["--money-debit"],
)
const lightOnly = buildTheme({ brand: "#123456", mode: "light" })
ok("mode: light builds light only", !!lightOnly.light && !lightOnly.dark)
const yellow = buildTheme({ brand: "#facc15" })
ok(
  "an unreadable brand is moved and reported",
  yellow.adjustments.some((a) => a.token === "--primary" && a.from === "#facc15" && a.ratio >= 4.5),
  yellow.adjustments,
)
ok(
  "a readable brand is kept as --primary",
  buildTheme({ brand: "#6d28d9", base: "cinematic" }).light?.["--primary"] === "#6d28d9",
)

// --- CSS ---------------------------------------------------------------------
for (const base of BASES) {
  const t = buildTheme({ brand: "#0ea5e9", base, density: { all: "compact" } })
  const css = toCss(t)
  ok(
    `${base}: CSS imports its base`,
    css.includes(`@import "@dapplelight/signet-tokens/${base}.css";`),
  )
  const light = block(css, /:root\s*\{/)
  const darkSel =
    base === "cinematic" ? /\[data-theme="cinematic"\]\s*\{/ : /\.dark,\s*\[data-theme="ui"\]\s*\{/
  const dark = block(css, darkSel)
  ok(
    `${base}: CSS carries both modes in the base's own selectors`,
    Object.entries(t.light ?? {}).every(([k, x]) => light[k] === x) &&
      Object.entries(t.dark ?? {}).every(([k, x]) => dark[k] === x),
  )
  ok(`${base}: CSS sets density`, light["--density"] === String(DENSITY.compact))
}

// The built CSS compiles as a theme: Tailwind still maps bg-primary to the
// runtime variable, which the layer now sets.
const TMP = `${ROOT}/.builderbuild`
mkdirSync(TMP, { recursive: true })
const compile = async (name: string, theme: string, classes = "bg-primary text-text-muted h-8") => {
  writeFileSync(
    `${TMP}/${name}.css`,
    `@import "tailwindcss";\n@source "../packages/ui/src";\n@source inline("${classes}");\n${theme}`,
  )
  await $`${ROOT}/node_modules/.bin/tailwindcss -i ${TMP}/${name}.css -o ${TMP}/${name}.out.css`.quiet()
  return readFileSync(`${TMP}/${name}.out.css`, "utf8")
}
{
  const t = buildTheme({ brand: "#0ea5e9", base: "cinematic" })
  const out = await compile(
    "built",
    toCss(t).replace("@dapplelight/signet-tokens/", "../packages/tokens/src/themes/"),
  )
  ok("built CSS compiles", /\.bg-primary \{\s*background-color: var\(--primary\)/.test(out))
  ok("built CSS overrides --primary", out.includes(`--primary: ${t.light?.["--primary"]};`))
}

// --- JSON --------------------------------------------------------------------
for (const base of BASES) {
  const t = buildTheme({ brand: "#c2410c", base, density: { button: "compact", card: "spacious" } })
  const json = JSON.parse(JSON.stringify(toDesignTokens(t)))
  const back = fromDesignTokens(json)
  ok(
    `${base}: DTCG round-trips`,
    back.base === base &&
      back.brand === t.brand &&
      JSON.stringify(back.light) === JSON.stringify(t.light) &&
      JSON.stringify(back.dark) === JSON.stringify(t.dark) &&
      JSON.stringify(back.density) === JSON.stringify(t.density),
  )
  ok(`${base}: CSS from imported JSON is identical`, toCss(back) === toCss(t))
}
{
  const t = buildTheme({ brand: "#c2410c" })
  const json = toDesignTokens(t) as {
    light: Record<string, { $type: string; $value: { hex: string; components: number[] } }>
  }
  const tok = json.light.primary
  ok(
    "DTCG colour is the 2025.10 object form",
    tok?.$type === "color" &&
      tok.$value.hex === t.light?.["--primary"] &&
      tok.$value.components.length === 3,
  )
  const subtle = (json.light["accent-red-subtle"]?.$value as { alpha?: number } | undefined)?.alpha
  ok("DTCG keeps alpha", subtle !== undefined && Math.abs(subtle - 0.1) < 0.01)
  // Hand-written token files use plain hex strings.
  const hand = fromDesignTokens({ light: { primary: { $type: "color", $value: "#123" } } })
  ok("imports plain hex values", hand.light?.["--primary"] === "#112233")

  const f = toFigmaVariables(buildTheme({ brand: "#c2410c", density: { all: "spacious" } }))
  const ids = new Set(f.variables.map((v) => v.id))
  const perVar = new Map<string, Set<string>>()
  for (const mv of f.variableModeValues) {
    if (!perVar.has(mv.variableId)) perVar.set(mv.variableId, new Set())
    perVar.get(mv.variableId)?.add(mv.modeId)
  }
  ok(
    "Figma: one collection, two modes, a value per variable per mode",
    f.variableCollections.length === 1 &&
      f.variableModes.length === 2 &&
      [...ids].every((id) => perVar.get(id)?.size === 2),
  )
  const primary = f.variableModeValues.find((m) => m.variableId === "var:primary")?.value as {
    r: number
  }
  ok("Figma colours are 0-1 floats", primary.r >= 0 && primary.r <= 1)
}

// --- density -----------------------------------------------------------------
// Default look unchanged: every spacing utility in each shipped theme is the
// theme's exact old unit times n, with both multipliers defaulting to 1.
const UNIT = { editorial: "0.25rem", cinematic: "0.3rem", finance: "0.25rem" } as const
for (const t of BASES) {
  const out = await compile(t, `@import "../packages/tokens/src/themes/${t}.css";`)
  const uses = [
    ...out.matchAll(
      /calc\(calc\(([\d.]+rem) \* var\(--density, 1\) \* var\(--density-component, 1\)\) \* -?[\d.]+\)/g,
    ),
  ]
  const literal = out.match(/calc\([\d.]+rem \* -?[\d.]+\)/g) ?? []
  ok(
    `${t}: every spacing utility is ${UNIT[t]} x n by default (${uses.length} uses)`,
    uses.length > 200 && uses.every((m) => m[1] === UNIT[t]) && literal.length === 0,
    literal.slice(0, 3),
  )
}
const baseCss = readFileSync(`${ROOT}/packages/tokens/src/base.css`, "utf8")
ok(
  "base.css sets --density only under data-density",
  [...baseCss.matchAll(/([^{}]+)\{\s*--density:/g)].every((m) =>
    /\[data-density="\w+"\]\s*$/.test(m[1] as string),
  ),
)
for (const [lvl, x] of Object.entries(DENSITY))
  ok(
    `base.css density ${lvl} = ${x}`,
    baseCss.includes(`[data-density="${lvl}"] {\n  --density: ${x};`),
  )
const ui = $`cat ${ROOT}/packages/ui/src/components/ui/*.tsx`.text()
const uiSrc = await ui
for (const slot of DENSITY_SLOTS) {
  ok(
    `density slot ${slot} exists in signet-ui and defaults to 1`,
    (uiSrc.includes(`data-slot="${slot}"`) || uiSrc.includes(`slot: "${slot}"`)) &&
      baseCss.includes(
        `:where([data-slot="${slot}"]) {\n  --density-component: var(--density-${slot}, 1);`,
      ),
  )
}

rmSync(TMP, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
