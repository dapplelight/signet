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
const { ApiKeysManager, ProfileCard, SessionsList } = await import(
  "../src/components/screens/account-screens"
)
const { NotificationInbox, NotificationPreferences } = await import(
  "../src/components/screens/notification-screens"
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

// --- Account ---
await t("ProfileCard", async () => {
  const saved: unknown[] = []
  render(
    <ProfileCard
      profile={{ name: "Ada Lovelace", email: "ada@example.com" }}
      onSave={(p) => void saved.push(p)}
    />,
  )
  await tick()
  ok("Profile: region named Profile", !!screen.getByRole("region", { name: "Profile" }))
  ok("Profile: initials fallback", !!screen.getByText("AL"))
  const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement
  ok("Profile: save disabled until changed", save.disabled)
  const name = screen.getByRole("textbox", { name: "Name" })
  await userEvent.clear(name)
  await userEvent.type(name, "Ada King{Enter}")
  ok("Profile: Enter saves the new name", (saved[0] as { name: string })?.name === "Ada King")
})

await t("SessionsList", async () => {
  const revoked: string[] = []
  let others = 0
  const now = Date.now()
  render(
    <SessionsList
      sessions={[
        { id: "a", device: "Chrome on macOS", ip: "10.0.0.1", lastSeenAt: now, current: true },
        { id: "b", device: "Safari on iOS", ip: null, lastSeenAt: now - 7200_000 },
      ]}
      onRevoke={(s) => void revoked.push(s.id)}
      onRevokeOthers={() => void others++}
    />,
  )
  ok("Sessions: region named Devices", !!screen.getByRole("region", { name: "Devices" }))
  ok("Sessions: current device marked", !!screen.getByText("This device"))
  ok(
    "Sessions: current row is data-current",
    document.querySelectorAll("[data-slot=session-item][data-current]").length === 1,
  )
  ok(
    "Sessions: no sign-out button for this device",
    !screen.queryByRole("button", { name: "Sign out Chrome on macOS" }),
  )
  await userEvent.click(screen.getByRole("button", { name: "Sign out Safari on iOS" }))
  ok("Sessions: per-device sign out", revoked[0] === "b")
  const trigger = screen.getByRole("button", { name: "Sign out others" })
  await userEvent.click(trigger)
  const dialog = screen.getByRole("alertdialog", { name: "Sign out every other device?" })
  ok("Sessions: sign out others confirms in an alertdialog", !!dialog)
  ok("Sessions: focus starts on Cancel", document.activeElement?.textContent === "Cancel")
  await userEvent.keyboard("{Escape}")
  ok("Sessions: Escape cancels", others === 0 && !screen.queryByRole("alertdialog"))
  await waitFor(() => ok("Sessions: focus returns", document.activeElement === trigger))
  await userEvent.click(trigger)
  const confirm = within(screen.getByRole("alertdialog")).getByRole("button", {
    name: "Sign out others",
  })
  await userEvent.click(confirm)
  await waitFor(() => ok("Sessions: confirm runs onRevokeOthers", others === 1))
})

await t("ApiKeysManager", async () => {
  const revoked: string[] = []
  let created = ""
  render(
    <ApiKeysManager
      keys={[
        { id: "k1", name: "CI", start: "app_1a2b3c", createdAt: Date.now(), lastUsedAt: null },
      ]}
      onCreate={async ({ name }) => {
        created = name
        return { token: "app_1a2b3c_secret" }
      }}
      onRevoke={(k) => void revoked.push(k.id)}
    />,
  )
  ok("Keys: lists the key start, never a secret", !!screen.getByText("app_1a2b3c…"))
  ok("Keys: never used", !!screen.getByText(/Never used/))
  await userEvent.click(screen.getByRole("button", { name: "New key" }))
  const dialog = screen.getByRole("dialog", { name: "New key" })
  ok("Keys: create opens a named dialog", !!dialog)
  const name = screen.getByRole("textbox", { name: "Key name" })
  ok("Keys: name field focused", document.activeElement === name)
  await userEvent.type(name, "Deploy{Enter}")
  await tick()
  ok("Keys: onCreate gets the name", created === "Deploy")
  const reveal = screen.getByRole("textbox", { name: "Copy your key" }) as HTMLInputElement
  ok("Keys: token shown once, read-only", reveal.value === "app_1a2b3c_secret" && reveal.readOnly)
  await userEvent.click(screen.getByRole("button", { name: "Done" }))
  await waitFor(() => ok("Keys: Done closes", !screen.queryByRole("dialog")))
  await userEvent.click(screen.getByRole("button", { name: "New key" }))
  ok(
    "Keys: the token is gone after closing",
    !screen.queryByDisplayValue("app_1a2b3c_secret") &&
      !!screen.getByRole("textbox", { name: "Key name" }),
  )
  await userEvent.keyboard("{Escape}")
  await userEvent.click(screen.getByRole("button", { name: "Revoke CI" }))
  ok("Keys: revoke confirms", !!screen.getByRole("alertdialog", { name: "Revoke CI?" }))
  await userEvent.click(screen.getByRole("button", { name: "Revoke" }))
  await waitFor(() => ok("Keys: revoke runs", revoked[0] === "k1"))
})

await t("ApiKeysManager: empty", async () => {
  render(<ApiKeysManager keys={[]} labels={{ noKeys: "Abhi koi key nahi" }} />)
  ok("Keys: empty state with label override", !!screen.getByText("Abhi koi key nahi"))
  ok("Keys: no create button without onCreate", !screen.queryByRole("button", { name: "New key" }))
})

// --- Notifications ---
const ITEMS = [
  { id: "1", title: "Invoice paid", body: "₹4,999 received", createdAt: new Date().toISOString() },
  {
    id: "2",
    title: "New sign-in",
    body: "Chrome on macOS",
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    readAt: new Date().toISOString(),
  },
]

await t("NotificationInbox", async () => {
  const read: string[][] = []
  let all = 0
  const opened: string[] = []
  const archived: string[] = []
  render(
    <NotificationInbox
      items={ITEMS}
      onMarkRead={(ids) => void read.push(ids)}
      onMarkAllRead={() => void all++}
      onOpen={(i) => void opened.push(i.id)}
      onArchive={(i) => void archived.push(i.id)}
    />,
  )
  ok("Inbox: region named Notifications", !!screen.getByRole("region", { name: /Notifications/ }))
  ok("Inbox: unread count for screen readers", !!screen.getByText("1 unread"))
  ok(
    "Inbox: unread row is data-unread",
    document.querySelectorAll("[data-slot=inbox-item][data-unread]").length === 1,
  )
  const row = screen.getByRole("button", { name: /Unread: Invoice paid/ })
  ok("Inbox: unread is announced in the row name", !!row)
  row.focus()
  await userEvent.keyboard("{Enter}")
  ok("Inbox: Enter opens and marks read", opened[0] === "1" && read[0]?.[0] === "1")
  await userEvent.click(screen.getByRole("button", { name: /^New sign-in/ }))
  ok("Inbox: opening a read item does not mark it again", read.length === 1)
  await userEvent.click(screen.getByRole("button", { name: "Mark all read" }))
  ok("Inbox: mark all read", all === 1)
  await userEvent.click(screen.getByRole("button", { name: "Archive Invoice paid" }))
  ok("Inbox: archive", archived[0] === "1")
  const unreadFilter = screen.getByRole("button", { name: "Unread" })
  await userEvent.click(unreadFilter)
  ok("Inbox: filter is aria-pressed", unreadFilter.getAttribute("aria-pressed") === "true")
  ok("Inbox: unread filter hides read items", !screen.queryByText("New sign-in"))
})

await t("NotificationInbox: empty and link items", async () => {
  render(<NotificationInbox items={[]} />)
  ok("Inbox: empty state", !!screen.getByText("You're all caught up"))
  cleanup()
  render(
    <NotificationInbox
      items={[{ ...ITEMS[0], link: "/billing" } as (typeof ITEMS)[0] & { link: string }]}
      // biome-ignore lint/a11y/useAnchorContent: render props: InboxItem supplies the content
      renderItem={(i) => <a href={i.link} />}
    />,
  )
  const link = screen.getByRole("link", { name: /Invoice paid/ })
  ok("Inbox: renderItem swaps the row for a link", link.getAttribute("href") === "/billing")
})

await t("NotificationPreferences", async () => {
  const toggles: unknown[] = []
  let value: unknown
  render(
    <NotificationPreferences
      categories={[
        { id: "security", label: "Security", required: true },
        { id: "marketing", label: "Offers" },
      ]}
      defaultValue={{ marketing: { email: false } }}
      onValueChange={(v) => (value = v)}
      onToggle={(c) => void toggles.push(c)}
    />,
  )
  const offersEmail = screen.getByRole("switch", { name: "Offers: Email" })
  ok("Prefs: switch named by category and channel", !!offersEmail)
  ok("Prefs: stored false shows off", offersEmail.getAttribute("aria-checked") === "false")
  const sec = screen.getByRole("switch", { name: "Security: Email" })
  ok(
    "Prefs: required category locked on",
    sec.getAttribute("aria-checked") === "true" &&
      (sec.getAttribute("aria-disabled") === "true" || sec.hasAttribute("data-disabled")),
  )
  offersEmail.focus()
  await userEvent.keyboard(" ")
  ok("Prefs: Space toggles", offersEmail.getAttribute("aria-checked") === "true")
  ok(
    "Prefs: onToggle gets the change",
    JSON.stringify(toggles[0]) ===
      JSON.stringify({ category: "marketing", channel: "email", on: true }),
  )
  ok(
    "Prefs: onValueChange gets the full value",
    (value as Record<string, Record<string, boolean>>).marketing?.email === true,
  )
  ok("Prefs: column headers", screen.getAllByRole("columnheader").length === 4)
})

await t("NotificationPreferences: failed save rolls back", async () => {
  render(
    <NotificationPreferences
      categories={[{ id: "news", label: "News" }]}
      channels={["push"]}
      onToggle={() => {
        throw new Error("Offline")
      }}
    />,
  )
  const sw = screen.getByRole("switch", { name: "News: Push" })
  await userEvent.click(sw)
  await tick()
  ok("Prefs: rolls back on error", sw.getAttribute("aria-checked") === "true")
  ok("Prefs: error is an alert", screen.getByRole("alert").textContent === "Offline")
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
