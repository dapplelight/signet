/**
 * DOM rendering checks for @dapplelight/signet-ui: real components mounted in
 * happy-dom and driven through testing-library, the way an app uses them.
 * test/ui.tsx stays DOM-free on purpose (it checks the no-window fallbacks),
 * so this file runs in its own process.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

// testing-library reads `document` when it loads, so everything that touches
// the DOM is imported after happy-dom is registered.
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { useState } = await import("react")
const { AnswerHeadline, answerText } = await import("../src/components/ui/answer-headline")
const { Button } = await import("../src/components/ui/button")
const { Checkbox } = await import("../src/components/ui/checkbox")
const { DataTable } = await import("../src/components/ui/data-table")
const { Dialog, DialogContent, DialogTitle, DialogTrigger } = await import(
  "../src/components/ui/dialog"
)
const { EmptyState } = await import("../src/components/ui/empty-state")
const { ErrorState } = await import("../src/components/ui/error-state")
const { Pagination } = await import("../src/components/ui/pagination")
const { PillGroup } = await import("../src/components/ui/pill-group")
const {
  MASKED_PERCENT,
  MASKED_VALUE,
  MaskToggle,
  maskPercentText,
  PrivacyMaskProvider,
  RatioFill,
  RatioProgress,
  RatioText,
  usePrivacyMask,
} = await import("../src/components/ui/privacy-mask")
const { ResponsiveSheet } = await import("../src/components/ui/responsive-sheet")
const { SearchInput } = await import("../src/components/ui/search-input")
const { StatStrip } = await import("../src/components/ui/stat-strip")
const { Switch } = await import("../src/components/ui/switch")
const { Tabs, TabsContent, TabsList, TabsTrigger } = await import("../src/components/ui/tabs")
const { ThemeProvider } = await import("../src/components/ui/theme-provider")
const { ThemeToggle } = await import("../src/components/ui/theme-toggle")
const { useMediaQuery } = await import("../src/hooks/use-media-query")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean) => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n))
}

/** Runs one case with a clean DOM and storage, and reports a throw as a failure. */
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (e) {
    ok(`${name} (threw: ${(e as Error).message.split("\n")[0]})`, false)
  } finally {
    cleanup()
    localStorage.clear()
  }
}

/** A controllable window.matchMedia: every query answers `matches`, and `set` fires change. */
function stubMedia(matches: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>()
  const mql = {
    matches,
    media: "",
    onchange: null,
    addEventListener: (_: string, f: (e: { matches: boolean }) => void) => listeners.add(f),
    removeEventListener: (_: string, f: (e: { matches: boolean }) => void) => listeners.delete(f),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }
  window.matchMedia = (() => mql) as unknown as typeof window.matchMedia
  return {
    set(m: boolean) {
      mql.matches = m
      for (const f of listeners) f({ matches: m })
    },
    listeners,
  }
}

// --- useMediaQuery ---
await t("useMediaQuery", () => {
  const media = stubMedia(false)
  function Probe() {
    return <span data-testid="mq">{String(useMediaQuery("(min-width: 768px)"))}</span>
  }
  const { unmount } = render(<Probe />)
  ok("useMediaQuery: reads the initial match", screen.getByTestId("mq").textContent === "false")
  act(() => media.set(true))
  ok("useMediaQuery: follows a change event", screen.getByTestId("mq").textContent === "true")
  unmount()
  ok("useMediaQuery: removes its listener on unmount", media.listeners.size === 0)
})

// --- ResponsiveSheet ---
await t("ResponsiveSheet phone", async () => {
  stubMedia(false)
  let closed = 0
  render(
    <ResponsiveSheet title="Add goal" description="Name it" onClose={() => closed++} testId="s">
      <input aria-label="Name" />
    </ResponsiveSheet>,
  )
  const body = screen.getByTestId("s")
  ok("ResponsiveSheet: a Drawer below md", body.dataset.sheet === "drawer")
  ok("ResponsiveSheet: title and description render", !!screen.getByText("Add goal"))
  ok("ResponsiveSheet: description renders", !!screen.getByText("Name it"))
  ok("ResponsiveSheet: children render inside", !!within(body).getByLabelText("Name"))
  await userEvent.keyboard("{Escape}")
  ok("ResponsiveSheet: Escape on the Drawer calls onClose", closed === 1)
})

