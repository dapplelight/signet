import { type ChildProcess, spawn } from "node:child_process"
import { expect, test } from "@playwright/test"

// Sign in → admin → billing in a real browser against the built app, served by
// api/server.ts with a throwaway database and fake billing. The one-time code
// is read from the server's console, where development prints it. No keys.
const PORT = 4100 + Math.floor(Math.random() * 500)
const BASE = `http://localhost:${PORT}`
const PHONE = "+919000000001"

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
