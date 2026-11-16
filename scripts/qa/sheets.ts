// Visual QA contact sheets and report (dev-only, never published). Runs at the end of `bun run qa`, or alone:
//   bun run scripts/qa/sheets.ts qa-out/<run>
// Per item: sheets/<item>.png (3 themes x light/dark x mobile/desktop, rendered by Playwright from a generated
// HTML grid of the run's shots, no image library). Per run: report.md. See CONTRIBUTING.md, "Visual QA".
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { QA_ITEMS } from "../../apps/showcase/src/qa-items"

const ROOT = resolve(import.meta.dir, "../..")
const USAGE = "Usage: bun run scripts/qa/sheets.ts <run-dir>"
const THEMES = ["editorial", "cinematic", "finance"]
const MODES = ["light", "dark"]
const VIEWPORTS = [
  { name: "mobile", width: 390, scaledTo: 390 },
  { name: "desktop", width: 1280, scaledTo: 640 },
]
const IMPACTS = ["critical", "serious", "moderate", "minor"]

export type Entry = {
  item: string
  theme: string
  mode: string
  viewport: string
  png: string | null
  axe: string | null
  violations: number
  consoleErrors: string[]
  overflow: boolean
  error: string | null
}
type AxeNode = { target?: unknown[] }
type AxeViolation = { id: string; impact?: string | null; help?: string; nodes?: AxeNode[] }

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const where = (e: Entry) => `${e.item} / ${e.theme} / ${e.mode} / ${e.viewport}`
const find = (shots: Entry[], item: string, theme: string, mode: string, viewport: string) =>
  shots.find(
    (e) => e.item === item && e.theme === theme && e.mode === mode && e.viewport === viewport,
  )

function tile(
  dir: string,
  shots: Entry[],
  item: string,
  theme: string,
  mode: string,
  vp: (typeof VIEWPORTS)[number],
) {
  const e = find(shots, item, theme, mode, vp.name)
  const pct = Math.round((vp.scaledTo / vp.width) * 100)
  const parts = [theme, mode, `${vp.name} ${vp.width}`, `${pct}%`]
  if (e?.violations) parts.push(`axe ${e.violations}`)
  if (e?.consoleErrors.length) parts.push(`console ${e.consoleErrors.length}`)
  if (e?.overflow) parts.push("overflow")
  let body: string
  if (!e) body = "Not captured"
  else if (!e.png) body = `No shot: ${e.error ?? "unknown error"}`
  else if (!existsSync(join(dir, e.png))) body = `No shot: ${e.png} is missing`
  else body = ""
  const inner = body
    ? `<div class="none">${esc(body)}</div>`
    : `<img src="../${esc(e?.png ?? "")}" width="${vp.scaledTo}">`
  return `<div class="tile" style="width:${vp.scaledTo}px"><div class="label">${esc(parts.join(" · "))}</div>${inner}</div>`
}

