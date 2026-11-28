/**
 * LogoStack: the 4-mark cap, "+N", alt names, lightTile, size, parts and hooks.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render } = await import("@testing-library/react")
const { LogoStack, LogoStackMark, LogoStackRoot } = await import("../src/components/ui/logo-stack")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const names = ["Acme Labs", "Globex", "Initech", "Umbrella Co", "Hooli", "Stark"]
const marks = names.map((alt, i) => ({ src: `/m${i}.png`, alt, lightTile: i === 1 }))
const q = (c: HTMLElement, sel: string) => Array.from(c.querySelectorAll<HTMLElement>(sel))

{
  const { container } = render(<LogoStack marks={marks} className="custom" data-testid="row" />)
  const root = container.firstElementChild as HTMLElement
  ok("shows 4 marks and a +2 mark", q(container, "[data-logo-mark]").length === 4)
  const more = q(container, "[data-slot=logo-stack-more]")
  ok("+N counts the rest", more.length === 1 && more[0]?.textContent === "+2")
  ok("+N has an accessible name", more[0]?.getAttribute("aria-label") === "2 more")
  ok(
    "className and data-* pass through",
    root.classList.contains("custom") && root.dataset.testid === "row",
  )
  ok("marks overlap", root.className.includes("-space-x-2"))
  const first = q(container, "[data-logo-mark]")[0] as HTMLElement
  ok(
    "square, 5px, 2px ring in the page colour",
    first.className.includes("rounded-[5px]") &&
      first.className.includes("ring-2") &&
      first.className.includes("ring-background") &&
      !first.className.includes("rounded-full"),
  )
  ok(
    "more mark shares the ring",
    more[0]?.className.includes("ring-background") === true &&
      more[0]?.className.includes("rounded-[5px]") === true,
  )
  const imgs = q(container, "img")
  ok(
    "each mark takes src and alt",
    imgs.length === 4 && imgs.every((i, n) => i.getAttribute("alt") === names[n]),
  )
  ok(
    "initials stand in until the image loads",
    q(container, "[data-logo-mark]")[0]?.textContent === "AL",
  )
  cleanup()
}
{
  const { container } = render(<LogoStack marks={marks} />)
  const tiles = q(container, "[data-logo-mark]").map((m) => m.dataset.lightTile === "true")
  ok("lightTile only on the mark that asks", tiles.join() === "false,true,false,false")
  const second = q(container, "[data-logo-mark]")[1] as HTMLElement
  ok("lightTile is a light tile in dark mode", second.className.includes("dark:bg-white"))
  ok(
    "no tile unless asked",
    !(q(container, "[data-logo-mark]")[0] as HTMLElement).className.includes("dark:bg-white"),
  )
  cleanup()
}
{
  const { container } = render(<LogoStack marks={marks.slice(0, 4)} />)
  ok("exactly 4: no +N", q(container, "[data-slot=logo-stack-more]").length === 0)
  cleanup()
}
{
  const { container } = render(<LogoStack marks={[]} />)
  ok("empty: renders nothing inside", container.firstElementChild?.children.length === 0)
  cleanup()
}
{
  const { container } = render(
    <LogoStack
      marks={marks}
      max={2}
      size="lg"
      moreLabel={(n) => `${n} other projects`}
      classNames={{ mark: "m-class", more: "x-class" }}
    />,
  )
  ok("max sets the cap", q(container, "[data-logo-mark]").length === 2)
  ok("+N follows max", q(container, "[data-slot=logo-stack-more]")[0]?.textContent === "+4")
  ok(
    "moreLabel",
    q(container, "[data-slot=logo-stack-more]")[0]?.getAttribute("aria-label") ===
      "4 other projects",
  )
  ok(
    "size reaches marks and +N",
    (q(container, "[data-logo-mark]")[0] as HTMLElement).className.includes("size-10") &&
      (q(container, "[data-slot=logo-stack-more]")[0] as HTMLElement).className.includes("size-10"),
  )
  ok(
    "classNames per part",
    (q(container, "[data-logo-mark]")[0] as HTMLElement).classList.contains("m-class") &&
      (q(container, "[data-slot=logo-stack-more]")[0] as HTMLElement).classList.contains("x-class"),
  )
  cleanup()
}
{
  const { container } = render(
    <LogoStackRoot data-x="1">
      <LogoStackMark src="/a.png" alt="Acme Labs" />
    </LogoStackRoot>,
  )
  ok(
    "parts compose on their own",
    q(container, "[data-slot=logo-stack] [data-logo-mark]").length === 1,
  )
  cleanup()
}

console.log(`\n${pass} passed, ${fail} failed`)
await GlobalRegistrator.unregister()
if (fail) throw new Error(`${fail} failed`)
