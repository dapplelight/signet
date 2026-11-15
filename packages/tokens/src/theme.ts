/**
 * Theme builder: one brand colour in, every colour token of a Signet theme out,
 * light and dark, derived in OKLCH. Text tokens are guaranteed WCAG 4.5:1 on
 * the backgrounds they sit on (focus and chart colours 3:1, input borders
 * 1.3:1, as `test/contrast.ts` checks the shipped themes); a token that had to
 * move to get there is listed in `adjustments`.
 *
 * The result is a layer over a shipped theme (`base`): it overrides the runtime
 * colour variables only, so radius, type, spacing and motion stay the base
 * theme's, and `toCss` emits a file that imports the base and works as a theme.
 *
 * No dependencies: plain functions, safe in a browser, a Worker or a CLI.
 */

export type Base = "editorial" | "cinematic" | "finance"
export type Mode = "light" | "dark"
export type DensityLevel = "compact" | "comfortable" | "spacious"
/** Runtime CSS variables of one mode, e.g. `{ "--primary": "#12833c" }`. */
export type Vars = Record<string, string>

/** Multiplier on the theme's `--spacing` for each density level. */
export const DENSITY: Record<DensityLevel, number> = {
  compact: 0.8,
  comfortable: 1,
  spacious: 1.25,
}
/** Components with a per-component density token, `--density-<slot>`; `base.css` wires them. */
export const DENSITY_SLOTS = [
  "button",
  "input",
  "textarea",
  "select-trigger",
  "badge",
  "card",
  "tabs-list",
  "dialog-content",
  "sidebar",
] as const
export type DensitySlot = (typeof DENSITY_SLOTS)[number]
/** `all` sets `--density` for the whole app; a slot sets that component's own multiplier. */
export type Density = Partial<Record<DensitySlot | "all", DensityLevel>>

export type Adjustment = {
  mode: Mode
  token: string
  from: string
  to: string
  /** The lowest ratio the final colour reaches across its backgrounds. */
  ratio: number
  min: number
  on: string[]
}

export type Theme = {
  brand: string
  base: Base
  light?: Vars
  dark?: Vars
  density?: Density
  adjustments: Adjustment[]
}

export type BuildThemeOptions = {
  /** Brand colour as `#rgb` or `#rrggbb`. */
  brand: string
  base?: Base
  /** Which modes to build. Default both. */
  mode?: Mode | "both"
  density?: Density
}

// ------------------------------------------------------------------ colour math

type Lch = [l: number, c: number, h: number]
type Rgb = [number, number, number]

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

export function normalizeHex(hex: string): string {
  const m = HEX.exec(hex.trim())
  if (!m) throw new Error(`Not a hex colour: "${hex}". Use #rgb or #rrggbb.`)
  const h = m[1] as string
  return `#${(h.length === 3 ? [...h].map((c) => c + c).join("") : h).toLowerCase()}`
}

