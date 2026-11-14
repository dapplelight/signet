/**
 * Signet behaviours (signet-ui/behaviors): keyboard and state contracts the
 * components are built from. UI SDK implements them; these pin the Signet API.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { act, cleanup, render, screen } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { matchScore, useControllableState, useShortcut, useShortcutLabel } = await import(
  "../src/behaviors/index"
)

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
/** Presses mod+key whichever platform UI SDK detected. */
const pressMod = async (key: string) => {
  await userEvent.keyboard(`{Meta>}${key}{/Meta}`)
  await userEvent.keyboard(`{Control>}${key}{/Control}`)
}

await t("useShortcut", async () => {
  const hits: string[] = []
  function Probe({ keys, enabled }: { keys: string | null; enabled?: boolean }) {
    useShortcut(keys, () => hits.push(String(keys)), { enabled })
    return <input aria-label="field" />
  }
  const { rerender, unmount } = render(<Probe keys="mod+j" />)
  await pressMod("j")
  ok("useShortcut: mod+key runs the handler once per press", hits.length === 1, hits)
  await userEvent.keyboard("j")
  ok("useShortcut: the bare key does not", hits.length === 1)
  rerender(<Probe keys="mod+j" enabled={false} />)
  await pressMod("j")
  ok("useShortcut: enabled=false registers nothing", hits.length === 1)
  rerender(<Probe keys={null} />)
  await pressMod("j")
  ok("useShortcut: null registers nothing", hits.length === 1)
  rerender(<Probe keys="shift+?" />)
  await userEvent.keyboard("{Shift>}?{/Shift}")
  ok("useShortcut: other combinations", hits.at(-1) === "shift+?", hits)
  unmount()
  await pressMod("j")
  ok("useShortcut: unregisters on unmount", hits.filter((h) => h === "mod+j").length === 1)
})

await t("useShortcutLabel", async () => {
  function Label() {
    const { text, ariaKeyShortcuts } = useShortcutLabel("mod+k")
    return <kbd aria-keyshortcuts={ariaKeyShortcuts}>{text}</kbd>
  }
  render(<Label />)
  const kbd = document.querySelector("kbd") as HTMLElement
  ok(
    "useShortcutLabel: formats for the platform",
    /^(⌘K|Ctrl\+K)$/.test((kbd.textContent ?? "").replace(/[\u2066-\u2069]/g, "")),
    kbd.textContent,
  )
  ok(
    "useShortcutLabel: aria-keyshortcuts names the real keys",
    /(Meta|Control)\+K/i.test(kbd.getAttribute("aria-keyshortcuts") ?? ""),
    kbd.getAttribute("aria-keyshortcuts"),
  )
})

await t("useControllableState", async () => {
  const seen: boolean[] = []
  function Toggle({ value }: { value?: boolean }) {
    const [on, setOn] = useControllableState({
      value,
      defaultValue: false,
      onChange: (v) => seen.push(v),
    })
    return (
      <button type="button" aria-pressed={on} onClick={() => setOn(!on)}>
        Toggle
      </button>
    )
  }
  const { rerender } = render(<Toggle />)
  const button = screen.getByRole("button")
  await userEvent.click(button)
  ok(
    "useControllableState: uncontrolled updates itself",
    button.getAttribute("aria-pressed") === "true",
  )
  ok("useControllableState: and reports the change", seen.at(-1) === true)
  rerender(<Toggle value={false} />)
  await userEvent.click(button)
  ok(
    "useControllableState: controlled stays on the prop",
    button.getAttribute("aria-pressed") === "false",
  )
  ok("useControllableState: and asks for the change", seen.at(-1) === true && seen.length === 2)
  await act(async () => rerender(<Toggle value={true} />))
  ok("useControllableState: follows the prop", button.getAttribute("aria-pressed") === "true")
})

await t("matchScore", () => {
  ok("matchScore: same text is 1", matchScore("Settings", "settings") === 1)
  ok("matchScore: letters in order match", matchScore("Settings", "stg") > 0)
  ok("matchScore: out of order does not", matchScore("Settings", "gts") === 0)
  ok("matchScore: ignores accents", matchScore("Café", "cafe") > 0)
  ok(
    "matchScore: prefix beats scattered",
    matchScore("Settings", "set") > matchScore("Reset things", "set"),
  )
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