function sheetHtml(dir: string, shots: Entry[], item: string) {
  const kind = QA_ITEMS.find((i) => i.id === item)?.kind
  const tiles = THEMES.flatMap((t) =>
    MODES.flatMap((m) => VIEWPORTS.map((vp) => tile(dir, shots, item, t, m, vp))),
  )
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#fff;color:#111;font:14px/1.4 system-ui,sans-serif}
h1{font-size:18px;margin:0 0 12px;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:392px 642px;gap:12px;align-items:start}
.tile{box-sizing:content-box;border:1px solid #ccc;background:#fff}
.label{padding:4px 6px;border-bottom:1px solid #ccc;font-size:14px;color:#111;overflow-wrap:anywhere}
.none{min-height:120px;padding:6px;color:#111;overflow-wrap:anywhere}
img{display:block}
</style></head><body><h1>${esc(item)}${kind ? ` · ${kind}` : ""}</h1><div class="grid">${tiles.join("")}</div></body></html>`
}

function readViolations(dir: string, e: Entry): AxeViolation[] {
  if (!e.axe || !existsSync(join(dir, e.axe))) return []
  return JSON.parse(readFileSync(join(dir, e.axe), "utf8")).violations ?? []
}

function report(run: string, dir: string, shots: Entry[], items: string[]) {
  type Group = { id: string; impact: string; help: string; nodes: string[] }
  const groups = new Map<string, Group>()
  for (const e of shots)
    for (const v of readViolations(dir, e)) {
      const impact = v.impact ?? "minor"
      const g = groups.get(`${v.id}|${impact}`) ?? {
        id: v.id,
        impact,
        help: v.help ?? "",
        nodes: [],
      }
      for (const n of v.nodes ?? [])
        g.nodes.push(`- ${where(e)}: \`${(n.target ?? []).flat().join(" ")}\``)
      groups.set(`${v.id}|${impact}`, g)
    }
  const rank = (i: string) => (IMPACTS.includes(i) ? IMPACTS.indexOf(i) : IMPACTS.length)
  const ranked = [...groups.values()].sort(
    (a, b) =>
      rank(a.impact) - rank(b.impact) ||
      b.nodes.length - a.nodes.length ||
      a.id.localeCompare(b.id),
  )
  const sum = (f: (e: Entry) => number) => shots.reduce((n, e) => n + f(e), 0)
  const section = (title: string, lines: string[]) =>
    `## ${title}\n\n${lines.length ? lines.join("\n") : "None."}\n`
  const consoleLines = shots
    .filter((e) => e.consoleErrors.length)
    .flatMap((e) => [
      `- ${where(e)}`,
      ...e.consoleErrors.map((m) => `  - ${m.replace(/\s+/g, " ").trim()}`),
    ])
  const overflowLines = shots.filter((e) => e.overflow).map((e) => `- ${where(e)}`)
  const axeBlocks = ranked.map(
    (g) => `### ${g.id} (${g.impact}): ${g.help}\n\n${g.nodes.join("\n")}\n`,
  )
  return [
    `# QA report ${run}\n`,
    `## Summary\n\n- Shots: ${shots.length}\n- Errors: ${sum((e) => +!!e.error)}\n- Axe violations: ${sum((e) => e.violations)}\n- Console errors: ${sum((e) => e.consoleErrors.length)}\n- Overflow: ${sum((e) => +e.overflow)}\n`,
    `## Axe violations\n\n${axeBlocks.length ? axeBlocks.join("\n") : "None.\n"}`,
    section("Console errors", consoleLines),
    section("Horizontal overflow", overflowLines),
    section(
      "Sheets",
      items.map((i) => `- sheets/${i}.png`),
    ),
  ].join("\n")
}

/** Writes <dir>/sheets/<item>.png for every item in the manifest and <dir>/report.md. Throws if there is no manifest. */
export async function writeSheets(dir: string, label = dir) {
  const manifest = join(dir, "manifest.json")
  if (!existsSync(manifest)) throw new Error(`Sheets failed: no manifest.json in ${label}`)
  const shots: Entry[] = JSON.parse(readFileSync(manifest, "utf8")).shots
  const items = [...new Set(shots.map((e) => e.item))]
  const sheetDir = join(dir, "sheets")
  mkdirSync(sheetDir, { recursive: true })
  // report first: it needs no browser, so a launch failure still leaves it behind
  await Bun.write(
    join(dir, "report.md"),
    report(dir.split(/[\\/]/).filter(Boolean).pop() ?? dir, dir, shots, items),
  )

  const { chromium } = createRequire(join(ROOT, "packages/test/package.json"))("@playwright/test")
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 800 } })
    for (const item of items) {
      const html = join(sheetDir, `${item}.html`)
      await Bun.write(html, sheetHtml(dir, shots, item))
      await page.goto(pathToFileURL(html).href)
      await page.screenshot({ path: join(sheetDir, `${item}.png`), fullPage: true })
      unlinkSync(html)
    }
  } finally {
    await browser.close()
  }
  console.log(`Wrote ${label}/sheets (${items.length} sheets)`)
  console.log(`Wrote ${label}/report.md`)
}

if (import.meta.main) {
  const dir = process.argv[2]
  if (!dir) {
    console.error(USAGE)
    process.exit(2)
  }
  await writeSheets(resolve(dir), dir).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(msg.startsWith("Sheets failed") ? msg : `Sheets failed: ${msg}`)
    process.exit(1)
  })
}
