// signet-ui's RichTextEditor in real Chromium: every toolbar command and
// shortcut goes through Tiptap and lands in the markdown value; pasted HTML
// and unsafe links are cleaned; @mentions are stored as tokens.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"

const OUT = mkdtempSync(join(tmpdir(), "signet-rte-"))
const HTML = `<!doctype html><html><body><div id="root"></div><script type="module" src="/rich-text-page.js"></script></body></html>`
let origin = ""
const server = createServer((req, res) => {
  if (req.url?.startsWith("/rich-text-page.js")) {
    res.setHeader("content-type", "text/javascript")
    return res.end(readFileSync(join(OUT, "rich-text-page.js")))
  }
  res.setHeader("content-type", "text/html")
  res.end(HTML)
})

test.beforeAll(async () => {
  const built = spawnSync(
    "bun",
    [
      "build",
      join(import.meta.dirname, "rich-text-page.tsx"),
      "--outdir",
      OUT,
      "--target",
      "browser",
      "--production",
    ],
    { encoding: "utf8" },
  )
  if (built.status !== 0) throw new Error(`bun build failed: ${built.stderr || built.error}`)
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => {
  server.close()
  rmSync(OUT, { recursive: true, force: true })
})

const value = (page: Page) => page.locator("#value")
const editor = (page: Page) => page.getByRole("textbox", { name: "Note" })
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true })
const setLink = (page: Page, url: string) =>
  page.evaluate((u) => {
    ;(window as unknown as { __link: string }).__link = u
  }, url)

async function typeIn(page: Page, text: string) {
  await page.goto(origin)
  await editor(page).click()
  await page.keyboard.type(text)
  await expect(value(page)).toHaveText(text)
}

test("marks from the toolbar and shortcuts", async ({ page }) => {
  await typeIn(page, "hello world")
  await page.keyboard.press("ControlOrMeta+a")
  await button(page, "Bold").click()
  await expect(value(page)).toHaveText("**hello world**")
  await expect(button(page, "Bold")).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("ControlOrMeta+b")
  await expect(value(page)).toHaveText("hello world")
  await expect(button(page, "Bold")).toHaveAttribute("aria-pressed", "false")
  await button(page, "Italic").click()
  await expect(value(page)).toHaveText("_hello world_")
  await page.keyboard.press("ControlOrMeta+i")
  await button(page, "Code").click()
  await expect(value(page)).toHaveText("`hello world`")
})

test("blocks from the toolbar", async ({ page }) => {
  await typeIn(page, "title")
  await button(page, "Heading").click()
  await expect(value(page)).toHaveText("## title")
  await button(page, "Subheading").click()
  await expect(value(page)).toHaveText("### title")
  await button(page, "Subheading").click()
  await button(page, "Bulleted list").click()
  await expect(value(page)).toHaveText("- title")
  await expect(button(page, "Bulleted list")).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await page.keyboard.type("next")
  await expect(value(page)).toHaveText("- title\n- next")
  await button(page, "Numbered list").click()
  await expect(value(page)).toHaveText("1. title\n2. next")
})

test("links: safe addresses only", async ({ page }) => {
  await typeIn(page, "docs")
  await page.keyboard.press("ControlOrMeta+a")
  await setLink(page, "javascript:alert(1)")
  await button(page, "Link").click()
  await expect(value(page)).toHaveText("docs")
  await setLink(page, "https://example.com/a")
  await page.keyboard.press("ControlOrMeta+k")
  await expect(value(page)).toHaveText("[docs](https://example.com/a)")
  await expect(editor(page).locator("a")).toHaveAttribute("rel", "noopener noreferrer nofollow")
})

test("paste keeps only allowlisted formatting", async ({ page }) => {
  await typeIn(page, "x")
  const dialogs: string[] = []
  page.on("dialog", (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })
  await editor(page).evaluate((el) => {
    const dt = new DataTransfer()
    dt.setData(
      "text/html",
      '<p><em>pasted</em><script>alert(1)</script><img src=x onerror="alert(2)"> <a href="javascript:alert(3)">bad</a></p>',
    )
    dt.setData("text/plain", "pasted bad")
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  })
  await expect(value(page)).toContainText("_pasted_")
  await expect(editor(page).locator("script, img, a")).toHaveCount(0)
  expect(await value(page).textContent()).not.toMatch(/script|onerror|javascript/)
  expect(dialogs).toEqual([])
})

test("@mentions through the suggestion list", async ({ page }) => {
  await typeIn(page, "hi")
  await page.keyboard.type(" @de")
  const list = page.getByRole("listbox", { name: "People to mention" })
  await expect(list.getByRole("option")).toHaveText(["Dev Patel"])
  await expect(editor(page)).toHaveAttribute("aria-controls", (await list.getAttribute("id")) ?? "")
  await page.keyboard.press("Enter")
  await expect(list).toHaveCount(0)
  await expect(value(page)).toHaveText("hi @[Dev Patel](user:u2)")
})
