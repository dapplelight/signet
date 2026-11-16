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
const { Auth, SAMPLE_PROVIDERS } = await import("../src/blocks/auth-page/index")
const { Onboarding } = await import("../src/blocks/onboarding/index")
const { Pricing } = await import("../src/blocks/pricing/index")
const { SAMPLE_PLANS } = await import("../src/blocks/pricing/sample")
const { CheckoutSummary, checkoutTotal } = await import("../src/blocks/checkout-summary/index")
const { EmptyPage } = await import("../src/blocks/empty-page/index")
const { ErrorPage } = await import("../src/blocks/error-page/index")
const { formatMoney } = await import("../src/components/screens/billing-screens")

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

// ---- Blocks 2: auth, onboarding, pricing, checkout summary, empty and error pages

await t("auth: sign-in and sign-up titles, no OAuth buttons without providers", () => {
  const { unmount } = render(<Auth className="mine" />)
  ok("data-block and className", !!root("auth-page")?.classList.contains("mine"))
  ok(
    "sign-in title and Send code",
    !!screen.getByText("Welcome back") && !!screen.getByRole("button", { name: "Send code" }),
  )
  ok("no OAuth buttons", !document.querySelector("[data-provider]"))
  unmount()
  render(<Auth mode="sign-up" providers={SAMPLE_PROVIDERS} />)
  ok("sign-up title", !!screen.getByText("Create your account"))
  ok(
    "OAuth button for each provider",
    !!screen.getByRole("button", { name: "Continue with Google" }) &&
      !!screen.getByRole("button", { name: "Continue with GitHub" }),
  )
})

await t("auth: request a code, then verify it, wired through callbacks", async () => {
  const asked: unknown[] = []
  const verified: unknown[] = []
  render(<Auth onRequestCode={(r) => void asked.push(r)} onVerify={(r) => void verified.push(r)} />)
  await userEvent.type(screen.getByPlaceholderText("you@example.com"), "ada@example.com")
  await userEvent.click(screen.getByRole("button", { name: "Send code" }))
  await screen.findByText(/Code sent to ada@example.com/)
  ok(
    "onRequestCode got channel, address and mode",
    JSON.stringify(asked[0]) ===
      JSON.stringify({ channel: "email", to: "ada@example.com", mode: "sign-in" }),
    asked,
  )
  await userEvent.type(screen.getByLabelText("One-time code"), "123456")
  await waitFor(() => verified.length === 1 || Promise.reject())
  ok("onVerify got the code", (verified[0] as { code: string }).code === "123456", verified)
})

await t("auth: a throwing callback shows its message in an alert", async () => {
  render(
    <Auth
      onRequestCode={() => {
        throw new Error("Too many attempts")
      }}
    />,
  )
  await userEvent.type(screen.getByPlaceholderText("you@example.com"), "ada@example.com")
  await userEvent.click(screen.getByRole("button", { name: "Send code" }))
  ok("message", (await screen.findByRole("alert")).textContent === "Too many attempts")
})

await t("auth: the verify step on its own, loading and error", async () => {
  const { unmount } = render(<Auth step="verify" to="ada@example.com" onRequestCode={() => {}} />)
  ok(
    "verify title and where it went",
    !!screen.getByText("Check your inbox") && !!screen.getByText(/Code sent to ada@example.com/),
  )
  ok("resend is locked with the timer", !!screen.getByText("Resend in 30s"))
  unmount()
  const loading = render(<Auth state="loading" />)
  ok("loading status", !!screen.getByRole("status", { name: "Loading sign-in" }))
  loading.unmount()
  let retried = 0
  render(<Auth state="error" onRetry={() => retried++} />)
  await userEvent.click(screen.getByRole("button", { name: /try again|retry/i }))
  ok("onRetry called", retried === 1)
})

await t("onboarding: steps in a stepper, Back hidden on step 1, focus on the heading", async () => {
  const seen: number[] = []
  let finished = 0
  render(<Onboarding onNext={(_, i) => void seen.push(i)} onFinish={() => void finished++} />)
  ok("stepper is labelled Onboarding", !!document.querySelector("[aria-label=Onboarding]"))
  ok("no Back on step 1", !screen.queryByRole("button", { name: "Back" }))
  ok("no Skip without onSkip", !screen.queryByRole("button", { name: "Skip for now" }))
  ok("first heading", screen.getByRole("heading", { level: 2 }).textContent === "Tell us about you")
  await userEvent.click(screen.getByRole("button", { name: "Continue" }))
  const h = await screen.findByRole("heading", { level: 2, name: "Create a workspace" })
  ok("second heading has focus", document.activeElement === h)
  ok("onNext got the index", JSON.stringify(seen) === "[0]", seen)
  ok("Back appears", !!screen.getByRole("button", { name: "Back" }))
  await userEvent.click(screen.getByRole("button", { name: "Back" }))
  ok(
    "Back goes to step 1",
    screen.getByRole("heading", { level: 2 }).textContent === "Tell us about you",
  )
  await userEvent.click(screen.getByRole("button", { name: "Continue" }))
  await userEvent.click(screen.getByRole("button", { name: "Continue" }))
  await userEvent.click(await screen.findByRole("button", { name: "Finish" }))
  await waitFor(() => finished === 1 || Promise.reject())
  ok("Finish on the last step ran onFinish", finished === 1)
})

