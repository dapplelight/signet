/**
 * Keyboard, focus and ARIA checks for the user-facing screens: auth,
 * account, notifications and privacy. Each screen takes data and callbacks,
 * so these drive them the way a user would and assert what the callbacks see.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { act, cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { AuthScreen, SessionExpiredScreen, VerifyCodeScreen, DEFAULT_AUTH_LABELS } = await import(
  "../src/components/screens/auth-screens"
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
/** UI SDK writes cross-part ARIA (labelledby, describedby) a tick after mount. */
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 20)))

// --- Auth ---
await t("AuthScreen", async () => {
  const requests: unknown[] = []
  const verified: unknown[] = []
  const oauth: string[] = []
  const modes: string[] = []
  render(
    <AuthScreen
      providers={[{ id: "google", label: "Google" }]}
      onOAuth={(p, mode) => void oauth.push(`${p.id}:${mode}`)}
      onRequestCode={(r) => void requests.push(r)}
      onVerify={(r) => void verified.push(r)}
      onModeChange={(m) => void modes.push(m)}
      resendAfterSeconds={0}
      className="my-card"
    />,
  )
  await tick()
  ok("Auth: a heading names the screen", !!screen.getByRole("heading", { name: "Welcome back" }))
  const card = document.querySelector("[data-slot=auth-card]") as HTMLElement
  ok("Auth: className merges onto the card", card.classList.contains("my-card"))
  ok("Auth: step is data-step", card.dataset.step === "request")

  await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }))
  ok("Auth: OAuth button passes provider and mode", oauth[0] === "google:sign-in")

  const tabs = screen.getAllByRole("tab")
  ok("Auth: email and phone tabs", tabs.length === 2)
  const email = screen.getByRole("textbox", { name: "Email" }) as HTMLInputElement
  ok("Auth: email field is labelled and typed", email.type === "email")
  ok("Auth: autocomplete email", email.autocomplete === "email")
  // Arrow keys move between tabs (roving focus).
  tabs[0]?.focus()
  await userEvent.keyboard("{ArrowRight}")
  ok("Auth: ArrowRight moves to the phone tab", document.activeElement === tabs[1])
  await userEvent.keyboard("{Enter}")
  await tick()
  const phone = screen.getByRole("textbox", { name: "Phone" }) as HTMLInputElement
  ok("Auth: phone field is tel", phone.type === "tel")
  await userEvent.click(tabs[0] as HTMLElement)

  const send = screen.getByRole("button", { name: "Send code" }) as HTMLButtonElement
  ok("Auth: send is disabled while empty", send.disabled)
  await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com{Enter}")
  await tick()
  ok(
    "Auth: Enter submits the code request",
    JSON.stringify(requests[0]) ===
      JSON.stringify({ channel: "email", to: "ada@example.com", mode: "sign-in" }),
  )
  ok(
    "Auth: moves to the verify step",
    card.dataset.step === "verify" || !!screen.getByText(/Code sent to ada@example.com/),
  )
  const otp = screen.getByRole("textbox", { name: "One-time code" })
  ok("Auth: code input is labelled", !!otp)
  ok("Auth: code input has focus", document.activeElement === otp)
  await userEvent.keyboard("123456")
  await tick()
  ok("Auth: a full code verifies by itself", (verified[0] as { code?: string })?.code === "123456")
  await userEvent.click(screen.getByRole("button", { name: "Change" }))
  ok("Auth: Change goes back", !!screen.getByRole("button", { name: "Send code" }))
  await userEvent.click(screen.getByRole("button", { name: "Create account" }))
  ok("Auth: mode switch calls onModeChange", modes[0] === "sign-up")
  ok("Auth: sign-up title", !!screen.getByRole("heading", { name: "Create your account" }))
})

await t("AuthScreen: errors and labels", async () => {
  render(
    <AuthScreen
      channels={["phone"]}
      labels={{ sendCode: "Code bhejo", phone: "Mobile" }}
      onRequestCode={() => {
        throw new Error("Too many requests")
      }}
    />,
  )
  ok("Auth: one channel shows no tabs", !screen.queryByRole("tab"))
  await userEvent.type(screen.getByRole("textbox", { name: "Mobile" }), "9876543210")
  await userEvent.click(screen.getByRole("button", { name: "Code bhejo" }))
  await tick()
  const alert = screen.getByRole("alert")
  ok("Auth: a thrown message shows in an alert", alert.textContent === "Too many requests")
  ok(
    "Auth: field is marked invalid",
    screen.getByRole("textbox", { name: "Mobile" }).getAttribute("aria-invalid") === "true",
  )
})

await t("VerifyCodeScreen", async () => {
  let resent = 0
  render(
    <VerifyCodeScreen
      channel="phone"
      to="+91******3210"
      length={4}
      resendAfterSeconds={30}
      onVerify={() => {
        throw new Error("Wrong code")
      }}
      onResend={() => void resent++}
    />,
  )
  ok("Verify: phone title", !!screen.getByRole("heading", { name: "Check your messages" }))
  ok("Verify: says where it went", !!screen.getByText(/\+91\*\*\*\*\*\*3210/))
  const resend = screen.getByRole("button", { name: /Resend in 30s/ }) as HTMLButtonElement
  ok("Verify: resend waits", resend.disabled)
  await userEvent.keyboard("1234")
  await tick()
  ok("Verify: wrong code shows an alert", screen.getByRole("alert").textContent === "Wrong code")
  const otp = screen.getByRole("textbox", { name: "One-time code" }) as HTMLInputElement
  ok("Verify: wrong code clears the slots", otp.value === "")
  ok("Verify: code is aria-invalid", otp.getAttribute("aria-invalid") === "true")
  ok("Verify: resend not called yet", resent === 0)
})

await t("SessionExpiredScreen", async () => {
  let signIn = 0
  render(<SessionExpiredScreen onSignIn={() => void signIn++} />)
  const btn = screen.getByRole("button", { name: DEFAULT_AUTH_LABELS.expiredAction })
  ok("Expired: heading", !!screen.getByRole("heading", { name: "Session expired" }))
  ok("Expired: action has focus", document.activeElement === btn)
  await userEvent.keyboard("{Enter}")
  ok("Expired: Enter signs in", signIn === 1)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
