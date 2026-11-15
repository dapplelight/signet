/**
 * MetricHeadline: the trend rule, its copy, parts, data-* and the privacy mask.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render } = await import("@testing-library/react")
const { PrivacyMaskProvider } = await import("../src/components/ui/privacy-mask")
const { MetricHeadline, MetricHeadlineRoot, MetricHeadlineValue, metricSentence, metricTrend } =
  await import("../src/components/ui/metric-headline")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

// the rule
ok(
  "up 18%",
  metricSentence({ current: 118, previous: 100 }, { label: "Signups" }) ===
    "Signups up 18% this week",
)
ok(
  "down",
  metricSentence({ current: 80, previous: 100 }, { label: "Orders", period: "today" }) ===
    "Orders down 20% today",
)
ok("flat within 1%", metricTrend({ current: 1005, previous: 1000 }).direction === "flat")
ok(
  "flatWithin widens it",
  metricTrend({ current: 104, previous: 100 }, { flatWithin: 5 }).direction === "flat",
)
ok("no previous is new", metricTrend({ current: 5, previous: 0 }).direction === "new")
ok("nothing at all is flat", metricTrend({ current: 0, previous: null }).direction === "flat")
ok("up is good by default", metricTrend({ current: 2, previous: 1 }).tone === "good")
ok(
  "goodWhen down: up is warn",
  metricTrend({ current: 2, previous: 1 }, { goodWhen: "down" }).tone === "warn",
)

// rendering
{
  const { container } = render(
    <MetricHeadline
      result={{ current: 1240, previous: 1050 }}
      label="Signups"
      className="custom"
      data-testid="mh"
      classNames={{ value: "v-class" }}
    />,
  )
  const root = container.querySelector("[data-slot=metric-headline]") as HTMLElement
  ok(
    "root carries data-direction and data-tone",
    root.dataset.direction === "up" && root.dataset.tone === "good",
  )
  ok(
    "className and data-* pass through",
    root.classList.contains("custom") && root.dataset.testid === "mh",
  )
  ok("aria-label is the sentence", root.getAttribute("aria-label") === "Signups up 18% this week")
  const value = container.querySelector("[data-slot=metric-headline-value]") as HTMLElement
  ok(
    "value formatted",
    value.textContent === (1240).toLocaleString() && value.classList.contains("v-class"),
  )
  ok(
    "trend part, green when good",
    container
      .querySelector("[data-slot=metric-headline-trend]")
      ?.className.includes("text-accent-green") === true,
  )
  cleanup()
}
{
  const { container } = render(
    <MetricHeadline
      result={{ current: 3, previous: 6 }}
      label="Errors"
      goodWhen="down"
      copy={{ down: (c) => `${c.label} fell ${c.percent} ${c.period}`, trend: () => "" }}
    />,
  )
  ok("copy overrides", container.textContent?.includes("Errors fell 50% this week") === true)
  ok(
    "empty trend copy hides the trend part",
    !container.querySelector("[data-slot=metric-headline-trend]"),
  )
  ok(
    "down is good when goodWhen=down",
    (container.firstElementChild as HTMLElement).dataset.tone === "good",
  )
  cleanup()
}
{
  const { container } = render(
    <PrivacyMaskProvider masked>
      <MetricHeadline result={{ current: 1240, previous: 1050 }} label="Revenue" />
    </PrivacyMaskProvider>,
  )
  ok(
    "masked: value hidden",
    !container.textContent?.includes("1,240") && container.textContent?.includes("••••••") === true,
  )
  ok("masked: percent hidden", !container.textContent?.includes("18%"))
  ok(
    "masked: aria-label hides it too",
    !container.firstElementChild?.getAttribute("aria-label")?.includes("18%"),
  )
  cleanup()
}
{
  const { container } = render(
    <MetricHeadlineRoot data-x="1">
      <MetricHeadlineValue>42</MetricHeadlineValue>
    </MetricHeadlineRoot>,
  )
  ok(
    "parts compose on their own",
    container.querySelector("[data-slot=metric-headline-value]")?.textContent === "42",
  )
  cleanup()
}

console.log(`\n${pass} passed, ${fail} failed`)
await GlobalRegistrator.unregister()
if (fail) throw new Error(`${fail} failed`)
