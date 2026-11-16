// Visual QA runner (dev-only, never published): `bun run qa`. See CONTRIBUTING.md, "Visual QA".
// Builds apps/showcase, serves dist on 127.0.0.1 (random port, nothing else), then for every QA item x theme
// x mode x viewport opens qa.html, takes a full-page PNG, runs axe and records console errors and overflow.
// Playwright comes from packages/test (it pins the version); axe-core is the one root devDependency.
import { mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, relative, resolve, sep } from "node:path"
import { QA_ITEMS, QA_MODES } from "../../apps/showcase/src/qa-items"
import type { Browser } from "../../packages/test/node_modules/@playwright/test"

const ROOT = resolve(import.meta.dir, "../..")
const SHOWCASE = join(ROOT, "apps/showcase")
const THEMES = ["editorial", "cinematic", "finance"]
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]
const AXE_TAGS = ["wcag2a", "wcag2aa", "best-practice"]
const READY_MS = 15_000
const USAGE = "Usage: bun run qa [--quick] [--filter <id>] [--out <dir>] [--concurrency N]"

type Entry = {
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

function fail(code: number, msg: string): never {
  console.error(msg)
  process.exit(code)
}

function parseArgs(argv: string[]) {
  const o = { quick: false, filter: "", out: "qa-out", concurrency: 4 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    const value = () => argv[++i]
    if (a === "--quick") o.quick = true
    else if (a === "--filter") o.filter = value() ?? fail(2, `Unknown flag ${a}. ${USAGE}`)
    else if (a === "--out") o.out = value() ?? fail(2, `Unknown flag ${a}. ${USAGE}`)
    else if (a === "--concurrency") {
      const n = Number(value())
      if (!Number.isInteger(n) || n < 1) fail(2, `Unknown flag ${a}. ${USAGE}`)
      o.concurrency = n
    } else fail(2, `Unknown flag ${a}. ${USAGE}`)
  }
  return o
}

/** Static file server for the built showcase. Bound to 127.0.0.1 only; paths cannot leave dist. */
function serve(dist: string) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname)
      const file = resolve(dist, `.${path === "/" ? "/index.html" : path}`)
      if (file !== dist && !file.startsWith(dist + sep))
        return new Response("Not found", { status: 404 })
      const f = Bun.file(file)
      return f.size ? new Response(f) : new Response("Not found", { status: 404 })
    },
  })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const items = QA_ITEMS.filter((i) => i.id.includes(opts.filter))
  if (!items.length) {
    console.log(`No QA items match "${opts.filter}".`)
    for (const i of QA_ITEMS) console.log(i.id)
    process.exit(1)
  }
  const themes = opts.quick ? THEMES.slice(0, 1) : THEMES
  const modes = opts.quick ? QA_MODES.slice(0, 1) : QA_MODES

  console.log("Building showcase…")
  const build = Bun.spawnSync(["bun", "run", "build"], {
    cwd: SHOWCASE,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (build.exitCode !== 0) {
    const tail = `${build.stdout}${build.stderr}`.trim().split("\n").slice(-8).join("\n")
    fail(1, `QA failed: showcase build exited ${build.exitCode}\n${tail}`)
  }
  const server = serve(join(SHOWCASE, "dist"))
  const base = `http://127.0.0.1:${server.port}`
  console.log(`Serving ${base}`)

  const rootRequire = createRequire(import.meta.url)
  const axeSource = readFileSync(rootRequire.resolve("axe-core/axe.min.js"), "utf8")
  const { chromium } = createRequire(join(ROOT, "packages/test/package.json"))("@playwright/test")

  const jobs = items.flatMap((item) =>
    themes.flatMap((theme) =>
      modes.flatMap((mode) => VIEWPORTS.map((vp) => ({ item: item.id, theme, mode, vp }))),
    ),
  )
  console.log(
    `${jobs.length} shots: ${items.length} items x ${themes.length} x ${modes.length} x 2 viewports, concurrency ${opts.concurrency}`,
  )

  let browser: Browser
  try {
    browser = await chromium.launch()
  } catch (e) {
    server.stop(true)
    fail(
      1,
      `QA failed: browser launch failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`,
    )
  }

  const runDir = join(resolve(opts.out), new Date().toISOString().replace(/[:.]/g, "-"))
  mkdirSync(join(runDir, "shots"), { recursive: true })
  mkdirSync(join(runDir, "axe"), { recursive: true })

  const entries: Entry[] = new Array(jobs.length)
  let next = 0
  let done = 0

  async function shot({ item, theme, mode, vp }: (typeof jobs)[number]): Promise<Entry> {
    const name = `${item}__${theme}__${mode}__${vp.name}`
    const entry: Entry = {
      item,
      theme,
      mode,
      viewport: vp.name,
      png: null,
      axe: null,
      violations: 0,
      consoleErrors: [],
      overflow: false,
      error: null,
    }
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    try {
      const page = await context.newPage()
      page.on("console", (m) => m.type() === "error" && entry.consoleErrors.push(m.text()))
      page.on("pageerror", (e) => entry.consoleErrors.push(e.message))
      await page.goto(
        `${base}/qa.html?item=${encodeURIComponent(item)}&theme=${theme}&mode=${mode}`,
      )
      await page.waitForFunction(
        () => (window as { __qaReady?: boolean }).__qaReady === true,
        null,
        {
          timeout: READY_MS,
        },
      )
      entry.overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )
      await page.screenshot({
        path: join(runDir, "shots", `${name}.png`),
        fullPage: true,
        animations: "disabled",
      })
      entry.png = `shots/${name}.png`
      await page.evaluate(axeSource)
      const results = await page.evaluate(
        (tags) =>
          (
            window as unknown as {
              axe: {
                run: (c: Document, o: object) => Promise<{ violations: { nodes: unknown[] }[] }>
              }
            }
          ).axe.run(document, { runOnly: { type: "tag", values: tags } }),
        AXE_TAGS,
      )
      entry.violations = results.violations.length
      await Bun.write(
        join(runDir, "axe", `${name}.json`),
        JSON.stringify({ tags: AXE_TAGS, violations: results.violations }, null, 2),
      )
      entry.axe = `axe/${name}.json`
    } catch (e) {
      entry.error = e instanceof Error ? (e.message.split("\n")[0] ?? "error") : String(e)
    } finally {
      await context.close()
    }
    return entry
  }

  async function worker() {
    while (next < jobs.length) {
      const i = next++
      const job = jobs[i] as (typeof jobs)[number]
      const e = await shot(job)
      entries[i] = e
      done++
      const flag = e.violations || e.consoleErrors.length || e.overflow || e.error ? " !" : ""
      const tail = e.error ? `  error ${e.error}` : ""
      console.log(
        `[${done}/${jobs.length}] ${e.item}__${e.theme}__${e.mode}__${e.viewport}  axe ${e.violations}  console ${e.consoleErrors.length}  overflow ${e.overflow ? "yes" : "no"}${tail}${flag}`,
      )
    }
  }

  await Promise.all(Array.from({ length: Math.min(opts.concurrency, jobs.length) }, worker))
  await browser.close()
  server.stop(true)

  const manifest = join(runDir, "manifest.json")
  await Bun.write(manifest, JSON.stringify({ axeTags: AXE_TAGS, shots: entries }, null, 2))
  const sum = (f: (e: Entry) => number) => entries.reduce((n, e) => n + f(e), 0)
  console.log(`Wrote ${relative(process.cwd(), manifest)}`)
  console.log(
    `${sum((e) => e.violations)} axe violations, ${sum((e) => e.consoleErrors.length)} console errors, ${sum((e) => +e.overflow)} overflow across ${entries.length} shots`,
  )
  if (entries.every((e) => e.error))
    fail(1, `QA failed: every shot errored (first: ${entries[0]?.error})`)
}

await main().catch((e) => fail(1, `QA failed: ${e instanceof Error ? e.message : e}`))
