import Link from "next/link"
import { Mark } from "@/components/mark"
import { Showcase } from "@/components/showcase"

const BORING = ["Login", "Payments", "Paywalls", "Admin", "Webhooks", "Bot checks"]

const FEATURES = [
  {
    title: "12 payment providers",
    body: "Stripe, Paddle, Razorpay, PhonePe, App Store, Google Play. One model, one ledger.",
    href: "/docs/guides/payments",
  },
  {
    title: "Paywalls without a release",
    body: "Change offers remotely. Cancel, refund, MRR and churn built in.",
    href: "/docs/guides/add-monetisation",
  },
  {
    title: "AI bills that can't explode",
    body: "Every AI call capped per user, org and day. Bots stopped at sign-up.",
    href: "/docs/guides/add-abuse-protection",
  },
  {
    title: "Workflows that survive crashes",
    body: "Sleep for days, wait for events, pause for a human to approve.",
    href: "/docs/guides/add-workflows",
  },
  {
    title: "Launch kit included",
    body: "Waitlist, invites, referrals, changelog and feedback in your own database.",
    href: "/docs/guides/add-growth",
  },
]

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <section className="flex flex-col items-center gap-6 py-20 text-center md:py-28">
        <Mark className="size-12" />
        <p className="text-xs font-medium uppercase tracking-widest text-fd-muted-foreground">
          Open source · Beta
        </p>
        <h1 className="max-w-5xl text-balance text-5xl font-semibold tracking-tighter md:text-7xl">
          Every SaaS is the same 80%.
          <span className="block text-fd-muted-foreground">Signet ships it.</span>
        </h1>
        <ul className="flex max-w-2xl flex-wrap justify-center gap-2">
          {BORING.map((b) => (
            <li
              key={b}
              className="rounded-full border border-fd-border px-3 py-1 text-sm text-fd-muted-foreground line-through decoration-fd-primary decoration-2"
            >
              {b}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/docs"
            className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
          >
            Get started
          </Link>
          <Link
            href="/docs/components"
            className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-medium hover:bg-fd-accent"
          >
            Browse components
          </Link>
        </div>
        <code className="rounded-md bg-fd-muted px-3 py-1.5 text-sm">
          npx create-signet-app@latest my-app
        </code>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Link
          href="/docs/guides/mcp-by-default"
          className="flex min-w-0 flex-col justify-between gap-6 rounded-2xl bg-fd-foreground p-8 text-fd-background md:col-span-2 md:row-span-2"
        >
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium uppercase tracking-widest opacity-60">One line</p>
            <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">
              Your API is now an MCP server.
            </h2>
            <p className="max-w-md opacity-70">
              Every validated route becomes a tool Claude can call, as the signed-in user. Writes
              ask first.
            </p>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-fd-background/10 p-4 text-sm">
            <code>{`mountMcp(app, "/mcp", { tools: appTools(app) })`}</code>
          </pre>
        </Link>
        {FEATURES.map((f) => (
          <Link
            key={f.title}
            href={f.href}
            className="flex min-w-0 flex-col gap-2 rounded-2xl border border-fd-border p-6 hover:bg-fd-accent"
          >
            <h3 className="text-lg font-semibold tracking-tight">{f.title}</h3>
            <p className="text-sm text-fd-muted-foreground">{f.body}</p>
          </Link>
        ))}
      </section>

      <div className="mt-24">
        <Showcase />
      </div>

      <section className="flex flex-col items-center gap-5 py-24 text-center">
        <h2 className="text-4xl font-semibold tracking-tighter md:text-6xl">
          Build the 20% that's yours.
        </h2>
        <Link
          href="/docs"
          className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
        >
          Get started
        </Link>
      </section>
    </main>
  )
}
