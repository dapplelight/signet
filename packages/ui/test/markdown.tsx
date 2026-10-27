/**
 * Markdown in happy-dom: GFM, heading ids that match the TOC, and the safety
 * rules — no raw HTML, no unsafe URLs, no remote images unless allowed.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen } = await import("@testing-library/react")
const { Markdown, MarkdownToc, markdownToc } = await import("../src/components/ui/markdown")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
function t(name: string, fn: () => void) {
  try {
    fn()
  } catch (e) {
    ok(`${name} (threw: ${(e as Error).message.split("\n")[0]})`, false)
  } finally {
    cleanup()
  }
}

const DOC = `# Senior Engineer

Intro with **bold** and ~~old~~ text.

## Requirements

- [x] TypeScript
- [ ] Rust

## Requirements

| Level | Salary |
| ----- | ------ |
| L5    | 200k   |

### Nice to \`have\`

#### Too deep for the TOC
`

t("gfm and headings", () => {
  const { container } = render(<Markdown>{DOC}</Markdown>)
  const ids = [...container.querySelectorAll("h1,h2,h3,h4")].map((h) => h.id)
  ok(
    "headings get GitHub-style ids; repeats get -1",
    ids.join() === "senior-engineer,requirements,requirements-1,nice-to-have,too-deep-for-the-toc",
    ids,
  )
  ok("tables render", container.querySelector("table td")?.textContent === "L5")
  ok(
    "task lists render disabled checkboxes",
    container.querySelectorAll("input[type=checkbox][disabled]").length === 2,
  )
  ok("strikethrough renders", container.querySelector("del")?.textContent === "old")
  ok(
    "a heading's name is its text alone; the # link beside it has its own",
    !!screen.getByRole("heading", { name: "Senior Engineer", level: 1 }) &&
      !container.querySelector("h1 a") &&
      !!screen.getByRole("link", { name: "Link to Senior Engineer" }),
  )
  ok(
    "the anchor links to its heading",
    JSON.stringify(
      screen
        .getAllByRole("link", { name: "Link to Requirements" })
        .map((a) => a.getAttribute("href")),
    ) === JSON.stringify(["#requirements", "#requirements-1"]),
  )
})

t("toc", () => {
  const toc = markdownToc(DOC)
  ok(
    "markdownToc: ids match the rendered headings, depth <= 3 by default",
    JSON.stringify(toc.map((e) => [e.id, e.depth])) ===
      JSON.stringify([
        ["senior-engineer", 1],
        ["requirements", 2],
        ["requirements-1", 2],
        ["nice-to-have", 3],
      ]),
    toc,
  )
  ok("markdownToc: inline code joins the text", toc[3]?.text === "Nice to have")
  ok("markdownToc: maxDepth", markdownToc(DOC, { maxDepth: 4 }).length === 5)
  ok(
    "markdownToc: idPrefix",
    markdownToc(DOC, { idPrefix: "job-" })[0]?.id === "job-senior-engineer",
  )
  const { container } = render(
    <>
      <MarkdownToc markdown={DOC} idPrefix="a-" activeId="a-requirements" />
      <Markdown idPrefix="a-">{DOC}</Markdown>
    </>,
  )
  const nav = screen.getByRole("navigation", { name: "On this page" })
  const hrefs = [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href")?.slice(1))
  ok(
    "MarkdownToc: every link resolves to a heading on the page",
    hrefs.length === 4 && hrefs.every((h) => !!container.querySelector(`[id="${h}"]`)),
    hrefs,
  )
  ok(
    "MarkdownToc: activeId is aria-current",
    nav.querySelector("[aria-current=location]")?.textContent === "Requirements",
  )
  cleanup()
  const empty = render(<MarkdownToc markdown="just text" />)
  ok("MarkdownToc: no headings, no nav", empty.container.innerHTML === "")
})

t("raw html", () => {
  const evil = `Hello <script>window.__pwned = 1</script> <img src=x onerror="window.__pwned=2"> <b onclick="x()">bold</b>

<iframe src="https://evil.example"></iframe>

<div style="position:fixed">overlay</div>`
  const { container } = render(<Markdown images>{evil}</Markdown>)
  const html = container.innerHTML
  ok(
    "raw HTML: no script, iframe, handlers or inline styles reach the DOM",
    !/<script|<iframe|onerror|onclick|position:fixed/i.test(html),
    html,
  )
  ok("raw HTML: nothing ran", (window as unknown as { __pwned?: number }).__pwned === undefined)
  ok("raw HTML: the surrounding text stays", container.textContent?.includes("Hello") === true)
})

t("links", () => {
  const md = `[js](javascript:alert(1)) [data](data:text/html,<b>x</b>) [vb](vbscript:msgbox) [ext](https://jobs.example/1) [rel](/jobs/2) [mail](mailto:a@b.co)`
  const { container } = render(<Markdown>{md}</Markdown>)
  const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))
  ok(
    "links: javascript:, data: and vbscript: are not links",
    hrefs.join() === "https://jobs.example/1,/jobs/2,mailto:a@b.co",
    hrefs,
  )
  ok(
    "links: an unsafe link keeps its text",
    ["js", "data", "vb"].every((w) => container.textContent?.includes(w)),
  )
  const ext = container.querySelector('a[href^="https"]')
  ok(
    "links: external opens a new tab, noopener noreferrer nofollow",
    ext?.getAttribute("target") === "_blank" &&
      ext?.getAttribute("rel") === "noopener noreferrer nofollow",
  )
  ok(
    "links: relative stays in the tab",
    !container.querySelector('a[href="/jobs/2"]')?.hasAttribute("target"),
  )
})

t("images", () => {
  const md = `![Company logo](https://tracker.example/pixel.png) ![](https://cdn.example/a.png) ![x](javascript:alert(1))`
  const off = render(<Markdown>{md}</Markdown>)
  ok(
    "images: off by default, nothing is fetched",
    off.container.querySelectorAll("img").length === 0,
  )
  ok(
    "images: alt text shows instead",
    [...off.container.querySelectorAll("[data-slot=markdown-image-blocked]")]
      .map((s) => s.textContent)
      .join() === "[Company logo],[image],[x]",
  )
  cleanup()
  const on = render(<Markdown images>{md}</Markdown>)
  const srcs = [...on.container.querySelectorAll("img")].map((i) => i.getAttribute("src"))
  ok(
    "images=true: allowed URLs render, unsafe ones still do not",
    srcs.join() === "https://tracker.example/pixel.png,https://cdn.example/a.png",
    srcs,
  )
  cleanup()
  const some = render(
    <Markdown images={(src) => src.startsWith("https://cdn.example/")}>{md}</Markdown>,
  )
  ok(
    "images=fn: decided per URL",
    [...some.container.querySelectorAll("img")].map((i) => i.getAttribute("src")).join() ===
      "https://cdn.example/a.png",
  )
})

t("anchors off", () => {
  const { container } = render(<Markdown headingAnchors={false}>{"## A"}</Markdown>)
  ok(
    "headingAnchors=false: id kept, no # link",
    container.querySelector("h2")?.id === "a" && !container.querySelector("h2 a"),
  )
})

console.log(`\n${pass} passed, ${fail} failed`)
await GlobalRegistrator.unregister()
if (fail) throw new Error(`${fail} failed`)
