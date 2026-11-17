import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "./browser"
import type { Step } from "./types"

const STEP_MS = 5000
const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")

// The few Playwright members the steps use, so this file needs no Playwright types.
type Loc = {
  first(): Loc
  click(o: { timeout: number }): Promise<void>
  fill(v: string, o: { timeout: number }): Promise<void>
  waitFor(o: { state: "visible" | "hidden"; timeout: number }): Promise<void>
  count(): Promise<number>
}
type Page = {
  goto(url: string, o: { timeout: number }): Promise<unknown>
  getByRole(role: string, o: { name?: RegExp }): Loc
  getByLabel(label: RegExp): Loc
  getByText(text: RegExp): Loc
  waitForEvent(
    e: "download",
    o: { timeout: number },
  ): Promise<{
    createReadStream(): Promise<NodeJS.ReadableStream | null>
    path(): Promise<string | null>
  }>
  route(
    url: string,
    handler: (route: {
      fulfill(o: { status: number; contentType: string; body: string }): Promise<void>
    }) => Promise<void>,
  ): Promise<void>
  setDefaultTimeout(ms: number): void
}

/** Source files under <app>/src with one of the comma-separated extensions, as [path, text]. */
function sourceFiles(app: string, ext: string): [string, string][] {
  const want = ext.split(",").map((e) => `.${e.trim()}`)
  const dir = join(app, "src")
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => want.some((e) => f.endsWith(e)))
    .map((f): [string, string] => [f, readFileSync(join(dir, f), "utf8")])
}

const str = (s: Step, k: string) => String(s[k])

/** Runs one step against the page. Throws with what went wrong. */
async function run(page: Page, base: string, app: string, s: Step) {
  const t = { timeout: STEP_MS }
  switch (s.do) {
    case "mockApi": {
      // Answers every request to this path from now on; a later mockApi for the same path replaces it.
      const delay = typeof s.delayMs === "number" ? s.delayMs : 0
      await page.route(`**${str(s, "path")}`, async (route) => {
        if (delay) await Bun.sleep(delay)
        await route.fulfill({
          status: Number(s.status),
          contentType: typeof s.type === "string" ? s.type : "application/json",
          body: str(s, "body"),
        })
      })
      return
    }
    case "sourceForbids": {
      const rx = new RegExp(str(s, "pattern"))
      const hit = sourceFiles(app, typeof s.ext === "string" ? s.ext : "tsx,jsx,ts,js")
        .map(([f, text]) => [f, rx.exec(text)?.[0]] as const)
        .find(([, m]) => m)
      if (hit) throw new Error(`src/${hit[0]} contains "${hit[1]}", which the task forbids`)
      return
    }
    case "goto":
      await page.goto(base + str(s, "path"), t)
      return
    case "http": {
      const r = await fetch(base + str(s, "path"))
      if (r.status !== s.status)
        throw new Error(`GET ${s.path} gave ${r.status}, wanted ${s.status}`)
      if (typeof s.contains === "string" && !(await r.text()).includes(s.contains))
        throw new Error(`GET ${s.path} body lacks "${s.contains}"`)
      return
    }
    case "click":
      return page
        .getByRole(str(s, "role"), { name: rx(str(s, "name")) })
        .first()
        .click(t)
    case "fill":
      return page
        .getByLabel(rx(str(s, "label")))
        .first()
        .fill(str(s, "value"), t)
    case "expectText":
      return page
        .getByText(rx(str(s, "text")))
        .first()
        .waitFor({ state: "visible", ...t })
    case "expectNoText":
      return page
        .getByText(rx(str(s, "text")))
        .first()
        .waitFor({ state: "hidden", ...t })
    case "expectRole":
      return page
        .getByRole(str(s, "role"), { name: rx(str(s, "name")) })
        .first()
        .waitFor({ state: "visible", ...t })
    case "expectCount": {
      const loc = page.getByRole(str(s, "role"), {})
      const end = Date.now() + STEP_MS
      let n = await loc.count()
      while (n < Number(s.min) && Date.now() < end) {
        await Bun.sleep(100)
        n = await loc.count()
      }
      if (n < Number(s.min)) throw new Error(`found ${n} ${s.role} elements, wanted ${s.min}`)
      return
    }
    case "download": {
      const [dl] = await Promise.all([
        page.waitForEvent("download", t),
        page
          .getByRole(str(s, "role"), { name: rx(str(s, "name")) })
          .first()
          .click(t),
      ])
      const file = await dl.path()
      const text = file ? await Bun.file(file).text() : ""
      if (!text.includes(str(s, "contains"))) throw new Error(`download lacks "${s.contains}"`)
      return
    }
    default:
      throw new Error(`unknown step ${s.do}`)
  }
}

export type HiddenResult = { pass: boolean; failure?: string }

/** Plays the hidden test in a fresh browser context against the app at `base`. `app` is the app folder, for source checks. */
export async function runHidden(base: string, steps: Step[], app: string): Promise<HiddenResult> {
  const browser = await chromium().launch()
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
    })
    const page = (await context.newPage()) as Page
    page.setDefaultTimeout(STEP_MS)
    for (const [i, s] of steps.entries())
      try {
        await run(page, base, app, s)
      } catch (e) {
        const why = e instanceof Error ? (e.message.split("\n")[0] ?? "error") : String(e)
        return { pass: false, failure: `step ${i + 1} (${s.do}): ${why}` }
      }
    return { pass: true }
  } finally {
    await browser.close()
  }
}
