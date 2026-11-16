/**
 * `signet check --pages`: a screenshot and an axe run for each page at the two
 * Agent QA viewports. Playwright and axe-core are the app's own (resolved from
 * its package.json); the CLI depends on neither.
 */

import { mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, relative } from "node:path"
import type { Finding } from "./check-conventions.js"
import { type AxeViolation, axeScript, QA_VIEWPORTS } from "./qa.js"

const READY_MS = 15_000
export const SHOTS_DIR = ".signet/check"

type Page = {
  goto(url: string, o: object): Promise<unknown>
  screenshot(o: object): Promise<unknown>
  evaluate(script: string): Promise<unknown>
}
type Browser = {
  newContext(o: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }>
  close(): Promise<void>
}

const fail = (file: string | null, rule: string, message: string, fix: string): Finding => ({
  file,
  line: null,
  rule,
  level: "error",
  message,
  fix,
})

const INSTALL = "bunx playwright install chromium"
const slug = (page: string) => page.replace(/^\/+|\/+$/g, "").replace(/[^\w-]+/g, "-") || "index"

/** `/dashboard` against `web`; a full URL stays as it is. The finding's `file` is the page as given. */
export const pageUrl = (page: string, web: string) =>
  /^https?:\/\//.test(page) ? page : new URL(page, web).href

export async function checkPages(
  root: string,
  pages: string[],
  web: string,
): Promise<{ findings: Finding[]; screenshots: string[] }> {
  const findings: Finding[] = []
  const screenshots: string[] = []
  const appRequire = createRequire(join(root, "package.json"))

  let chromium: { launch(): Promise<Browser> }
  try {
    chromium = (appRequire("@playwright/test") as { chromium: typeof chromium }).chromium
  } catch {
    return {
      findings: [
        fail(
          null,
          "pages/playwright",
          "Playwright is not installed in this app.",
          `bun add -d @playwright/test, then ${INSTALL}`,
        ),
      ],
      screenshots,
    }
  }
  let axeSource: string
  try {
    axeSource = readFileSync(appRequire.resolve("axe-core/axe.min.js"), "utf8")
  } catch {
    return {
      findings: [
        fail(
          null,
          "pages/axe-core",
          "axe-core is not installed in this app.",
          "bun add -d axe-core",
        ),
      ],
      screenshots,
    }
  }
  let browser: Browser
  try {
    browser = await chromium.launch()
  } catch (e) {
    const why = e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e)
    return {
      findings: [fail(null, "pages/browser", `Could not start a browser: ${why}`, INSTALL)],
      screenshots,
    }
  }

  mkdirSync(join(root, SHOTS_DIR), { recursive: true })
  try {
    for (const page of pages) {
      const seen = new Set<string>()
      for (const vp of QA_VIEWPORTS) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
        })
        try {
          const p = await context.newPage()
          await p.goto(pageUrl(page, web), { waitUntil: "load", timeout: READY_MS })
          const path = join(root, SHOTS_DIR, `${slug(page)}__${vp.name}.png`)
          await p.screenshot({ path, fullPage: true, animations: "disabled" })
          screenshots.push(relative(root, path))
          for (const v of (await p.evaluate(axeScript(axeSource))) as AxeViolation[]) {
            if (seen.has(v.id)) continue // the same rule at the other viewport is one finding
            seen.add(v.id)
            findings.push(
              fail(
                page,
                `axe/${v.id}`,
                `${v.description} (${v.nodes.length} element${v.nodes.length === 1 ? "" : "s"}, ${vp.name})`,
                v.help,
              ),
            )
          }
        } catch (e) {
          const why = e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e)
          findings.push(
            fail(
              page,
              "pages/unreachable",
              `Could not load ${pageUrl(page, web)} (${vp.name}): ${why}`,
              "Start the app's dev server and pass its address with --web <url>.",
            ),
          )
          break // the other viewport would fail the same way
        } finally {
          await context.close()
        }
      }
    }
  } finally {
    await browser.close()
  }
  return { findings, screenshots }
}
