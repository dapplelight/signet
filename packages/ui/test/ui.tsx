/**
 * Pure-logic checks for @dapplelight/signet-ui: cn's type ramp, variant classes,
 * exported table features, theme fallbacks. Static rendering only, no DOM.
 */
import type { ColumnDef } from "@tanstack/react-table"
import { renderToStaticMarkup } from "react-dom/server"
import { buttonVariants } from "../src/components/ui/button"
import { Calendar } from "../src/components/ui/calendar"
import {
  CHART_COLORS,
  type ChartConfig,
  ChartContainer,
  ChartStyle,
  ChartTooltipContent,
} from "../src/components/ui/chart"
import { type DataTableFeatures, dataTableFeatures } from "../src/components/ui/data-table"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerSwipeHandle,
  DrawerTitle,
  DrawerTrigger,
} from "../src/components/ui/drawer"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "../src/components/ui/input-otp"
import { syncThemeColorMeta, ThemeProvider, useTheme } from "../src/components/ui/theme-provider"
import { ThemeToggle } from "../src/components/ui/theme-toggle"
import { cn, TYPE_RAMP } from "../src/lib/utils"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean) => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n))
}

// --- cn knows CONTRACT's semantic type ramp ---
ok(
  "size and colour both survive: text-subhead + text-text-primary",
  cn("text-subhead", "text-text-primary") === "text-subhead text-text-primary",
)
ok("later ramp size wins: text-body + text-title", cn("text-body", "text-title") === "text-title")
ok("ramp size overrides a default size", cn("text-sm", "text-headline") === "text-headline")
ok("default size overrides a ramp size", cn("text-hero", "text-xs") === "text-xs")
ok("colours still merge", cn("text-text-muted", "text-text-primary") === "text-text-primary")
ok(
  "every ramp name keeps a colour beside it",
  TYPE_RAMP.every((t) => cn(`text-${t}`, "text-accent-red") === `text-${t} text-accent-red`),
)
ok("ramp has the ten CONTRACT names", TYPE_RAMP.length === 10)

// --- Button touch sizes ---
const touch = buttonVariants({ size: "touch" })
ok("touch is h-11 px-4", touch.includes("h-11") && touch.includes("px-4"))
ok("icon-touch is size-11", buttonVariants({ size: "icon-touch" }).includes("size-11"))
ok("default size unchanged", buttonVariants().includes("h-8"))

// --- data-table features exported ---
ok(
  "dataTableFeatures carries the four features",
  [
    "columnSizingFeature",
    "columnResizingFeature",
    "columnVisibilityFeature",
    "rowSelectionFeature",
  ].every((k) => k in dataTableFeatures),
)
// Type-level: an external column array typed with the exported type.
const cols: ColumnDef<DataTableFeatures, { a: number }, unknown>[] = [{ accessorKey: "a" }]
ok("DataTableFeatures types an external ColumnDef array", cols.length === 1)

// --- Calendar merges month_grid with react-day-picker's default ---
const cal = renderToStaticMarkup(<Calendar mode="single" month={new Date(2026, 0, 1)} />)
ok(
  "month_grid keeps rdp's default class",
  /<table[^>]*class="[^"]*w-full[^"]*rdp-month_grid|<table[^>]*class="[^"]*rdp-month_grid[^"]*w-full/.test(
    cal,
  ),
)

// --- useTheme outside a provider ---
let seen: ReturnType<typeof useTheme> | undefined
function Probe() {
  seen = useTheme()
  return null
}
let threw = false
try {
  renderToStaticMarkup(<Probe />)
} catch {
  threw = true
}
ok("useTheme outside a provider does not throw", !threw)
ok("defaults to system", seen?.theme === "system")
ok("resolves to light with no window", seen?.resolvedTheme === "light")
ok("setter is a no-op", (seen?.setTheme("dark"), seen?.toggleTheme(), true))

// --- theme-color meta sync ---
const meta = {
  content: "#old",
  setAttribute(_k: string, v: string) {
    this.content = v
  },
}
const fakeDoc = (m: typeof meta | null, bg: string) =>
  ({
    querySelector: () => m,
    documentElement: {},
    defaultView: { getComputedStyle: () => ({ getPropertyValue: () => ` ${bg}` }) },
  }) as unknown as Document
