/**
 * The picker's rows and what the answers scaffold, apart from the prompts so
 * the mapping is tested without a terminal. Step 1 picks a platform; for web
 * and api, "Start from" picks a ready-made mix and "Features" ticks its parts,
 * which the user adjusts. Every row is one plain-language line, explanation
 * included: clack shows a hint only on the highlighted row. Each label is at
 * most 44 characters, or clack wraps the row at 60 columns.
 */

import { existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import {
  PART_NAMES,
  PARTS,
  type PartName,
  resolveParts,
  STARTERS,
  type StarterName,
} from "./compose.js"

export const PLATFORMS = ["web", "api", "cli", "extension", "desktop"] as const
export type Platform = (typeof PLATFORMS)[number]

export const WHAT: { value: Platform; label: string }[] = [
  { value: "web", label: "Web app — a site people open in a browser" },
  { value: "api", label: "API only — a server other apps talk to" },
  { value: "cli", label: "Command-line tool — runs in a terminal" },
  { value: "extension", label: "Browser extension — a Chrome add-on" },
  { value: "desktop", label: "Desktop app — Mac, Windows and Linux" },
]

/** "Start from": the platform alone, or a starter. */
export type Mix = "basics" | StarterName

const STARTER_NAMES = Object.keys(STARTERS) as StarterName[]
const apiStarter = (s: StarterName) => "surface" in STARTERS[s]

/** The starters offered on a path: the API ones for api, the rest for web; full on both, last. */
function startersFor(what: "web" | "api"): StarterName[] {
  const ends: StarterName[] = what === "web" ? ["blank", "full"] : ["full"]
  const rest = STARTER_NAMES.filter((s) => !ends.includes(s) && (what === "api") === apiStarter(s))
  return [...rest, ...ends]
}

/** "Start from" rows: the basics first, the starters, everything last. */
export function mixRows(what: "web" | "api"): { value: Mix; label: string }[] {
  return [
    {
      value: "basics",
      label:
        what === "api"
          ? "Just the basics — a plain API, no extras"
          : "Just the basics — a themed site, no server",
    },
    ...startersFor(what).map((s) => ({ value: s, label: STARTERS[s].label })),
  ]
}

/** Every part but mcp, which is its own question. */
const PART_LABELS: Record<Exclude<PartName, "mcp">, string> = {
  auth: "Sign-in — log in with a phone code",
  account: "Account page — profile, devices, API keys",
  orgs: "Teams & roles — members and invite links",
  admin: "Admin panel",
  notifications: "Notifications — inbox and preferences",
  privacy: "Privacy — consent, data export and deletion",
  payments: "Billing — plans and payments",
  paywalls: "Paywalls — offers shown per audience",
  growth: "Growth — waitlist, referrals, feedback",
  ai: "AI with spend limits",
  workflows: "Approvals — multi-step jobs people sign off",
  dashboard: "Dashboard — sidebar, stats, a chart, a table",
  pwa: "Installable — works offline",
}
const partLabel = (p: PartName) => PART_LABELS[p as Exclude<PartName, "mcp">]

/** "Features" rows; the API path leaves out the web-only parts. */
export function partRows(what: "web" | "api"): { value: PartName; label: string }[] {
  return PART_NAMES.filter((p) => p !== "mcp" && !(what === "api" && PARTS[p].webOnly)).map(
    (p) => ({ value: p, label: partLabel(p) }),
  )
}

/** Parts plus everything they need, as compose installs them. */
const installed = (parts: readonly PartName[]) => resolveParts([...parts], []).parts

/** The parts already ticked for a mix: the starter's own and what they need. */
export function ticked(mix: Mix): PartName[] {
  return mix === "basics" ? [] : installed(STARTERS[mix].parts)
}

export type Choice = {
  template: Platform | "full"
  starter?: StarterName
  api?: true
  with?: PartName[]
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x))

