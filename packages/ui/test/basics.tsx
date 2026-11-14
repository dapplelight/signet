/**
 * Keyboard, focus and ARIA checks for the components built on UI SDK
 * (toast, alert-dialog, field, avatar, radio-group, command, timeline,
 * stepper) and the ones composed here (sidebar, breadcrumb, spinner).
 * UI SDK is in beta; these pin the behaviour Signet relies on, so an upgrade
 * that changes it fails here first.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { act, cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { useState } = await import("react")
const { Toaster, toast } = await import("../src/components/ui/toast")
const {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} = await import("../src/components/ui/alert-dialog")
const { Field, FieldControl, FieldDescription, FieldError, FieldLabel } = await import(
  "../src/components/ui/field"
)
const { Avatar, AvatarFallback, AvatarImage, initials } = await import(
  "../src/components/ui/avatar"
)
const { RadioGroup, RadioGroupItem } = await import("../src/components/ui/radio-group")
const {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} = await import("../src/components/ui/command")
const { Timeline, TimelineItem, TimelineTime, TimelineTitle } = await import(
  "../src/components/ui/timeline"
)
const { Stepper } = await import("../src/components/ui/stepper")
const {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} = await import("../src/components/ui/sidebar")
const {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} = await import("../src/components/ui/breadcrumb")
const { Spinner } = await import("../src/components/ui/spinner")
const { Button } = await import("../src/components/ui/button")

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
/** UI SDK writes cross-part ARIA (labelledby, describedby) a tick after mount. */
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 20)))
/** happy-dom has no matchMedia by default; force the desktop or phone layout. */
const setDesktop = (desktop: boolean) => {
  window.matchMedia = ((q: string) => ({
    matches: desktop,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
}

// --- Toast ---
await t("Toast", async () => {
  render(<Toaster />)
  let undone = false
  await act(async () => {
    toast("Event created", {
      description: "Friday at 10:00",
      action: { label: "Undo", onClick: () => (undone = true) },
    })
  })
  const region = screen.getByRole("region", { name: "Notifications" })
  ok("Toast: region is a landmark named Notifications", !!region)
  ok("Toast: F6 is announced as its shortcut", region.getAttribute("aria-keyshortcuts") === "F6")
  ok("Toast: shows title and description", region.textContent.includes("Friday at 10:00"))
  const item = region.querySelector("[data-slot=toast]") as HTMLElement
  ok("Toast: named by its title", !!item.getAttribute("aria-labelledby"))
  ok(
    "Toast: default position bottom end",
    region.dataset.side === "bottom" && region.dataset.align === "end",
  )
  await userEvent.click(screen.getByRole("button", { name: "Undo" }))
  ok("Toast: action runs onClick", undone)
  await waitFor(() => ok("Toast: action dismisses it", !screen.queryByText("Event created")))

  await act(async () => {
    toast.error("Couldn't save")
  })
  const err = screen.getByText("Couldn't save").closest("[data-slot=toast]") as HTMLElement
  ok("Toast: error type is exposed as data-type", err.dataset.type === "error")
  // F6 moves focus into the region; Escape dismisses the focused toast.
  const before = document.createElement("button")
  document.body.append(before)
  before.focus()
  await userEvent.keyboard("{F6}")
  ok("Toast: F6 focuses the newest toast", document.activeElement === err)
  await userEvent.keyboard("{Escape}")
  await waitFor(() =>
    ok("Toast: Escape dismisses the focused toast", !screen.queryByText("Couldn't save")),
  )
  before.remove()

  const id = await act(async () => toast.loading("Uploading"))
  await act(async () => {
    toast.success("Uploaded", { id })
  })
  ok(
    "Toast: reusing an id updates in place",
    !screen.queryByText("Uploading") && !!screen.queryByText("Uploaded"),
  )
  await act(async () => toast.dismiss())
})

await t("Toast: position and close button", async () => {
  render(<Toaster position="top-center" closeButton label="Alerts" />)
  await act(async () => {
    toast.info("Heads up")
  })
  const region = screen.getByRole("region", { name: "Alerts" })
  ok(
    "Toaster: position maps to side/align",
    region.dataset.side === "top" && region.dataset.align === "center",
  )
  await userEvent.click(screen.getByRole("button", { name: "Close" }))
  await waitFor(() => ok("Toaster: close button dismisses", !screen.queryByText("Heads up")))
})

// --- AlertDialog ---
await t("AlertDialog", async () => {
  let confirmed = 0
  render(
    <AlertDialog>
      <AlertDialogTrigger>Delete project</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Delete this project?</AlertDialogTitle>
        <AlertDialogDescription>Its files go too.</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction action={() => void confirmed++}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  )
  const trigger = screen.getByRole("button", { name: "Delete project" })
  ok(
    "AlertDialog: trigger says it opens a dialog",
    trigger.getAttribute("aria-haspopup") === "dialog",
  )
  await userEvent.click(trigger)
  const dialog = screen.getByRole("alertdialog", { name: "Delete this project?" })
  ok("AlertDialog: role alertdialog, named by its title", !!dialog)
  ok("AlertDialog: described by its description", !!dialog.getAttribute("aria-describedby"))
  ok("AlertDialog: modal", dialog.getAttribute("aria-modal") === "true")
  ok("AlertDialog: focus starts on Cancel", document.activeElement?.textContent === "Cancel")
  await userEvent.keyboard("{Escape}")
  ok("AlertDialog: Escape closes", !screen.queryByRole("alertdialog"))
  await waitFor(() =>
    ok("AlertDialog: focus returns to the trigger", document.activeElement === trigger),
  )
  await userEvent.click(trigger)
  await userEvent.click(screen.getByRole("button", { name: "Delete" }))
  ok("AlertDialog: action runs and closes", confirmed === 1 && !screen.queryByRole("alertdialog"))
})

await t("AlertDialog: Tab stays inside", async () => {
  render(
    <>
      <button type="button">Outside</button>
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogTitle>Leave?</AlertDialogTitle>
          <AlertDialogCancel>Stay</AlertDialogCancel>
          <AlertDialogAction>Leave</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    </>,
  )
  await waitFor(() => screen.getByRole("alertdialog"))
  screen.getByRole("button", { name: "Stay" }).focus()
  await userEvent.tab()
  await userEvent.tab()
  ok(
    "AlertDialog: Tab cycles within the dialog",
    screen.getByRole("alertdialog").contains(document.activeElement),
    document.activeElement?.textContent,
  )
})

// --- Field ---
await t("Field", async () => {
  const { rerender } = render(
    <Field>
      <FieldLabel>Email</FieldLabel>
      <FieldControl type="email" />
      <FieldDescription>We never share it.</FieldDescription>
      <FieldError />
    </Field>,
  )
  const input = screen.getByRole("textbox", { name: "Email" })
  ok("Field: label names the control", !!input)
  ok(
    "Field: renders Signet's Input",
    input.getAttribute("data-slot") === "field-control" && input.className.includes("rounded-lg"),
  )
  ok(
    "Field: description describes it",
    screen.getByRole("textbox", { description: "We never share it." }) === input,
  )
  ok("Field: not invalid without errors", input.getAttribute("aria-invalid") === null)
  ok(
    "Field: no error text without errors",
    !document.querySelector("[data-slot=field-error]")?.textContent,
  )
  await userEvent.click(screen.getByText("Email"))
  ok("Field: clicking the label focuses the control", document.activeElement === input)

  // TanStack Form's errors: Standard Schema issues and strings, mixed, duplicated.
  rerender(
    <Field errors={[{ message: "Enter a valid email" }, "Enter a valid email", undefined]}>
      <FieldLabel>Email</FieldLabel>
      <FieldControl type="email" />
      <FieldDescription>We never share it.</FieldDescription>
      <FieldError />
    </Field>,
  )
  const invalid = screen.getByRole("textbox", { name: "Email" })
  await tick()
  ok("Field: errors mark the control aria-invalid", invalid.getAttribute("aria-invalid") === "true")
  const shown = document.querySelector("[data-slot=field-error]")
  ok(
    "Field: shows the first message once",
    shown?.textContent === "Enter a valid email",
    shown?.textContent,
  )
  ok(
    "Field: the error describes the control",
    (invalid.getAttribute("aria-describedby") ?? "").includes(shown?.id ?? "-"),
  )
  ok("Field: label marked invalid too", screen.getByText("Email").hasAttribute("data-invalid"))
})

await t("Field: custom control and disabled", async () => {
  render(
    <Field disabled>
      <FieldLabel>Notes</FieldLabel>
      <FieldControl render={<textarea />} />
    </Field>,
  )
  const ta = screen.getByRole("textbox", { name: "Notes" })
  ok("Field: render swaps the control element", ta.tagName === "TEXTAREA")
  ok("Field: disabled reaches the control", (ta as HTMLTextAreaElement).disabled)
})

// --- Avatar ---
await t("Avatar", async () => {
  render(
    <Avatar>
      <AvatarImage alt="Ada Lovelace" />
      <AvatarFallback>{initials("Ada Lovelace")}</AvatarFallback>
    </Avatar>,
  )
  ok("Avatar: fallback shows initials while no image loads", !!screen.getByText("AL"))
  ok(
    "Avatar: a failed image is hidden from screen readers",
    document.querySelector("img")?.getAttribute("aria-hidden") === "true",
  )
  ok(
    "Avatar: root is sized by the theme",
    (document.querySelector("[data-slot=avatar]") as HTMLElement).className.includes("size-8"),
  )
  ok("initials: two words", initials("Grace Brewster Hopper") === "GH")
  ok("initials: one word", initials(" grace ") === "G")
  ok("initials: empty", initials("") === "")
})

// --- RadioGroup ---
await t("RadioGroup", async () => {
  const Plan = () => {
    const [v, setV] = useState<string | null>("monthly")
    return (
      <>
        <RadioGroup
          aria-label="Plan"
          value={v}
          onValueChange={(next) => setV(next as string | null)}
        >
          {/* biome-ignore lint/a11y/noLabelWithoutControl: RadioGroupItem is the control */}
          <label>
            <RadioGroupItem value="monthly" /> Monthly
          </label>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: RadioGroupItem is the control */}
          <label>
            <RadioGroupItem value="yearly" /> Yearly
          </label>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: RadioGroupItem is the control */}
          <label>
            <RadioGroupItem value="lifetime" disabled /> Lifetime
          </label>
        </RadioGroup>
        <output>{v}</output>
      </>
    )
  }
  render(<Plan />)
  const group = screen.getByRole("radiogroup", { name: "Plan" })
  ok("RadioGroup: named radiogroup", !!group)
  await userEvent.tab()
  const monthly = screen.getByRole("radio", { name: "Monthly" })
  ok("RadioGroup: Tab lands on the checked radio", document.activeElement === monthly)
  await userEvent.keyboard("{ArrowDown}")
  const yearly = screen.getByRole("radio", { name: "Yearly" })
  ok(
    "RadioGroup: arrow moves and checks",
    document.activeElement === yearly && yearly.getAttribute("aria-checked") === "true",
  )
  ok("RadioGroup: controlled value follows", screen.getByText("yearly").tagName === "OUTPUT")
  await userEvent.keyboard("{ArrowDown}")
  ok("RadioGroup: arrow skips disabled (wraps to first)", document.activeElement === monthly)
  await userEvent.click(screen.getByText("Yearly"))
  ok("RadioGroup: clicking the label checks", yearly.getAttribute("aria-checked") === "true")
  await userEvent.tab()
  ok("RadioGroup: Tab leaves after one stop", !group.contains(document.activeElement))
})

// --- Command ---
const Items = () => (
  <>
    <CommandInput aria-label="Search commands" placeholder="Search" />
    <CommandEmpty>No results.</CommandEmpty>
    <CommandList>
      <CommandGroup heading="Pages">
        <CommandItem value="home">Home</CommandItem>
        <CommandItem value="settings" keywords={["preferences"]}>
          Settings
        </CommandItem>
        <CommandItem value="billing" disabled>
          Billing
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </>
)

await t("Command", async () => {
  const ran: string[] = []
  render(
    <Command onAction={(v) => void ran.push(v)}>
      <Items />
    </Command>,
  )
  const input = screen.getByRole("combobox", { name: "Search commands" })
  ok(
    "Command: input is a combobox controlling a listbox",
    !!screen.getByRole("listbox") && !!input.getAttribute("aria-controls"),
  )
  ok(
    "Command: group is named by its heading",
    !!(await screen.findByRole("group", { name: "Pages" })),
  )
  await userEvent.click(input)
  ok(
    "Command: first item highlighted",
    screen.getByRole("option", { name: "Home" }).hasAttribute("data-highlighted"),
  )
  await userEvent.keyboard("{ArrowDown}")
  const settings = screen.getByRole("option", { name: "Settings" })
  ok(
    "Command: arrow moves the highlight, focus stays in input",
    settings.hasAttribute("data-highlighted") && document.activeElement === input,
  )
  ok(
    "Command: aria-activedescendant follows",
    input.getAttribute("aria-activedescendant") === settings.id,
  )
  await userEvent.keyboard("{ArrowDown}")
  ok(
    "Command: disabled item is skipped",
    !screen.getByRole("option", { name: "Billing" }).hasAttribute("data-highlighted"),
  )
  await userEvent.keyboard("{Enter}")
  ok(
    "Command: Enter runs the highlighted item",
    ran.at(-1) === "home" || ran.at(-1) === "settings",
    ran,
  )
  await userEvent.keyboard("prefer")
  const visible = screen.queryAllByRole("option").map((o) => o.textContent)
  ok("Command: keywords match", visible.length === 1 && visible[0] === "Settings", visible)
  await userEvent.clear(input)
  await userEvent.keyboard("zzz")
  ok(
    "Command: empty state shows",
    !!screen.getByText("No results.") && screen.queryAllByRole("option").length === 0,
  )
})

await t("CommandDialog", async () => {
  const ran: string[] = []
  render(
    <CommandDialog onAction={(v) => void ran.push(v)}>
      <Items />
    </CommandDialog>,
  )
  ok("CommandDialog: closed at first", !screen.queryByRole("dialog"))
  await userEvent.keyboard("{Meta>}k{/Meta}")
  if (!screen.queryByRole("dialog")) await userEvent.keyboard("{Control>}k{/Control}")
  const dialog = await waitFor(() => screen.getByRole("dialog", { name: "Command palette" }))
  ok("CommandDialog: ⌘K / Ctrl+K opens a named dialog", !!dialog)
  await waitFor(() =>
    ok(
      "CommandDialog: focus moves to the search input",
      document.activeElement === screen.getByRole("combobox"),
    ),
  )
  await userEvent.keyboard("sett{Enter}")
  ok("CommandDialog: running a command reports it", ran[0] === "settings", ran)
  await waitFor(() => ok("CommandDialog: and closes", !screen.queryByRole("dialog")))
})

// --- Timeline ---
await t("Timeline", async () => {
  render(
    <Timeline aria-label="Activity">
      <TimelineItem status="complete">
        <TimelineTitle>Ordered</TimelineTitle>
        <TimelineTime dateTime="2026-11-01">1 Nov</TimelineTime>
      </TimelineItem>
      <TimelineItem status="current">
        <TimelineTitle>Shipped</TimelineTitle>
      </TimelineItem>
      <TimelineItem status="upcoming">
        <TimelineTitle>Delivered</TimelineTitle>
      </TimelineItem>
    </Timeline>,
  )
  await tick()
  ok("Timeline: a named list", !!screen.getByRole("list", { name: "Activity" }))
  ok("Timeline: items are list items", screen.getAllByRole("listitem").length === 3)
  const ordered = screen.getByRole("listitem", { name: "Ordered" })
  ok(
    "Timeline: an item is named by its title, described by its time",
    (ordered.getAttribute("aria-describedby") ?? "") !== "",
  )
  await userEvent.tab()
  const shipped = screen.getByRole("listitem", { name: "Shipped" })
  ok("Timeline: Tab lands on the current item", document.activeElement === shipped)
  ok(
    "Timeline: current item has aria-current=step",
    shipped.getAttribute("aria-current") === "step",
  )
  await userEvent.keyboard("{ArrowDown}")
  ok(
    "Timeline: ArrowDown moves on",
    document.activeElement === screen.getByRole("listitem", { name: "Delivered" }),
  )
  await userEvent.keyboard("{Home}")
  ok("Timeline: Home goes to the first", document.activeElement === ordered)
  await userEvent.tab()
  ok("Timeline: one tab stop", !screen.getByRole("list").contains(document.activeElement))
  ok(
    "Timeline: time is machine readable",
    document.querySelector("time")?.getAttribute("datetime") === "2026-11-01",
  )
})

// --- Stepper ---
await t("Stepper", async () => {
  render(
    <Stepper
      aria-label="Checkout"
      current={1}
      steps={[{ title: "Cart" }, { title: "Address", description: "Where to" }, { title: "Pay" }]}
    />,
  )
  await tick()
  const list = screen.getByRole("list", { name: "Checkout" })
  ok("Stepper: a named list of steps", screen.getAllByRole("listitem").length === 3 && !!list)
  const address = screen.getByRole("listitem", { name: "Address" })
  ok("Stepper: current step has aria-current=step", address.getAttribute("aria-current") === "step")
  ok(
    "Stepper: earlier steps complete",
    screen.getByRole("listitem", { name: "Cart" }).hasAttribute("data-complete"),
  )
  ok(
    "Stepper: later steps upcoming",
    screen.getByRole("listitem", { name: "Pay" }).hasAttribute("data-upcoming"),
  )
  ok(
    "Stepper: upcoming steps show their number",
    screen.getByRole("listitem", { name: "Pay" }).textContent.includes("3"),
  )
  await userEvent.tab()
  ok("Stepper: Tab lands on the current step", document.activeElement === address)
  await userEvent.keyboard("{ArrowRight}")
  ok(
    "Stepper: ArrowRight moves on",
    document.activeElement === screen.getByRole("listitem", { name: "Pay" }),
  )
  await userEvent.keyboard("{ArrowRight}")
  ok(
    "Stepper: does not wrap",
    document.activeElement === screen.getByRole("listitem", { name: "Pay" }),
  )
})

// --- Sidebar ---
const Shell = () => (
  <SidebarProvider>
    <Sidebar aria-label="Main">
      <SidebarContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive>
              <svg aria-hidden="true" />
              <span>Home</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton render={<a href="/settings">x</a>}>
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
    <main>
      <SidebarTrigger />
    </main>
  </SidebarProvider>
)

await t("Sidebar (desktop)", async () => {
  setDesktop(true)
  render(<Shell />)
  const aside = screen.getByRole("complementary", { name: "Main" })
  const trigger = screen.getByRole("button", { name: "Toggle sidebar" })
  ok("Sidebar: trigger controls the panel", trigger.getAttribute("aria-controls") === aside.id)
  ok(
    "Sidebar: starts expanded",
    trigger.getAttribute("aria-expanded") === "true" && aside.dataset.state === "expanded",
  )
  ok(
    "Sidebar: active item is the current page",
    screen.getByRole("button", { name: "Home" }).getAttribute("aria-current") === "page",
  )
  ok(
    "Sidebar: render makes a link",
    screen.getByRole("link", { name: "Settings" }).getAttribute("href") === "/settings",
  )
  await userEvent.click(trigger)
  ok(
    "Sidebar: trigger collapses to icons",
    aside.dataset.collapsible === "icon" && trigger.getAttribute("aria-expanded") === "false",
  )
  ok(
    "Sidebar: labels stay for screen readers when collapsed",
    !!screen.getByRole("button", { name: "Home" }),
  )
  await userEvent.keyboard("{Meta>}b{/Meta}")
  if (aside.dataset.state !== "expanded") await userEvent.keyboard("{Control>}b{/Control}")
  ok("Sidebar: ⌘B / Ctrl+B toggles", aside.dataset.state === "expanded")
})

await t("Sidebar (offcanvas)", async () => {
  setDesktop(true)
  render(
    <SidebarProvider defaultOpen={false}>
      <Sidebar collapsible="offcanvas">
        <button type="button">Inside</button>
      </Sidebar>
    </SidebarProvider>,
  )
  const aside = document.querySelector("[data-slot=sidebar]") as HTMLElement
  ok("Sidebar: collapsed off-canvas is inert", aside.hasAttribute("inert"))
})

await t("Sidebar (phone)", async () => {
  setDesktop(false)
  render(<Shell />)
  ok(
    "Sidebar: hidden on phones until opened",
    !screen.queryByRole("complementary", { name: "Main" }),
  )
  const trigger = screen.getByRole("button", { name: "Toggle sidebar" })
  ok("Sidebar: trigger reports closed", trigger.getAttribute("aria-expanded") === "false")
  await userEvent.click(trigger)
  await waitFor(() => screen.getByRole("dialog"))
  ok("Sidebar: opens as a drawer", !!screen.getByRole("complementary", { name: "Main" }))
  await userEvent.keyboard("{Escape}")
  await waitFor(() =>
    ok("Sidebar: Escape closes the drawer", trigger.getAttribute("aria-expanded") === "false"),
  )
  setDesktop(true)
})

// --- Breadcrumb ---
await t("Breadcrumb", async () => {
  render(
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink render={<a href="/x" className="router" />} href="/docs">
            Docs
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Field</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>,
  )
  ok(
    "Breadcrumb: nav landmark named Breadcrumb",
    !!screen.getByRole("navigation", { name: "Breadcrumb" }),
  )
  ok("Breadcrumb: crumbs are an ordered list", screen.getByRole("list").tagName === "OL")
  ok("Breadcrumb: separators are hidden", screen.getAllByRole("listitem").length === 3)
  ok(
    "Breadcrumb: last crumb is the current page",
    screen.getByText("Field").getAttribute("aria-current") === "page",
  )
  const docs = screen.getByRole("link", { name: "Docs" })
  ok(
    "Breadcrumb: render keeps the router element and merges",
    docs.getAttribute("href") === "/docs" && docs.className.includes("router"),
  )
  await userEvent.tab()
  ok(
    "Breadcrumb: links are in the tab order",
    document.activeElement === screen.getByRole("link", { name: "Home" }),
  )
})

// --- Spinner ---
await t("Spinner", async () => {
  render(
    <>
      <Spinner />
      <Spinner aria-label="Saving" />
    </>,
  )
  ok("Spinner: status named Loading", !!screen.getByRole("status", { name: "Loading" }))
  ok("Spinner: name can be changed", !!screen.getByRole("status", { name: "Saving" }))
  ok(
    "Spinner: stops under reduced motion",
    screen
      .getByRole("status", { name: "Loading" })
      .getAttribute("class")
      ?.includes("motion-reduce:animate-none") === true,
  )
})

// --- Trigger with a Signet Button ---
await t("AlertDialog: Signet Button as the trigger", async () => {
  render(
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" />}>Remove</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Remove?</AlertDialogTitle>
        <AlertDialogCancel>No</AlertDialogCancel>
      </AlertDialogContent>
    </AlertDialog>,
  )
  const trigger = screen.getByRole("button", { name: "Remove" })
  ok(
    "AlertDialog: render keeps the Button's look",
    trigger.getAttribute("data-slot") !== null && trigger.className.includes("text-accent-red"),
  )
  await userEvent.click(trigger)
  ok("AlertDialog: and still opens", !!screen.getByRole("alertdialog", { name: "Remove?" }))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
