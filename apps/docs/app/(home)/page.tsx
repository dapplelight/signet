import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock"
import { ArrowRightIcon, StarIcon } from "lucide-react"
import Link from "next/link"
import { Commands } from "@/components/home"
import { Showcase } from "@/components/showcase"
import { gitConfig } from "@/lib/shared"

const GITHUB = `https://github.com/${gitConfig.user}/${gitConfig.repo}`

const PACKAGES = [
  {
    name: "Auth",
    fact: "Sign-in, OAuth, CSRF, validation and rate limits on Hono and Workers.",
    href: "/docs/guides/add-auth",
  },
  {
    name: "Payments",
    fact: "12 providers, Razorpay, PhonePe and the app stores included, posting to one ledger.",
    href: "/docs/guides/payments",
  },
  {
    name: "Paywalls",
    fact: "Offerings you publish without an app release, and a paywall per placement.",
    href: "/docs/guides/add-monetisation",
  },
  {
    name: "AI spend caps",
    fact: "Every model call capped per user, org and day.",
    href: "/docs/guides/add-abuse-protection",
  },
  {
    name: "Workflows",
    fact: "Crash-safe runs that sleep, wait for events and pause for approval.",
    href: "/docs/guides/add-workflows",
  },
  {
    name: "Components",
    fact: "React on Tailwind v4 with a token contract. A theme is one CSS file.",
    href: "/docs/components",
  },
  {
    name: "Growth",
    fact: "Waitlist, invites, referrals and onboarding in your own database.",
    href: "/docs/guides/add-growth",
  },
  {
    name: "MCP server",
    fact: "Your coding agent reads Signet's docs and builds with the real thing.",
    href: "/docs/guides/build-a-whole-app-with-an-agent",
  },
]

const CODE = `const app = new Hono()
  .get("/api/notes", zValidator("query", Search), list)
  .post("/api/notes", zValidator("json", Note), save)

mountMcp(app, "/mcp", {
  name: "notes",
  version: "1.0.0",
  tools: appTools(app),
})`

const h2 = "text-2xl font-semibold tracking-[-0.025em] text-balance md:text-3xl"

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function Actions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href="/docs"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
      >
        Read the docs
        <ArrowRightIcon className="size-4" />
      </Link>
      <a
        href={GITHUB}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-fd-border px-4 text-sm font-medium transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
      >
        <GitHubMark />
        Star on GitHub
        <StarIcon className="size-3.5 text-fd-muted-foreground" />
      </a>
    </div>
  )
}

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 pb-24 md:px-6">
      <section className="flex flex-col items-start gap-6 pt-16 pb-14 md:pt-24 md:pb-16">
        <h1 className="max-w-4xl text-[clamp(2.5rem,6.2vw,4.5rem)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance">
          Write the business logic. Signet ships the rest.
        </h1>
        <p className="max-w-2xl text-lg text-pretty text-fd-muted-foreground md:text-xl">
          Auth, payments, paywalls, workflows, components and an MCP server, as packages you install
          and update.
        </p>
        <div className="mt-2 flex w-full flex-col items-start gap-4">
          <Commands />
          <Actions />
        </div>
      </section>

      <section aria-label="Live components">
        <Showcase />
        <p className="mt-6 text-sm text-fd-muted-foreground">
          Every tile is a live <code className="text-fd-foreground">signet-ui</code> component.{" "}
          <Link
            href="/docs/components"
            className="text-fd-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
          >
            Browse all components
          </Link>
        </p>
      </section>

      <section className="mt-20 border-t border-fd-border pt-16 md:mt-24">
        <h2 className={h2}>What ships in the box</h2>
        <ul className="mt-8 grid md:grid-cols-2 md:gap-x-12">
          {PACKAGES.map((p) => (
            <li key={p.name} className="border-t border-fd-border">
              <Link
                href={p.href}
                className="group grid grid-cols-[9rem_1fr_auto] items-baseline gap-4 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring max-sm:grid-cols-[1fr_auto] max-sm:gap-y-1"
              >
                <span className="text-base font-semibold tracking-[-0.01em]">{p.name}</span>
                <span className="text-sm text-pretty text-fd-muted-foreground max-sm:col-span-2 max-sm:row-start-2">
                  {p.fact}
                </span>
                <ArrowRightIcon className="size-4 self-center text-fd-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-fd-foreground max-sm:col-start-2 max-sm:row-start-1" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-20 grid gap-8 border-t border-fd-border pt-16 md:mt-24 md:grid-cols-[2fr_3fr] md:gap-12">
        <div className="flex flex-col items-start gap-4">
          <h2 className={h2}>One call turns your routes into MCP tools.</h2>
          <p className="max-w-sm text-pretty text-fd-muted-foreground">
            Validated Hono routes become tools a coding agent can call, with the same checks.
          </p>
          <Link
            href="/docs/guides/mcp-by-default"
            className="text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
          >
            MCP by default
          </Link>
        </div>
        <div className="min-w-0 [&_figure]:my-0">
          <DynamicCodeBlock lang="ts" code={CODE} codeblock={{ title: "server/app.ts" }} />
        </div>
      </section>

      <section className="mt-20 flex flex-col items-start gap-6 border-t border-fd-border pt-16 md:mt-24">
        <h2 className={h2}>Start with one command.</h2>
        <Commands />
        <Actions />
      </section>
    </main>
  )
}
