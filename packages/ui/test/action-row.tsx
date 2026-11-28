/**
 * ActionRow: tone, parts, className / data-* hooks, the narrow-screen 44px rule.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render } = await import("@testing-library/react")
const { Button } = await import("../src/components/ui/button")
const { ActionRow, ActionRowActions, ActionRowRoot, ActionRowTitle } = await import(
  "../src/components/ui/action-row"
)

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

{
  const { container } = render(
    <ActionRow
      icon={<svg data-testid="ic" />}
      title="Merge PR #482"
      description="CI passed and two people approved."
      actions={<Button>Merge</Button>}
      className="custom"
      data-testid="row"
      classNames={{ title: "t-class", actions: "a-class" }}
    />,
  )
  const root = container.querySelector("[data-slot=action-row]") as HTMLElement
  ok("default tone is neutral", root.dataset.tone === "neutral")
  ok(
    "className and data-* pass through",
    root.classList.contains("custom") && root.dataset.testid === "row",
  )
  ok(
    "group named by the title",
    root.getAttribute("role") === "group" &&
      root.getAttribute("aria-labelledby") ===
        container.querySelector("[data-slot=action-row-title]")?.id,
  )
  ok(
    "per-part classNames",
    container.querySelector("[data-slot=action-row-title]")?.classList.contains("t-class") ===
      true &&
      container.querySelector("[data-slot=action-row-actions]")?.classList.contains("a-class") ===
        true,
  )
  ok(
    "icon is decorative",
    container.querySelector("[data-slot=action-row-icon]")?.getAttribute("aria-hidden") === "true",
  )
  ok(
    "sentence and button render",
    container.textContent?.includes("CI passed and two people approved.") === true &&
      !!container.querySelector("[data-slot=button]"),
  )
  const actions = container.querySelector("[data-slot=action-row-actions]") as HTMLElement
  ok(
    "buttons stack and reach 44px on narrow screens",
    actions.className.includes("flex-col") &&
      actions.className.includes("max-sm:[&_[data-slot=button]]:min-h-11"),
  )
  ok("row goes back to a line from sm up", root.className.includes("sm:flex-row"))
  cleanup()
}
for (const tone of ["ask", "warn"] as const) {
  const { container } = render(<ActionRow tone={tone} title="x" />)
  const root = container.firstElementChild as HTMLElement
  ok(`${tone}: data-tone`, root.dataset.tone === tone)
  ok(`${tone}: never red`, !/red|destructive/.test(root.className))
  if (tone === "warn") ok("warn is amber", root.className.includes("amber"))
  ok(
    `${tone}: no actions part without actions`,
    !container.querySelector("[data-slot=action-row-actions]"),
  )
  cleanup()
}
{
  const { container } = render(
    <ActionRowRoot tone="warn" data-x="1">
      <ActionRowTitle>Approve deploy</ActionRowTitle>
      <ActionRowActions>
        <Button>Approve</Button>
      </ActionRowActions>
    </ActionRowRoot>,
  )
  ok(
    "parts compose on their own",
    container.querySelector("[data-slot=action-row-title]")?.textContent === "Approve deploy" &&
      !!container.querySelector("[data-slot=action-row-actions] [data-slot=button]"),
  )
  cleanup()
}

console.log(`\n${pass} passed, ${fail} failed`)
await GlobalRegistrator.unregister()
if (fail) throw new Error(`${fail} failed`)
