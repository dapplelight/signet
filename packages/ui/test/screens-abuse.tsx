/**
 * Abuse screens: the captcha widget in test mode reports the fixed token and
 * loads nothing; with a provider it renders through the provider's API,
 * reports tokens, clears them on expiry, removes the widget on unmount and
 * injects the script once. The AI spend admin screen shows spend against caps,
 * top spenders and caps, and sets and removes caps in cost units.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register({
  settings: { disableJavaScriptFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
})

const { cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { AiSpendAdmin, CAPTCHA_SCRIPTS, CAPTCHA_TEST_PASS, CaptchaWidget, formatUnits } =
  await import("../src/components/screens/abuse-screens")

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
const w = window as unknown as Record<string, unknown>

await t("CaptchaWidget: test mode reports the fixed token and loads no script", async () => {
  const tokens: (string | null)[] = []
  render(<CaptchaWidget provider="test" onToken={(tk) => tokens.push(tk)} />)
  await waitFor(() => tokens.length > 0 || Promise.reject())
  ok("token is CAPTCHA_TEST_PASS", tokens[0] === CAPTCHA_TEST_PASS)
  ok("no script injected", document.querySelectorAll("script").length === 0)
  ok("test label shown", !!screen.getByText(/test mode/))
  ok("provider as data-*", !!document.querySelector("[data-slot=captcha][data-provider=test]"))
})

await t("CaptchaWidget: renders through Turnstile's API and relays tokens", async () => {
  const calls: Record<string, any>[] = []
  const removed: unknown[] = []
  w.turnstile = {
    render(_el: HTMLElement, opts: Record<string, any>) {
      calls.push(opts)
      return "w1"
    },
    remove: (id: unknown) => removed.push(id),
  }
  const tokens: (string | null)[] = []
  const errors: unknown[] = []
  const { unmount } = render(
    <CaptchaWidget
      provider="turnstile"
      siteKey="site-key"
      action="signup"
      theme="dark"
      onToken={(tk) => tokens.push(tk)}
      onError={(e) => errors.push(e)}
    />,
  )
  await waitFor(() => calls.length > 0 || Promise.reject())
  const o = calls[0] ?? {}
  ok(
    "site key, action and theme passed",
    o.sitekey === "site-key" && o.action === "signup" && o.theme === "dark",
  )
  o.callback("tok-1")
  o["expired-callback"]()
  o["error-callback"]("boom")
  ok(
    "token, then null on expiry and error",
    JSON.stringify(tokens) === JSON.stringify(["tok-1", null, null]),
  )
  ok("error reported", errors[0] === "boom")
  ok(
    "script not injected when the API is already there",
    document.querySelectorAll("script").length === 0,
  )
  unmount()
  ok("widget removed on unmount", removed[0] === "w1")
  delete w.turnstile
})

await t("CaptchaWidget: injects the hCaptcha script once, then renders", async () => {
  const rendered: unknown[] = []
  render(
    <>
      <CaptchaWidget provider="hcaptcha" siteKey="k" onToken={() => {}} />
      <CaptchaWidget provider="hcaptcha" siteKey="k" onToken={() => {}} />
    </>,
  )
  const scripts = [...document.querySelectorAll("script")]
  ok("one script for two widgets", scripts.length === 1, scripts.length)
  ok("explicit-render script url", scripts[0]?.getAttribute("src") === CAPTCHA_SCRIPTS.hcaptcha)
  // Stands in for the script having run.
  w.hcaptcha = { render: (el: HTMLElement) => rendered.push(el) && "h" }
  await waitFor(() => rendered.length === 2 || Promise.reject(), { timeout: 2000 })
  ok("both widgets render once loaded", rendered.length === 2)
  delete w.hcaptcha
})

const overview = {
  global: {
    scope: "global" as const,
    subject: "*",
    day: { used: 1_500_000, cap: 2_000_000, remaining: 500_000 },
    month: { used: 9_000_000, cap: null, remaining: null },
  },
  top: {
    users: [
      { subject: "user-1", used: 800_000, cap: 500_000 },
      { subject: "user-2", used: 100_000, cap: null },
    ],
    orgs: [],
  },
}
const caps = [
  {
    id: "user:*:day",
    scope: "user" as const,
    subject: "*",
    period: "day" as const,
    units: 500_000,
  },
  {
    id: "org:o1:month",
    scope: "org" as const,
    subject: "o1",
    period: "month" as const,
    units: null,
  },
]

await t("AiSpendAdmin: spend, top spenders and caps", () => {
  render(<AiSpendAdmin overview={overview} caps={caps} />)
  ok("formatUnits reads dollars", formatUnits(1_500_000) === "$1.5")
  const meters = document.querySelectorAll("[data-slot=spend-meter]")
  ok("today and month meters", meters.length === 2)
  ok(
    "today against its cap",
    meters[0]?.textContent?.includes("$1.5") && meters[0]?.textContent?.includes("of $2"),
  )
  ok("month uncapped", meters[1]?.textContent?.includes("No cap") ?? false)
  ok(
    "progress only for a capped period",
    document.querySelectorAll("[data-slot=progress]").length === 1,
  )
  ok(
    "top users listed",
    !!document.querySelector("[data-slot=spend-top-users] [data-subject=user-1]"),
  )
  ok("empty orgs", !!screen.getByText("No spend yet"))
  ok(
    "caps listed with everyone and unlimited",
    !!screen.getByText("Everyone") &&
      !!document.querySelector("[data-cap='org:o1:month']")?.textContent?.includes("No cap"),
  )
  ok(
    "read-only without callbacks",
    !document.querySelector("[data-slot=cap-form]") && !screen.queryByRole("button"),
  )
})

await t("AiSpendAdmin: set and remove caps", async () => {
  const set: unknown[] = []
  const removed: unknown[] = []
  const user = userEvent.setup()
  render(
    <AiSpendAdmin
      overview={overview}
      caps={caps}
      onSetCap={(i) => set.push(i)}
      onRemoveCap={(c) => removed.push(c.id)}
      labels={{ save: "Save it" }}
    />,
  )
  await user.click(screen.getByRole("button", { name: "Remove the month cap for o1" }))
  ok("remove sends the cap", removed[0] === "org:o1:month")

  await user.type(screen.getByLabelText(/User or org id/), "user-9")
  await user.type(screen.getByLabelText(/Cap in USD/), "0.25")
  await user.click(screen.getByRole("button", { name: "Save it" }))
  await waitFor(() => screen.getByText("Cap saved"))
  ok(
    "a user's daily cap in cost units",
    JSON.stringify(set[0]) ===
      JSON.stringify({ scope: "user", subject: "user-9", period: "day", units: 250_000 }),
    set[0],
  )

  await user.selectOptions(screen.getByLabelText(/User \/ Org/), "global")
  ok(
    "subject disabled for global",
    (screen.getByLabelText(/User or org id/) as HTMLInputElement).disabled,
  )
  await user.selectOptions(screen.getByLabelText(/^Cap$/), "month")
  await user.clear(screen.getByLabelText(/Cap in USD/))
  await user.click(screen.getByRole("button", { name: "Save it" }))
  await waitFor(() => set.length === 2 || Promise.reject())
  ok(
    "blank amount is unlimited; global subject is *",
    JSON.stringify(set[1]) ===
      JSON.stringify({ scope: "global", subject: "*", period: "month", units: null }),
    set[1],
  )

  await user.type(screen.getByLabelText(/Cap in USD/), "-3")
  await user.click(screen.getByRole("button", { name: "Save it" }))
  ok(
    "a negative amount is refused without a call",
    set.length === 2 && !!screen.getByText(/0 or more/),
  )
})

await t("AiSpendAdmin: a failed save says so", async () => {
  const user = userEvent.setup()
  render(
    <AiSpendAdmin
      overview={overview}
      caps={[]}
      onSetCap={() => {
        throw new Error("nope")
      }}
    />,
  )
  ok("no caps message", !!screen.getByText(/No caps set here/))
  await user.click(screen.getByRole("button", { name: "Save cap" }))
  await waitFor(() => screen.getByText(/Could not save/))
  ok("failure shown", true)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
