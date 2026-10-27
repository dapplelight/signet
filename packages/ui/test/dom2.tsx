/**
 * DOM rendering checks for the components dom.tsx does not cover: Select,
 * Combobox, Calendar (interactive), InputOTP, Slider, Tooltip.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { act, cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { useState } = await import("react")
const { Calendar } = await import("../src/components/ui/calendar")
const {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} = await import("../src/components/ui/combobox")
const { InputOTP, InputOTPGroup, InputOTPSlot } = await import("../src/components/ui/input-otp")
const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } = await import(
  "../src/components/ui/select"
)
const { Slider } = await import("../src/components/ui/slider")
const { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } = await import(
  "../src/components/ui/tooltip"
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

// --- Select ---
// The interactive popup (open, pick an item) is not exercised here: base-ui's
// Select positions its Popup with layout math happy-dom does not implement,
// which throws during that render in this environment (works in real
// browsers and in Playwright — app-a's e2e suite covers the open/pick flow).
// This checks the static, closed render: value, accessible name, disabled.
await t("Select (static)", async () => {
  const { unmount } = render(
    <Select defaultValue="food" disabled={false}>
      <SelectTrigger aria-label="Category">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="food">Food</SelectItem>
        <SelectItem value="rent">Rent</SelectItem>
      </SelectContent>
    </Select>,
  )
  const trigger = screen.getByRole("combobox", { name: "Category" })
  ok("Select: shows the default value", trigger.textContent.includes("food"), trigger.textContent)
  ok("Select: closed at first", trigger.getAttribute("aria-expanded") === "false")
  ok("Select: not disabled by default", trigger.getAttribute("data-disabled") === null)
  unmount()
  render(
    <Select defaultValue="food" disabled>
      <SelectTrigger aria-label="Category">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="food">Food</SelectItem>
      </SelectContent>
    </Select>,
  )
  ok(
    "Select: disabled marks the trigger",
    screen.getByRole("combobox").hasAttribute("data-disabled"),
  )
})

// --- Combobox ---
// Same environment limitation as Select: the open/filter/pick flow needs a
// real browser's layout math. This checks the static render only.
await t("Combobox (static)", async () => {
  render(
    <Combobox items={["Food", "Rent"]} defaultValue="Food">
      <ComboboxTrigger aria-label="Merchant">
        <ComboboxValue />
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput aria-label="Search merchant" />
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>,
  )
  const trigger = screen.getByRole("combobox", { name: "Merchant" })
  ok("Combobox: shows the default value", trigger.textContent === "Food")
  ok("Combobox: closed at first", trigger.getAttribute("aria-expanded") === "false")
})

// --- Calendar ---
await t("Calendar", async () => {
  let picked: Date | undefined
  function App() {
    const [date, setDate] = useState<Date | undefined>(new Date(2026, 8, 15))
    return (
      <Calendar
        mode="single"
        selected={date}
        onSelect={(d) => {
          setDate(d)
          picked = d
        }}
        month={new Date(2026, 8, 1)}
      />
    )
  }
  render(<App />)
  const day20 = screen.getByRole("gridcell", { name: /20/ }).querySelector("button") as HTMLElement
  await userEvent.click(day20)
  ok(
    "Calendar: clicking a day calls onSelect with that date",
    picked?.getDate() === 20 && picked?.getMonth() === 8,
  )
  const after20 = screen
    .getByRole("gridcell", { name: /20/ })
    .querySelector("button") as HTMLElement
  ok(
    "Calendar: the newly selected day is marked",
    after20.getAttribute("data-selected-single") === "true",
    after20.outerHTML,
  )
})

// --- InputOTP ---
await t("InputOTP", async () => {
  const values: string[] = []
  render(
    <InputOTP maxLength={4} onChange={(v) => values.push(v)}>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
        <InputOTPSlot index={3} />
      </InputOTPGroup>
    </InputOTP>,
  )
  const hidden = document.querySelector("input") as HTMLInputElement
  await userEvent.click(hidden)
  await userEvent.keyboard("1234")
  ok("InputOTP: typing fills the hidden input", hidden.value === "1234")
  ok("InputOTP: onChange gets the final value", values.at(-1) === "1234")
  const slots = document.querySelectorAll("[data-slot=input-otp-slot]")
  ok(
    "InputOTP: each slot shows its digit",
    [...slots].map((s) => s.textContent).join() === "1,2,3,4",
    [...slots].map((s) => s.textContent),
  )
})

// --- Slider ---
await t("Slider", async () => {
  const values: number[][] = []
  render(
    <Slider
      defaultValue={[30]}
      min={0}
      max={100}
      step={10}
      onValueChange={(v) => values.push(v as number[])}
      aria-label="Budget"
    />,
  )
  // happy-dom does not map input[type=range]'s implicit role to "slider";
  // getByLabelText works regardless, and is what a real screen reader keys off.
  const thumb = screen.getByLabelText("Budget") as HTMLInputElement
  ok("Slider: reports its starting value", thumb.getAttribute("aria-valuenow") === "30")
  thumb.focus()
  await userEvent.keyboard("{ArrowRight}")
  ok("Slider: ArrowRight increases by one step", thumb.getAttribute("aria-valuenow") === "40")
  ok("Slider: onValueChange fired with the new value", values.at(-1)?.[0] === 40, values)
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}")
  ok("Slider: ArrowLeft decreases", thumb.getAttribute("aria-valuenow") === "20")
})

// --- Tooltip ---
await t("Tooltip", async () => {
  render(
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>Helpful text</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  )
  ok("Tooltip: closed at first", !screen.queryByText("Helpful text"))
  const trigger = screen.getByText("Hover me")
  await act(async () => {
    trigger.dispatchEvent(new Event("pointerenter", { bubbles: true }))
    trigger.focus()
  })
  await waitFor(
    () =>
      ok("Tooltip: focusing the trigger shows its content", !!screen.queryByText("Helpful text")),
    {
      timeout: 2000,
    },
  )
})

await t("EmojiPicker", async () => {
  const { EmojiPicker } = await import("../src/components/ui/emoji-picker")
  function App() {
    const [v, setV] = useState("🎯")
    return (
      <>
        <EmojiPicker value={v} onChange={setV} label="Goal icon" />
        <span data-testid="picked">{v}</span>
      </>
    )
  }
  render(<App />)
  await userEvent.click(screen.getByRole("button", { name: "Goal icon" }))
  await userEvent.click(await screen.findByRole("option", { name: "🏠" }))
  ok(
    "EmojiPicker: picking an emoji calls onChange",
    screen.getByTestId("picked").textContent === "🏠",
  )
  await userEvent.click(screen.getByRole("button", { name: "Goal icon" }))
  await userEvent.type(await screen.findByLabelText("Other emoji"), "🦄{Enter}")
  ok("EmojiPicker: 'Other' accepts any emoji", screen.getByTestId("picked").textContent === "🦄")
})

console.log(`\n${pass} passed, ${fail} failed`)
await GlobalRegistrator.unregister()
if (fail) throw new Error(`${fail} failed`)
