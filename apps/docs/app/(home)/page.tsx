import { Gloock } from "next/font/google"
import Link from "next/link"
import type { ReactNode } from "react"
import { Ledger, McpChat, Skinned, SkinPicker, SkinProvider } from "@/components/home"
import { Showcase } from "@/components/showcase"

/** An inscriptional serif for headings, the lettering of a seal. */
const display = Gloock({ subsets: ["latin"], weight: "400", variable: "--font-seal" })

const CODE = `const app = new Hono()
  .get("/api/notes", zValidator("query", Search), list)
  .post("/api/notes", zValidator("json", Note), save)

`
const LINE = `mountMcp(app, "/mcp", { tools: appTools(app) })`

const STEPS = [
  { at: "Day 0", what: "Trial started" },
  { at: "Day 0", what: "Sleeping 3 days" },
  { at: "Day 3", what: "Server restarted" },
  { at: "Day 3", what: "Resumed, sent reminder" },
  { at: "Day 3", what: "Waiting for Priya to approve refund" },
]

const MORE = [
  ["Paywalls without a release", "/docs/guides/add-monetisation"],
  ["Waitlist, invites, referrals", "/docs/guides/add-growth"],
  ["Comments and undo", "/docs/guides/add-collab"],
  ["Realtime presence", "/docs/guides/add-realtime"],
  ["A/B tests and status page", "/docs/guides/add-experiments"],
  ["OpenAPI and signed webhooks", "/docs/guides/publish-an-api"],
  ["UPI links and GST invoices", "/docs/guides/add-india"],
]

const h2 =
  "font-[family-name:var(--font-seal)] text-3xl tracking-[-0.01em] text-balance md:text-5xl"

function Row({
  title,
  body,
  href,
  children,
}: {
  title: string
  body: string
  href: string
  children: ReactNode
}) {
  return (
    <section className="grid items-center gap-8 border-t border-fd-border py-16 md:grid-cols-[2fr_3fr] md:gap-16 md:py-24">
      <div className="flex flex-col gap-4">
        <h2 className={h2}>{title}</h2>
        <p className="max-w-sm text-pretty text-fd-muted-foreground">{body}</p>
        <Link href={href} className="text-sm font-medium underline">
          Read the guide
        </Link>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

export default function HomePage() {
  return (
    <SkinProvider>
      <main
        className={`home ${display.variable} mx-auto text-base w-full max-w-6xl px-5 pb-24 md:px-6`}
      >
        <section className="grid items-start gap-12 pt-14 pb-20 lg:items-center lg:grid-cols-[5fr_6fr] lg:gap-14 lg:pt-24">
          <div className="flex min-w-0 flex-col items-start gap-7">
            <h1 className="font-[family-name:var(--font-seal)] text-[clamp(2.75rem,6.4vw,5.25rem)] leading-[0.98] tracking-[-0.02em] text-balance">
              Write the business logic. Signet ships the rest.
            </h1>
            <p className="max-w-md text-lg text-pretty text-fd-muted-foreground">
              Auth, payments, paywalls, workflows, components and an MCP server, as packages you
              install and update.
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                href="/docs"
                className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
              >
                Read the docs
              </Link>
              <code className="text-sm text-fd-muted-foreground">npx create-signet-app@latest</code>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-5 lg:pt-3">
            <div className="w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card">
              <p className="border-b border-fd-border px-4 py-2 text-xs text-fd-muted-foreground">
                server/app.ts
              </p>
              <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed whitespace-pre-wrap sm:whitespace-pre">
                <code className="text-fd-muted-foreground">{CODE}</code>
                <code className="font-semibold text-fd-foreground">{LINE}</code>
              </pre>
            </div>
            <McpChat />
          </div>
        </section>

        <section className="border-t border-fd-border py-16 md:py-24">
          <div className="grid gap-8 md:grid-cols-[2fr_3fr] md:items-end md:gap-16">
            <div className="flex flex-col gap-4">
              <h2 className={h2}>A theme is one CSS file.</h2>
              <p className="max-w-sm text-pretty text-fd-muted-foreground">
                Every component reads the same token contract. Pick a shipped theme and every live
                surface on this page redraws: colour, radius, spacing and type.
              </p>
            </div>
            <SkinPicker />
          </div>
          <div className="mt-12">
            <Skinned>
              <Showcase />
            </Skinned>
          </div>
        </section>

        <Row
          title="Twelve payment providers, one ledger"
          body="Stripe, Paddle, Razorpay, PhonePe, the App Store and Google Play post to the same double-entry ledger. A webhook that arrives twice is booked once."
          href="/docs/guides/payments"
        >
          <Ledger />
        </Row>

        <Row
          title="AI spend that stops at the cap"
          body="Every model call is metered per user, org and day. Sign-up turns away bots and throwaway inboxes before they cost anything."
          href="/docs/guides/add-abuse-protection"
        >
          <Skinned className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">priya@acme.dev · today</span>
              <span className="tabular-nums text-muted-foreground">$2.00 of $2.00</span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div className="h-2 w-full rounded-full bg-foreground" />
            </div>
            <p className="text-sm">
              <code className="font-medium">429 budget_exceeded</code>
              <span className="text-muted-foreground"> · resets at midnight UTC</span>
            </p>
          </Skinned>
        </Row>

        <Row
          title="Workflows that outlive the server"
          body="Steps can sleep for days, wait for an event or pause for a named person. A restart picks up where it stopped."
          href="/docs/guides/add-workflows"
        >
          <Skinned className="rounded-2xl border border-border bg-card p-6">
            <ol className="flex flex-col">
              {STEPS.map((s, i) => (
                <li key={s.what} className="grid grid-cols-[4rem_1fr] gap-4 py-1.5 text-sm">
                  <span className="tabular-nums text-muted-foreground">{s.at}</span>
                  <span className={i === STEPS.length - 1 ? "font-medium" : undefined}>
                    {s.what}
                  </span>
                </li>
              ))}
            </ol>
          </Skinned>
        </Row>

        <section className="grid gap-10 border-t border-fd-border py-16 md:grid-cols-[2fr_3fr] md:gap-16 md:py-24">
          <h2 className={h2}>Also in the box</h2>
          <ul className="grid gap-x-10 sm:grid-cols-2">
            {MORE.map(([label, href]) => (
              <li key={href} className="border-b border-fd-border">
                <Link
                  href={href}
                  className="block py-3 text-fd-muted-foreground transition-colors hover:text-fd-foreground"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-wrap items-center gap-4 border-t border-fd-border pt-16">
          <code className="rounded-lg border border-fd-border px-4 py-2.5 text-sm">
            npx create-signet-app@latest my-app
          </code>
          <Link href="/docs" className="text-sm font-medium underline">
            Read the docs
          </Link>
        </section>
      </main>
    </SkinProvider>
  )
}