const toRgb = (hex: string): Rgb =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb
const toHex = (rgb: Rgb): string =>
  `#${rgb
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

/** sRGB hex to OKLCH (Ottosson's OKLab, polar). */
export function hexToOklch(hex: string): Lch {
  const [r, g, b] = toRgb(normalizeHex(hex)).map(lin) as Rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return [L, Math.hypot(A, B), h < 0 ? h + 360 : h]
}

function oklchToLinear([L, C, H]: Lch): Rgb {
  const a = C * Math.cos((H * Math.PI) / 180)
  const b = C * Math.sin((H * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** OKLCH to hex, reducing chroma (hue and lightness kept) until it fits sRGB. */
export function oklchToHex([L, C, H]: Lch): string {
  const l = Math.min(1, Math.max(0, L))
  let lo = 0
  let hi = C
  if (!inGamut(oklchToLinear([l, hi, H]))) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear([l, mid, H]))) lo = mid
      else hi = mid
    }
    hi = lo
  }
  return toHex(oklchToLinear([l, hi, H]).map(gam) as Rgb)
}

// WCAG 2 relative luminance and contrast, the formula `test/contrast.ts` uses.
const luminance = (hex: string) => {
  const c = toRgb(hex).map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number)
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
/** `fg` at `alpha` over `bg`, as a `/NN` opacity modifier paints it. */
export function over(fg: string, bg: string, alpha: number): string {
  const a = toRgb(fg)
  const b = toRgb(bg)
  return toHex(a.map((v, i) => v * alpha + (b[i] as number) * (1 - alpha)) as Rgb)
}
const withAlpha = (hex: string, alpha: number) =>
  `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`

// ------------------------------------------------------------------ recipe

/** Per base: target OKLCH lightness of each neutral, and how much brand hue they carry. */
type Recipe = {
  chroma: number
  bg: number
  surface: number
  elevated: number
  borderSubtle: number
  border: number
  borderStrong: number
  input: number
  muted: number
  text: number
  secondary: number
  textMuted: number
  hint: number
  disabled: number
  /** cinematic tints --accent with the brand; editorial keeps it neutral. */
  brandAccent: boolean
  /** --card / --popover: which surface they use. */
  card: "bg" | "surface"
  popover: "bg" | "elevated"
  secondaryBg: "surface" | "elevated"
}

const EDITORIAL: Record<Mode, Recipe> = {
  light: {
    chroma: 0.006,
    bg: 0.985,
    surface: 0.957,
    elevated: 0.93,
    borderSubtle: 0.93,
    border: 0.872,
    borderStrong: 0.8,
    input: 0.872,
    muted: 0.93,
    text: 0.21,
    secondary: 0.43,
    textMuted: 0.5,
    hint: 0.52,
    disabled: 0.8,
    brandAccent: false,
    card: "surface",
    popover: "bg",
    secondaryBg: "elevated",
  },
  dark: {
    chroma: 0.006,
    bg: 0.15,
    surface: 0.19,
    elevated: 0.215,
    borderSubtle: 0.245,
    border: 0.285,
    borderStrong: 0.345,
    input: 0.3,
    muted: 0.225,
    text: 0.94,
    secondary: 0.7,
    textMuted: 0.64,
    hint: 0.62,
    disabled: 0.34,
    brandAccent: false,
    card: "surface",
    popover: "elevated",
    secondaryBg: "elevated",
  },
}

const RECIPES: Record<Base, Record<Mode, Recipe>> = {
  editorial: EDITORIAL,
  finance: EDITORIAL,
  cinematic: {
    light: {
      chroma: 0.012,
      bg: 1,
      surface: 0.97,
      elevated: 0.94,
      borderSubtle: 0.93,
      border: 0.88,
      borderStrong: 0.78,
      input: 0.88,
      muted: 0.955,
      text: 0.14,
      secondary: 0.38,
      textMuted: 0.5,
      hint: 0.52,
      disabled: 0.82,
      brandAccent: true,
      card: "bg",
      popover: "bg",
      secondaryBg: "surface",
    },
    dark: {
      chroma: 0.014,
      bg: 0.12,
      surface: 0.16,
      elevated: 0.19,
      borderSubtle: 0.21,
      border: 0.25,
      borderStrong: 0.32,
      input: 0.3,
      muted: 0.18,
      text: 0.97,
      secondary: 0.74,
      textMuted: 0.64,
      hint: 0.62,
      disabled: 0.3,
      brandAccent: true,
      card: "surface",
      popover: "elevated",
      secondaryBg: "elevated",
    },
  },
}

/** Status hues stay universal (green good, red bad...); only their lightness follows the theme. */
const STATUS = { green: 150, blue: 262, amber: 72, red: 27 } as const
/** Hue offsets of the categorical chart series from the brand; series 1 is the brand. */
const CHART_OFFSETS = [0, 150, 60, 210, 300, 100]

const TEXT = 4.5

function buildMode(brand: string, base: Base, mode: Mode, adjustments: Adjustment[]): Vars {
  const r = RECIPES[base][mode]
  const [bl, bc, bh] = hexToOklch(brand)
  const dark = mode === "dark"
  const nc = Math.min(r.chroma, bc)
  const neutral = (l: number) => oklchToHex([l, nc, bh])
  const v: Vars = {}

  /**
   * Set `token` to `want`, then move its lightness (toward black or white,
   * whichever the backgrounds need) until it reaches `min` on every one of
   * them. `bgs` gets the candidate so a tint of the colour itself can count.
   */
  const ensure = (
    token: string,
    want: Lch,
    min: number,
    bgs: (fg: string) => [name: string, hex: string][],
    paint: (fg: string, bg: string) => string = (fg) => fg,
  ): string => {
    const first = oklchToHex(want)
    const worst = (fg: string) => Math.min(...bgs(fg).map(([, bg]) => contrast(paint(fg, bg), bg)))
    const [, firstBg] = bgs(first)[0] as [string, string]
    const toward = contrast("#000000", firstBg) >= contrast("#ffffff", firstBg) ? -1 : 1
    let hex = first
    let l = want[0]
    while (worst(hex) < min + 0.01 && l >= 0 && l <= 1) {
      l += toward * 0.005
      hex = oklchToHex([l, want[1], want[2]])
    }
    if (worst(hex) < min + 0.01) hex = toward < 0 ? "#000000" : "#ffffff"
    if (hex !== first)
      adjustments.push({
        mode,
        token,
        from: first,
        to: hex,
        ratio: Math.round(worst(hex) * 100) / 100,
        min,
        on: bgs(hex).map(([n]) => n),
      })
    v[token] = hex
    return hex
  }
  /** Ink for a solid fill: white or the theme's darkest/lightest neutral, whichever reads best. */
  const ink = (fill: string) =>
    [v["--bg-base"] as string, "#ffffff", v["--text-primary"] as string].sort(
      (a, b) => contrast(b, fill) - contrast(a, fill),
    )[0] as string
  const on =
    (...names: string[]) =>
    () =>
      names.map((n) => [n, v[n] as string] as [string, string])

  // Surfaces and lines: fixed lightness, a trace of brand hue.
  v["--bg-base"] = neutral(r.bg)
  v["--bg-surface"] = neutral(r.surface)
  v["--bg-elevated"] = neutral(r.elevated)
  v["--border-default"] = neutral(r.border)
  v["--border-subtle"] = neutral(r.borderSubtle)
  v["--border-strong"] = neutral(r.borderStrong)
  v["--muted"] = neutral(r.muted)
  v["--background"] = v["--bg-base"]
  v["--card"] = v[r.card === "bg" ? "--bg-base" : "--bg-surface"] as string
  v["--popover"] = v[r.popover === "bg" ? "--bg-base" : "--bg-elevated"] as string
  v["--secondary"] = v[r.secondaryBg === "surface" ? "--bg-surface" : "--bg-elevated"] as string
  v["--border"] = v["--border-default"]
  v["--accent"] = r.brandAccent
    ? oklchToHex([dark ? 0.25 : 0.95, Math.min(bc, dark ? 0.06 : 0.05), bh])
    : (v["--bg-elevated"] as string)
  ensure("--input", [r.input, nc, bh], 1.3, on("--bg-base"))

  // Text, on every surface it is painted over.
  const surfaces = ["--bg-base", "--bg-surface", "--bg-elevated", "--card", "--popover"]
  const tabsAlpha = dark ? 0.55 : 0.65 // inactive TabsTrigger: text-text-primary/65, dark /55
  ensure(
    "--text-primary",
    [r.text, nc, bh],
    TEXT,
    on(...surfaces, "--muted", "--secondary", "--accent"),
  )
  const tp = v["--text-primary"] as string
  ensure("--text-primary", hexToOklch(tp), TEXT, on("--bg-elevated"), (fg, bg) =>
    over(fg, bg, tabsAlpha),
  )
  ensure("--text-secondary", [r.secondary, nc, bh], TEXT, on(...surfaces))
  ensure("--text-muted", [r.textMuted, nc, bh], TEXT, on(...surfaces, "--muted"))
  ensure("--text-hint", [r.hint, nc, bh], TEXT, on("--bg-base", "--bg-surface"))
  v["--text-disabled"] = neutral(r.disabled)
  v["--text-inverse"] = v["--bg-base"]
  for (const t of ["--foreground", "--card-fg", "--popover-fg", "--secondary-fg"])
    v[t] = v["--text-primary"] as string
  v["--muted-fg"] = v["--text-muted"] as string
  if (r.brandAccent)
    ensure("--accent-fg", [dark ? 0.85 : 0.38, Math.min(bc, 0.16), bh], TEXT, on("--accent"))
  else v["--accent-fg"] = v["--text-primary"] as string

  // Primary: the brand itself in light mode, a lighter step of it in dark.
  // Components paint it as text too (link buttons, pagination on bg-primary/12),
  // so it must read on the surfaces and on its own tint.
  const primaryWant: Lch = dark ? [Math.max(bl, 0.78), bc, bh] : [bl, bc, bh]
  const primary = ensure("--primary", primaryWant, TEXT, (fg) => [
    ["--bg-base", v["--bg-base"] as string],
    ["--bg-surface", v["--bg-surface"] as string],
    ["--primary/12", over(fg, v["--bg-base"] as string, 0.12)],
  ])
  ensure("--primary-fg", hexToOklch(ink(primary)), TEXT, on("--primary"))
  v["--ring"] = primary

  // Status accents: fixed hues, lightness tuned to the surfaces. Each is text
  // on the surfaces; red is also text on its own tint (destructive badge,
  // button, alert: bg-accent-red/10, /20 dark).
  for (const [name, hue] of Object.entries(STATUS)) {
    const token = `--accent-${name}`
    const want: Lch = dark ? [0.78, 0.15, hue] : [name === "red" ? 0.47 : 0.52, 0.16, hue]
    const hex =
      name === "red"
        ? ensure(token, want, TEXT, (fg) =>
            ["--bg-base", "--bg-surface"].flatMap((b) => [
              [b, v[b] as string] as [string, string],
              [`--accent-red/20 on ${b}`, over(fg, v[b] as string, 0.2)] as [string, string],
            ]),
          )
        : ensure(token, want, TEXT, on("--bg-base", "--bg-surface"))
    v[`${token}-subtle`] = withAlpha(hex, dark ? 0.12 : 0.1)
  }
  v["--destructive"] = v["--accent-red"] as string
  ensure("--accent-red-fg", hexToOklch(ink(v["--accent-red"] as string)), TEXT, on("--accent-red"))

  // Charts: brand first, then hues around it; graphics need 3:1 (WCAG 1.4.11).
  CHART_OFFSETS.forEach((off, i) => {
    if (i === 0) v["--chart-1"] = primary
    else
      ensure(
        `--chart-${i + 1}`,
        [dark ? 0.74 : 0.58, Math.max(0.1, Math.min(bc, 0.16)), (bh + off) % 360],
        3,
        on("--bg-base", "--bg-surface"),
      )
  })

  // Optional slots (CONTRACT.md), as concrete colours.
  v["--focus-ring"] = primary
  v["--focus-ring-offset"] = v["--bg-base"] as string
  v["--accent-primary"] = primary
  v["--accent-primary-fg"] = v["--primary-fg"] as string
  v["--accent-primary-subtle"] = withAlpha(primary, dark ? 0.12 : 0.1)
  if (base === "finance") {
    v["--money-credit"] = v["--accent-green"] as string
    v["--money-debit"] = v["--text-primary"] as string
    v["--money-transfer"] = v["--text-muted"] as string
  }
  return v
}

/**
 * Derive a full colour theme from one brand colour.
 *
 *   const t = buildTheme({ brand: "#e11d48", base: "cinematic" })
 *   writeFileSync("src/brand.css", toCss(t))
 *   t.adjustments  // tokens moved to reach their contrast floor
 */
export function buildTheme(options: BuildThemeOptions): Theme {
  const brand = normalizeHex(options.brand)
  const base = options.base ?? "editorial"
  if (!(base in RECIPES))
    throw new Error(`Unknown base "${base}". Use editorial, cinematic or finance.`)
  const mode = options.mode ?? "both"
  const adjustments: Adjustment[] = []
  const theme: Theme = { brand, base, adjustments }
  if (mode !== "dark") theme.light = buildMode(brand, base, "light", adjustments)
  if (mode !== "light") theme.dark = buildMode(brand, base, "dark", adjustments)
  if (options.density) theme.density = options.density
  return theme
}

// ------------------------------------------------------------------ CSS

const DARK_SELECTOR: Record<Base, string> = {
  editorial: '.dark,\n  [data-theme="ui"]',
  finance: '.dark,\n  [data-theme="ui"]',
  cinematic: '.dark,\n  [data-theme="cinematic"]',
}

const densityVars = (d: Density | undefined): Vars =>
  Object.fromEntries(
    Object.entries(d ?? {}).map(([k, lvl]) => [
      k === "all" ? "--density" : `--density-${k}`,
      String(DENSITY[lvl as DensityLevel]),
    ]),
  )

const decls = (vars: Vars) =>
  Object.entries(vars)
    .map(([k, val]) => `    ${k}: ${val};`)
    .join("\n")

/**
 * The theme as a CSS file: imports its base theme, then overrides the runtime
 * variables in the base's own light and dark selectors. Import it in place of
 * the base theme, before `base.css`. `importBase: false` leaves the import out
 * (to append to a stylesheet that already has the base).
 */
export function toCss(theme: Theme, { importBase = true } = {}): string {
  const density = densityVars(theme.density)
  const blocks: string[] = []
  if (theme.light || Object.keys(density).length)
    blocks.push(`  :root {\n${decls({ ...theme.light, ...density })}\n  }`)
  if (theme.dark) blocks.push(`  ${DARK_SELECTOR[theme.base]} {\n${decls(theme.dark)}\n  }`)
  return [
    `/* Signet theme built from ${theme.brand} on ${theme.base}. Regenerate with: signet theme ${theme.brand} --base ${theme.base} */`,
    importBase ? `@import "@dapplelight/signet-tokens/${theme.base}.css";\n` : "",
    `@layer base {\n${blocks.join("\n\n")}\n}\n`,
  ]
    .filter(Boolean)
    .join("\n")
}

// ------------------------------------------------------------------ W3C Design Tokens

const EXT = "in.dapplelight.signet"
type DtcgColor = { colorSpace: "srgb"; components: number[]; alpha?: number; hex: string }
type DtcgToken = { $type: string; $value: unknown; $description?: string }
export type DesignTokens = Record<string, unknown>

function dtcgColor(hex: string): DtcgColor {
  const rgb = toRgb(hex.slice(0, 7)).map((c) => Math.round(c * 10000) / 10000)
  const alpha = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1
  return {
    colorSpace: "srgb",
    components: rgb,
    ...(alpha < 1 ? { alpha: Math.round(alpha * 10000) / 10000 } : {}),
    hex: hex.slice(0, 7),
  }
}

/**
 * W3C Design Tokens (DTCG 2025.10) JSON: a `light` and a `dark` group of
 * colour tokens named after the CSS variables (`--bg-base` is `bg-base`), a
 * `density` group of numbers, and the brand and base under `$extensions`.
 */
export function toDesignTokens(theme: Theme): DesignTokens {
  const group = (vars: Vars) =>
    Object.fromEntries(
      Object.entries(vars).map(([k, hex]) => [
        k.slice(2),
        { $type: "color", $value: dtcgColor(hex) } satisfies DtcgToken,
      ]),
    )
  const out: DesignTokens = {
    $description: `Signet theme from ${theme.brand} on ${theme.base}`,
    $extensions: { [EXT]: { brand: theme.brand, base: theme.base } },
  }
  if (theme.light) out.light = group(theme.light)
  if (theme.dark) out.dark = group(theme.dark)
  if (theme.density)
    out.density = Object.fromEntries(
      Object.entries(theme.density).map(([k, lvl]) => [
        k,
        {
          $type: "number",
          $value: DENSITY[lvl as DensityLevel],
          $description: lvl,
        } satisfies DtcgToken,
      ]),
    )
  return out
}

/** A DTCG colour value as hex: the 2025.10 object form, or a plain hex string. */
function hexOf(value: unknown, name: string): string {
  if (typeof value === "string") {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value)
    if (m) return value.toLowerCase()
    return normalizeHex(value)
  }
  const c = value as Partial<DtcgColor> | null
  if (c && Array.isArray(c.components) && c.components.length === 3) {
    if (c.colorSpace && c.colorSpace !== "srgb")
      throw new Error(`${name}: only srgb colours can be imported, got ${c.colorSpace}`)
    const hex = c.hex ? normalizeHex(c.hex) : toHex(c.components as Rgb)
    return c.alpha !== undefined && c.alpha < 1 ? withAlpha(hex, c.alpha) : hex
  }
  throw new Error(`${name}: not a colour value`)
}

/**
 * Read DTCG JSON (as `toDesignTokens` writes it, or hand-edited) back into a
 * theme `toCss` can emit. Unknown groups are ignored; `base` falls back to the
 * `$extensions` entry, then editorial.
 */
export function fromDesignTokens(json: DesignTokens, base?: Base): Theme {
  const ext = (json.$extensions as Record<string, { brand?: string; base?: Base }> | undefined)?.[
    EXT
  ]
  const theme: Theme = {
    brand: ext?.brand ? normalizeHex(ext.brand) : "#000000",
    base: base ?? ext?.base ?? "editorial",
    adjustments: [],
  }
  if (!(theme.base in RECIPES)) throw new Error(`Unknown base "${theme.base}"`)
  for (const mode of ["light", "dark"] as const) {
    const group = json[mode] as Record<string, DtcgToken> | undefined
    if (!group) continue
    const vars: Vars = {}
    for (const [name, tok] of Object.entries(group)) {
      if (name.startsWith("$") || tok?.$type !== "color") continue
      if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Token name "${name}" is not a CSS name`)
      vars[`--${name}`] = hexOf(tok.$value, `${mode}.${name}`)
    }
    theme[mode] = vars
  }
  const density = json.density as Record<string, DtcgToken> | undefined
  if (density) {
    const levels = Object.entries(DENSITY)
    theme.density = {}
    for (const [k, tok] of Object.entries(density)) {
      if (k !== "all" && !(DENSITY_SLOTS as readonly string[]).includes(k)) continue
      const lvl = levels.find(([n, x]) => n === tok.$description || x === tok.$value)?.[0]
      if (lvl) theme.density[k as DensitySlot] = lvl as DensityLevel
    }
  }
  return theme
}