/**
 * What the answers scaffold, as flags say it. Ticks that install the same
 * parts as a starter on this path (needs counted on both sides) are
 * `--starter <name>`, the chosen mix first; any other ticks are
 * `--with`, plus `--api` on the API path. Nothing ticked from the basics, or
 * nothing that matches a starter, is the platform alone.
 */
export function choose(what: Platform, mix: Mix = "basics", ticks: PartName[] = []): Choice {
  if (what !== "web" && what !== "api") return { template: what }
  if (mix === "basics" && !ticks.length) return { template: what }
  const api = what === "api" ? ({ api: true } as const) : {}
  const order = mix === "basics" ? startersFor(what) : [mix, ...startersFor(what)]
  const starter = order.find((s) => same(installed(STARTERS[s].parts), installed(ticks)))
  if (starter) return { template: "full", starter, ...(apiStarter(starter) ? {} : api) }
  if (!ticks.length) return { template: what }
  return { template: "full", with: ticks, ...api }
}

/** The one-line command that scaffolds the same app, so the picker teaches the flags. */
export function command(
  runner: string,
  name: string,
  c: Choice,
  theme?: string,
  mcp?: boolean,
): string {
  return [
    runner,
    name,
    ...(c.template !== "web" && c.template !== "full" ? ["--platform", c.template] : []),
    ...(c.starter ? ["--starter", c.starter] : []),
    ...(c.with ? ["--with", c.with.join(",")] : []),
    ...(c.api ? ["--api"] : []),
    ...(theme && theme !== "editorial" ? ["--theme", theme] : []),
    ...(mcp === undefined ? [] : [mcp ? "--mcp" : "--no-mcp"]),
  ].join(" ")
}

/** The summary shown before creating: what, which mix, the parts installed (needs too), theme, MCP. */
export function summary(
  what: Platform,
  c: Choice,
  ticks: PartName[],
  theme?: string,
  mcp?: boolean,
): string[] {
  const short = (label: string) => label.split(" — ")[0]
  const parts = installed(ticks)
  return [
    what === "web"
      ? c.template === "full"
        ? "Web app (site + server)"
        : "Web app"
      : short(WHAT.find((w) => w.value === what)?.label ?? what),
    ...(c.starter ? [`Starter: ${STARTERS[c.starter].label}`] : []),
    ...(c.template === "full"
      ? [`Features: ${parts.length ? parts.map((p) => short(partLabel(p))).join(", ") : "none"}`]
      : []),
    ...(theme ? [`Theme: ${theme}`] : []),
    ...(mcp === undefined ? [] : [`AI coding agents (MCP): ${mcp ? "yes" : "no"}`]),
  ]
}

/**
 * A question the picker asks only where it applies and only when no flag
 * answered it: the flag's value is kept, never overwritten. Undefined where
 * it does not apply (a flag given there is left for checkCombo to refuse).
 */
export async function answer<T>(
  applies: boolean,
  given: T | undefined,
  ask: () => Promise<T>,
): Promise<T | undefined> {
  if (!applies) return undefined
  return given ?? ask()
}

/** MCP applies where there is an API; the theme where there is a web UI. */
export const hasApi = (c: Choice) => c.template === "api" || c.template === "full"
export const hasUi = (what: Platform) => what !== "api" && what !== "cli"

/** Why a typed project name can't be used, or undefined; empty is the default, my-app. */
export function nameError(typed: string | undefined, cwd: string): string | undefined {
  const name = typed?.trim() || "my-app"
  if (name.startsWith("-")) return "A name can't start with -."
  const dest = resolve(cwd, name)
  if (existsSync(dest) && readdirSync(dest).length > 0)
    return `${name} already exists and is not empty.`
}

/** The theme rows' explanations; a theme missing here shows its name alone. */
export const THEME_LABELS: Record<string, string> = {
  editorial: "Editorial — warm paper, ink text, green",
  cinematic: "Cinematic — cool neutrals, violet accent",
  finance: "Finance — editorial plus money colours",
}
