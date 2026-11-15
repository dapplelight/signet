/**
 * Data editing in happy-dom: the CSV parser and import flow, the editable
 * grid (keyboard, editing, paste and copy, selection, sort, virtual rows,
 * optimistic saves) and the rich text editor (markdown both ways, XSS).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react")
const { useState } = await import("react")
const { z } = await import("zod")
const { CsvImport, autoMatch, parseCsv, toCsv, validateRows, detectDelimiter } = await import(
  "../src/components/domain/csv-import"
)
const { DataGrid, parseCell } = await import("../src/components/ui/data-grid")
const { RichTextEditor, RichTextContent, richTextToHtml, htmlToRichText, isSafeUrl } = await import(
  "../src/components/ui/rich-text-editor"
)
type DataGridColumn<T> = import("../src/components/ui/data-grid").DataGridColumn<T>
type DataGridChange<T> = import("../src/components/ui/data-grid").DataGridChange<T>

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
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const tick = () => act(() => new Promise((r) => setTimeout(r, 0)))

// ------------------------------------------------------------------ CSV parser

await t("parseCsv", () => {
  ok(
    "simple",
    eq(parseCsv("a,b\n1,2"), [
      ["a", "b"],
      ["1", "2"],
    ]),
  )
  ok(
    "CRLF and trailing break",
    eq(parseCsv("a,b\r\n1,2\r\n"), [
      ["a", "b"],
      ["1", "2"],
    ]),
  )
  ok("lone CR line ends", eq(parseCsv("a\r1\r2"), [["a"], ["1"], ["2"]]))
  ok("BOM is dropped", eq(parseCsv("﻿name\nAsha"), [["name"], ["Asha"]]))
  ok(
    "quoted delimiter, escaped quote, line break inside quotes",
    eq(parseCsv('a,b\n"x, y","say ""hi""\nnext"'), [
      ["a", "b"],
      ["x, y", 'say "hi"\nnext'],
    ]),
    parseCsv('a,b\n"x, y","say ""hi""\nnext"'),
  )
  ok("CRLF inside quotes is kept", eq(parseCsv('"a\r\nb"'), [["a\r\nb"]]))
  ok(
    "empty fields",
    eq(parseCsv("a,,c\n,,"), [
      ["a", "", "c"],
      ["", "", ""],
    ]),
  )
  ok("blank lines are skipped", eq(parseCsv("a\n\n\nb\n"), [["a"], ["b"]]))
  ok('a "" field counts as a row', eq(parseCsv('""'), [[""]]))
  ok("unclosed quote runs to the end", eq(parseCsv('a,"b\nc'), [["a", "b\nc"]]))
  ok("text after a closing quote is kept", eq(parseCsv('"a"b,c'), [["ab", "c"]]))
  ok("semicolon detected", detectDelimiter("a;b;c\n1;2;3") === ";")
  ok(
    "tab detected",
    eq(parseCsv("a\tb\n1\t2"), [
      ["a", "b"],
      ["1", "2"],
    ]),
  )
  ok("delimiter inside quotes does not count", detectDelimiter('"a;b;c",d') === ",")
  ok("explicit delimiter", eq(parseCsv("a|b", { delimiter: "|" }), [["a", "b"]]))
  ok("empty text", eq(parseCsv(""), []))
  const tricky = [["a,b", 'q"q', "line\nbreak", ""]]
  ok("toCsv round-trips", eq(parseCsv(toCsv(tricky)), tricky), toCsv(tricky))
})

await t("autoMatch and validateRows", () => {
  const fields = [
    { key: "name", required: true },
    { key: "email", label: "Email", aliases: ["E-mail address"] },
    { key: "age" },
  ]
  const m = autoMatch(["E-Mail Address", "Full name", "NAME", "Age "], fields)
  ok(
    "matches by key, alias, ignoring case and punctuation",
    eq(m, { name: 2, email: 0, age: 3 }),
    m,
  )
  const schema = z.object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    age: z.coerce.number().int().optional(),
  })
  const rows = validateRows(
    [
      ["a@x.io", "", "Asha", "31"],
      ["bad", "", "", "x"],
    ],
    fields,
    m,
    schema,
  )
  ok("valid row gets parsed data", eq(rows[0]?.data, { name: "Asha", email: "a@x.io", age: 31 }))
  ok("line numbers count the header", rows[0]?.line === 2 && rows[1]?.line === 3)
  ok(
    "errors per field",
    !!rows[1]?.errors.name && !!rows[1]?.errors.email && !!rows[1]?.errors.age && !rows[1]?.data,
    rows[1]?.errors,
  )
})

await t("CsvImport flow", async () => {
  const fields = [{ key: "name", required: true }, { key: "email" }]
  const schema = z.object({ name: z.string(), email: z.string().email().optional() })
  let got: unknown[] = []
  render(
    <CsvImport
      fields={fields}
      schema={schema}
      onImport={async (rows) => {
        got = rows
        return { inserted: 1, skipped: 0, errors: [{ row: 1, field: "email", message: "taken" }] }
      }}
    />,
  )
  const root = document.querySelector("[data-slot=csv-import]") as HTMLElement
  ok("starts at source", root.dataset.step === "source")
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Name,Email\r\nAsha,asha@x.io\r\nDev,dev@x.io\r\n,nope\r\n" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  ok("mapping step", root.dataset.step === "map")
  const nameSelect = screen.getByLabelText("name") as HTMLSelectElement
  ok("auto-matched", nameSelect.value === "0")
  fireEvent.change(nameSelect, { target: { value: "" } })
  ok(
    "required field blocks continue",
    (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled,
  )
  fireEvent.change(nameSelect, { target: { value: "0" } })
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  ok("review step", root.dataset.step === "review")
  ok(
    "summary",
    /2 ready, 1 with errors/.test(
      document.querySelector("[data-slot=csv-import-summary]")?.textContent ?? "",
    ),
  )
  const bad = document.querySelectorAll("[data-slot=csv-import-cell][aria-invalid=true]")
  ok("errors shown per cell", bad.length === 2, bad.length)
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Import 2 rows" }))
  })
  ok(
    "imports only valid rows",
    eq(got, [
      { name: "Asha", email: "asha@x.io" },
      { name: "Dev", email: "dev@x.io" },
    ]),
  )
  ok("done step", root.dataset.step === "done")
  ok(
    "status reports the result",
    /Imported 1 rows, 1 failed/.test(screen.getByRole("status").textContent ?? ""),
  )
  const cells = [...document.querySelectorAll("[data-slot=csv-import-cell][aria-invalid=true]")]
  ok(
    "server error lands on the right line and field",
    cells.some((c) => c.textContent?.includes("dev@x.io") && c.textContent.includes("taken")),
  )
})

await t("CsvImport: empty input", () => {
  render(<CsvImport fields={[{ key: "a" }]} onImport={() => undefined} />)
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "a\n" } })
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  ok(
    "header only stays on source with a message",
    /no rows/.test(screen.getByRole("status").textContent ?? ""),
  )
})

// ------------------------------------------------------------------ grid

type Person = {
  id: string
  name: string
  age: number | null
  role: string | null
  active: boolean
  joined: string | null
}
const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
]
const cols: DataGridColumn<Person>[] = [
  { id: "name", header: "Name" },
  {
    id: "age",
    header: "Age",
    type: "number",
    validate: (v) => (typeof v === "number" && v < 0 ? "Too small" : undefined),
  },
  { id: "role", header: "Role", type: "select", options: ROLES },
  { id: "active", header: "Active", type: "checkbox" },
  { id: "joined", header: "Joined", type: "date" },
]
const people = (n: number): Person[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Person ${i}`,
    age: 20 + (i % 50),
    role: i % 2 ? "admin" : "member",
    active: i % 3 === 0,
    joined: "2026-01-01",
  }))

function Grid({
  initial,
  onSave,
  selectable,
}: {
  initial: Person[]
  onSave?: (c: DataGridChange<Person>[]) => unknown
  selectable?: boolean
}) {
  const [rows, setRows] = useState(initial)
  return (
    <DataGrid
      aria-label="People"
      columns={cols}
      rows={rows}
      getRowId={(r) => r.id}
      selectable={selectable}
      height={360}
      onChange={async (changes) => {
        const res = await onSave?.(changes)
        setRows((all) =>
          all.map((r) => {
            const mine = changes.filter((c) => c.rowId === r.id)
            return mine.length
              ? { ...r, ...Object.fromEntries(mine.map((c) => [c.columnId, c.value])) }
              : r
          }),
        )
        return res as never
      }}
    />
  )
}

const grid = () => screen.getByRole("grid")
const cell = (r: number, c: number) =>
  document.querySelector(`[data-row-index="${r}"] [data-col-index="${c}"]`) as HTMLElement
const key = (k: string, o: Record<string, unknown> = {}) =>
  fireEvent.keyDown(document.activeElement as Element, { key: k, ...o })

await t("parseCell", () => {
  ok("number with grouping", eq(parseCell("number", "1,234.5"), { value: 1234.5 }))
  ok("number refused", "error" in parseCell("number", "12abc"))
  ok("empty number is null", eq(parseCell("number", " "), { value: null }))
  ok("date strict", eq(parseCell("date", "2026-02-28"), { value: "2026-02-28" }))
  ok("impossible date refused", "error" in parseCell("date", "2026-02-30"))
  ok(
    "checkbox words",
    eq(parseCell("checkbox", "Yes"), { value: true }) &&
      eq(parseCell("checkbox", "0"), { value: false }),
  )
  ok(
    "select by label",
    eq(parseCell("select", "admin", ROLES), { value: "admin" }) &&
      eq(parseCell("select", "Member", ROLES), { value: "member" }),
  )
  ok("select refused", "error" in parseCell("select", "owner", ROLES))
})

await t("grid: roles, virtual rows, one tab stop", () => {
  render(<Grid initial={people(10_000)} />)
  const g = grid()
  ok("aria-rowcount counts every row plus the header", g.getAttribute("aria-rowcount") === "10001")
  ok("aria-colcount", g.getAttribute("aria-colcount") === "5")
  const rendered = document.querySelectorAll("tbody tr[data-row-index]").length
  ok("renders a window of rows, not 10,000", rendered > 0 && rendered < 40, rendered)
  ok(
    "cells are gridcells with column indexes",
    cell(0, 1).getAttribute("role") === "gridcell" &&
      cell(0, 1).getAttribute("aria-colindex") === "2",
  )
  const tabbable = document.querySelectorAll('[role=gridcell][tabindex="0"]')
  ok("exactly one cell is in the tab order", tabbable.length === 1 && tabbable[0] === cell(0, 0))
  ok(
    "headers carry aria-sort",
    screen.getAllByRole("columnheader")[0]?.getAttribute("aria-sort") === "none",
  )
})

await t("grid: keyboard navigation", async () => {
  render(<Grid initial={people(500)} />)
  act(() => cell(0, 0).focus())
  key("ArrowRight")
  ok("ArrowRight moves focus", document.activeElement === cell(0, 1))
  key("ArrowDown")
  ok("ArrowDown", document.activeElement === cell(1, 1))
  key("End")
  ok("End goes to the last column", document.activeElement === cell(1, 4))
  key("Home")
  ok("Home goes to the first column", document.activeElement === cell(1, 0))
  key("ArrowUp")
  key("ArrowUp")
  ok("stops at the top", document.activeElement === cell(0, 0))
  key("Tab")
  ok("Tab moves right", document.activeElement === cell(0, 1))
  key("Tab", { shiftKey: true })
  ok("Shift+Tab moves left", document.activeElement === cell(0, 0))
  key("ArrowDown", { ctrlKey: true })
  await tick()
  ok(
    "Ctrl+ArrowDown scrolls to and focuses the last row",
    document.activeElement === cell(499, 0),
    document.activeElement?.outerHTML.slice(0, 80),
  )
  ok("the active cell is the only tab stop", cell(499, 0).tabIndex === 0)
})

await t("grid: edit text with Enter, cancel with Escape", async () => {
  const saved: DataGridChange<Person>[][] = []
  render(<Grid initial={people(3)} onSave={(c) => void saved.push(c)} />)
  act(() => cell(0, 0).focus())
  key("Enter")
  const input = document.querySelector("[data-slot=data-grid-editor]") as HTMLInputElement
  ok("Enter opens an editor with the value", !!input && input.value === "Person 0")
  fireEvent.change(input, { target: { value: "Asha" } })
  fireEvent.keyDown(input, { key: "Escape" })
  ok("Escape closes without saving", saved.length === 0 && cell(0, 0).textContent === "Person 0")
  ok("focus goes back to the cell", document.activeElement === cell(0, 0))
  key("Enter")
  const again = document.querySelector("[data-slot=data-grid-editor]") as HTMLInputElement
  fireEvent.change(again, { target: { value: "Asha" } })
  await act(async () => {
    fireEvent.keyDown(again, { key: "Enter" })
  })
  ok(
    "Enter saves",
    saved.length === 1 && saved[0]?.[0]?.value === "Asha" && saved[0][0].columnId === "name",
  )
  ok("the new value shows", cell(0, 0).textContent === "Asha")
  ok("and the cursor moves down", document.activeElement === cell(1, 0))
  key("x")
  const typed = document.querySelector("[data-slot=data-grid-editor]") as HTMLInputElement
  ok("typing a character starts editing with it", typed?.value === "x")
  await act(async () => {
    fireEvent.keyDown(typed, { key: "Tab" })
  })
  ok("Tab saves and moves right", saved.length === 2 && document.activeElement === cell(1, 1))
})

await t("grid: number, select, checkbox, date", async () => {
  const saved: DataGridChange<Person>[] = []
  render(<Grid initial={people(3)} onSave={(c) => void saved.push(...c)} />)
  act(() => cell(0, 1).focus())
  key("Enter")
  let input = document.querySelector("[data-slot=data-grid-editor]") as HTMLInputElement
  fireEvent.change(input, { target: { value: "abc" } })
  fireEvent.keyDown(input, { key: "Enter" })
  input = document.querySelector("[data-slot=data-grid-editor]") as HTMLInputElement
  ok(
    "a bad number keeps the editor open, marked invalid",
    input?.getAttribute("aria-invalid") === "true",
  )
  ok(
    "with a message tied to it",
    document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent ===
      "Enter a number.",
  )
  fireEvent.change(input, { target: { value: "-4" } })
  fireEvent.keyDown(input, { key: "Enter" })
  ok(
    "column validate refuses too",
    document.querySelector("[data-slot=data-grid-editor-message]")?.textContent === "Too small",
  )
  fireEvent.change(document.querySelector("[data-slot=data-grid-editor]") as HTMLInputElement, {
    target: { value: "42" },
  })
  await act(async () => {
    fireEvent.keyDown(document.querySelector("[data-slot=data-grid-editor]") as Element, {
      key: "Enter",
    })
  })
  ok("number saved as a number", saved.at(-1)?.value === 42)

  act(() => cell(0, 2).focus())
  key("Enter")
  const select = document.querySelector("select[data-slot=data-grid-editor]") as HTMLSelectElement
  ok("select editor", !!select)
  await act(async () => {
    fireEvent.change(select, { target: { value: "admin" } })
  })
  ok("choosing saves", saved.at(-1)?.value === "admin" && cell(0, 2).textContent === "Admin")

  act(() => cell(0, 3).focus())
  await act(async () => {
    key(" ")
  })
  ok(
    "Space toggles a checkbox",
    saved.at(-1)?.columnId === "active" && saved.at(-1)?.value === false,
  )

  act(() => cell(0, 4).focus())
  key("Enter")
  const date = document.querySelector("[data-slot=data-grid-editor]") as HTMLInputElement
  ok("date editor is a native date input", date?.type === "date")
  fireEvent.change(date, { target: { value: "2026-11-15" } })
  await act(async () => {
    fireEvent.keyDown(date, { key: "Enter" })
  })
  ok("date saved", saved.at(-1)?.value === "2026-11-15")
})

await t("grid: optimistic save, error per cell, revert", async () => {
  let resolve: (v?: unknown) => void = () => {}
  let reject: (e: Error) => void = () => {}
  const announce = () => document.querySelector("[role=status]")?.textContent
  render(
    <Grid
      initial={people(2)}
      onSave={() =>
        new Promise((res, rej) => {
          resolve = res
          reject = rej
        })
      }
    />,
  )
  act(() => cell(0, 0).focus())
  key("Enter")
  fireEvent.change(document.querySelector("[data-slot=data-grid-editor]") as Element, {
    target: { value: "New" },
  })
  fireEvent.keyDown(document.querySelector("[data-slot=data-grid-editor]") as Element, {
    key: "Enter",
  })
  await tick()
  ok("shows the new value at once", cell(0, 0).textContent === "New")
  ok("marked pending", cell(0, 0).dataset.pending === "true")
  await act(async () => reject(new Error("Name is taken")))
  await tick()
  ok("reverts on failure", cell(0, 0).textContent?.startsWith("Person 0"), cell(0, 0).textContent)
  ok(
    "error on the cell",
    cell(0, 0).getAttribute("aria-invalid") === "true" && cell(0, 0).title === "Name is taken",
  )
  ok("announced", announce() === "Name: Name is taken", announce())
  void resolve
})

await t("grid: returned failures mark only those cells", async () => {
  render(
    <Grid
      initial={people(3)}
      onSave={(changes) => [{ rowId: changes[1]?.rowId, columnId: "name", error: "Nope" }]}
    />,
  )
  act(() => cell(0, 0).focus())
  await act(async () => {
    fireEvent.paste(grid(), { clipboardData: { getData: () => "A\nB\nC" } })
  })
  await tick()
  ok("the failed cell is marked", cell(1, 0).dataset.error === "")
  ok(
    "the others saved",
    cell(0, 0).textContent === "A" &&
      cell(2, 0).textContent === "C" &&
      cell(0, 0).dataset.error === undefined,
  )
})

await t("grid: paste a TSV range, copy a range", async () => {
  const saved: DataGridChange<Person>[] = []
  render(<Grid initial={people(5)} onSave={(c) => void saved.push(...c)} />)
  act(() => cell(1, 0).focus())
  await act(async () => {
    fireEvent.paste(grid(), {
      clipboardData: { getData: () => 'Ann\t30\tadmin\r\n"Bo\nB"\tx\tMember\r\n' },
    })
  })
  ok(
    "pastes a block from the active cell",
    cell(1, 0).textContent === "Ann" &&
      cell(1, 1).textContent === "30" &&
      cell(2, 2).textContent === "Member",
  )
  ok(
    "quoted multi-line field",
    saved.some((s) => s.value === "Bo\nB"),
  )
  ok(
    "an unparseable cell is marked, not saved",
    cell(2, 1).dataset.error === "" && !saved.some((s) => s.rowId === "p2" && s.columnId === "age"),
  )
  ok("the pasted block is selected", cell(2, 2).dataset.inRange === "")

  act(() => cell(0, 0).focus())
  key("ArrowRight", { shiftKey: true })
  key("ArrowDown", { shiftKey: true })
  ok(
    "Shift+arrows extend the range",
    cell(1, 1).getAttribute("aria-selected") === "true" && cell(0, 0).dataset.inRange === "",
  )
  let copied = ""
  fireEvent.copy(grid(), { clipboardData: { setData: (_: string, v: string) => (copied = v) } })
  ok("copy writes the range as TSV", copied === "Person 0\t20\r\nAnn\t30", JSON.stringify(copied))

  key("Escape")
  act(() => cell(3, 1).focus())
  key("ArrowDown", { shiftKey: true })
  await act(async () => {
    fireEvent.paste(grid(), { clipboardData: { getData: () => "7" } })
  })
  ok(
    "one value fills the selected range",
    cell(3, 1).textContent === "7" && cell(4, 1).textContent === "7",
  )

  await act(async () => {
    key("Delete")
  })
  ok("Delete clears the range", cell(3, 1).textContent === "" && saved.at(-1)?.value === null)
})

await t("grid: row selection", () => {
  let ids: string[] = []
  render(
    <DataGrid
      aria-label="People"
      columns={cols}
      rows={people(4)}
      getRowId={(r) => r.id}
      selectable
      onSelectedRowIdsChange={(v) => (ids = v)}
    />,
  )
  ok("aria-colcount includes the checkbox column", grid().getAttribute("aria-colcount") === "6")
  act(() => cell(0, 1).focus())
  key(" ", { shiftKey: true })
  ok(
    "Shift+Space selects the row",
    eq(ids, ["p0"]) &&
      document.querySelector('[data-row-index="0"]')?.getAttribute("aria-selected") === "true",
  )
  act(() => cell(1, 0).focus())
  key(" ")
  ok("Space on the checkbox column toggles", eq(ids.sort(), ["p0", "p1"]))
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }))
  ok("select all", ids.length === 4)
})

await t("grid: sort and resize", () => {
  const rows = people(5).map((p, i) => ({ ...p, age: [30, 10, 50, 20, 40][i] as number }))
  render(<DataGrid aria-label="People" columns={cols} rows={rows} getRowId={(r) => r.id} />)
  fireEvent.click(screen.getByRole("button", { name: /Age/ }))
  const ages = () => [0, 1, 2, 3, 4].map((r) => cell(r, 1).textContent)
  ok("sorts ascending", eq(ages(), ["10", "20", "30", "40", "50"]), ages())
  ok("aria-sort", screen.getAllByRole("columnheader")[1]?.getAttribute("aria-sort") === "ascending")
  fireEvent.click(screen.getByRole("button", { name: /Age/ }))
  ok("then descending", ages()[0] === "50")
  const handle = screen.getByRole("separator", { name: "Resize column Name" })
  const before = Number(handle.getAttribute("aria-valuenow"))
  fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true })
  ok("keyboard resize", Number(handle.getAttribute("aria-valuenow")) === before + 50)
  ok(
    "read-only grid: Enter does not edit",
    (() => {
      act(() => cell(0, 0).focus())
      key("Enter")
      return (
        !document.querySelector("[data-slot=data-grid-editor]") &&
        cell(0, 0).getAttribute("aria-readonly") === "true"
      )
    })(),
  )
})

// ------------------------------------------------------------------ rich text

await t("richTextToHtml", () => {
  ok("headings", richTextToHtml("# A\n\n## B\n\n#### C") === "<h1>A</h1><h2>B</h2><h3>C</h3>")
  ok(
    "inline marks",
    richTextToHtml("**b** _i_ `c`") === "<p><strong>b</strong> <em>i</em> <code>c</code></p>",
  )
  ok(
    "nested lists",
    richTextToHtml("- a\n  1. b\n  2. c\n- d") ===
      "<ul><li>a<ol><li>b</li><li>c</li></ol></li><li>d</li></ul>",
    richTextToHtml("- a\n  1. b\n  2. c\n- d"),
  )
  ok(
    "code block keeps text",
    richTextToHtml("```\n<b>x</b>\n```") === "<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>",
  )
  ok("line break", richTextToHtml("a\nb") === "<p>a<br>b</p>")
  ok(
    "mention",
    richTextToHtml("hi @[Asha Rao](user:u1)") ===
      '<p>hi <span data-mention="" data-user-id="u1" contenteditable="false">@Asha Rao</span></p>',
  )
  ok(
    "link",
    richTextToHtml("[x](https://a.io/p?q=1&r=2)") ===
      '<p><a href="https://a.io/p?q=1&amp;r=2" rel="noopener noreferrer nofollow">x</a></p>',
  )
  ok("unclosed marker is text", richTextToHtml("2 * 3 = 6") === "<p>2 * 3 = 6</p>")
  ok("escapes", richTextToHtml("\\*not\\* \\[x\\]") === "<p>*not* [x]</p>")
})

await t("XSS: richTextToHtml", () => {
  const cases: [string, string][] = [
    ["<script>alert(1)</script>", "script tag"],
    ['<img src=x onerror="alert(1)">', "img onerror"],
    ["[x](javascript:alert(1))", "javascript link"],
    ["[x](JaVaScRiPt:alert(1))", "mixed case scheme"],
    ["[x](java\tscript:alert(1))", "tab in scheme"],
    ["[x](data:text/html;base64,PHNjcmlwdD4=)", "data URL"],
    ["[x](vbscript:msgbox)", "vbscript"],
    ['[x](https://a.io"onmouseover="alert(1))', "quote breaking out of href"],
    ["@[<img src=x onerror=alert(1)>](user:u1)", "markup in a mention name"],
    ["`</code><script>alert(1)</script>`", "code span"],
    ["**<svg onload=alert(1)>**", "svg in bold"],
  ]
  for (const [md, name] of cases) {
    const html = richTextToHtml(md)
    const doc = new DOMParser().parseFromString(html, "text/html")
    const evil =
      doc.querySelector("script,img,svg,iframe") ||
      [...doc.querySelectorAll("*")].some((el) =>
        [...el.attributes].some(
          (a) => /^on/i.test(a.name) || (a.name === "href" && !isSafeUrl(a.value)),
        ),
      ) ||
      /<(script|img|svg)/i.test(html)
    ok(`inert: ${name}`, !evil, html)
  }
  ok("unsafe link keeps its text", richTextToHtml("[click](javascript:x)") === "<p>click</p>")
})

await t("htmlToRichText: allowlist", () => {
  ok(
    "keeps supported formatting",
    htmlToRichText(
      "<h2>T</h2><p><b>b</b> <em>i</em> <code>c</code> <a href='https://a.io'>l</a></p><ul><li>x</li><li>y<ol><li>z</li></ol></li></ul>",
    ) === "## T\n\n**b** _i_ `c` [l](https://a.io)\n\n- x\n- y\n  1. z",
    htmlToRichText(
      "<h2>T</h2><p><b>b</b> <em>i</em> <code>c</code> <a href='https://a.io'>l</a></p><ul><li>x</li><li>y<ol><li>z</li></ol></li></ul>",
    ),
  )
  ok(
    "drops scripts, styles, handlers and unsafe links",
    htmlToRichText(
      `<p onclick="x()">hi<script>alert(1)</script><style>p{}</style> <a href="javascript:alert(1)">there</a><img src=x onerror=alert(1)></p>`,
    ) === "hi there",
  )
  ok(
    "escapes markdown in text",
    htmlToRichText("<p>*a* [b](c) 1. x</p>") === "\\*a\\* \\[b\\](c) 1. x",
  )
  ok(
    "escapes block markers at a line start",
    htmlToRichText("<p># not a heading</p><p>- not a list</p>") ===
      "\\# not a heading\n\n\\- not a list",
  )
  ok(
    "mentions keep their id",
    htmlToRichText('<p><span data-mention data-user-id="u1">@Asha</span></p>') ===
      "@[Asha](user:u1)",
  )
  ok(
    "a bad mention id is just text",
    htmlToRichText('<p><span data-mention data-user-id="u1)x(">@A</span></p>') === "A",
  )
  ok("pre becomes a fence", htmlToRichText("<pre>a\n```\nb</pre>") === "````\na\n```\nb\n````")
  for (const md of [
    "## Title\n\n**bold** and _it_ with `code` and [a link](https://x.io/a%20b)",
    "- one\n- two\n  - nested\n\n1. first\n2. second",
    "hi @[Asha Rao](user:u1), see \\*this\\*",
    "```\nconst a = `x`\n```",
    "\\# literal\n\n2 \\* 3",
  ]) {
    const back = htmlToRichText(richTextToHtml(md))
    ok(`round trip: ${md.slice(0, 24).replace(/\n/g, "⏎")}`, back === md, back)
  }
})

await t("RichTextEditor", async () => {
  let value = ""
  const people = [
    { id: "u1", name: "Asha Rao" },
    { id: "u2", name: "Dev Patel" },
  ]
  function Editor() {
    const [v, setV] = useState("Hello **world**")
    value = v
    return (
      <RichTextEditor
        aria-label="Comment"
        value={v}
        onValueChange={setV}
        onMentionSearch={(q) =>
          people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
        }
        placeholder="Write…"
      />
    )
  }
  render(<Editor />)
  const box = screen.getByRole("textbox", { name: "Comment" })
  ok(
    "renders the value as HTML",
    box.innerHTML === "<p>Hello <strong>world</strong></p>",
    box.innerHTML,
  )
  ok(
    "multi-line textbox",
    box.getAttribute("aria-multiline") === "true" && box.getAttribute("contenteditable") === "true",
  )
  const toolbar = screen.getByRole("toolbar", { name: "Formatting" })
  const buttons = [...toolbar.querySelectorAll("button")]
  ok("toolbar has one tab stop", buttons.filter((b) => b.tabIndex === 0).length === 1)
  act(() => buttons[0]?.focus())
  fireEvent.keyDown(toolbar, { key: "ArrowRight" })
  ok(
    "arrows move along the toolbar",
    document.activeElement === buttons[1] && buttons[1]?.tabIndex === 0,
  )

  // Type " @as" at the end, as the browser would, then pick from the list.
  const p = box.querySelector("p") as HTMLElement
  const text = document.createTextNode(" @as")
  p.append(text)
  const sel = document.getSelection() as Selection
  const range = document.createRange()
  range.setStart(text, 4)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  await act(async () => {
    fireEvent.input(box)
  })
  await tick()
  const list = screen.getByRole("listbox", { name: "People to mention" })
  ok("@ opens the people list", !!list && box.getAttribute("aria-controls") === list.id)
  ok("filtered by the query", screen.getAllByRole("option").length === 1)
  ok(
    "active option is announced",
    box.getAttribute("aria-activedescendant") === screen.getAllByRole("option")[0]?.id,
  )
  await act(async () => {
    fireEvent.keyDown(box, { key: "Enter" })
  })
  ok(
    "Enter inserts the mention as a stored token",
    value === "Hello **world** @[Asha Rao](user:u1)",
    value,
  )
  ok("the list closes", !screen.queryByRole("listbox"))

  // Paste HTML with a script: only allowlisted formatting gets in.
  const r2 = document.createRange()
  r2.selectNodeContents(box)
  r2.collapse(false)
  sel.removeAllRanges()
  sel.addRange(r2)
  await act(async () => {
    fireEvent.paste(box, {
      clipboardData: {
        getData: (t: string) =>
          t === "text/html"
            ? '<p><em>pasted</em><script>alert(1)</script><img src=x onerror="alert(1)"></p>'
            : t === "text/plain"
              ? "pasted"
              : "",
      },
    })
  })
  ok(
    "paste is sanitised",
    !box.querySelector("script,img") && box.querySelector("em")?.textContent === "pasted",
    box.innerHTML,
  )
  ok("and reaches the value", value.includes("_pasted_") && !value.includes("script"), value)
})

await t("RichTextEditor: uncontrolled, placeholder, content", () => {
  render(<RichTextEditor aria-label="Note" placeholder="Write…" defaultValue="" />)
  const box = screen.getByRole("textbox", { name: "Note" })
  ok(
    "empty shows the placeholder",
    box.dataset.empty === "true" && box.dataset.placeholder === "Write…",
  )
  cleanup()
  render(<RichTextContent value={"Hi <b>x</b> [a](javascript:void0)"} />)
  const c = document.querySelector("[data-slot=rich-text-content]") as HTMLElement
  ok(
    "RichTextContent renders escaped text and drops the unsafe link",
    c.innerHTML === "<p>Hi &lt;b&gt;x&lt;/b&gt; a</p>",
    c.innerHTML,
  )
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
