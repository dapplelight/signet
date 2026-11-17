import Link from "next/link"
import type { ReactNode } from "react"
import { Showcase } from "@/components/showcase"

const CODE = `const app = new Hono()
  .get("/api/notes", zValidator("query", Search), list)
  .post("/api/notes", zValidator("json", Note), save)

mountMcp(app, "/mcp", { tools: appTools(app) })`

const TOOLS = [
  { name: "list_notes", kind: "read", note: "runs as the signed-in user" },
  { name: "save_note", kind: "write", note: "asks before it runs" },
]

const LEDGER = [
  { provider: "Stripe", event: "invoice.paid", amount: "$29.00", state: "posted" },
  { provider: "Razorpay", event: "payment.captured", amount: "₹2,499", state: "posted" },
  { provider: "PhonePe", event: "PAYMENT_SUCCESS", amount: "₹499", state: "posted" },
  {
    provider: "Razorpay",
    event: "payment.captured",
    amount: "₹2,499",
    state: "duplicate, ignored",
  },
]

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
    <div className="grid items-center gap-8 border-t border-fd-border py-16 md:grid-cols-[2fr_3fr] md:gap-16">
      <div className="flex flex-col gap-3">
        <h2 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">{title}</h2>
        <p className="max-w-sm text-fd-muted-foreground">{body}</p>
        <Link href={href} className="text-sm font-medium underline underline-offset-4">
          Read the guide
        </Link>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <section className="grid items-center gap-12 py-16 md:grid-cols-2 md:py-24">
        <div className="flex flex-col items-start gap-6">
          <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-6xl">
            One line turns your API into an MCP server.
          </h1>
          <p className="max-w-md text-lg text-fd-muted-foreground">
            Signet is the TypeScript kit for the rest of the app too: payments, paywalls, workflows,
            abuse limits and the components to show them.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/docs"
              className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
            >
              Read the docs
            </Link>
            <code className="text-sm text-fd-muted-foreground">npx create-signet-app@latest</code>
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card">
          <p className="border-b border-fd-border px-4 py-2 text-xs text-fd-muted-foreground">
            server/app.ts
          </p>
          <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
            <code>{CODE}</code>
          </pre>
          <div className="border-t border-fd-border px-4 py-3">
            <p className="mb-2 text-xs text-fd-muted-foreground">What Claude sees</p>
            <ul className="flex flex-col gap-1.5">
              {TOOLS.map((t) => (
                <li key={t.name} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <code className="font-medium">{t.name}</code>
                  <span
                    className={
                      t.kind === "write"
                        ? "text-xs font-medium text-amber-600 dark:text-amber-400"
                        : "text-xs font-medium text-fd-primary"
                    }
                  >
                    {t.kind}
                  </span>
                  <span className="text-fd-muted-foreground">{t.note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <Row
        title="Twelve payment providers, one ledger"
        body="Stripe, Paddle, Razorpay, PhonePe, the App Store and Google Play post to the same double-entry ledger. A webhook that arrives twice is booked once."
        href="/docs/guides/payments"
      >
        <div className="overflow-x-auto rounded-xl border border-fd-border">
          <table className="w-full text-left text-sm tabular-nums">
            <tbody>
              {LEDGER.map((l, i) => (
                <tr
                  key={`${l.provider}-${i}`}
                  className="border-b border-fd-border last:border-0 data-[dup=true]:text-fd-muted-foreground"
                  data-dup={l.state !== "posted"}
                >
                  <td className="px-4 py-3 font-medium">{l.provider}</td>
                  <td className="px-4 py-3 font-mono text-xs">{l.event}</td>
                  <td className="px-4 py-3 text-right">{l.amount}</td>
                  <td className="px-4 py-3 text-right text-xs">{l.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Row>

      <Row
        title="AI spend that stops at the cap"
        body="Every model call is metered per user, org and day. Sign-up turns away bots and throwaway inboxes before they cost anything."
        href="/docs/guides/add-abuse-protection"
      >
        <div className="flex flex-col gap-3 rounded-xl border border-fd-border p-6">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">priya@acme.dev · today</span>
            <span className="tabular-nums text-fd-muted-foreground">$2.00 of $2.00</span>
          </div>
          <div className="h-2 rounded-full bg-fd-muted">
            <div className="h-2 w-full rounded-full bg-fd-foreground" />
          </div>
          <p className="text-sm">
            <code className="font-medium">429 budget_exceeded</code>
            <span className="text-fd-muted-foreground"> · resets at midnight UTC</span>
          </p>
        </div>
      </Row>

      <Row
        title="Workflows that outlive the server"
        body="Steps can sleep for days, wait for an event or pause for a named person. A restart picks up where it stopped."
        href="/docs/guides/add-workflows"
      >
        <ol className="flex flex-col rounded-xl border border-fd-border p-6">
          {STEPS.map((s, i) => (
            <li key={s.what} className="grid grid-cols-[4rem_1fr] gap-4 py-1.5 text-sm">
              <span className="tabular-nums text-fd-muted-foreground">{s.at}</span>
              <span className={i === STEPS.length - 1 ? "font-medium" : undefined}>{s.what}</span>
            </li>
          ))}
        </ol>
      </Row>

      <section className="border-t border-fd-border py-16">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Every component reads one token contract.
        </h2>
        <p className="mt-3 max-w-md text-fd-muted-foreground">
          Swap the theme file and all of these change together.
        </p>
        <div className="mt-10">
          <Showcase />
        </div>
      </section>

      <section className="border-t border-fd-border py-16">
        <h2 className="text-lg font-semibold">Also in the box</h2>
        <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
          {MORE.map(([label, href]) => (
            <li key={href}>
              <Link href={href} className="text-fd-muted-foreground hover:text-fd-foreground">
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-12 flex flex-wrap items-center gap-4">
          <code className="rounded-lg border border-fd-border px-4 py-2.5 text-sm">
            npx create-signet-app@latest my-app
          </code>
          <Link href="/docs" className="text-sm font-medium underline underline-offset-4">
            Read the docs
          </Link>
        </div>
      </section>
    </main>
  )
}
