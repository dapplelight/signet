/**
 * Growth screens: waitlist, invite accept, referral card, onboarding
 * checklist, feedback widget, what's new. Keyboard, focus, ARIA, labels.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { FeedbackWidget, InviteAccept, OnboardingChecklist, ReferralCard, WaitlistJoin, WhatsNew } =
  await import("../src/components/screens/growth-screens")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const must = (n: string, c: boolean, d: unknown = "") => {
  if (!c) throw new Error(`${n} ${JSON.stringify(d)}`)
  ok(n, c)
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
const tick = () => new Promise((r) => setTimeout(r, 20))

await t("WaitlistJoin", async () => {
  const joined: string[] = []
  render(
    <WaitlistJoin
      onJoin={async (email) => {
        joined.push(email)
        return { email, position: 128, joined: true }
      }}
    />,
  )
  await tick()
  const region = screen.getByRole("region", { name: "Join the waitlist" })
  const input = within(region).getByLabelText("Email")
  await userEvent.type(input, "nope{Enter}")
  await tick()
  must("Waitlist: invalid email marks the field", input.getAttribute("aria-invalid") === "true")
  ok("Waitlist: and says why", !!screen.getByText("Enter a valid email"))
  ok("Waitlist: nothing sent", joined.length === 0)
  await userEvent.clear(input)
  await userEvent.type(input, "a@example.com{Enter}")
  await waitFor(() => must("Waitlist: shows the position", !!screen.getByText("#128")))
  ok(
    "Waitlist: announces it",
    screen.getAllByRole("status").some((s) => s.textContent === "You're on the list"),
  )
  ok("Waitlist: joined as data-*", !!document.querySelector("[data-slot=waitlist][data-joined]"))
  ok("Waitlist: email trimmed and sent", joined[0] === "a@example.com")
})

await t("InviteAccept: success and failure", async () => {
  let accepted = 0
  render(
    <InviteAccept
      invite={{
        inviterName: "Asha Rao",
        scopeName: "Acme",
        role: "editor",
        expiresAt: "2026-12-01",
      }}
      onAccept={async () => ({ ok: true })}
      onAccepted={() => accepted++}
      onDecline={() => {}}
    />,
  )
  const region = screen.getByRole("region", { name: "Asha Rao invited you" })
  ok(
    "Invite: who, what, role",
    region.textContent?.includes("Join Acme") && region.textContent.includes("as editor"),
  )
  ok("Invite: inviter initials", region.textContent?.includes("AR") ?? false)
  const accept = screen.getByRole("button", { name: "Accept" })
  accept.focus()
  await userEvent.keyboard("{Enter}")
  await waitFor(() =>
    must(
      "Invite: accepted is announced",
      screen.getAllByRole("status").some((s) => s.textContent === "You're in"),
    ),
  )
  ok("Invite: onAccepted runs", accepted === 1)
  cleanup()
  render(
    <InviteAccept
      invite={{}}
      onAccept={async () => ({ ok: false, reason: "expired" })}
      labels={{ inviteError: { expired: "Caducada" } }}
    />,
  )
  await userEvent.click(screen.getByRole("button", { name: "Accept" }))
  await waitFor(() =>
    must(
      "Invite: failure reason in plain words, overridable",
      screen.getAllByRole("status").some((s) => s.textContent === "Caducada"),
    ),
  )
  ok(
    "Invite: status as data-*",
    !!document.querySelector("[data-slot=invite-accept][data-status=error]"),
  )
  ok("Invite: buttons gone after a failure", !screen.queryByRole("button", { name: "Accept" }))
})

await t("InviteAccept: a thrown accept can be retried", async () => {
  let calls = 0
  render(
    <InviteAccept
      invite={{}}
      onAccept={async () => {
        calls++
        if (calls === 1) throw new Error("network down")
        return { ok: true }
      }}
    />,
  )
  await userEvent.click(screen.getByRole("button", { name: "Accept" }))
  await waitFor(() =>
    must(
      "Invite: a rejected onAccept says it failed",
      screen.getAllByRole("status").some((s) => s.textContent === "Couldn't accept. Try again."),
    ),
  )
  ok("Invite: thrown failure as data-status=error", !!document.querySelector("[data-status=error]"))
  const retry = screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement
  ok("Invite: Accept is enabled again for a retry", !retry.disabled)
  await userEvent.click(retry)
  await waitFor(() =>
    must(
      "Invite: retry succeeds",
      screen.getAllByRole("status").some((s) => s.textContent === "You're in"),
    ),
  )
  ok("Invite: onAccept ran twice", calls === 2)
})

await t("ReferralCard", async () => {
  let shared = ""
  const writes: string[] = []
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async (s: string) => void writes.push(s) },
    configurable: true,
  })
  render(
    <ReferralCard
      code="ASHA42"
      url="https://app.example.com/?ref=ASHA42"
      stats={{ referred: 5, converted: 2, rewarded: 1 }}
      onShare={(u) => (shared = u)}
    />,
  )
  const region = screen.getByRole("region", { name: "Invite friends" })
  ok("Referral: code shown", within(region).getByText("ASHA42").dataset.slot === "referral-code")
  ok(
    "Referral: link field labelled",
    (screen.getByLabelText("Your link") as HTMLInputElement).value.endsWith("ASHA42"),
  )
  await userEvent.click(screen.getByRole("button", { name: "Copy link" }))
  await waitFor(() =>
    must(
      "Referral: copy announces",
      screen.getAllByRole("status").some((s) => s.textContent === "Copied"),
    ),
  )
  ok("Referral: copied the url", writes[0] === "https://app.example.com/?ref=ASHA42")
  await userEvent.click(screen.getByRole("button", { name: "Share" }))
  ok("Referral: onShare gets the url", shared === "https://app.example.com/?ref=ASHA42")
  ok(
    "Referral: stats as a description list",
    region.querySelectorAll("dt").length === 3 && region.textContent?.includes("Subscribed"),
  )
})

await t("OnboardingChecklist", async () => {
  const picked: string[] = []
  let dismissed = false
  render(
    <OnboardingChecklist
      steps={[
        { key: "profile", title: "Add your photo" },
        { key: "project", title: "Create a project", description: "Takes a minute" },
        { key: "invite", title: "Invite a teammate" },
      ]}
      done={["profile"]}
      onStepSelect={(s) => picked.push(s.key)}
      onDismiss={() => (dismissed = true)}
    />,
  )
  const region = screen.getByRole("region", { name: "Get started" })
  ok("Onboarding: progress text", region.textContent?.includes("1 of 3 done") ?? false)
  const next = within(region).getByRole("button", { current: "step" })
  ok(
    "Onboarding: next step is aria-current=step",
    next.textContent?.includes("Create a project") ?? false,
  )
  ok(
    "Onboarding: next step shows its description",
    next.textContent?.includes("Takes a minute") ?? false,
  )
  ok(
    "Onboarding: done step says so to screen readers",
    region.textContent?.includes("(Done)") ?? false,
  )
  next.focus()
  await userEvent.keyboard("{Enter}")
  ok("Onboarding: Enter selects a step", picked[0] === "project")
  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }))
  ok("Onboarding: dismiss", dismissed)
  cleanup()
  render(<OnboardingChecklist steps={[{ key: "a", title: "A" }]} defaultDone={["a"]} />)
  ok(
    "Onboarding: complete state",
    !!screen.getByRole("heading", { name: "All set" }) &&
      !!document.querySelector("[data-slot=onboarding][data-complete]"),
  )
})

await t("FeedbackWidget", async () => {
  const sent: unknown[] = []
  render(<FeedbackWidget rating onSubmit={async (input) => void sent.push(input)} />)
  const trigger = screen.getByRole("button", { name: "Feedback" })
  await userEvent.click(trigger)
  const form = await screen.findByRole("form", { name: "Send feedback" })
  const kinds = within(form).getAllByRole("radio").slice(0, 4)
  ok(
    "Feedback: kinds are one radio group",
    kinds.length === 4 && kinds[0]?.getAttribute("aria-checked") === "true",
  )
  ;(kinds[0] as HTMLElement).focus()
  await userEvent.keyboard("{ArrowRight}")
  must("Feedback: arrow keys pick a kind", kinds[1]?.getAttribute("aria-checked") === "true")
  const send = within(form).getByRole("button", { name: "Send" }) as HTMLButtonElement
  ok("Feedback: Send waits for a message", send.disabled)
  await userEvent.type(within(form).getByLabelText("Message"), "Dark mode please")
  await userEvent.click(within(form).getByRole("radio", { name: "4 stars" }))
  await userEvent.click(send)
  await waitFor(() =>
    must(
      "Feedback: thanks announced",
      screen.getAllByRole("status").some((s) => s.textContent === "Thanks!"),
    ),
  )
  ok(
    "Feedback: input sent",
    JSON.stringify(sent[0]) === '{"kind":"idea","message":"Dark mode please","rating":4}',
  )
})

await t("WhatsNew", async () => {
  let opened = 0
  render(
    <WhatsNew
      unseen={1}
      onOpen={() => opened++}
      entries={[
        { id: "2", date: "2026-11-10", title: "Dark mode", tag: "New", href: "/changelog#2" },
        { id: "1", date: "2026-10-01", title: "Faster search" },
      ]}
    />,
  )
  const trigger = screen.getByRole("button", { name: /What's new.*, 1 new/ })
  ok("WhatsNew: unseen count in the name", !!trigger && trigger.dataset.unseen !== undefined)
  trigger.focus()
  await userEvent.keyboard("{Enter}")
  await screen.findByText("Dark mode")
  ok("WhatsNew: opening marks seen", opened === 1)
  ok(
    "WhatsNew: unseen entry marked",
    !!document.querySelector("li[data-unseen]")?.textContent?.includes("Dark mode"),
  )
  ok(
    "WhatsNew: read more names its entry",
    !!screen.getByRole("link", { name: "Read more about Dark mode" }),
  )
  await userEvent.keyboard("{Escape}")
  await waitFor(() =>
    must(
      "WhatsNew: Escape closes, focus back on trigger",
      !screen.queryByText("Faster search") && document.activeElement === trigger,
    ),
  )
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
