import { mkdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { chromium } from "./browser"
import type { Shot } from "./types"

export const WIDTHS = [390, 1440]
export const MODES = ["light", "dark"] as const
const HEIGHT = { 390: 844, 1440: 900 } as Record<number, number>

const slug = (page: string) =>
  page === "/" ? "home" : page.replace(/^\/|\/$/g, "").replace(/[^a-z0-9]+/gi, "-")
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Tile label, as in scripts/qa/sheets.ts: the parts of the view, then a failure note. */
export const tileLabel = (s: Shot) => `${s.page} · ${s.mode} · ${s.width}`

/** Screenshots every page at 390 and 1440, light and dark. A shot that fails is kept with its reason. */
export async function takeShots(
  base: string,
  pages: string[],
  outDir: string,
  rel: string,
): Promise<Shot[]> {
  mkdirSync(join(outDir, "shots"), { recursive: true })
  const shots: Shot[] = []
  let browser: Awaited<ReturnType<ReturnType<typeof chromium>["launch"]>> | undefined
  let launchError = ""
  try {
    browser = await chromium().launch()
  } catch (e) {
    launchError = `browser launch failed: ${e instanceof Error ? (e.message.split("\n")[0] ?? "") : e}`
  }
  for (const page of pages)
    for (const width of WIDTHS)
      for (const mode of MODES) {
        const shot: Shot = { page, width, mode, path: null }
        const file = `shots/${slug(page)}__${width}__${mode}.png`
        if (!browser) shot.reason = launchError
        else {
          const context = await browser.newContext({
            viewport: { width, height: HEIGHT[width] ?? 800 },
            colorScheme: mode,
          })
          try {
            const p = await context.newPage()
            await p.goto(base + page, { timeout: 15_000, waitUntil: "networkidle" })
            await p.screenshot({ path: join(outDir, file), fullPage: true, animations: "disabled" })
            shot.path = `${rel}/${file}`
          } catch (e) {
            shot.reason = e instanceof Error ? (e.message.split("\n")[0] ?? "error") : String(e)
          } finally {
            await context.close()
          }
        }
        shots.push(shot)
      }
  await browser?.close()
  return shots
}

/** The contact sheet for one run: one tile per shot, labelled, with "No shot: ..." where a shot failed. */
export function sheetHtml(title: string, shots: Shot[], resultsDir: string): string {
  const tiles = shots.map((s) => {
    const inner = s.path
      ? `<img src="${esc(pathToFileURL(join(resultsDir, s.path)).href)}" width="${s.width === 390 ? 390 : 640}">`
      : `<div class="none">No shot: ${esc(s.reason ?? "unknown error")}</div>`
    return `<div class="tile"><div class="label">${esc(tileLabel(s))}</div>${inner}</div>`
  })
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#fff;color:#111;font:14px/1.4 system-ui,sans-serif}
h1{font-size:18px;margin:0 0 12px;overflow-wrap:anywhere}
.grid{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
.tile{border:1px solid #ccc;background:#fff}
.label{padding:4px 6px;border-bottom:1px solid #ccc;overflow-wrap:anywhere}
.none{min-height:120px;min-width:200px;padding:6px;overflow-wrap:anywhere}
img{display:block}
</style></head><body><h1>${esc(title)}</h1><div class="grid">${tiles.join("")}</div></body></html>`
}

/** Writes sheet.png next to the shots. Returns its path relative to the results folder, or null with no browser. */
export async function writeSheet(
  title: string,
  shots: Shot[],
  outDir: string,
  rel: string,
  resultsDir: string,
) {
  let browser: Awaited<ReturnType<ReturnType<typeof chromium>["launch"]>> | undefined
  try {
    browser = await chromium().launch()
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
    const html = join(outDir, "sheet.html")
    await Bun.write(html, sheetHtml(title, shots, resultsDir))
    await page.goto(pathToFileURL(html).href)
    await page.screenshot({ path: join(outDir, "sheet.png"), fullPage: true })
    unlinkSync(html)
    return `${rel}/sheet.png`
  } catch {
    return null
  } finally {
    await browser?.close()
  }
}
