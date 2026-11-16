// Demo page for the page-level blocks: /block-settings.html, /block-list-detail.html,
// /block-analytics-dashboard.html, /block-auth.html, /block-onboarding.html,
// /block-pricing.html, /block-checkout-summary.html, /block-empty-page.html and
// /block-error-page.html. Query: &state=ready|loading|error, &theme=<name>,
// &dark=1, &embed=1 (no demo bar; the docs site embeds the page that way);
// auth also takes &mode=sign-in|sign-up and &step=request|verify (the code is
// 123456), error-page takes &code=404|500.
// The block name comes from <body data-block>. Everything runs on in-memory data.
import { AnalyticsDashboard } from "@dapplelight/signet-ui/blocks/analytics-dashboard"
import { Auth, SAMPLE_PROVIDERS } from "@dapplelight/signet-ui/blocks/auth"
import { CheckoutSummary } from "@dapplelight/signet-ui/blocks/checkout-summary"
import { EmptyPage } from "@dapplelight/signet-ui/blocks/empty-page"
import { ErrorPage } from "@dapplelight/signet-ui/blocks/error-page"
import { ListDetail } from "@dapplelight/signet-ui/blocks/list-detail"
import { Onboarding } from "@dapplelight/signet-ui/blocks/onboarding"
import { Pricing } from "@dapplelight/signet-ui/blocks/pricing"
import { Settings } from "@dapplelight/signet-ui/blocks/settings"
import { Toaster } from "@dapplelight/signet-ui/components/toast"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { applyTheme, initialTheme, THEMES } from "./themes"

const params = new URLSearchParams(location.search)
const block = document.body.dataset.block ?? ""
const STATES = ["ready", "loading", "error"] as const
const state = STATES.find((s) => s === params.get("state")) ?? "ready"
const embed = params.get("embed") === "1"

function Block() {
  const retry = () =>
    location.assign(`?${new URLSearchParams({ ...Object.fromEntries(params), state: "ready" })}`)
  if (block === "analytics-dashboard") return <AnalyticsDashboard state={state} onRetry={retry} />
  if (block === "list-detail") return <ListDetail state={state} onRetry={retry} />
  if (block === "settings") return <Settings state={state} onRetry={retry} />
  if (block === "auth") {
    const wait = () => new Promise((r) => setTimeout(r, 400))
    return (
      <Auth
        state={state}
        onRetry={retry}
        mode={params.get("mode") === "sign-up" ? "sign-up" : "sign-in"}
        step={params.get("step") === "verify" ? "verify" : "request"}
        to="ada@example.com"
        providers={SAMPLE_PROVIDERS}
        onRequestCode={wait}
        onVerify={async ({ code }) => {
          await wait()
          if (code !== "123456") throw new Error("That code is not right. Try 123456.")
        }}
        footer="By continuing you agree to the terms."
      />
    )
  }
  if (block === "onboarding")
    return <Onboarding state={state} onRetry={retry} onSkip={() => {}} />
  if (block === "pricing") return <Pricing state={state} onRetry={retry} />
  if (block === "checkout-summary")
    return (
      <CheckoutSummary
        state={state}
        onRetry={retry}
        discount={500}
        tax={430}
        onPay={() => new Promise((r) => setTimeout(r, 600))}
      />
    )
  if (block === "empty-page") return <EmptyPage state={state} onRetry={retry} onAction={() => {}} />
  if (block === "error-page")
    return (
      <ErrorPage
        state={state}
        onRetry={retry}
        code={params.get("code") === "500" ? 500 : 404}
        homeHref="./"
        onTryAgain={() => location.reload()}
      />
    )
  return <p className="p-6">Unknown block "{block}".</p>
}

function DemoBar() {
  const theme = initialTheme()
  const dark = document.documentElement.classList.contains("dark")
  const href = (over: Record<string, string>) =>
    `?${new URLSearchParams({ state, theme, dark: dark ? "1" : "0", ...over })}`
  const link =
    "inline-flex min-h-11 items-center rounded-md px-2 text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary aria-[current=page]:bg-bg-elevated aria-[current=page]:font-medium aria-[current=page]:text-text-primary"
  return (
    <nav
      aria-label="Demo"
      className="flex flex-wrap items-center gap-1 border-b border-border-default bg-bg-surface px-4 py-1"
    >
      <a href="./" className={link}>
        Showcase
      </a>
      {STATES.map((s) => (
        <a
          key={s}
          href={href({ state: s })}
          aria-current={s === state ? "page" : undefined}
          className={link}
        >
          {s}
        </a>
      ))}
      {THEMES.map((t) => (
        <a
          key={t}
          href={href({ theme: t })}
          aria-current={t === theme ? "page" : undefined}
          className={link}
        >
          {t}
        </a>
      ))}
      <a href={href({ dark: dark ? "0" : "1" })} className={link}>
        {dark ? "Light" : "Dark"}
      </a>
    </nav>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element #root not found")
await applyTheme(initialTheme())
createRoot(root).render(
  <StrictMode>
    <main className="min-h-dvh bg-bg-base text-text-primary">
      <h1 className="sr-only">Signet block: {block}</h1>
      {embed ? null : <DemoBar />}
      <Block />
      <Toaster />
    </main>
  </StrictMode>,
)