await t("onboarding: Skip for now, and a throwing onNext keeps the step", async () => {
  let skipped = 0
  const { unmount } = render(<Onboarding onSkip={() => void skipped++} />)
  await userEvent.click(screen.getByRole("button", { name: "Skip for now" }))
  await waitFor(() => skipped === 1 || Promise.reject())
  ok(
    "onSkip ran and the step did not move",
    skipped === 1 && screen.getByRole("heading", { level: 2 }).textContent === "Tell us about you",
  )
  unmount()
  render(
    <Onboarding
      onNext={() => {
        throw new Error("Name is required")
      }}
    />,
  )
  await userEvent.click(screen.getByRole("button", { name: "Continue" }))
  ok("message in an alert", (await screen.findByRole("alert")).textContent === "Name is required")
  ok(
    "still on step 1",
    screen.getByRole("heading", { level: 2 }).textContent === "Tell us about you",
  )
})

await t("onboarding: loading and error states", async () => {
  const { unmount } = render(<Onboarding state="loading" />)
  ok("loading status", !!screen.getByRole("status", { name: "Loading onboarding" }))
  unmount()
  let retried = 0
  render(<Onboarding state="error" onRetry={() => retried++} />)
  await userEvent.click(screen.getByRole("button", { name: /try again|retry/i }))
  ok("onRetry called", retried === 1 && !!root("onboarding"))
})

await t("pricing: three plans, one highlighted with Most popular, sr-only per month", () => {
  render(<Pricing className="mine" />)
  ok("data-block and className", !!root("pricing")?.classList.contains("mine"))
  const cards = document.querySelectorAll("[data-slot=pricing-plan]")
  ok("a card per plan", cards.length === SAMPLE_PLANS.length, cards.length)
  ok("one Most popular badge", screen.getAllByText("Most popular").length === 1)
  const hi = document.querySelector("[data-highlighted]") as HTMLElement
  ok(
    "highlighted plan has ring-primary",
    hi.classList.contains("ring-primary") && hi.dataset.plan === "team",
  )
  ok("price is formatted from minor units", within(hi).getByText(formatMoney(1900, "USD")) !== null)
  ok("sr-only per month", within(hi).getByText("per month").classList.contains("sr-only"))
  ok(
    "/month is hidden from screen readers",
    within(hi).getByText("/month").getAttribute("aria-hidden") === "true",
  )
  ok("features are listed", within(hi).getAllByRole("listitem").length === 4)
})

await t("pricing: the Yearly toggle changes prices, a CTA calls onSelect", async () => {
  const intervals: string[] = []
  const chosen: unknown[] = []
  render(
    <Pricing
      onIntervalChange={(i) => void intervals.push(i)}
      onSelect={(p, i) => void chosen.push([p.id, i])}
    />,
  )
  await userEvent.click(screen.getByRole("tab", { name: "Yearly" }))
  ok("onIntervalChange", JSON.stringify(intervals) === '["year"]', intervals)
  const hi = document.querySelector("[data-highlighted]") as HTMLElement
  ok(
    "yearly price and /year",
    !!within(hi).getByText(formatMoney(19000, "USD")) && !!within(hi).getByText("per year"),
  )
  await userEvent.click(within(hi).getByRole("button", { name: "Start free trial" }))
  await waitFor(() => chosen.length === 1 || Promise.reject())
  ok("onSelect got the plan and interval", JSON.stringify(chosen[0]) === '["team","year"]', chosen)
})

await t("pricing: no plans, loading and error", async () => {
  const empty = render(<Pricing plans={[]} />)
  ok("No plans available", !!screen.getByText("No plans available"))
  empty.unmount()
  const loading = render(<Pricing state="loading" />)
  ok("loading status", !!screen.getByRole("status", { name: "Loading plans" }))
  loading.unmount()
  let retried = 0
  render(<Pricing state="error" onRetry={() => retried++} />)
  await userEvent.click(screen.getByRole("button", { name: /try again|retry/i }))
  ok("onRetry called", retried === 1)
})

await t("checkout-summary: totals through formatMoney, Pay {total} calls onPay", async () => {
  const items = [
    { id: "a", name: "Plan", amount: 1900 },
    { id: "b", name: "Seat", amount: 500, quantity: 3 },
  ]
  ok("total maths: 1900 + 1500 - 500 + 300", checkoutTotal(items, 500, 300) === 3200)
  const paid: number[] = []
  render(
    <CheckoutSummary items={items} discount={500} tax={300} onPay={(n) => void paid.push(n)} />,
  )
  const totals = within(document.querySelector("[data-slot=checkout-totals]") as HTMLElement)
  ok(
    "subtotal",
    totals.getByText("Subtotal").nextElementSibling?.textContent === formatMoney(3400, "USD"),
  )
  ok(
    "discount is a minus",
    totals.getByText("Discount").nextElementSibling?.textContent === `−${formatMoney(500, "USD")}`,
  )
  ok("tax", totals.getByText("Tax").nextElementSibling?.textContent === formatMoney(300, "USD"))
  const total = totals.getByText("Total")
  ok(
    "total is bold and tabular",
    total.parentElement?.classList.contains("font-bold") === true &&
      total.nextElementSibling?.classList.contains("tabular-nums") === true,
  )
  await userEvent.click(screen.getByRole("button", { name: `Pay ${formatMoney(3200, "USD")}` }))
  await waitFor(() => paid.length === 1 || Promise.reject())
  ok("onPay got the total in minor units", paid[0] === 3200, paid)
})