syncThemeColorMeta(fakeDoc(meta, "#0d0d0b"))
ok("meta theme-color takes --background", meta.content === "#0d0d0b")
syncThemeColorMeta(fakeDoc(meta, ""))
ok("unset --background leaves meta alone", meta.content === "#0d0d0b")
let safe = true
try {
  syncThemeColorMeta(fakeDoc(null, "#fff"))
  syncThemeColorMeta(undefined)
} catch {
  safe = false
}
ok("no meta tag, or no DOM, is a no-op", safe)

// An app's own themeColor wins over --background, and needs no opt-out.
syncThemeColorMeta(fakeDoc(meta, "#0d0d0b"), "#0b7a5a")
ok("explicit color beats --background", meta.content === "#0b7a5a")
syncThemeColorMeta(fakeDoc(meta, ""), " #2fbf8f ")
ok("explicit color applies with --background unset", meta.content === "#2fbf8f")
syncThemeColorMeta(fakeDoc(meta, "#171714"), "")
ok("empty explicit color falls back to --background", meta.content === "#171714")
syncThemeColorMeta(fakeDoc(meta, "#0d0d0b"), undefined)
ok("no explicit color keeps the old behaviour", meta.content === "#0d0d0b")
let noMetaSafe = true
try {
  syncThemeColorMeta(fakeDoc(null, "#fff"), "#000")
} catch {
  noMetaSafe = false
}
ok("explicit color with no meta tag is a no-op", noMetaSafe)

// The function form is called with the resolved theme. It runs during render,
// so static rendering is enough to see what it was asked for.
const asked: string[] = []
const pick = (t: "light" | "dark") => (asked.push(t), t === "dark" ? "#000" : "#fff")
renderToStaticMarkup(
  <ThemeProvider defaultTheme="dark" themeColor={pick}>
    x
  </ThemeProvider>,
)
renderToStaticMarkup(
  <ThemeProvider defaultTheme="light" themeColor={pick}>
    x
  </ThemeProvider>,
)
ok("themeColor function gets the resolved theme", asked.join() === "dark,light")
asked.length = 0
renderToStaticMarkup(<ThemeProvider themeColor={pick}>x</ThemeProvider>)
ok("system resolves before themeColor is asked (light with no window)", asked.join() === "light")
ok(
  "string themeColor and syncThemeColor={false} still render",
  renderToStaticMarkup(
    <ThemeProvider themeColor="#0b7a5a" syncThemeColor={false}>
      ok
    </ThemeProvider>,
  ) === "ok",
)

// ThemeToggle: icon-only by default (aria-label names each); showLabels renders
// the words visibly, so the aria-label is not duplicated.
{
  const iconOnly = renderToStaticMarkup(<ThemeToggle />)
  ok(
    "icon-only toggle labels each option for screen readers",
    iconOnly.includes('aria-label="Light"') && !iconOnly.includes(">Light<"),
  )
  const labelled = renderToStaticMarkup(<ThemeToggle showLabels />)
  ok(
    "showLabels renders visible words",
    [">Light<", ">Dark<", ">System<"].every((t) => labelled.includes(t)),
  )
  ok("showLabels drops the duplicate aria-label", !labelled.includes('aria-label="Light"'))
}

// --- Drawer ---
// base-ui portals render nothing on the server, so only the parts outside the
// popup are rendered here; the tokens suite compiles the popup's classes.
{
  const d = renderToStaticMarkup(
    <Drawer showSwipeHandle>
      <DrawerTrigger>Open</DrawerTrigger>
      <DrawerHeader>
        <DrawerTitle>Title</DrawerTitle>
        <DrawerDescription>Body</DrawerDescription>
      </DrawerHeader>
      <DrawerFooter>Footer</DrawerFooter>
      <DrawerSwipeHandle />
    </Drawer>,
  )
  ok(
    "drawer parts carry their data-slot",
    [
      "drawer-trigger",
      "drawer-header",
      "drawer-title",
      "drawer-description",
      "drawer-footer",
      "drawer-swipe-handle",
    ].every((s) => d.includes(`data-slot="${s}"`)),
  )
  ok(
    "drawer title and description use text tokens",
    /data-slot="drawer-title" class="[^"]*text-text-primary/.test(d) &&
      /data-slot="drawer-description" class="[^"]*text-text-muted/.test(d),
  )
  ok("drawer trigger is closed by default", d.includes('aria-expanded="false"'))
  let msg = ""
  try {
    renderToStaticMarkup(<DrawerContent />)
  } catch (e) {
    msg = (e as Error).message
  }
  ok("DrawerContent outside a Drawer names the fix", msg.includes("within a Drawer"))
}

