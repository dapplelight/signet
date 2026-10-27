/**
 * Proves the theme contract: compile Tailwind against the real @dapplelight/signet-ui
 * components under each theme and assert the same utility classes resolve to
 * different values.
 *
 * This exists because reasoning about it was not enough. The first version of
 * CONTRACT.md claimed the type scale adapted; compiling showed it did not,
 * because components use `text-sm` (Tailwind's scale) while the themes only
 * defined `--text-body` (a semantic name no component referenced).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { $ } from "bun"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const TMP = `${ROOT}/.themebuild`
const THEMES = ["editorial", "cinematic", "finance"] as const
/** Stock Tailwind shades an app might use directly; a theme must not repaint them. */
const STOCK = [
  "red-500",
  "red-600",
  "green-600",
  "blue-600",
  "amber-500",
  "emerald-400",
  "violet-500",
]

// --- CONTRACT.md, parsed: the variable names in each section's code blocks ---
const CONTRACT = readFileSync(`${ROOT}/packages/tokens/CONTRACT.md`, "utf8")
const section = (from: string, to: string) => {
  const a = CONTRACT.indexOf(from)
  const b = CONTRACT.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`CONTRACT.md lost its "${from}" section`)
  const names = [...CONTRACT.slice(a, b).matchAll(/```\n([\s\S]*?)```/g)].flatMap(([, code]) =>
    [...code.matchAll(/--[a-z0-9-]+/g)].map(([n]) => n),
  )
  return [...new Set(names)]
}
const REQUIRED = section("## Required — color", "## Optional")
const OPTIONAL_GENERIC = section("## Optional", "Domain — ")
const OPTIONAL_DOMAIN = section("Domain — ", "## Not part of the contract")
const OPTIONAL = [...OPTIONAL_GENERIC, ...OPTIONAL_DOMAIN]
/** The utility a slot produces: --color-chart-1 -> bg-chart-1, --leading-display -> leading-display. */
const utility = (slot: string) =>
  slot.startsWith("--color-") ? `bg-${slot.slice(8)}` : slot.slice(2)

const PROBE = `@source inline("${[...STOCK.map((s) => `bg-${s}`), ...OPTIONAL.map(utility)].join(" ")}");`

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, detail = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, detail))
}

mkdirSync(TMP, { recursive: true })
const css: Record<string, string> = {}
const compile = async (name: string, theme: string) => {
  writeFileSync(
    `${TMP}/${name}.css`,
    `@import "tailwindcss";\n@source "../packages/ui/src";\n${PROBE}\n${theme}`,
  )
  await $`${ROOT}/node_modules/.bin/tailwindcss -i ${TMP}/${name}.css -o ${TMP}/${name}.out.css`.quiet()
  return readFileSync(`${TMP}/${name}.out.css`, "utf8")
}
for (const t of THEMES) {
  css[t] = await compile(t, `@import "../packages/tokens/src/themes/${t}.css";\n`)
  ok(`${t} compiles`, css[t].length > 10_000)
}
/** Tailwind with no theme at all — the stock palette to compare against. */
const stock = await compile("stock", "")

