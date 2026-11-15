/**
 * Domain components and hooks from the ui-domain batch: amount, kanban, and
 * the use-debounce / use-local-storage / use-copy / use-intersection hooks.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen } = await import("@testing-library/react")
const { fireEvent } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { Amount, formatAmount } = await import("../src/components/domain/amount")
const {
  Kanban,
  KanbanColumn,
  KanbanColumnHeader,
  KanbanColumnTitle,
  KanbanItem,
  KanbanList,
  moveItem,
} = await import("../src/components/domain/kanban")
type KanbanBoard = import("../src/components/domain/kanban").KanbanBoard
type KanbanMove = import("../src/components/domain/kanban").KanbanMove

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
const text = (v: Parameters<typeof formatAmount>[0], o?: Parameters<typeof formatAmount>[1]) =>
  formatAmount(v, o)
    .parts.map((p) => p.value)
    .join("")

await t("formatAmount", () => {
  ok("INR groups by lakh", text(1250000) === "₹12,50,000.00", text(1250000))
  ok("negative", text(-1234.5) === "-₹1,234.50", text(-1234.5))
  ok("whole drops decimals", text(1234.56, { notation: "whole" }) === "₹1,235")
  ok("compact lakh", text(1250000, { notation: "compact" }) === "₹12.5L")
  ok("compact crore", text(-12500000, { notation: "compact" }) === "-₹1.3Cr")
  ok("compact below a lakh is the full amount", text(99999, { notation: "compact" }) === "₹99,999")
  ok(
    "USD compact uses Intl",
    text(1300000, { currency: "USD", locale: "en-US", notation: "compact" }) === "$1.3M",
    text(1300000, { currency: "USD", locale: "en-US", notation: "compact" }),
  )
  ok("minor units", text(12345, { minorUnits: true }) === "₹123.45")
  ok("JPY has no decimals", text(1234, { currency: "JPY", locale: "ja-JP" }).endsWith("1,234"))
  ok(
    "bigint minor units stay exact",
    text(123456789012345678n, { minorUnits: true }) === "₹1,23,45,67,89,01,23,456.78",
    text(123456789012345678n, { minorUnits: true }),
  )
  ok("junk is zero", text("abc") === "₹0.00")
  ok("exceptZero signs credits", text(5, { signDisplay: "exceptZero" }) === "+₹5.00")
})

await t("Amount", () => {
  render(
    <>
      <Amount data-testid="a" value={-1500} tone="auto" classNames={{ currency: "cur" }} />
      <Amount data-testid="b" value={2500} tone="auto" />
      <Amount data-testid="c" value={0} tone="auto" />
      <Amount data-testid="d" value={1250000} notation="compact" />
      <Amount data-testid="e" value={10} tone="transfer" render={<span className="x" />} />
    </>,
  )
  const a = screen.getByTestId("a")
  ok(
    "renders a <data> with the exact value",
    a.tagName === "DATA" && a.getAttribute("value") === "-1500",
  )
  ok("auto tone: negative is debit", a.dataset.tone === "debit" && a.dataset.sign === "negative")
  ok("debit reads the money slot", a.className.includes("--money-debit"))
  ok(
    "parts carry data-part and classNames",
    a.querySelector('[data-part="currency"]')?.className === "cur",
  )
  const b = screen.getByTestId("b")
  ok(
    "auto tone: positive is credit and signed",
    b.dataset.tone === "credit" && b.textContent === "+₹2,500.00",
  )
  ok("credit falls back to accent-green", b.className.includes("var(--color-accent-green)"))
  const c = screen.getByTestId("c")
  ok("zero has no tone", c.dataset.tone === undefined && c.dataset.sign === "zero")
  const d = screen.getByTestId("d")
  ok(
    "compact shows the full amount on hover",
    d.title === "₹12,50,000.00" && d.textContent === "₹12.5L",
  )
  const e = screen.getByTestId("e")
  ok(
    "render swaps the element",
    e.tagName === "SPAN" && e.className.includes("x") && e.dataset.tone === "transfer",
  )
})

const COLUMNS = [
  ["todo", "To do"],
  ["doing", "Doing"],
  ["done", "Done"],
] as const
const NAMES: Record<string, string> = { a: "Write copy", b: "Fix bug", c: "Ship it" }
function Board(props: {
  value?: KanbanBoard
  onValueChange?: (b: KanbanBoard) => void
  onItemMove?: (m: KanbanMove) => void
}) {
  return (
    <Kanban
      aria-label="Tasks"
      defaultValue={{ todo: ["a", "b"], doing: ["c"], done: [] }}
      {...props}
    >
      {(board) =>
        COLUMNS.map(([id, title]) => (
          <KanbanColumn key={id} value={id} data-testid={`col-${id}`}>
            <KanbanColumnHeader>
              <KanbanColumnTitle>{title}</KanbanColumnTitle>
            </KanbanColumnHeader>
            <KanbanList>
              {(board[id] ?? []).map((item) => (
                <KanbanItem key={item} value={item}>
                  {NAMES[item]}
                </KanbanItem>
              ))}
            </KanbanList>
          </KanbanColumn>
        ))
      }
    </Kanban>
  )
}
const ids = (col: string) =>
  [
    ...screen.getByTestId(`col-${col}`).querySelectorAll<HTMLElement>("[data-slot=kanban-item]"),
  ].map((el) => el.dataset.value)
const card = (name: string) => screen.getByText(name).closest("li") as HTMLElement
const live = () => screen.getByRole("status").textContent

await t("moveItem", () => {
  const b = { todo: ["a", "b"], doing: ["c"] }
  const n = moveItem(b, "a", "doing", 9)
  ok("moves across and clamps the index", n.todo?.join() === "b" && n.doing?.join() === "c,a")
  ok("does not change the input", b.todo.join() === "a,b")
})

await t("Kanban: ARIA", () => {
  render(<Board />)
  const a = card("Write copy")
  ok("cards are tab stops", a.tabIndex === 0)
  ok("role description", a.getAttribute("aria-roledescription") === "draggable card")
  const desc = document.getElementById(a.getAttribute("aria-describedby") ?? "")
  ok("described by the instructions", !!desc?.textContent?.includes("Space to pick up"))
  ok("columns are groups named by their title", !!screen.getByRole("group", { name: "Doing" }))
})

await t("Kanban: keyboard move across columns", async () => {
  const user = userEvent.setup()
  const changes: KanbanBoard[] = []
  const moves: KanbanMove[] = []
  render(<Board onValueChange={(b) => changes.push(b)} onItemMove={(m) => moves.push(m)} />)
  card("Write copy").focus()
  await user.keyboard(" ")
  ok("Space lifts", card("Write copy").dataset.lifted === "")
  ok("lift is announced", live() === "Picked up Write copy. To do, position 1 of 2.", live())
  await user.keyboard("{ArrowDown}")
  ok("ArrowDown reorders", ids("todo").join() === "b,a")
  ok("move is announced", live() === "Write copy: To do, position 2 of 2.", live())
  await user.keyboard("{ArrowRight}")
  ok(
    "ArrowRight moves to the next column",
    ids("doing").join() === "c,a" && ids("todo").join() === "b",
  )
  ok("focus follows the card", document.activeElement === card("Write copy"))
  ok("nothing committed before drop", changes.length === 0)
  await user.keyboard("{ArrowRight}{ArrowRight}")
  ok("stops at the last column", ids("done").join() === "a")
  await user.keyboard(" ")
  ok("Space drops", card("Write copy").dataset.lifted === undefined)
  ok("drop commits the board", changes.length === 1 && changes[0]?.done?.join() === "a")
  ok(
    "onItemMove has the move",
    moves[0]?.item === "a" &&
      moves[0]?.from === "todo" &&
      moves[0]?.to === "done" &&
      moves[0]?.index === 0,
  )
  ok("drop is announced", live() === "Dropped Write copy in Done, position 1 of 1.", live())
  ok("focus stays on the card", document.activeElement === card("Write copy"))
})

await t("Kanban: Escape cancels", async () => {
  const user = userEvent.setup()
  const changes: KanbanBoard[] = []
  render(<Board onValueChange={(b) => changes.push(b)} />)
  card("Fix bug").focus()
  await user.keyboard(" {ArrowRight}")
  ok("previewed in the next column", ids("doing").includes("b"))
  await user.keyboard("{Escape}")
  ok("Escape puts it back", ids("todo").join() === "a,b" && changes.length === 0)
  ok("cancel is announced", live() === "Cancelled. Fix bug is back where it was.", live())
  ok("focus returns to the card", document.activeElement === card("Fix bug"))
})

await t("Kanban: messages override", async () => {
  const user = userEvent.setup()
  render(
    <Kanban defaultValue={{ x: ["a"] }} messages={{ lifted: (i) => `Cogido ${i}` }}>
      <KanbanColumn value="x" label="Hacer">
        <KanbanList>
          <KanbanItem value="a" label="Tarea">
            A
          </KanbanItem>
        </KanbanList>
      </KanbanColumn>
    </Kanban>,
  )
  screen.getByText("A").focus()
  await user.keyboard(" ")
  ok("custom text and item label", live() === "Cogido Tarea", live())
  ok("column label prop names the group", !!screen.getByRole("group", { name: "Hacer" }))
})

await t("Kanban: pointer drag and drop", () => {
  const moves: KanbanMove[] = []
  render(<Board onItemMove={(m) => moves.push(m)} />)
  const c = card("Ship it")
  fireEvent.dragStart(c)
  ok("data-dragging while dragged", c.dataset.dragging === "")
  const done = screen.getByTestId("col-done")
  fireEvent.dragOver(done)
  ok("data-over on the target column", done.dataset.over === "")
  fireEvent.drop(done)
  ok("dropped into the column", ids("done").join() === "c" && ids("doing").length === 0)
  ok("onItemMove", moves[0]?.to === "done" && moves[0]?.from === "doing")
  ok("drag state clears", done.dataset.over === undefined)
})

await t("Kanban: controlled", async () => {
  const user = userEvent.setup()
  let last: KanbanBoard | undefined
  render(<Board value={{ todo: ["a"], doing: [], done: [] }} onValueChange={(b) => (last = b)} />)
  card("Write copy").focus()
  await user.keyboard(" {ArrowRight} ")
  ok("reports the change", last?.doing?.join() === "a")
  ok("stays as the parent says", ids("todo").join() === "a")
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
