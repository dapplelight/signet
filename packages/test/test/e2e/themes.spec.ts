import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { applyTheme, expectAcrossThemes, MODES, seed, signInAs, THEMES } from "../../src/playwright"

// Baselines live in __screenshots__/linux, rendered by CI.
const LINUX_ONLY =
  "screenshot baselines are Linux-only (rendered in CI); comparison skipped on this OS"

// The real token stylesheets, served raw: each theme's CSS variables (and its
// .dark block) drive a small page, so the screenshots differ per theme and mode.
const THEMES_DIR = join(import.meta.dirname, "../../../tokens/src/themes")
const PAGE = `<!doctype html><html><head><script>
  const t = new URLSearchParams(location.search).get("theme") || "editorial";
  document.write('<link rel="stylesheet" href="/themes/' + t + '.css">');
</script><style>
  body { margin: 0; padding: 24px; background: var(--background); color: var(--foreground); font: 16px sans-serif }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px }
  .btn { display: inline-block; margin-top: 12px; padding: 8px 16px; background: var(--primary); color: var(--primary-fg); border-radius: var(--radius-md) }
  .cat { display: inline-block; width: 24px; height: 24px; margin-left: 8px; vertical-align: middle; background: var(--money-credit, var(--muted)) }
</style></head><body><div class="card">Signet <span class="cat"></span><br><span class="btn">Pay</span></div>
<p id="who"></p></body></html>`

let seeded: unknown = null
let extraCss = ""
let origin = ""
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x")
  if (url.pathname.startsWith("/themes/")) {
    res.setHeader("content-type", "text/css")
    return res.end(readFileSync(join(THEMES_DIR, url.pathname.slice(8)), "utf8"))
  }
  if (url.pathname === "/__signet/seed") {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      seeded = JSON.parse(body)
      res.setHeader("content-type", "application/json")
      res.end('{"ok":true}')
    })
    return
  }
  res.setHeader("content-type", "text/html")
  res.end(PAGE.replace("</style>", `${extraCss}</style>`))
})
test.beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => server.close())

async function serve(page: Page, css = "") {
  extraCss = css
  await page.goto(`${origin}/`)
}

test("matches the stored baselines in every theme and mode", async ({ page }) => {
  test.skip(process.platform !== "linux", LINUX_ONLY)
  await serve(page)
  await expectAcrossThemes(page, "card")
})

test("a visual change fails", async ({ page }) => {
  test.skip(process.platform !== "linux", LINUX_ONLY)
  test.fail()
  await serve(page, ".btn { padding: 20px 40px }")
  await expectAcrossThemes(page, "card")
})

test("each theme and mode looks different", async ({ page }) => {
  await serve(page)
  const shots = new Set<string>()
  for (const theme of THEMES)
    for (const mode of MODES) {
      await applyTheme(page, theme, mode)
      shots.add((await page.screenshot()).toString("base64"))
    }
  expect(shots.size).toBe(THEMES.length * MODES.length)
})

test("signInAs sets the session cookie; seed posts to the app", async ({ page }) => {
  await serve(page)
  await signInAs(page, "user_1", {
    session: { cookieName: "app_session", secret: "s".repeat(32) },
  })
  const [cookie] = await page.context().cookies()
  expect(cookie?.name).toBe("app_session")
  expect(cookie?.httpOnly).toBe(true)
  const payload = JSON.parse(
    Buffer.from(String(cookie?.value).split(".")[0], "base64url").toString(),
  )
  expect(payload.sub).toBe("user_1")
  expect(await seed(page, { invoices: [1, 2] }, { path: `${origin}/__signet/seed` })).toEqual({
    ok: true,
  })
  expect(seeded).toEqual({ invoices: [1, 2] })
})
