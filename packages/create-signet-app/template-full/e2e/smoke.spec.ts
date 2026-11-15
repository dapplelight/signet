import { type ChildProcess, spawn } from "node:child_process"
import { expect, test } from "@playwright/test"

// Sign in → admin → billing in a real browser against the built app, served by
// api/server.ts with a throwaway database and fake billing. The one-time code
// is read from the server's console, where development prints it. No keys.
const PORT = 4100 + Math.floor(Math.random() * 500)
const BASE = `http://localhost:${PORT}`
const PHONE = "+919000000001"
const PHONE_2 = "+919000000002"

let server: ChildProcess
let log = ""

test.beforeAll(async () => {
  server = spawn("bun", ["api/server.ts"], {
    env: {
      ...process.env,
      APP_ENV: "development",
      PORT: String(PORT),
      DATABASE_PATH: ":memory:",
      SESSION_SECRET: "e2e-session-secret-0123456789abcdef",
      OTP_SECRET: "e2e-otp-secret-0123456789abcdef01234",
      ADMIN_PHONES: PHONE,
      BILLING: "fake",
    },
  })
  server.stdout?.on("data", (d) => {
    log += String(d)
  })
  server.stderr?.on("data", (d) => {
    log += String(d)
  })
  await expect
    .poll(
      () =>
        fetch(`${BASE}/api/health`).then(
          (r) => r.ok,
          () => false,
        ),
      { timeout: 20_000 },
    )
    .toBe(true)
})

test.afterAll(() => {
  server?.kill()
})

test("sign in, then admin, then billing", async ({ page }) => {
  await page.goto(`${BASE}/`)
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel(/phone/i).fill(PHONE)
  await page.getByRole("button", { name: /send code/i }).click()
  await expect.poll(() => /Your code is (\d+)/.exec(log)?.[1]).toBeTruthy()
  const code = /Your code is (\d+)/.exec(log)?.[1] ?? ""
  // A full code submits itself.
  await page.getByRole("textbox", { name: "One-time code" }).fill(code)
  await expect(page).toHaveURL(`${BASE}/`)
  await expect(page.getByText(/You are on the/)).toBeVisible()

  await page.getByRole("link", { name: "Admin" }).click()
  // The admin panel loads the users table from /api/admin.
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible()
  await expect(page.getByRole("cell", { name: PHONE })).toBeVisible()

  await page.getByRole("link", { name: "Billing" }).click()
  // The plan picker marks the current plan, then checkout moves it.
  const current = page.locator('[data-slot="plan-card"][data-current]')
  await expect(current).toHaveAttribute("data-plan", "free")
  await page.getByRole("button", { name: "Continue with Pro" }).click()
  await expect(current).toHaveAttribute("data-plan", "pro")

  await page.getByRole("link", { name: /inbox/i }).click()
  await expect(page.getByText("Plan changed")).toBeVisible()

  // The other wired screens render with data, not the error boundary.
  await page.getByRole("link", { name: "Account" }).click()
  await expect(page.getByText("This device")).toBeVisible()
  await page.getByRole("link", { name: "Privacy" }).click()
  await expect(page.getByText("Usage analytics")).toBeVisible()
})

/** Sign in on this page; reads the newest code the server printed. */
async function signIn(page: import("@playwright/test").Page, phone: string) {
  const before = log.length
  await page.getByLabel(/phone/i).fill(phone)
  await page.getByRole("button", { name: /send code/i }).click()
  await expect.poll(() => /Your code is (\d+)/.exec(log.slice(before))?.[1]).toBeTruthy()
  const code = /Your code is (\d+)/.exec(log.slice(before))?.[1] ?? ""
  await page.getByRole("textbox", { name: "One-time code" }).fill(code)
}

test("orgs: personal org, a second org, an invite, isolation", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage()
  await owner.goto(`${BASE}/login`)
  await signIn(owner, PHONE)
  await expect(owner).toHaveURL(`${BASE}/`)
  const switcher = owner.getByRole("button", { name: "Switch organisation" })
  await expect(switcher).toContainText("Personal")
  const personalId = (
    (await (await owner.request.get(`${BASE}/api/orgs/current`)).json()) as {
      org: { id: string }
    }
  ).org.id

  // A second org: made from the switcher, and the app moves into it.
  await switcher.click()
  await owner.getByRole("button", { name: "New organisation" }).click()
  await owner.getByLabel("Name").fill("Second Org")
  await owner.getByRole("button", { name: "Create" }).click()
  await expect(owner).toHaveURL(`${BASE}/org`)
  await expect(switcher).toContainText("Second Org")

  // Invite by link.
  await owner.getByRole("link", { name: "Members and invites" }).click()
  await owner.getByRole("button", { name: "Invite", exact: true }).click()
  await owner.getByRole("button", { name: "Create invite" }).click()
  const link = await owner.getByLabel("Invite link").inputValue()
  expect(link).toContain("/invite/")

  // The second user opens it signed out, signs in, comes back and accepts.
  const guest = await (await browser.newContext()).newPage()
  await guest.goto(link)
  await expect(guest.getByText("Second Org").first()).toBeVisible()
  await guest.getByRole("button", { name: "Accept" }).click()
  await expect(guest).toHaveURL(/\/login\?next=/)
  await signIn(guest, PHONE_2)
  await expect(guest).toHaveURL(link)
  await guest.getByRole("button", { name: "Accept" }).click()
  await expect(guest).toHaveURL(`${BASE}/`)
  await expect(guest.getByRole("button", { name: "Switch organisation" })).toContainText(
    "Second Org",
  )

  // They see the org they joined and their own, never the owner's personal org.
  const theirs = (await (await guest.request.get(`${BASE}/api/orgs`)).json()) as {
    orgs: { org: { id: string; name: string } }[]
  }
  expect(theirs.orgs.map((o) => o.org.name).sort()).toEqual(["Personal", "Second Org"])
  expect(theirs.orgs.some((o) => o.org.id === personalId)).toBe(false)
  await guest.getByRole("link", { name: "Org", exact: true }).click()
  await guest.getByRole("link", { name: "Members and invites" }).click()
  await expect(guest.locator('[data-slot="member"]')).toHaveCount(2)

  // A request for the owner's personal org, by header: 404.
  const other = await guest.request.get(`${BASE}/api/orgs/current/members`, {
    headers: { "x-org": personalId },
  })
  expect(other.status()).toBe(404)
})
