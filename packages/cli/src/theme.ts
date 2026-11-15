/**
 * signet theme <hex>: a whole theme from one brand colour, printed as a CSS
 * file (default), W3C Design Tokens JSON or the Figma Variables API body.
 * `--import tokens.json` turns a token file back into CSS. The builder is
 * signet-tokens' own (`@dapplelight/signet-tokens/theme`).
 */

import { readFileSync, writeFileSync } from "node:fs"
import {
  type Base,
  buildTheme,
  DENSITY,
  type DensityLevel,
  fromDesignTokens,
  type Mode,
  type Theme,
  toCss,
  toDesignTokens,
  toFigmaVariables,
} from "../../tokens/src/theme.js"
import { SignetCliError } from "./core.js"

const HELP = `
signet theme <hex> [options]
signet theme --import tokens.json [--out file]

Options:
  --base <name>       editorial | cinematic | finance (default: editorial)
  --mode <mode>       light | dark | both (default: both)
  --density <level>   compact | comfortable | spacious, for the whole app
  --format <format>   css | tokens | figma (default: css)
  --import <file>     Read W3C Design Tokens JSON instead of a hex colour
  --out <file>        Write here instead of stdout

Example:
  signet theme "#e11d48" --base cinematic --out src/brand.css
`

export function theme(args: string[]): number {
  const o: Record<string, string> = {}
  let brand = ""
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === "-h" || a === "--help") {
      console.log(HELP)
      return 0
    }
    if (a.startsWith("--")) {
      const v = args[++i]
      if (v === undefined) throw new SignetCliError(`${a} needs a value.`)
      o[a.slice(2)] = v
    } else brand = a
  }
  if (!brand && !o.import) {
    console.log(HELP)
    return 1
  }
  if (o.mode && !["light", "dark", "both"].includes(o.mode))
    throw new SignetCliError(`Unknown mode "${o.mode}". Use light, dark or both.`)
  if (o.density && !(o.density in DENSITY))
    throw new SignetCliError(
      `Unknown density "${o.density}". Use compact, comfortable or spacious.`,
    )
  let t: Theme
  try {
    if (o.import) t = fromDesignTokens(JSON.parse(readFileSync(o.import, "utf8")), o.base as Base)
    else
      t = buildTheme({
        brand,
        base: (o.base ?? "editorial") as Base,
        mode: (o.mode ?? "both") as Mode | "both",
        ...(o.density ? { density: { all: o.density as DensityLevel } } : {}),
      })
  } catch (err) {
    throw new SignetCliError(err instanceof Error ? err.message : String(err))
  }
  const format = o.format ?? "css"
  const out =
    format === "css"
      ? toCss(t)
      : format === "tokens"
        ? `${JSON.stringify(toDesignTokens(t), null, 2)}\n`
        : format === "figma"
          ? `${JSON.stringify(toFigmaVariables(t), null, 2)}\n`
          : null
  if (out === null)
    throw new SignetCliError(`Unknown format "${format}". Use css, tokens or figma.`)
  if (o.out) writeFileSync(o.out, out)
  else process.stdout.write(out)
  // Adjustments go to stderr so stdout stays a clean file.
  for (const a of t.adjustments)
    console.error(
      `  ${a.mode} ${a.token}: ${a.from} -> ${a.to} (${a.ratio}:1 on ${a.on.join(", ")})`,
    )
  if (o.out) console.error(`  wrote ${o.out}`)
  return 0
}
