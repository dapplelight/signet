/**
 * Org screens: switcher, members list, invite dialog, accept-invite page,
 * org settings. Labels, roles, callbacks, validation and live regions.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { AcceptInvitePage, InviteDialog, MembersList, OrgSettings, OrgSwitcher } = await import(
  "../src/components/screens/org-screens"
)

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

const acme = { id: "a", name: "Acme Labs", slug: "acme", brandColor: "#12833c" }
const bolt = { id: "b", name: "Bolt", slug: "bolt" }

await t("OrgSwitcher", async () => {
  const switched: string[] = []
  let created = 0
  render(
    <OrgSwitcher
      orgs={[
        { org: acme, role: "owner" },
        { org: bolt, role: "member" },
      ]}
      currentId="a"
      onSwitch={(id) => {
        switched.push(id)
      }}
      onCreate={() => created++}
    />,
  )
  const trigger = screen.getByRole("button", { name: "Switch organisation" })
  ok("Switcher: shows the current org", trigger.textContent?.includes("Acme Labs"))
  await userEvent.click(trigger)
  await tick()
  const items = document.querySelectorAll("[data-slot=org-switcher-item]")
  must("Switcher: lists every org", items.length === 2, items.length)
  ok("Switcher: marks the current one", items[0]?.getAttribute("aria-current") === "true")
  await userEvent.click(items[0] as HTMLElement)
  ok("Switcher: picking the current org does nothing", switched.length === 0)
  await userEvent.click(trigger)
  await tick()
  await userEvent.click(screen.getByText("Bolt"))
  ok("Switcher: switches", switched[0] === "b")
  await userEvent.click(trigger)
  await tick()
  await userEvent.click(screen.getByText("New organisation"))
  ok("Switcher: create", created === 1)
})

await t("MembersList: manage", async () => {
  const changes: [string, string][] = []
  const removed: string[] = []
  const revoked: string[] = []
  let inviting = 0
  render(
    <MembersList
      members={[
        { userId: "u1", role: "owner", user: { name: "Asha Rao", email: "asha@example.com" } },
        { userId: "u2", role: "member", user: { name: "Dev Patel" } },
        { userId: "u3", role: "billing" },
      ]}
      roles={["owner", "admin", "member"]}
      currentUserId="u1"
      canManage
      onRoleChange={(m, r) => {
        changes.push([m.userId, r])
      }}
      onRemove={(m) => {
        removed.push(m.userId)
      }}
      invitations={[
        { id: "i1", email: "zed@example.com", role: "member", expiresAt: "2026-12-01" },
      ]}
      onRevokeInvite={(i) => {
        revoked.push(i.id)
      }}
      onInvite={() => inviting++}
    />,
  )
  const region = screen.getByRole("region", { name: /Members/ })
  ok("Members: count in the heading", region.textContent?.includes("3"))
  ok("Members: marks you", !!within(region).getByText("(you)"))
  ok("Members: no role picker for yourself", !screen.queryByLabelText("Role for Asha Rao"))
  ok("Members: you can leave", !!screen.getByRole("button", { name: "Leave" }))
  const picker = screen.getByLabelText("Role for Dev Patel") as HTMLSelectElement
  await userEvent.selectOptions(picker, "admin")
  await tick()
  ok("Members: role change", changes[0]?.[0] === "u2" && changes[0]?.[1] === "admin")
  const custom = screen.getByLabelText("Role for u3") as HTMLSelectElement
  ok("Members: keeps a role not in the list", custom.value === "billing")
  await userEvent.click(screen.getByRole("button", { name: "Remove Dev Patel" }))
  await tick()
  ok("Members: remove", removed[0] === "u2")
  await userEvent.click(screen.getByRole("button", { name: "Revoke invite for zed@example.com" }))
  await tick()
  ok("Members: revoke invite", revoked[0] === "i1")
  await userEvent.click(screen.getByRole("button", { name: "Invite" }))
  ok("Members: invite button", inviting === 1)
  ok("Members: roles as data-*", !!document.querySelector("[data-slot=member][data-role=billing]"))
})

await t("MembersList: read-only and errors", async () => {
  render(
    <MembersList
      members={[
        { userId: "u1", role: "owner" },
        { userId: "u2", role: "member" },
      ]}
      roles={["owner", "member"]}
      currentUserId="u2"
      onRemove={() => {
        throw new Error("An organisation needs at least one owner.")
      }}
    />,
  )
  ok("Read-only: no pickers", !document.querySelector("select"))
  ok("Read-only: roles as badges", !!screen.getByText("owner"))
  ok("Read-only: cannot remove others", !screen.queryByRole("button", { name: "Remove u1" }))
  await userEvent.click(screen.getByRole("button", { name: "Leave" }))
  await waitFor(() =>
    must(
      "Errors: shown in an alert",
      screen.getByRole("alert").textContent?.includes("one owner") === true,
    ),
  )
})

await t("InviteDialog", async () => {
  const sent: { email?: string; role: string }[] = []
  render(
    <InviteDialog
      open
      onOpenChange={() => {}}
      roles={["member", "admin"]}
      onInvite={async (input) => {
        sent.push(input)
        return { link: "https://app.example/invite/tok123" }
      }}
    />,
  )
  await tick()
  const email = screen.getByLabelText("Email")
  await userEvent.type(email, "nope")
  await userEvent.click(screen.getByRole("button", { name: "Create invite" }))
  await tick()
  ok(
    "Invite: invalid email blocked",
    sent.length === 0 && !!screen.getByText("Enter a valid email"),
  )
  await userEvent.clear(email)
  await userEvent.type(email, " zed@example.com ")
  await userEvent.selectOptions(screen.getByLabelText("Role"), "admin")
  await userEvent.click(screen.getByRole("button", { name: "Create invite" }))
  await waitFor(() =>
    must(
      "Invite: link shown",
      (screen.getByLabelText("Invite link") as HTMLInputElement).value.endsWith("tok123"),
    ),
  )
  ok(
    "Invite: trimmed email and role sent",
    sent[0]?.email === "zed@example.com" && sent[0]?.role === "admin",
  )
})

await t("InviteDialog: link without email", async () => {
  const sent: { email?: string; role: string }[] = []
  render(
    <InviteDialog
      open
      onOpenChange={() => {}}
      roles={["member"]}
      onInvite={async (input) => {
        sent.push(input)
        return { link: "https://app.example/invite/x" }
      }}
    />,
  )
  await tick()
  await userEvent.click(screen.getByRole("button", { name: "Create invite" }))
  await tick()
  ok("Invite: email optional", sent.length === 1 && !("email" in (sent[0] ?? {})))
})

await t("InviteDialog: no email field", async () => {
  render(
    <InviteDialog
      open
      askEmail={false}
      onOpenChange={() => {}}
      roles={["member"]}
      onInvite={async () => ({ link: "x" })}
    />,
  )
  await tick()
  ok("Invite: askEmail={false} hides the email", !screen.queryByLabelText("Email"))
})

await t("AcceptInvitePage", async () => {
  let accepted = 0
  render(
    <AcceptInvitePage
      org={acme}
      invite={{ inviterName: "Asha Rao", role: "member", expiresAt: "2026-12-01" }}
      onAccept={async () => ({ ok: true })}
      onAccepted={() => accepted++}
    />,
  )
  ok("Accept page: a main landmark", !!screen.getByRole("main"))
  ok("Accept page: the org's name", screen.getAllByText(/Acme Labs/).length >= 2)
  await userEvent.click(screen.getByRole("button", { name: "Accept" }))
  await waitFor(() => must("Accept page: accepted", accepted === 1))
})

await t("AcceptInvitePage: failure", async () => {
  render(<AcceptInvitePage invite={{}} onAccept={async () => ({ ok: false, reason: "expired" })} />)
  await userEvent.click(screen.getByRole("button", { name: "Accept" }))
  await waitFor(() => must("Accept page: says why", !!screen.getByText("This invite has expired")))
})

await t("OrgSettings", async () => {
  const saved: unknown[] = []
  render(
    <OrgSettings
      org={{ name: "Acme Labs", domain: null, theme: null, brandColor: null }}
      onSave={(c) => {
        saved.push(c)
      }}
    />,
  )
  const form = screen.getByRole("form", { name: "Organisation settings" })
  const domain = within(form).getByLabelText("Custom domain")
  await userEvent.type(domain, "not a domain")
  await userEvent.click(screen.getByRole("button", { name: "Save" }))
  await tick()
  ok(
    "Settings: bad domain blocked",
    saved.length === 0 && !!screen.getByText("Enter a host name like app.example.com"),
  )
  await userEvent.clear(domain)
  await userEvent.type(domain, "app.acme.example")
  const color = within(form).getByLabelText("Brand colour")
  await userEvent.type(color, "#12833c")
  await tick()
  ok("Settings: colour preview", !!document.querySelector("[data-slot=org-theme-preview]"))
  await userEvent.selectOptions(within(form).getByLabelText("Theme"), "cinematic")
  await userEvent.click(screen.getByRole("button", { name: "Save" }))
  await waitFor(() =>
    must(
      "Settings: saved",
      screen.getAllByRole("status").some((s) => s.textContent === "Saved"),
    ),
  )
  ok(
    "Settings: only changes sent",
    JSON.stringify(saved[0]) ===
      JSON.stringify({ domain: "app.acme.example", theme: "cinematic", brandColor: "#12833c" }),
    saved[0],
  )
})

await t("OrgSettings: read-only and failure", async () => {
  const { unmount } = render(
    <OrgSettings
      readOnly
      org={{ name: "Acme", domain: null, theme: null, brandColor: null }}
      onSave={() => {}}
    />,
  )
  ok("Settings: read-only has no Save", !screen.queryByRole("button", { name: "Save" }))
  unmount()
  render(
    <OrgSettings
      org={{ name: "Acme", domain: null, theme: null, brandColor: null }}
      onSave={() => {
        throw new Error("That domain is taken.")
      }}
    />,
  )
  await userEvent.type(screen.getByLabelText("Custom domain"), "app.example.com")
  await userEvent.click(screen.getByRole("button", { name: "Save" }))
  await waitFor(() =>
    must(
      "Settings: failure said",
      screen.getAllByRole("status").some((s) => s.textContent === "That domain is taken."),
    ),
  )
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