await t("ResponsiveSheet desktop", async () => {
  stubMedia(true)
  let closed = 0
  render(
    <ResponsiveSheet title="Edit goal" onClose={() => closed++} testId="s">
      <p>form</p>
    </ResponsiveSheet>,
  )
  ok("ResponsiveSheet: a Dialog from md up", screen.getByTestId("s").dataset.sheet === "dialog")
  ok(
    "ResponsiveSheet: the Dialog is labelled by its title",
    !!screen.getByRole("dialog", { name: "Edit goal" }),
  )
  ok(
    "ResponsiveSheet: no description element when none given",
    !document.querySelector("[data-slot=dialog-description]"),
  )
  await userEvent.keyboard("{Escape}")
  ok("ResponsiveSheet: Escape on the Dialog calls onClose", closed === 1)
})

await t("ResponsiveSheet custom query", () => {
  stubMedia(false)
  render(
    <ResponsiveSheet title="T" onClose={() => {}} testId="s" desktopQuery="(min-width: 1px)">
      x
    </ResponsiveSheet>,
  )
  ok(
    "ResponsiveSheet: desktopQuery is what gets asked",
    screen.getByTestId("s").dataset.sheet === "drawer",
  )
})

// --- privacy mask ---
ok(
  "maskPercentText: replaces every percentage, signed or spaced",
  maskPercentText("Savings rate 73% · +12.5% vs Jul · −4 % dip · 1,200%") ===
    `Savings rate ${MASKED_PERCENT} · ${MASKED_PERCENT} vs Jul · ${MASKED_PERCENT} dip · ${MASKED_PERCENT}`,
)
ok("maskPercentText: leaves plain numbers", maskPercentText("7 payments due") === "7 payments due")

await t("usePrivacyMask outside a provider", async () => {
  let seen: ReturnType<typeof usePrivacyMask> | undefined
  function Probe() {
    seen = usePrivacyMask()
    return null
  }
  render(<Probe />)
  ok("usePrivacyMask: unmasked outside a provider", seen?.masked === false)
  ok(
    "usePrivacyMask: setters are no-ops outside a provider",
    (seen?.toggle(), seen?.setMasked(true), true),
  )
  render(<MaskToggle />)
  await userEvent.click(screen.getByRole("button", { name: "Hide values" }))
  ok(
    "MaskToggle: outside a provider it stays unmasked",
    !!screen.getByRole("button", { name: "Hide values" }),
  )
})

await t("MaskToggle + persistence", async () => {
  render(
    <PrivacyMaskProvider storageKey="app-mask">
      <MaskToggle shortcut="h" />
      <RatioText>{"Budget 92% used"}</RatioText>
    </PrivacyMaskProvider>,
  )
  const btn = screen.getByRole("button", { name: "Hide values" })
  ok("MaskToggle: 44px on phone (icon-touch)", btn.className.includes("size-11"))
  ok("MaskToggle: shortcut in the title", btn.getAttribute("title") === "Hide values (h)")
  await userEvent.click(btn)
  ok("MaskToggle: flips to Show values", !!screen.getByRole("button", { name: "Show values" }))
  ok("PrivacyMaskProvider: masked is stored as 1", localStorage.getItem("app-mask") === "1")
  ok(
    "RatioText: masks its percentage",
    document.body.textContent?.includes(`Budget ${MASKED_PERCENT} used`) === true,
  )
  await userEvent.click(screen.getByRole("button", { name: "Show values" }))
  ok("PrivacyMaskProvider: unmasking removes the key", localStorage.getItem("app-mask") === null)
})

await t("PrivacyMaskProvider reads storage", () => {
  localStorage.setItem("app-mask", "1")
  render(
    <PrivacyMaskProvider storageKey="app-mask">
      <MaskToggle hideLabel="Hide amounts" showLabel="Show amounts" />
    </PrivacyMaskProvider>,
  )
  ok(
    "PrivacyMaskProvider: starts from the stored choice",
    !!screen.getByRole("button", { name: "Show amounts" }),
  )
})

await t("PrivacyMaskProvider default key and storageKey=false", async () => {
  const { unmount } = render(
    <PrivacyMaskProvider>
      <MaskToggle />
    </PrivacyMaskProvider>,
  )
  await userEvent.click(screen.getByRole("button", { name: "Hide values" }))
  ok(
    "PrivacyMaskProvider: default key is signet-privacy-mask",
    localStorage.getItem("signet-privacy-mask") === "1",
  )
  unmount()
  localStorage.clear()
  render(
    <PrivacyMaskProvider storageKey={false}>
      <MaskToggle />
    </PrivacyMaskProvider>,
  )
  await userEvent.click(screen.getByRole("button", { name: "Hide values" }))
  ok(
    "PrivacyMaskProvider: storageKey=false masks without storing",
    !!screen.getByRole("button", { name: "Show values" }) && localStorage.length === 0,
  )
})

