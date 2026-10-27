/**
 * Shortcuts on TanStack Hotkeys, in happy-dom: the ? overlay lists what is
 * registered, and j/k list navigation, including with DataTable.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { useState } = await import("react")
const { useHotkey, useHotkeySequence } = await import("@tanstack/react-hotkeys")
const { ShortcutsHelp, useListNavigation } = await import("../src/components/ui/shortcuts")
const { DataTable } = await import("../src/components/ui/data-table")

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
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }
}

// --- the ? overlay ---
await t("overlay", async () => {
  const fired: string[] = []
  function App() {
    useHotkey("Mod+K", () => fired.push("search"), {
      meta: { name: "Search", description: "Find a job", group: "General" },
    })
    useHotkeySequence(["G", "I"], () => fired.push("inbox"), {
      meta: { name: "Go to inbox", group: "Go to" },
    })
    useHotkey("X", () => fired.push("x")) // no meta: works, not listed
    return (
      <>
        <Twin />
        <Twin />
        <ShortcutsHelp />
      </>
    )
  }
  // The same described key mounted twice (two lists on screen): listed once.
  function Twin() {
    useHotkey("R", () => {}, {
      meta: { name: "Refresh", group: "General" },
      conflictBehavior: "allow",
    } as never)
    return null
  }
  render(<App />)
  ok("overlay: closed at first", !screen.queryByRole("dialog"))
  await userEvent.keyboard("?")
  const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" })
  ok("overlay: ? opens it", !!dialog)
  const general = within(dialog).getByRole("region", { name: "General" })
  ok(
    "overlay: a described hotkey is listed in its group",
    within(general).getByText("Search") !== null,
  )
  ok(
    "overlay: its description shows under the name",
    within(general).getByText("Find a job") !== null,
  )
  ok(
    "overlay: the ? key lists itself",
    within(general).getByText("Show keyboard shortcuts") !== null,
  )
  const goTo = within(dialog).getByRole("region", { name: "Go to" })
  const seq = within(goTo).getByText("Go to inbox").closest("div")?.querySelector("dd")
  ok(
    "overlay: a sequence shows its steps with 'then'",
    seq?.querySelector(".sr-only")?.textContent === "G then I",
    seq?.textContent,
  )
  ok("overlay: keys are drawn with Kbd", (seq?.querySelectorAll("kbd").length ?? 0) === 2)
  const listed = [...dialog.querySelectorAll("dt")].map((d) => d.firstChild?.textContent)
  ok(
    "overlay: exactly the described keys, each once",
    JSON.stringify(listed.sort()) ===
      JSON.stringify(["Go to inbox", "Refresh", "Search", "Show keyboard shortcuts"]),
    listed,
  )
  await userEvent.keyboard("{Escape}")
  await userEvent.keyboard("x")
  ok("overlay: undescribed hotkeys still fire", fired.includes("x"))
})

await t("overlay controlled, no help key", async () => {
  function App() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Shortcuts
        </button>
        <ShortcutsHelp helpKey={false} open={open} onOpenChange={setOpen} title="Keys" />
      </>
    )
  }
  render(<App />)
  await userEvent.keyboard("?")
  ok("helpKey=false: ? does nothing", !screen.queryByRole("dialog"))
  await userEvent.click(screen.getByRole("button", { name: "Shortcuts" }))
  ok("controlled: the app opens it, with its title", !!screen.getByRole("dialog", { name: "Keys" }))
})

// --- list navigation ---
const IDS = ["a", "b", "c"]
function List(props: { onOpen?: (id: string) => void; arrows?: boolean; enabled?: boolean }) {
  const { activeId } = useListNavigation({ ids: IDS, ...props })
  return (
    <>
      <output data-testid="active">{activeId ?? "none"}</output>
      <input aria-label="search" />
      <button type="button">Other</button>
    </>
  )
}
const active = () => screen.getByTestId("active").textContent

await t("j/k", async () => {
  render(<List />)
  await userEvent.keyboard("j")
  ok("j: from none to the first", active() === "a")
  await userEvent.keyboard("jjj")
  ok("j: stops at the last", active() === "c")
  await userEvent.keyboard("k")
  ok("k: back one", active() === "b")
  await userEvent.click(screen.getByLabelText("search"))
  await userEvent.keyboard("j")
  ok("j while typing in a field: ignored", active() === "b")
})

await t("k from none", async () => {
  render(<List />)
  await userEvent.keyboard("k")
  ok("k: from none to the last", active() === "c")
})

await t("arrows", async () => {
  render(<List />)
  await userEvent.keyboard("{ArrowDown}")
  ok("arrows: off by default (page scrolling keeps working)", active() === "none")
  cleanup()
  render(<List arrows />)
  await userEvent.keyboard("{ArrowDown}{ArrowDown}")
  ok("arrows: on with arrows", active() === "b")
})

await t("Enter", async () => {
  const opened: string[] = []
  render(<List onOpen={(id) => opened.push(id)} />)
  await userEvent.keyboard("{Enter}")
  ok("Enter with nothing active: nothing opens", opened.length === 0)
  await userEvent.keyboard("jj{Enter}")
  ok("Enter opens the active item", opened.join() === "b")
  screen.getByRole("button", { name: "Other" }).focus()
  await userEvent.keyboard("{Enter}")
  ok("Enter on a focused button is left to the button", opened.join() === "b")
})

await t("enabled", async () => {
  render(<List enabled={false} />)
  await userEvent.keyboard("j")
  ok("enabled=false: keys do nothing", active() === "none")
})

// --- with DataTable ---
await t("DataTable", async () => {
  type R = { id: string; name: string }
  const rows: R[] = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }))
  function Jobs() {
    const { activeId } = useListNavigation({ ids: rows.map((r) => r.id) })
    return (
      <DataTable
        columns={[{ accessorKey: "name", header: "Name" }]}
        data={rows}
        getRowId={(r) => r.id}
        virtual={{ rowHeight: 30, height: 300 }}
        {...(activeId ? { activeRowId: activeId } : {})}
      />
    )
  }
  const { container } = render(<Jobs />)
  await userEvent.keyboard("jjj")
  ok(
    "DataTable: j moves the active row",
    container.querySelector("[data-active=true]")?.textContent === "Row 2",
  )
})

console.log(`\n${pass} passed, ${fail} failed`)
await GlobalRegistrator.unregister()
if (fail) throw new Error(`${fail} failed`)
