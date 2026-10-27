/**
 * DataTable at scale, in happy-dom: virtual rows, facet and text filters with
 * counts, sorting, saved views, server-side mode and the active row.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { useState } = await import("react")
const { DataTable, EMPTY_VIEW } = await import("../src/components/ui/data-table")
type DataTableView = import("../src/components/ui/data-table").DataTableView
type ColumnDef = import("@tanstack/react-table").ColumnDef<
  import("../src/components/ui/data-table").DataTableFeatures,
  Job,
  unknown
>

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

type Job = {
  id: string
  title: string
  company: string
  status: string
  tags: string[]
  score: number
}
const STATUSES = ["new", "applied", "rejected"] as const
const jobs: Job[] = Array.from({ length: 10_000 }, (_, i) => ({
  id: `j${i}`,
  title: `Engineer ${i}`,
  company: i % 10 === 0 ? "Acme" : `Co ${i % 7}`,
  status: STATUSES[i % 3] as string,
  tags: i % 2 ? ["remote"] : ["onsite", "visa"],
  score: (i * 37) % 101,
}))
const columns: ColumnDef[] = [
  { accessorKey: "title", header: "Title", meta: { filter: "text" } },
  { accessorKey: "company", header: "Company" },
  { accessorKey: "status", header: "Status", meta: { filter: "facet" } },
  { accessorKey: "tags", header: "Tags", meta: { filter: "facet", filterLabel: "Tag" } },
  { accessorKey: "score", header: "Score" },
]
const bodyRows = () => document.querySelectorAll("tbody tr:not([data-slot=data-table-spacer])")
const count = () => document.querySelector("[data-slot=data-table-count]")?.textContent

// --- virtual rows ---
await t("virtual", async () => {
  const { container } = render(
    <DataTable
      columns={columns}
      data={jobs}
      getRowId={(r) => r.id}
      virtual={{ rowHeight: 36, height: 360, overscan: 5 }}
    />,
  )
  const rendered = bodyRows().length
  ok("virtual: renders a window, not 10,000 rows", rendered > 0 && rendered <= 10 + 5 + 1, rendered)
  const table = container.querySelector("table") as HTMLTableElement
  ok(
    "virtual: aria-rowcount is every row plus the header",
    table.getAttribute("aria-rowcount") === "10001",
  )
  const spacer = container.querySelector("[data-slot=data-table-spacer]") as HTMLElement
  ok(
    "virtual: a bottom spacer holds the rest of the height",
    spacer.style.height === `${(10_000 - rendered) * 36}px`,
    spacer.style.height,
  )
  const scroller = table.closest("div.overflow-auto") as HTMLElement
  ok("virtual: the body scrolls inside the given height", scroller?.style.height === "360px")
  ok(
    "virtual: the header is sticky",
    container.querySelector("thead")?.className.includes("sticky") === true,
  )
  scroller.scrollTop = 36 * 5000
  fireEvent.scroll(scroller)
  const first = bodyRows()[0] as HTMLElement
  const idx = Number(first.dataset.rowIndex)
  ok("virtual: scrolling moves the window", idx >= 4990 && idx <= 5000, idx)
  ok("virtual: rows carry aria-rowindex", first.getAttribute("aria-rowindex") === String(idx + 2))
  ok(
    "virtual: the row at the window is the right one",
    first.textContent?.includes(`Engineer ${idx}`) === true,
  )
  const spacers = container.querySelectorAll("[data-slot=data-table-spacer]")
  ok(
    "virtual: spacers above and below",
    spacers.length === 2 && (spacers[0] as HTMLElement).style.height === `${idx * 36}px`,
  )
})

await t("not virtual", () => {
  render(<DataTable columns={columns} data={jobs.slice(0, 50)} />)
  ok("no virtual: every row renders", bodyRows().length === 50)
  ok(
    "no virtual: no spacers and no aria-rowcount",
    !document.querySelector("[data-slot=data-table-spacer]") &&
      !document.querySelector("table[aria-rowcount]"),
  )
})

// --- facets ---
await t("facets", async () => {
  const views: DataTableView[] = []
  render(
    <DataTable
      columns={columns}
      data={jobs}
      virtual={{ rowHeight: 36, height: 360 }}
      onViewChange={(v) => views.push(v)}
    />,
  )
  ok("toolbar: count of all rows", count() === "10,000 rows", count())
  await userEvent.click(screen.getByRole("button", { name: /Status/ }))
  const list = screen.getByRole("list", { name: "Status values" })
  const items = within(list)
    .getAllByRole("listitem")
    .map((li) => li.textContent)
  ok(
    "facet: every value with its count",
    items.join("|") === "new3,334|applied3,333|rejected3,333",
    items,
  )
  await userEvent.click(within(list).getByRole("checkbox", { name: "applied (3,333)" }))
  ok("facet: picking a value filters rows", count() === "3,333 of 10,000", count())
  ok(
    "facet: onViewChange gets a plain JSON view",
    JSON.stringify(views.at(-1)) ===
      JSON.stringify({
        filters: [{ id: "status", value: ["applied"] }],
        sorting: [],
        columnVisibility: {},
        search: "",
      }),
    views.at(-1),
  )
  await userEvent.click(within(list).getByRole("checkbox", { name: /^new \(/ }))
  ok("facet: two values are OR-ed", count() === "6,667 of 10,000", count())
  await userEvent.keyboard("{Escape}")
  await userEvent.click(screen.getByRole("button", { name: /Tag/ }))
  const tags = within(screen.getByRole("list", { name: "Tag values" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent)
  // Among new+applied rows (i%3 in 0,1): 3,334 odd i (remote), 3,333 even i (onsite + visa) — array cells count per element.
  ok(
    "facet: counts of another column follow the other filters, arrays per element",
    tags.join("|") === "remote3,334|onsite3,333|visa3,333",
    tags,
  )
  await userEvent.keyboard("{Escape}")
  await userEvent.click(screen.getByRole("button", { name: "Reset" }))
  ok(
    "reset: clears every filter",
    count() === "10,000 rows" && !screen.queryByRole("button", { name: "Reset" }),
  )
})

await t("text filter", async () => {
  render(<DataTable columns={columns} data={jobs.slice(0, 200)} />)
  await userEvent.type(screen.getByRole("searchbox", { name: "Filter Title" }), "engineer 19")
  ok("text: case-insensitive contains", count() === "11 of 200", count())
})

await t("facetCounts from the server", async () => {
  render(
    <DataTable
      columns={columns}
      data={jobs.slice(0, 5)}
      manual
      total={10_000}
      facetCounts={{ status: { applied: 12, new: 40 } }}
    />,
  )
  ok("manual: count uses total", count() === "5 of 10,000", count())
  await userEvent.click(screen.getByRole("button", { name: /Status/ }))
  const items = within(screen.getByRole("list", { name: "Status values" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent)
  ok(
    "facetCounts: server counts replace computed ones",
    items.join("|") === "new40|applied12",
    items,
  )
  await userEvent.click(screen.getByRole("checkbox", { name: "applied (12)" }))
  ok("manual: filtering does not touch data", bodyRows().length === 5)
})

// --- sorting ---
await t("sorting", async () => {
  render(<DataTable columns={columns} data={jobs.slice(0, 20)} sortable />)
  const th = () => screen.getByRole("columnheader", { name: "Score" })
  ok("sort: aria-sort none before", th().getAttribute("aria-sort") === "none")
  await userEvent.click(within(th()).getByRole("button"))
  const scores = () =>
    [...bodyRows()].map((r) => Number((r.children[4] as HTMLElement).textContent))
  const first = scores()
  ok(
    "sort: a click sorts",
    th().getAttribute("aria-sort") !== "none" &&
      first.every(
        (v, i) =>
          i === 0 ||
          (th().getAttribute("aria-sort") === "ascending"
            ? first[i - 1]! <= v
            : first[i - 1]! >= v),
      ),
    first,
  )
  await userEvent.click(within(th()).getByRole("button"))
  const second = scores()
  ok(
    "sort: a second click reverses",
    JSON.stringify(second) === JSON.stringify([...first].reverse()),
    second,
  )
  cleanup()
  render(<DataTable columns={columns} data={jobs.slice(0, 5)} />)
  ok(
    "sort: off by default (no buttons, no aria-sort)",
    !screen.getByRole("columnheader", { name: "Score" }).hasAttribute("aria-sort"),
  )
})

// --- views ---
await t("controlled view and saved views", async () => {
  const saved: Array<{ name: string; view: DataTableView }> = []
  const deleted: string[] = []
  function App() {
    const [view, setView] = useState<DataTableView>(EMPTY_VIEW)
    return (
      <DataTable
        columns={columns}
        data={jobs.slice(0, 300)}
        view={view}
        onViewChange={setView}
        savedViews={{
          views: [
            {
              id: "v1",
              name: "Applied only",
              view: {
                filters: [{ id: "status", value: ["applied"] }],
                sorting: [],
                columnVisibility: { tags: false },
              },
            },
          ],
          onSave: (name, v) => saved.push({ name, view: v }),
          onDelete: (id) => deleted.push(id),
        }}
      />
    )
  }
  render(<App />)
  await userEvent.click(screen.getByRole("button", { name: "Views" }))
  await userEvent.click(screen.getByRole("button", { name: "Applied only" }))
  ok("saved view: applies its filters", count() === "100 of 300", count())
  ok("saved view: applies column visibility", !screen.queryByRole("columnheader", { name: "Tags" }))
  await userEvent.click(screen.getByRole("button", { name: "Views" }))
  await userEvent.type(screen.getByRole("textbox", { name: "View name" }), "Mine{Enter}")
  ok(
    "saved view: Save hands the current view to the app",
    saved.length === 1 &&
      saved[0]?.name === "Mine" &&
      JSON.stringify(saved[0].view.filters) ===
        JSON.stringify([{ id: "status", value: ["applied"] }]),
    saved,
  )
  await userEvent.click(screen.getByRole("button", { name: "Delete view Applied only" }))
  ok("saved view: delete passes the id", deleted.join() === "v1")
})

await t("defaultView", () => {
  render(
    <DataTable
      columns={columns}
      data={jobs.slice(0, 30)}
      defaultView={{
        filters: [{ id: "status", value: ["rejected"] }],
        sorting: [],
        columnVisibility: {},
      }}
    />,
  )
  ok("defaultView: starts filtered", count() === "10 of 30", count())
})

// --- active row ---
await t("activeRowId", () => {
  function App({ active }: { active: string }) {
    return (
      <DataTable
        columns={columns}
        data={jobs}
        getRowId={(r) => r.id}
        virtual={{ rowHeight: 36, height: 360 }}
        activeRowId={active}
      />
    )
  }
  const { rerender, container } = render(<App active="j0" />)
  ok(
    "active: marked with data-active",
    container.querySelector("[data-active=true]")?.textContent?.includes("Engineer 0") === true,
  )
  act(() => rerender(<App active="j4000" />))
  const active = container.querySelector("[data-active=true]") as HTMLElement | null
  ok(
    "active: a far row is scrolled into the window",
    active?.textContent?.includes("Engineer 4000") === true,
    active?.dataset.rowIndex,
  )
  const scroller = container.querySelector("div.overflow-auto") as HTMLElement
  ok("active: scrollTop moved to it", scroller.scrollTop > 36 * 3900, scroller.scrollTop)
  act(() => rerender(<App active="j10" />))
  ok(
    "active: a row above the window scrolls back up to it",
    scroller.scrollTop === 360 &&
      container.querySelector("[data-active=true]")?.textContent?.includes("Engineer 10") === true,
    scroller.scrollTop,
  )
})

// --- row selection + bulk actions ---
await t("selection", async () => {
  const selected: string[][] = []
  render(
    <DataTable
      columns={columns}
      data={jobs.slice(0, 5)}
      getRowId={(r) => r.id}
      selectable
      onSelectedRowIdsChange={(ids) => selected.push(ids)}
      bulkActions={(rows) => <button type="button">{`Delete ${rows.length}`}</button>}
    />,
  )
  ok("selection: no bulk bar with nothing selected", !screen.queryByText(/selected/))
  const headerCheckbox = screen.getByRole("checkbox", { name: "Select all rows" })
  const rowCheckboxes = () => screen.getAllByRole("checkbox", { name: /^Select row/ })
  await userEvent.click(rowCheckboxes()[0] as HTMLElement)
  ok("selection: picking a row reports its id", selected.at(-1)?.join() === "j0")
  ok("selection: the bulk bar shows the count", screen.getByText("1 selected") !== null)
  ok(
    "selection: bulkActions gets the selected rows' data",
    !!screen.getByRole("button", { name: "Delete 1" }),
  )
  await userEvent.click(headerCheckbox)
  ok("selection: select-all selects every row", selected.at(-1)?.length === 5)
  ok(
    "selection: header checkbox reflects all-selected",
    headerCheckbox.getAttribute("data-state") === "checked" ||
      headerCheckbox.getAttribute("aria-checked") === "true",
  )
  await userEvent.click(screen.getByRole("button", { name: "Clear" }))
  ok(
    "selection: Clear empties the selection",
    selected.at(-1)?.length === 0 && !screen.queryByText(/selected/),
  )
})

await t("selection controlled", async () => {
  function App() {
    const [ids, setIds] = useState<string[]>(["j1"])
    return (
      <DataTable
        columns={columns}
        data={jobs.slice(0, 3)}
        getRowId={(r) => r.id}
        selectable
        selectedRowIds={ids}
        onSelectedRowIdsChange={setIds}
      />
    )
  }
  render(<App />)
  ok("selection: starts from selectedRowIds", screen.getByText("1 selected") !== null)
  const row1 = screen.getByRole("checkbox", { name: "Select row j1" })
  ok(
    "selection: the given id is checked",
    row1.getAttribute("data-state") === "checked" || row1.getAttribute("aria-checked") === "true",
  )
})

// --- global search ---
await t("global search", async () => {
  render(
    <DataTable
      columns={columns}
      data={jobs.slice(0, 300)}
      searchable={{ placeholder: "Find a job…" }}
    />,
  )
  const box = screen.getByRole("searchbox", { name: "Search" })
  ok("search: placeholder", box.getAttribute("placeholder") === "Find a job…")
  await userEvent.type(box, "engineer 19")
  ok("search: filters across columns, case-insensitively", count() === "11 of 300", count())
  await userEvent.click(screen.getByRole("button", { name: "Reset" }))
  ok("search: Reset clears it", (box as HTMLInputElement).value === "" && count() === "300 rows")
})

// --- columns menu ---
await t("columns menu", async () => {
  render(<DataTable columns={columns} data={jobs.slice(0, 5)} columnsMenu />)
  ok(
    "columnsMenu: Company column visible at first",
    !!screen.getByRole("columnheader", { name: "Company" }),
  )
  await userEvent.click(screen.getByRole("button", { name: "Columns" }))
  await userEvent.click(screen.getByRole("checkbox", { name: "Company" }))
  ok(
    "columnsMenu: unchecking hides the column",
    !screen.queryByRole("columnheader", { name: "Company" }),
  )
})

// --- CSV export ---
await t("csv export", async () => {
  const clicked: Array<{ download: string }> = []
  const blobs: Blob[] = []
  const origClick = HTMLAnchorElement.prototype.click
  const origCreate = URL.createObjectURL
  const origRevoke = URL.revokeObjectURL
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download })
  }
  URL.createObjectURL = ((b: Blob) => {
    blobs.push(b)
    return "blob:mock"
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL
  try {
    render(
      <DataTable
        columns={[
          { accessorKey: "title", header: "Title" },
          { accessorKey: "company", header: 'Company, "Inc"' },
        ]}
        data={[
          {
            id: "x",
            title: "Row, one",
            company: 'Has "quotes"',
            status: "new",
            tags: [],
            score: 0,
          },
        ]}
        exportFilename="jobs"
      />,
    )
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }))
    ok("export: downloads with the given filename", clicked[0]?.download === "jobs.csv", clicked)
    const text = await blobs[0]?.text()
    ok(
      "export: header row, and commas/quotes in cells are RFC 4180 quoted",
      text === 'Title,"Company, ""Inc"""\r\n"Row, one","Has ""quotes"""',
      text,
    )
  } finally {
    HTMLAnchorElement.prototype.click = origClick
    URL.createObjectURL = origCreate
    URL.revokeObjectURL = origRevoke
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
await GlobalRegistrator.unregister()
if (fail) throw new Error(`${fail} failed`)