await t("PrivacyMaskProvider with throwing storage", async () => {
  const proto = Object.getPrototypeOf(localStorage)
  const { getItem, setItem } = proto
  proto.getItem = () => {
    throw new Error("blocked")
  }
  proto.setItem = () => {
    throw new Error("blocked")
  }
  try {
    render(
      <PrivacyMaskProvider>
        <MaskToggle />
      </PrivacyMaskProvider>,
    )
    await userEvent.click(screen.getByRole("button", { name: "Hide values" }))
    ok(
      "PrivacyMaskProvider: blocked storage still masks this tab",
      !!screen.getByRole("button", { name: "Show values" }),
    )
  } finally {
    proto.getItem = getItem
    proto.setItem = setItem
  }
})

await t("PrivacyMaskProvider controlled", async () => {
  const changes: boolean[] = []
  function App() {
    const [masked, setMasked] = useState(false)
    return (
      <PrivacyMaskProvider
        masked={masked}
        onMaskedChange={(m) => {
          changes.push(m)
          setMasked(m)
        }}
      >
        <MaskToggle />
      </PrivacyMaskProvider>
    )
  }
  render(<App />)
  await userEvent.click(screen.getByRole("button", { name: "Hide values" }))
  ok("controlled: onMaskedChange gets the next value", changes.join() === "true")
  ok(
    "controlled: the app's state drives the toggle",
    !!screen.getByRole("button", { name: "Show values" }),
  )
  ok("controlled: nothing written to storage", localStorage.length === 0)
  cleanup()
  const stuck: boolean[] = []
  render(
    <PrivacyMaskProvider masked={false} onMaskedChange={(m) => stuck.push(m)}>
      <MaskToggle />
    </PrivacyMaskProvider>,
  )
  await userEvent.click(screen.getByRole("button", { name: "Hide values" }))
  ok(
    "controlled: an app that ignores the change stays unmasked",
    stuck.join() === "true" && !!screen.getByRole("button", { name: "Hide values" }),
  )
})

await t("Ratio primitives", () => {
  const { container, unmount } = render(
    <PrivacyMaskProvider masked>
      <RatioText>{"Groceries budget is 92% used"}</RatioText>
      <RatioProgress value={87} aria-label="budget" />
      <RatioFill pct={63} className="bar" />
    </PrivacyMaskProvider>,
  )
  const html = container.innerHTML
  ok(
    "Ratio*: masked text shows ••%",
    container.textContent?.includes(`is ${MASKED_PERCENT} used`) === true,
  )
  ok(
    "Ratio*: the real ratios never reach the DOM",
    !html.includes("92") && !html.includes("87") && !html.includes("63"),
  )
  ok(
    "RatioFill: masked width is 0%",
    (container.querySelector(".bar") as HTMLElement).style.width === "0%",
  )
  ok(
    "RatioFill: marked data-masked",
    (container.querySelector(".bar") as HTMLElement).dataset.masked === "true",
  )
  unmount()
  const open = render(
    <PrivacyMaskProvider masked={false}>
      <RatioText>{"92% used"}</RatioText>
      <RatioFill pct={63} className="bar" as="span" />
    </PrivacyMaskProvider>,
  )
  ok("Ratio*: unmasked text is untouched", open.container.textContent === "92% used")
  const bar = open.container.querySelector(".bar") as HTMLElement
  ok("RatioFill: unmasked width is the ratio", bar.style.width === "63%" && bar.tagName === "SPAN")
  ok("RatioFill: no data-masked when unmasked", bar.dataset.masked === undefined)
})

// --- StatStrip ---
const stats = [
  { label: "Spent", value: "₹41,760", meta: "88% of budget", tone: "warn" as const },
  { label: "Savings rate", value: "73%", meta: "up from last month", tone: "good" as const },
  { label: "Bills", value: "7" },
]

