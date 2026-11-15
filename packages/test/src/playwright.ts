/**
 * Playwright helpers for Signet apps. `@playwright/test` is an optional peer:
 * install it in the app that runs the browser tests.
 *
 *   import { expectAcrossThemes, seed, signInAs } from "@dapplelight/signet-test/playwright"
 *
 *   test("dashboard", async ({ page }) => {
 *     await signInAs(page, "user_1", { session: { cookieName: "app_session", secret } })
 *     await seed(page, { invoices: [...] })
 *     await page.goto("/dashboard")
 *     await expectAcrossThemes(page, "dashboard")
 *   })
 *
 * Baselines are Playwright's own `toHaveScreenshot` files: the first run (or
 * `--update-snapshots`) writes them next to the spec, later runs compare.
 * Screenshots differ by OS and browser build, so make baselines on the
 * machine (or CI image) that checks them.
 */
import type { SessionOptions } from "@dapplelight/signet-server/auth/session"
import { issueSession } from "@dapplelight/signet-server/auth/session"
import { expect, type Page, type PageAssertionsToHaveScreenshotOptions } from "@playwright/test"

/** The three themes in `@dapplelight/signet-tokens`. */
export const THEMES = ["editorial", "cinematic", "finance"] as const
export const MODES = ["light", "dark"] as const
export type Mode = (typeof MODES)[number]

/** Puts the page in `theme` and `mode`. Override for an app that switches themes differently. */
export type ApplyTheme = (page: Page, theme: string, mode: Mode) => Promise<void>

/**
 * The default switch, matching the showcase and the scaffold: reload with
 * `?theme=<name>` (each theme is its own stylesheet), with `signet-theme` in
 * localStorage set to the mode (what ThemeProvider reads), then make sure the
 * `.dark` class matches.
 */
export const applyTheme: ApplyTheme = async (page, theme, mode) => {
  await page.evaluate((m) => {
    try {
      localStorage.setItem("signet-theme", m)
    } catch {}
  }, mode)
  const url = new URL(page.url())
  url.searchParams.set("theme", theme)
  url.searchParams.set("dark", mode === "dark" ? "1" : "0")
  await page.goto(url.toString())
  await page.evaluate((m) => {
    document.documentElement.classList.toggle("dark", m === "dark")
    document.documentElement.style.colorScheme = m
  }, mode)
}

export type AcrossThemesOptions = {
  themes?: readonly string[]
  modes?: readonly Mode[]
  apply?: ApplyTheme
  /** Passed to `toHaveScreenshot` (fullPage, mask, maxDiffPixelRatio...). */
  screenshot?: PageAssertionsToHaveScreenshotOptions
}

/**
 * Screenshot the current page in every theme and mode (3 × 2 by default) and
 * compare each with its stored baseline, `<name>-<theme>-<mode>.png`. Every
 * combination is checked before the test fails (soft assertions), so one run
 * shows all the breakage. Animations are disabled and fonts awaited.
 */
export async function expectAcrossThemes(
  page: Page,
  name: string,
  options: AcrossThemesOptions = {},
): Promise<void> {
  const apply = options.apply ?? applyTheme
  for (const theme of options.themes ?? THEMES) {
    for (const mode of options.modes ?? MODES) {
      await apply(page, theme, mode)
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      await expect
        .soft(page, `${name} in ${theme} ${mode}`)
        .toHaveScreenshot(`${name}-${theme}-${mode}.png`, {
          animations: "disabled",
          caret: "hide",
          ...options.screenshot,
        })
    }
  }
}

/**
 * Sign the browser in as `userId` by setting a session cookie, without the
 * sign-in UI. With `session`, mints a signet-server stateless session
 * (`issueSession`) with the app's own cookie name and secret; for stored
 * sessions or Better Auth, mint the token yourself and pass `token`.
 * `url` is the app origin (default: the page's current origin; required
 * before the first `goto`).
 */
export async function signInAs(
  page: Page,
  userId: string,
  options: { url?: string } & (
    | { session: SessionOptions; token?: undefined; cookieName?: undefined }
    | { token: string; cookieName: string; session?: undefined }
  ),
): Promise<void> {
  const name = options.session?.cookieName ?? (options.cookieName as string)
  const value = options.token ?? (await issueSession(options.session as SessionOptions, userId))
  const current = page.url()
  const url = options.url ?? (current.startsWith("http") ? new URL(current).origin : undefined)
  if (!url) throw new Error("signInAs: pass `url` (the app origin) before the page has navigated")
  const sameSite = options.session?.sameSite ?? "lax"
  await page.context().addCookies([
    {
      name,
      value,
      url,
      httpOnly: true,
      sameSite: sameSite === "none" ? "None" : sameSite === "strict" ? "Strict" : "Lax",
      ...(sameSite === "none" ? { secure: true } : {}),
    },
  ])
}

/**
 * Load test data through the app's seed endpoint: demo mode's
 * `/__signet/seed` by default (see `@dapplelight/signet-test/demo`). Returns
 * the endpoint's JSON. Throws on a non-2xx answer.
 */
export async function seed<T = unknown>(
  page: Page,
  data: unknown,
  options: { path?: string } = {},
): Promise<T> {
  const res = await page.request.post(options.path ?? "/__signet/seed", { data })
  if (!res.ok()) throw new Error(`seed: ${res.status()} ${await res.text()}`)
  return (await res.json()) as T
}