await t(
  "checkout-summary: a failing payment shows its message; empty, loading, error",
  async () => {
    render(
      <CheckoutSummary
        onPay={() => {
          throw new Error("Card declined")
        }}
      />,
    )
    await userEvent.click(screen.getByRole("button", { name: /^Pay / }))
    ok("message in an alert", (await screen.findByRole("alert")).textContent === "Card declined")
    cleanup()
    render(<CheckoutSummary items={[]} />)
    ok("Your cart is empty", !!screen.getByText("Your cart is empty"))
    cleanup()
    render(<CheckoutSummary state="loading" />)
    ok("loading status", !!screen.getByRole("status", { name: "Loading order" }))
    cleanup()
    let retried = 0
    render(<CheckoutSummary state="error" onRetry={() => retried++} />)
    await userEvent.click(screen.getByRole("button", { name: /try again|retry/i }))
    ok("onRetry called", retried === 1)
  },
)

await t("empty-page: sample copy, an action, and a custom icon and action", async () => {
  let clicked = 0
  const { unmount } = render(<EmptyPage onAction={() => clicked++} className="mine" />)
  ok("data-block and className", !!root("empty-page")?.classList.contains("mine"))
  ok(
    "title and description",
    !!screen.getByText("No projects yet") &&
      !!screen.getByText("Create your first project to get started."),
  )
  await userEvent.click(screen.getByRole("button", { name: "New project" }))
  ok("onAction", clicked === 1)
  unmount()
  render(
    <EmptyPage
      title="Nothing here"
      description="Try later."
      action={<a href="/x">Go</a>}
      icon={<svg data-testid="mine" />}
    />,
  )
  ok(
    "props replace the copy",
    !!screen.getByText("Nothing here") &&
      !!screen.getByRole("link", { name: "Go" }) &&
      !!screen.getByTestId("mine"),
  )
  cleanup()
  render(<EmptyPage />)
  ok("no button without action or onAction", !screen.queryByRole("button"))
})

await t("empty-page: loading and error", async () => {
  const { unmount } = render(<EmptyPage state="loading" />)
  ok("loading status", !!screen.getByRole("status", { name: "Loading" }))
  unmount()
  let retried = 0
  render(<EmptyPage state="error" onRetry={() => retried++} />)
  await userEvent.click(screen.getByRole("button", { name: /try again|retry/i }))
  ok("onRetry called", retried === 1)
})

await t("error-page: 404 and 500 copy, the code is aria-hidden, the title is the h1", async () => {
  let home = 0
  let again = 0
  const { unmount } = render(
    <ErrorPage code={404} onHome={() => home++} onTryAgain={() => again++} />,
  )
  ok("h1 is the title", screen.getByRole("heading", { level: 1 }).textContent === "Page not found")
  ok("description", !!screen.getByText("The page you're looking for doesn't exist or has moved."))
  const code = document.querySelector("[data-slot=error-page-code]") as HTMLElement
  ok(
    "code is aria-hidden and muted",
    code.textContent === "404" &&
      code.getAttribute("aria-hidden") === "true" &&
      code.classList.contains("text-text-muted"),
  )
  ok("404 has no Try again", !screen.queryByRole("button", { name: "Try again" }))
  await userEvent.click(screen.getByRole("button", { name: "Go home" }))
  ok("onHome", home === 1)
  unmount()
  render(<ErrorPage code={500} onHome={() => home++} onTryAgain={() => again++} />)
  ok("500 title", screen.getByRole("heading", { level: 1 }).textContent === "Something went wrong")
  ok("500 description", !!screen.getByText("We hit an error on our side. Try again in a moment."))
  await userEvent.click(screen.getByRole("button", { name: "Try again" }))
  ok("onTryAgain", again === 1 && !!screen.getByRole("button", { name: "Go home" }))
})

await t("error-page: Go home as a link, loading and error", async () => {
  const { unmount } = render(<ErrorPage homeHref="/start" />)
  ok("link", screen.getByRole("link", { name: "Go home" }).getAttribute("href") === "/start")
  unmount()
  const loading = render(<ErrorPage state="loading" />)
  ok("loading status", !!screen.getByRole("status", { name: "Loading" }))
  loading.unmount()
  let retried = 0
  render(<ErrorPage state="error" onRetry={() => retried++} />)
  await userEvent.click(screen.getByRole("button", { name: /try again|retry/i }))
  ok("onRetry called", retried === 1 && !!root("error-page"))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