// --- InputOTP ---
{
  const otp = renderToStaticMarkup(
    <InputOTP maxLength={4} value="12" onChange={() => {}}>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={2} />
        <InputOTPSlot index={3} />
      </InputOTPGroup>
    </InputOTP>,
  )
  ok(
    "input-otp parts carry their data-slot",
    ["input-otp", "input-otp-group", "input-otp-slot", "input-otp-separator"].every((s) =>
      otp.includes(`data-slot="${s}"`),
    ),
  )
  ok("four slots render", otp.split('data-slot="input-otp-slot"').length - 1 === 4)
  ok("slots show the typed characters", />1<\/div>/.test(otp) && />2<\/div>/.test(otp))
  ok(
    "slots use input and ring tokens",
    /data-slot="input-otp-slot"[^>]*class="[^"]*border-input[^"]*data-\[active=true\]:border-ring/.test(
      otp,
    ),
  )
  ok("no product-only caret keyframe", !otp.includes("animate-caret-blink"))
  ok(
    "separator is hidden from screen readers, not a role",
    /data-slot="input-otp-separator" aria-hidden="true"/.test(otp) &&
      !otp.includes('role="separator"'),
  )
}

// --- Chart: config -> CSS variables ---
{
  ok("six default chart colours", CHART_COLORS.length === 6)
  ok(
    "each default reads --chart-N with a CONTRACT fallback",
    CHART_COLORS.every((c, i) =>
      new RegExp(`^var\\(--chart-${i + 1}, var\\(--color-[a-z-]+\\)\\)$`).test(c),
    ),
  )
  const config: ChartConfig = {
    income: { label: "Income", color: "#123456" },
    spend: { label: "Spend", theme: { light: "#aaa", dark: "#222" } },
    other: { label: "Other" },
  }
  const css = renderToStaticMarkup(<ChartStyle id="c1" config={config} />)
  const light = css.match(/ \[data-chart=c1\] \{([^}]*)\}/)?.[1] ?? ""
  const dark = css.match(/\.dark \[data-chart=c1\] \{([^}]*)\}/)?.[1] ?? ""
  ok("light and dark blocks are scoped to the chart", !!light && !!dark)
  ok(
    "an explicit color is used in both modes",
    light.includes("--color-income: #123456;") && dark.includes("--color-income: #123456;"),
  )
  ok(
    "a theme color differs per mode",
    light.includes("--color-spend: #aaa;") && dark.includes("--color-spend: #222;"),
  )
  ok(
    "an entry with no colour takes the palette slot at its position",
    light.includes(`--color-other: ${CHART_COLORS[2]};`) &&
      dark.includes(`--color-other: ${CHART_COLORS[2]};`),
  )
  const seven = Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => [`s${i}`, { label: `S${i}` }]),
  ) as ChartConfig
  ok(
    "the palette wraps after six",
    renderToStaticMarkup(<ChartStyle id="w" config={seven} />).includes(
      `--color-s6: ${CHART_COLORS[0]};`,
    ),
  )
  ok(
    "an empty config emits no style",
    renderToStaticMarkup(<ChartStyle id="e" config={{}} />) === "",
  )

  const container = renderToStaticMarkup(
    <ChartContainer id="rev" config={config}>
      <div />
    </ChartContainer>,
  )
  ok(
    "container carries data-slot and its chart id",
    container.includes('data-slot="chart"') && container.includes('data-chart="chart-rev"'),
  )
  ok(
    "container styles recharts with CONTRACT tokens",
    ["fill-text-muted", "stroke-border-subtle", "stroke-border-default", "fill-muted"].every((c) =>
      container.includes(c),
    ) && !/muted-foreground|stroke-border\/50/.test(container),
  )
  let msg = ""
  try {
    renderToStaticMarkup(<ChartTooltipContent active payload={[]} />)
  } catch (e) {
    msg = (e as Error).message
  }
  ok("tooltip outside a ChartContainer names the fix", msg.includes("<ChartContainer />"))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) throw new Error(`${fail} failed`)