await t("StatStrip layouts", () => {
  const { container, rerender } = render(<StatStrip items={stats} isDesktop />)
  const grid = container.querySelector("[data-slot=stat-strip]") as HTMLElement
  ok(
    "StatStrip: desktop is a grid",
    grid.dataset.layout === "grid" && grid.className.includes("grid-cols-3"),
  )
  ok("StatStrip: one card per stat", grid.children.length === 3)
  ok(
    "StatStrip: tones colour the meta line",
    !!container.querySelector("[data-tone=warn].text-accent-amber") &&
      !!container.querySelector("[data-tone=good].text-accent-green"),
  )
  ok("StatStrip: no meta line without meta", container.querySelectorAll("[data-tone]").length === 2)
  rerender(<StatStrip items={stats} isDesktop={false} />)
  const rows = container.querySelector("[data-slot=stat-strip]") as HTMLElement
  ok("StatStrip: phone is a dl of rows", rows.tagName === "DL" && rows.dataset.layout === "rows")
  ok(
    "StatStrip: phone rows pair each label with its value",
    [...rows.querySelectorAll("dt")].map((d) => d.firstChild?.textContent).join() ===
      "Spent,Savings rate,Bills" &&
      [...rows.querySelectorAll("dd")].map((d) => d.textContent).join() === "₹41,760,73%,7",
  )
  rerender(<StatStrip items={[...stats, { label: "Due", value: "2" }]} isDesktop />)
  ok(
    "StatStrip: four stats go 2-up then 4-up",
    (container.querySelector("[data-slot=stat-strip]") as HTMLElement).className.includes(
      "lg:grid-cols-4",
    ),
  )
})

await t("StatStrip follows the breakpoint", () => {
  const media = stubMedia(false)
  const { container } = render(<StatStrip items={stats} />)
  const layout = () =>
    (container.querySelector("[data-slot=stat-strip]") as HTMLElement).dataset.layout
  ok("StatStrip: no isDesktop means phone below md", layout() === "rows")
  act(() => media.set(true))
  ok("StatStrip: and the grid from md up", layout() === "grid")
})

await t("StatStrip masked", () => {
  const { container } = render(
    <PrivacyMaskProvider masked>
      <StatStrip items={stats} isDesktop />
    </PrivacyMaskProvider>,
  )
  ok("StatStrip: masked percentages in value and meta", !/\d+%/.test(container.textContent ?? ""))
  ok(
    "StatStrip: masked keeps non-percent text",
    container.textContent?.includes(`${MASKED_PERCENT} of budget`) === true,
  )
})

// --- AnswerHeadline ---
const headline = {
  question: "Can we still spend?",
  sentence: ["Yes. ", { value: 41760 }, " is free, 41% of income."],
  detail: ["Rent of ", { value: 25000 }, " is due Friday."],
  tone: "neutral" as const,
}

await t("AnswerHeadline", () => {
  const { container, rerender } = render(<AnswerHeadline headline={headline} />)
  const section = screen.getByRole("region", { name: "Can we still spend?" })
  ok("AnswerHeadline: a region named by its question", section.dataset.tone === "neutral")
  const sentence = container.querySelector("[data-slot=answer-headline-sentence]") as HTMLElement
  ok(
    "AnswerHeadline: values render bold with the default format",
    sentence.querySelector("strong")?.textContent === (41760).toLocaleString(),
  )
  ok(
    "AnswerHeadline: detail line renders",
    container.querySelector("[data-slot=answer-headline-detail]")?.textContent ===
      `Rent of ${(25000).toLocaleString()} is due Friday.`,
  )
  rerender(
    <AnswerHeadline
      headline={{ ...headline, tone: "warn", detail: undefined }}
      renderValue={(n) => <span data-testid="v">₹{n}</span>}
    >
      <button type="button">Period</button>
    </AnswerHeadline>,
  )
  ok(
    "AnswerHeadline: renderValue renders each value",
    screen.getAllByTestId("v")[0]?.textContent === "₹41760",
  )
  ok(
    "AnswerHeadline: warn is amber, never red",
    (
      container.querySelector("[data-slot=answer-headline-sentence]") as HTMLElement
    ).className.includes("text-accent-amber") && !container.innerHTML.includes("accent-red"),
  )
  ok(
    "AnswerHeadline: no detail element without detail",
    !container.querySelector("[data-slot=answer-headline-detail]"),
  )
  ok(
    "AnswerHeadline: children render under the sentence",
    !!screen.getByRole("button", { name: "Period" }),
  )
})

