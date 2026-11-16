/**
 * `./native` and `./ansi`: the committed data matches a fresh generation from
 * the theme CSS, and every theme resolves every CONTRACT.md colour in both
 * modes to a value React Native and a terminal can use.
 */

import { readFileSync } from "node:fs"
import { render, themeNames } from "../scripts/gen-native"
import { ansi, ansiCode, nearest256, RESET } from "../src/ansi"
import { NATIVE_THEMES, nativeTheme, THEME_NAMES, type ThemeName } from "../src/native"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, detail = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, detail))
}

const ROOT = new URL("..", import.meta.url).pathname
ok(
  "native-themes.ts is up to date (run `bun run gen:native`)",
  readFileSync(`${ROOT}src/native-themes.ts`, "utf8") === render(),
)
ok("every theme file is exported", THEME_NAMES.join() === themeNames().join(), THEME_NAMES.join())

// CONTRACT.md's required colours, as the camelCase keys ./native uses.
const contract = readFileSync(`${ROOT}CONTRACT.md`, "utf8")
const colorSection = contract.slice(
  contract.indexOf("## Required — color"),
  contract.indexOf("## Required — form"),
)
const required = [
  ...new Set([...colorSection.matchAll(/--color-([a-z0-9-]+)/g)].map(([, n]) => n as string)),
].map((n) => n.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()))
ok("contract colours parsed", required.length > 30, String(required.length))

const COLOR = /^#[0-9a-f]{6}$|^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\)$/
for (const name of THEME_NAMES) {
  for (const mode of ["light", "dark"] as const) {
    const { colors } = nativeTheme(name, mode)
    const missing = required.filter((k) => !COLOR.test((colors as Record<string, string>)[k] ?? ""))
    ok(`${name} ${mode}: every contract colour resolves`, missing.length === 0, missing.join())
  }
  const t = NATIVE_THEMES[name]
  const nums = [...Object.values(t.radius), t.spacing, ...Object.values(t.fontSize)]
  ok(
    `${name}: radii, spacing, font sizes are positive numbers`,
    nums.every((n) => n > 0),
  )
  ok(`${name}: light and dark differ`, t.light.background !== t.dark.background)

  for (const depth of ["truecolor", "256"] as const) {
    const a = ansi(name, { depth })
    const keys = Object.keys(a.fg)
    const allOpaque = Object.values(a.hex).every((h) => /^#[0-9a-f]{6}$/.test(h))
    ok(
      `${name} ${depth}: every colour flattens to hex`,
      allOpaque && keys.length >= required.length,
    )
    const s = (a.fg.primary?.("x") ?? "").replaceAll("\x1b", "ESC")
    const shape =
      depth === "truecolor" ? /^ESC\[38;2;\d+;\d+;\d+mxESC\[0m$/ : /^ESC\[38;5;\d+mxESC\[0m$/
    ok(`${name} ${depth}: fg wraps text and resets`, shape.test(s), JSON.stringify(s))
  }
}

// Spot values, so a parser change cannot quietly shift every colour.
ok("editorial light background", NATIVE_THEMES.editorial.light.background === "#faf9f7")
ok("editorial dark bg-base", NATIVE_THEMES.editorial.dark.bgBase === "#0d0d0b")
ok("editorial radius md = 10px", NATIVE_THEMES.editorial.radius.md === 10)
ok("editorial spacing = 4px", NATIVE_THEMES.editorial.spacing === 4)
ok(
  "finance inherits editorial",
  NATIVE_THEMES.finance.light.primary === NATIVE_THEMES.editorial.light.primary,
)
ok(
  "color-mix resolves to rgba",
  NATIVE_THEMES.editorial.light.accentPrimarySubtle === "rgba(17, 126, 58, 0.1)",
  NATIVE_THEMES.editorial.light.accentPrimarySubtle,
)

ok("nearest256 pure red", nearest256("#ff0000") === 196)
ok("nearest256 white", nearest256("#ffffff") === 231)
ok("nearest256 mid grey uses the ramp", nearest256("#808080") === 244)
ok("ansiCode truecolor bg", ansiCode("#0a0b0c", "bg") === "\x1b[48;2;10;11;12m")
ok("RESET", RESET === "\x1b[0m")
ok(
  "RN useColorScheme values: dark is dark, null/unspecified/undefined are light",
  nativeTheme("editorial", "dark").colors.background === NATIVE_THEMES.editorial.dark.background &&
    ([null, "unspecified", undefined] as const).every(
      (v) =>
        nativeTheme("editorial", v).colors.background === NATIVE_THEMES.editorial.light.background,
    ),
)
let threw = false
try {
  nativeTheme("nope" as ThemeName)
} catch {
  threw = true
}
ok("unknown theme throws", threw)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
