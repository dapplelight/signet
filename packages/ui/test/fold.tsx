/**
 * Fold: closed by default, opens in place, announces its state, Markdown body,
 * controlled and uncontrolled, copy and per-part overrides.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { Fold, FoldBody, FoldRoot, FoldToggle } = await import("../src/components/ui/fold")
const { LabelsProvider } = await import("../src/lib/labels")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
  } catch (e) {
    ok(`${name} (threw: ${(e as Error).message.split("\n")[0]})`, false)
  } finally {
    cleanup()
  }
}

const TEXT = "Intro line.\n\n- first **bold** item\n- second item"

await t("closed by default: row visible, body empty", () => {
  const { container } = render(
    <Fold title="Builder notes" detail="12 lines, written by the builder">
      {TEXT}
    </Fold>,
  )
  const btn = screen.getByRole("button", { name: "Show more" })
  ok("aria-expanded false", btn.getAttribute("aria-expanded") === "false")
  ok("title and detail", !!screen.getByText("Builder notes") && !!screen.getByText(/12 lines/))
  ok(
    "data-state closed",
    container.querySelector("[data-slot=fold]")?.getAttribute("data-state") === "closed",
  )
  const body = container.querySelector("[data-slot=fold-body]") as HTMLElement
  ok("body hidden and empty", body.hidden && body.textContent === "")
  ok("aria-controls points at the body", btn.getAttribute("aria-controls") === body.id)
})

await t("click opens in place, renders Markdown, says Show less", async () => {
  const user = userEvent.setup()
  const { container } = render(<Fold title="Notes">{TEXT}</Fold>)
  await user.click(screen.getByRole("button", { name: "Show more" }))
  const btn = screen.getByRole("button", { name: "Show less" })
  ok("aria-expanded true", btn.getAttribute("aria-expanded") === "true")
  ok("markdown list rendered", container.querySelectorAll("[data-slot=fold-body] li").length === 2)
  ok("bold rendered", !!container.querySelector("[data-slot=fold-body] strong"))
  ok(
    "no dialog or popup",
    !container.querySelector("[role=dialog]") && !document.querySelector("[role=dialog]"),
  )
  ok(
    "body capped near 66ch",
    (container.querySelector("[data-slot=fold-body]") as HTMLElement).className.includes(
      "max-w-[66ch]",
    ),
  )
  await user.click(btn)
  ok(
    "closes again",
    screen.getByRole("button", { name: "Show more" }).getAttribute("aria-expanded") === "false",
  )
})

await t("keyboard: Enter and Space toggle", async () => {
  const user = userEvent.setup()
  render(<Fold title="Notes">{TEXT}</Fold>)
  screen.getByRole("button").focus()
  await user.keyboard("{Enter}")
  ok("Enter opens", screen.getByRole("button").getAttribute("aria-expanded") === "true")
  await user.keyboard(" ")
  ok("Space closes", screen.getByRole("button").getAttribute("aria-expanded") === "false")
})

await t("controlled and defaultOpen", async () => {
  const user = userEvent.setup()
  const seen: boolean[] = []
  render(
    <Fold title="A" open onOpenChange={(o) => seen.push(o)}>
      {TEXT}
    </Fold>,
  )
  await user.click(screen.getByRole("button"))
  ok(
    "controlled stays open, reports the request",
    seen[0] === false && screen.getByRole("button").getAttribute("aria-expanded") === "true",
  )
  cleanup()
  render(
    <Fold title="B" defaultOpen>
      {TEXT}
    </Fold>,
  )
  ok("defaultOpen", screen.getByRole("button").getAttribute("aria-expanded") === "true")
})

await t("copy: prop, LabelsProvider", () => {
  render(
    <Fold title="A" showMoreLabel="Read on">
      {TEXT}
    </Fold>,
  )
  ok("prop label", !!screen.getByRole("button", { name: "Read on" }))
  cleanup()
  render(
    <LabelsProvider labels={{ showMore: "और दिखाएँ" }}>
      <Fold title="A">{TEXT}</Fold>
    </LabelsProvider>,
  )
  ok("labels provider", !!screen.getByRole("button", { name: "और दिखाएँ" }))
})

await t("className, classNames and data-*", () => {
  const { container } = render(
    <Fold
      title="A"
      detail="d"
      className="x-root"
      classNames={{ title: "x-title", detail: "x-detail", toggle: "x-toggle", body: "x-body" }}
    >
      {TEXT}
    </Fold>,
  )
  const has = (slot: string, c: string) =>
    container.querySelector(`[data-slot=${slot}]`)?.className.includes(c)
  ok(
    "classes land on parts",
    !!has("fold", "x-root") &&
      !!has("fold-title", "x-title") &&
      !!has("fold-detail", "x-detail") &&
      !!has("fold-toggle", "x-toggle") &&
      !!has("fold-body", "x-body"),
  )
})

await t("parts compose; a part outside the root throws", () => {
  render(
    <FoldRoot defaultOpen>
      <FoldToggle>Custom</FoldToggle>
      <FoldBody>plain</FoldBody>
    </FoldRoot>,
  )
  ok(
    "custom toggle text and body",
    !!screen.getByRole("button", { name: "Custom" }) && !!screen.getByText("plain"),
  )
  cleanup()
  const orig = console.error
  console.error = () => {}
  let threw = false
  try {
    render(<FoldToggle />)
  } catch {
    threw = true
  }
  console.error = orig
  ok("throws outside the root", threw)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