await t("AnswerHeadline masked", () => {
  const { container } = render(
    <PrivacyMaskProvider masked>
      <AnswerHeadline headline={headline} />
    </PrivacyMaskProvider>,
  )
  const sentence = container.querySelector("[data-slot=answer-headline-sentence]") as HTMLElement
  ok(
    "AnswerHeadline: masked sentence hides values and percentages",
    sentence.textContent === `Yes. ${MASKED_VALUE} is free, ${MASKED_PERCENT} of income.`,
  )
  ok("AnswerHeadline: masked values never reach the DOM", !/41|760|25/.test(container.innerHTML))
})

ok(
  "answerText: plain text with a format",
  answerText(headline.sentence, (n) => `₹${n}`) === "Yes. ₹41760 is free, 41% of income.",
)
ok(
  "answerText: default format is the locale's",
  answerText([{ value: 1200 }]) === (1200).toLocaleString(),
)

// --- existing components, driven through the DOM ---
await t("Button", async () => {
  let clicks = 0
  render(
    <>
      <Button onClick={() => clicks++}>Save</Button>
      <Button disabled onClick={() => clicks++}>
        Off
      </Button>
    </>,
  )
  await userEvent.click(screen.getByRole("button", { name: "Save" }))
  await userEvent.click(screen.getByRole("button", { name: "Off" }))
  ok("Button: click fires, disabled does not", clicks === 1)
})

await t("Dialog", async () => {
  render(
    <Dialog>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogTitle>Delete goal?</DialogTitle>
      </DialogContent>
    </Dialog>,
  )
  ok("Dialog: closed until triggered", !screen.queryByRole("dialog"))
  await userEvent.click(screen.getByRole("button", { name: "Open" }))
  ok(
    "Dialog: trigger opens it, labelled by its title",
    !!screen.getByRole("dialog", { name: "Delete goal?" }),
  )
  ok("Dialog: ships a close button", !!screen.getByRole("button", { name: "Close" }))
  await userEvent.keyboard("{Escape}")
  await act(() => new Promise((r) => setTimeout(r, 0)))
  ok("Dialog: Escape closes it", !screen.queryByRole("dialog"))
})

await t("Switch", async () => {
  const seen: boolean[] = []
  render(<Switch aria-label="Alerts" onCheckedChange={(c) => seen.push(c)} />)
  const sw = screen.getByRole("switch", { name: "Alerts" })
  ok("Switch: starts unchecked", sw.getAttribute("aria-checked") === "false")
  await userEvent.click(sw)
  ok(
    "Switch: click checks it",
    sw.getAttribute("aria-checked") === "true" && seen.join() === "true",
  )
})

await t("Checkbox", async () => {
  render(<Checkbox aria-label="Select row" />)
  const box = screen.getByRole("checkbox", { name: "Select row" })
  await userEvent.click(box)
  ok("Checkbox: click checks it", box.getAttribute("aria-checked") === "true")
})

await t("Tabs", async () => {
  render(
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">Month</TabsTrigger>
        <TabsTrigger value="b">Year</TabsTrigger>
      </TabsList>
      <TabsContent value="a">month view</TabsContent>
      <TabsContent value="b">year view</TabsContent>
    </Tabs>,
  )
  const year = screen.getByRole("tab", { name: "Year" })
  ok(
    "Tabs: default tab selected",
    screen.getByRole("tab", { name: "Month" }).getAttribute("aria-selected") === "true",
  )
  await userEvent.click(year)
  ok("Tabs: click selects", year.getAttribute("aria-selected") === "true")
  ok("Tabs: its panel shows", screen.getByRole("tabpanel").textContent === "year view")
})

await t("PillGroup", async () => {
  function Pills() {
    const [v, setV] = useState("")
    return (
      <PillGroup
        value={v}
        onChange={setV}
        options={[
          { value: "", label: "All" },
          { value: "food", label: "Food" },
        ]}
      />
    )
  }
  render(<Pills />)
  await userEvent.click(screen.getByRole("button", { name: "Food" }))
  ok(
    "PillGroup: the chosen pill is active, with ink text (AA on its tint)",
    screen.getByRole("button", { name: "Food" }).getAttribute("aria-pressed") === "true" &&
      screen.getByRole("button", { name: "Food" }).className.includes("text-text-primary"),
  )
  ok(
    "PillGroup: the others are not",
    screen.getByRole("button", { name: "All" }).className.includes("text-text-muted"),
  )
})