// ------------------------------------------------------------------ Figma

/**
 * Figma Variables REST payload (`POST /v1/files/:file_key/variables`): one
 * "Signet" collection with Light and Dark modes and a COLOR variable per token
 * (`bg-base` becomes `bg/base` so Figma groups it), plus density as FLOATs.
 * Send it as the request body; the temporary ids are resolved by Figma.
 */
export function toFigmaVariables(theme: Theme) {
  const modes = (["light", "dark"] as const).filter((m) => theme[m])
  const names = [...new Set(modes.flatMap((m) => Object.keys(theme[m] as Vars)))]
  const rgba = (hex: string) => {
    const [r, g, b] = toRgb(hex.slice(0, 7))
    const a = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1
    return { r, g, b, a }
  }
  const density = densityVars(theme.density)
  const variables = [
    ...names.map((n) => ({
      action: "CREATE",
      id: `var:${n.slice(2)}`,
      name: n.slice(2).replace("-", "/"),
      variableCollectionId: "collection:signet",
      resolvedType: "COLOR",
      codeSyntax: { WEB: `var(${n})` },
    })),
    ...Object.keys(density).map((n) => ({
      action: "CREATE",
      id: `var:${n.slice(2)}`,
      name: n.slice(2).replace("-", "/"),
      variableCollectionId: "collection:signet",
      resolvedType: "FLOAT",
      codeSyntax: { WEB: `var(${n})` },
    })),
  ]
  return {
    variableCollections: [
      {
        action: "CREATE",
        id: "collection:signet",
        name: `Signet (${theme.base}, ${theme.brand})`,
        initialModeId: `mode:${modes[0] ?? "light"}`,
      },
    ],
    variableModes: modes.map((m, i) =>
      i === 0
        ? {
            action: "UPDATE",
            id: `mode:${m}`,
            name: m === "light" ? "Light" : "Dark",
            variableCollectionId: "collection:signet",
          }
        : {
            action: "CREATE",
            id: `mode:${m}`,
            name: m === "light" ? "Light" : "Dark",
            variableCollectionId: "collection:signet",
          },
    ),
    variables,
    variableModeValues: [
      ...modes.flatMap((m) =>
        Object.entries(theme[m] as Vars).map(([n, hex]) => ({
          variableId: `var:${n.slice(2)}`,
          modeId: `mode:${m}`,
          value: rgba(hex),
        })),
      ),
      ...modes.flatMap((m) =>
        Object.entries(density).map(([n, x]) => ({
          variableId: `var:${n.slice(2)}`,
          modeId: `mode:${m}`,
          value: Number(x),
        })),
      ),
    ],
  }
}
