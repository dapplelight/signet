/**
 * Page blocks: each root carries data-block and takes className; loading shows
 * skeletons, error shows a retry; the dashboard has its empty state; the list
 * filters, pages and moves with the arrow keys; settings saves only after a
 * change and deletes only after the workspace name is typed.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register({
  settings: { disableJavaScriptFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
})
// recharts measures its container with ResizeObserver
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const { cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { AnalyticsDashboard } = await import("../src/blocks/analytics-dashboard/index")
const { SAMPLE_DASHBOARD } = await import("../src/blocks/analytics-dashboard/sample")
const { SAMPLE_ITEMS } = await import("../src/blocks/list-detail/sample")
const { ListDetail } = await import("../src/blocks/list-detail/index")
const { Settings } = await import("../src/blocks/settings/index")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (e) {
    ok(`${name} (threw: ${(e as Error).message.split("\n")[0]})`, false)
  } finally {
    cleanup()
  }
}
const root = (block: string) => document.querySelector(`[data-block=${block}]`)

await t("analytics-dashboard: root hooks, parts and the Overview title", () => {
  render(<AnalyticsDashboard data={SAMPLE_DASHBOARD} className="mine" />)
  const el = root("analytics-dashboard")
  ok("data-block and className on the root", !!el?.classList.contains("mine"))
  ok("title", !!screen.getByText("Overview"))
  ok(
    "chart and table titles",
    screen.getAllByText("Visitors").length > 0 && !!screen.getByText("Recent activity"),
  )
})

await t("analytics-dashboard: empty data shows the empty state", () => {
  render(<AnalyticsDashboard data={{ stats: [], series: [], rows: [] }} />)
  ok("No data yet", !!screen.getByText("No data yet"))
})

await t("analytics-dashboard: loading shows skeletons, error shows a retry", async () => {
  const { unmount } = render(<AnalyticsDashboard state="loading" />)
  ok("loading status", !!screen.getByRole("status", { name: "Loading overview" }))
  unmount()
  let retried = 0
  render(<AnalyticsDashboard state="error" onRetry={() => retried++} />)
  await userEvent.click(screen.getByRole("button", { name: /try again|retry/i }))
  ok("onRetry called", retried === 1, retried)
})

await t(
  "list-detail: shows 20 rows, filters, and clears filters from the empty result",
  async () => {
    render(<ListDetail items={SAMPLE_ITEMS} />)
    const rows = () => document.querySelectorAll("ul[aria-label=Projects] button")
    ok("20 rows on the first page", rows().length === 20, rows().length)
    ok("nothing selected on the desktop shows the prompt", !!screen.getByText(/Select a project/))
    await userEvent.type(screen.getByLabelText("Search projects"), "zzzz-no-such-project")
    await waitFor(() => screen.getByText("No matches"))
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    await waitFor(() => rows().length === 20 || Promise.reject())
    ok("clearing brings the rows back", rows().length === 20)
  },
)

await t("list-detail: a row is a button, selecting sets aria-current, arrows move", async () => {
  render(<ListDetail items={SAMPLE_ITEMS} />)
  const rowEls = () => document.querySelectorAll<HTMLElement>("ul[aria-label=Projects] button")
  const first = rowEls()[0] as HTMLElement
  ok("row is a button", first.tagName === "BUTTON")
  await userEvent.click(first)
  ok("aria-current on the selected row", first.getAttribute("aria-current") === "true")
  await userEvent.keyboard("{ArrowDown}")
  const second = rowEls()[1] as HTMLElement
  ok("focus moved to the next row", document.activeElement === second)
})

await t("settings: Save is disabled until a value changes, then toasts via onSave", async () => {
  const saved: unknown[] = []
  render(<Settings onSaveGeneral={(v) => void saved.push(v)} />)
  const general = within(document.querySelector("[data-slot=settings-general]") as HTMLElement)
  const save = general.getByRole("button", { name: "Save changes" }) as HTMLButtonElement
  ok("disabled at first", save.disabled)
  await userEvent.type(general.getByLabelText("Workspace name"), " Two")
  ok("enabled after an edit", !save.disabled)
  await userEvent.click(save)
  await waitFor(() => saved.length === 1 || Promise.reject())
  ok("onSaveGeneral got the values", (saved[0] as { name: string }).name.endsWith(" Two"))
})

await t("settings: an empty name shows a field error and does not save", async () => {
  const saved: unknown[] = []
  render(<Settings onSaveGeneral={(v) => void saved.push(v)} />)
  const general = within(document.querySelector("[data-slot=settings-general]") as HTMLElement)
  await userEvent.clear(general.getByLabelText("Workspace name"))
  await userEvent.click(general.getByRole("button", { name: "Save changes" }))
  ok("error text", !!(await screen.findByText("Enter a workspace name.")))
  ok("not saved", saved.length === 0)
})

await t("settings: Delete stays disabled until the workspace name is typed", async () => {
  let deleted = 0
  render(<Settings onDelete={() => void deleted++} />)
  await userEvent.click(screen.getByRole("button", { name: "Delete workspace" }))
  const dialog = within(await screen.findByRole("alertdialog"))
  ok(
    "body names the workspace",
    !!dialog.getByText(/Delete Acme Studio\?/) && !!dialog.getByText(/cannot be undone/),
  )
  const del = dialog.getByRole("button", { name: "Delete" }) as HTMLButtonElement
  ok("disabled", del.disabled)
  await userEvent.type(dialog.getByRole("textbox"), "Acme Studio")
  ok("enabled once typed", !del.disabled)
  await userEvent.click(del)
  await waitFor(() => deleted === 1 || Promise.reject())
  ok("onDelete ran", deleted === 1)
})

await t("settings: forms take the real values when they arrive after loading", async () => {
  const real = { name: "Real Co", description: "Real description." }
  const { rerender } = render(<Settings state="loading" />)
  rerender(
    <Settings
      state="ready"
      general={real}
      notifications={{ emailUpdates: false, weeklySummary: true }}
    />,
  )
  const general = within(document.querySelector("[data-slot=settings-general]") as HTMLElement)
  ok(
    "name is the real one",
    (general.getByLabelText("Workspace name") as HTMLInputElement).value === "Real Co",
  )
  ok(
    "Save is disabled, nothing differs",
    (general.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
  )
  rerender(<Settings state="ready" general={{ ...real }} />)
  await userEvent.type(general.getByLabelText("Workspace name"), "X")
  rerender(<Settings state="ready" general={{ ...real }} />)
  ok(
    "an equal object does not wipe an edit",
    (general.getByLabelText("Workspace name") as HTMLInputElement).value === "Real CoX",
  )
})

await t("settings: loading and error states", async () => {
  const { unmount } = render(<Settings state="loading" />)
  ok("loading status", !!screen.getByRole("status", { name: "Loading settings" }))
  unmount()
  render(<Settings state="error" />)
  ok("error message", !!screen.getByText("We could not load your settings."))
  ok("data-block", !!root("settings"))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