await t("Pagination", async () => {
  const pages: number[] = []
  const { container, rerender } = render(
    <Pagination page={1} totalPages={1} onPageChange={(p) => pages.push(p)} />,
  )
  ok("Pagination: one page renders nothing", container.innerHTML === "")
  rerender(<Pagination page={1} totalPages={3} onPageChange={(p) => pages.push(p)} />)
  ok(
    "Pagination: previous disabled on page 1",
    (screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled,
  )
  await userEvent.click(screen.getByRole("button", { name: "Next page" }))
  rerender(<Pagination page={3} totalPages={3} onPageChange={(p) => pages.push(p)} />)
  ok(
    "Pagination: next disabled on the last page",
    (screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled,
  )
  ok("Pagination: next asks for page 2", pages.join() === "2")
})

await t("SearchInput", async () => {
  render(<SearchInput placeholder="Search" />)
  const input = screen.getByPlaceholderText("Search") as HTMLInputElement
  await userEvent.type(input, "rent")
  ok("SearchInput: typing fills the input", input.value === "rent" && input.type === "text")
})

await t("EmptyState and ErrorState", async () => {
  let retries = 0
  render(
    <>
      <EmptyState
        title="No goals yet"
        description="Add one"
        action={<button type="button">Add</button>}
      />
      <ErrorState message="Network down" onRetry={() => retries++} />
    </>,
  )
  ok(
    "EmptyState: title, description and action render",
    !!screen.getByText("No goals yet") &&
      !!screen.getByText("Add one") &&
      !!screen.getByRole("button", { name: "Add" }),
  )
  ok(
    "ErrorState: is an alert with the message",
    screen.getByRole("alert").textContent?.includes("Network down") === true,
  )
  await userEvent.click(screen.getByRole("button", { name: "Try again" }))
  ok("ErrorState: Try again calls onRetry", retries === 1)
})

await t("DataTable", async () => {
  const clicked: string[] = []
  const { rerender } = render(
    <DataTable
      columns={[
        { accessorKey: "name", header: "Name" },
        { accessorKey: "total", header: "Total" },
      ]}
      data={[
        { name: "Rent", total: 25000 },
        { name: "Food", total: 8000 },
      ]}
      onRowClick={(r) => clicked.push(r.name)}
      getRowLabel={(r) => `Open ${r.name}`}
    />,
  )
  ok("DataTable: headers render", !!screen.getByRole("columnheader", { name: "Name" }))
  const rows = screen.getAllByRole("row").slice(1) // header row + 2 data rows
  ok(
    "DataTable: clickable rows keep the row role, are focusable, and are named",
    rows.length === 2 &&
      rows.every((r) => r.tabIndex === 0) &&
      rows.map((r) => r.getAttribute("aria-label")).join() === "Open Rent,Open Food",
  )
  fireEvent.click(screen.getByText("Food"))
  ok("DataTable: row click passes the item", clicked.join() === "Food")
  rows[0]?.focus()
  await userEvent.keyboard("{Enter}")
  ok("DataTable: Enter on a focused row activates it", clicked.join() === "Food,Rent")
  ok(
    "DataTable: a header's name is its label alone, not its resize handle's",
    !!screen.getByRole("columnheader", { name: "Total" }) &&
      !!screen.getByRole("separator", { name: "Resize column total" }),
  )
  rerender(
    <DataTable columns={[{ accessorKey: "name", header: "Name" }]} data={[{ name: "Rent" }]} />,
  )
  ok(
    "DataTable: rows without onRowClick keep the row role",
    screen.getAllByRole("row").length === 2,
  )
  rerender(
    <DataTable
      columns={[{ accessorKey: "name", header: "Name" }]}
      data={[]}
      emptyMessage="Nothing here"
    />,
  )
  ok("DataTable: empty data shows the message", !!screen.getByText("Nothing here"))
})

await t("ThemeToggle", async () => {
  stubMedia(false)
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  )
  ok(
    "ThemeToggle: system checked by default",
    screen.getByRole("radio", { name: "System" }).getAttribute("aria-checked") === "true",
  )
  await userEvent.click(screen.getByRole("radio", { name: "Dark" }))
  ok(
    "ThemeToggle: Dark applies .dark to <html>",
    document.documentElement.classList.contains("dark"),
  )
  ok("ThemeToggle: and stores the choice", localStorage.getItem("signet-theme") === "dark")
  await userEvent.click(screen.getByRole("radio", { name: "Light" }))
  ok("ThemeToggle: Light removes .dark", !document.documentElement.classList.contains("dark"))
})

console.log(`\n${pass} passed, ${fail} failed`)
await GlobalRegistrator.unregister()
if (fail) throw new Error(`${fail} failed`)