/** Resolved value of a property inside a generated utility class. */
const resolve = (sheet: string, cls: string, prop: string): string | null => {
  const m = sheet.match(
    new RegExp(`^  \\.${cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "m"),
  )
  return m?.[1].match(new RegExp(`${prop}:\\s*([^;]+)`))?.[1].trim() ?? null
}

// Components were really scanned — rounded-full and aria-invalid come from badge.tsx
ok(
  "scans real component classes",
  THEMES.every((t) => css[t].includes("aria-invalid")),
)

// The classes the components actually use must differ between themes.
for (const [cls, prop] of [
  ["text-sm", "font-size"],
  ["text-xs", "font-size"],
  ["text-base", "font-size"],
  ["rounded-lg", "border-radius"],
  ["rounded-md", "border-radius"],
] as const) {
  const e = resolve(css.editorial, cls, prop)
  const c = resolve(css.cinematic, cls, prop)
  ok(`.${cls} adapts`, !!e && !!c && e !== c, `(${e} vs ${c})`)
}

// No utility may resolve to an undefined custom property.
for (const t of THEMES) {
  const dangling = [...css[t].matchAll(/^ {2}\.([\w\\:.-]+) \{[^}]*var\((--[a-z0-9-]+)\)/gm)]
    .filter(([, , v]) => !new RegExp(`^\\s*${v}:`, "m").test(css[t]))
    .map(([, cls, v]) => `${cls}->${v}`)
  ok(
    `${t}: no utility resolves to an undefined var`,
    dangling.length === 0,
    dangling.slice(0, 3).join(" "),
  )
}

// A pill is a pill in every theme — this one SHOULD match.
ok(
  "rounded-full is theme-invariant",
  resolve(css.editorial, "rounded-full", "border-radius") ===
    resolve(css.cinematic, "rounded-full", "border-radius"),
)

// Density. --spacing is INLINED at build time, not a runtime var, so it cannot
// be flipped by overriding a CSS variable — but it does differ per theme.
const density = (t: string, cls: string, prop: string) =>
  css[t].match(new RegExp(`\\.${cls} \\{\\s*${prop}: ([^;]+)`))?.[1]
for (const [cls, prop] of [
  ["h-8", "height"],
  ["px-3", "padding-inline"],
  ["size-4", "width"],
] as const) {
  const e = density("editorial", cls, prop)
  const c = density("cinematic", cls, prop)
  ok(`.${cls} density adapts per theme`, !!e && !!c && e !== c, `(${e} vs ${c})`)
}

// The finance overlay carries the finance taxonomy the base themes must not.
ok("finance overlay inherits editorial radius", /\.rounded-lg \{[^}]*0\.75rem/.test(css.finance))
ok("finance overlay adds --cat-* tokens", /--color-cat-needs/.test(css.finance))

// Domain tokens must not leak into a theme that does not own them.
ok(
  "cinematic carries no finance --cat-* tokens",
  !/--cat-(needs|wants|investments)/.test(css.cinematic),
)
ok(
  "editorial carries no finance --cat-* tokens",
  !/--cat-(needs|wants|investments)/.test(css.editorial),
)

// Themes set semantic tokens and leave Tailwind's stock palette alone, so an
// app's bg-red-500 is Tailwind's red under every theme. editorial once remapped
// the red scale to rose, and green/blue/amber/emerald to v3 hexes.
/** What `bg-<s>` paints: the utility's value, with `var(--color-<s>)` substituted. */
const shade = (sheet: string, s: string) => {
  const v = resolve(sheet, `bg-${s}`, "background-color")
  const def = sheet.match(new RegExp(`^\\s*--color-${s}:\\s*([^;]+);`, "m"))?.[1].trim()
  return v === `var(--color-${s})` ? (def ?? null) : v
}
for (const t of THEMES) {
  const repainted = STOCK.filter((s) => shade(css[t], s) !== shade(stock, s))
  ok(
    `${t}: stock palette untouched`,
    !!shade(stock, "red-500") && repainted.length === 0,
    repainted.map((s) => `${s}=${shade(css[t], s)}`).join(" "),
  )
}
const STOCK_SCALE =
  /--color-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d+\s*:/
for (const f of ["editorial", "cinematic", "finance"]) {
  const src = readFileSync(`${ROOT}/packages/tokens/src/themes/${f}.css`, "utf8")
  ok(
    `${f}.css defines no stock-scale variable`,
    !STOCK_SCALE.test(src),
    src.match(STOCK_SCALE)?.[0],
  )
}

// --- The contract itself ---
/** A theme's source with its local @imports inlined (finance.css imports editorial.css). */
const source = (t: string): string =>
  readFileSync(`${ROOT}/packages/tokens/src/themes/${t}.css`, "utf8").replace(
    /@import "\.\/([\w-]+)\.css";/g,
    (_, dep: string) => source(dep),
  )
const defines = (src: string, v: string) => new RegExp(`^\\s*${v}\\s*:`, "m").test(src)
/** The bodies of every rule whose selector list starts with `sel`, joined. */
const blocks = (src: string, sel: RegExp) =>
  [...src.matchAll(new RegExp(`^\\s*${sel.source}[^{;]*\\{([^}]*)\\}`, "gm"))]
    .map(([, b]) => b)
    .join("\n")

const counted = CONTRACT.match(/\*\*(\d+) required, (\d+) optional\.\*\*/)
ok(
  "CONTRACT.md states its own counts correctly",
  Number(counted?.[1]) === REQUIRED.length && Number(counted?.[2]) === OPTIONAL.length,
  `(says ${counted?.[1]}/${counted?.[2]}, has ${REQUIRED.length}/${OPTIONAL.length})`,
)
ok(
  "CLAUDE.md states the same counts",
  readFileSync(`${ROOT}/CLAUDE.md`, "utf8").includes(
    `CONTRACT.md (${REQUIRED.length} required + ${OPTIONAL.length} optional vars)`,
  ),
)
ok("no slot is both required and optional", !OPTIONAL.some((v) => REQUIRED.includes(v)))

for (const t of THEMES) {
  const src = source(t)
  const missing = REQUIRED.filter((v) => !defines(src, v))
  ok(`${t} defines every required variable`, missing.length === 0, missing.join(" "))

  // Optional slots: nothing forces a theme to define one, but one it does
  // define must be whole — both modes, mapped to a utility, and compiling.
  const light = blocks(src, /:root/)
  const dark = blocks(src, /\.dark/)
  const broken: string[] = []
  for (const slot of OPTIONAL) {
    const colour = slot.startsWith("--color-")
    const raw = colour ? `--${slot.slice(8)}` : slot
    if (!defines(src, slot) && !(colour && defines(src, raw))) continue
    if (colour) {
      if (!defines(light, raw) || !defines(dark, raw)) broken.push(`${raw} not set in both modes`)
      if (!new RegExp(`^\\s*${slot}:\\s*var\\(${raw}\\);`, "m").test(src))
        broken.push(`${slot} does not map to var(${raw})`)
      const v = resolve(css[t], utility(slot), "background-color")
      if (v !== `var(${raw})`) broken.push(`.${utility(slot)} -> ${v}`)
    } else if (!resolve(css[t], utility(slot), "line-height")) {
      broken.push(`.${utility(slot)} not generated`)
    }
  }
  ok(`${t}: every optional slot it defines is complete`, broken.length === 0, broken.join("; "))
}

// Generic slots are in both base themes, so apps can rely on them under any theme.
for (const t of ["editorial", "cinematic"]) {
  const absent = OPTIONAL_GENERIC.filter((v) => !defines(source(t), v))
  ok(`${t} provides the generic optional slots`, absent.length === 0, absent.join(" "))
}
// Domain slots stay in the domain overlay — the same rule as --cat-*.
for (const t of ["editorial", "cinematic"]) {
  const leaked = OPTIONAL_DOMAIN.filter((v) => defines(source(t), v) || css[t].includes(v))
  ok(`${t} carries no domain optional slots`, leaked.length === 0, leaked.join(" "))
}
ok(
  "finance provides the money slots",
  OPTIONAL_DOMAIN.every((v) => defines(source("finance"), v)),
)

rmSync(TMP, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
