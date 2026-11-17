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
  setDefaultTimeout(ms: number): void
}

const str = (s: Step, k: string) => String(s[k])

/** Runs one step against the page. Throws with what went wrong. */
async function run(page: Page, base: string, s: Step) {
  const t = { timeout: STEP_MS }
  switch (s.do) {
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

/** Plays the hidden test in a fresh browser context against the app at `base`. */
export async function runHidden(base: string, steps: Step[]): Promise<HiddenResult> {
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
        await run(page, base, s)
      } catch (e) {
        const why = e instanceof Error ? (e.message.split("\n")[0] ?? "error") : String(e)
        return { pass: false, failure: `step ${i + 1} (${s.do}): ${why}` }
      }
    return { pass: true }
  } finally {
    await browser.close()
  }
}
