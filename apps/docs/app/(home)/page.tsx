import Link from "next/link"
import { Mark } from "@/components/mark"
import { Showcase } from "@/components/showcase"

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <section className="flex flex-col items-center gap-5 py-20 text-center">
        <Mark className="size-12" />
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
          Write your business logic. Signet does the rest.
        </h1>
        <p className="max-w-xl text-lg text-fd-muted-foreground">
          Components, themes, auth, payments, AI and data for React apps.
        </p>
        <div className="flex gap-3">
          <Link
            href="/docs"
            className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
          >
            Get started
          </Link>
          <Link
            href="/docs/components"
            className="rounded-lg border border-fd-border px-4 py-2 text-sm font-medium hover:bg-fd-accent"
          >
            Browse components
          </Link>
        </div>
        <code className="rounded-md bg-fd-muted px-3 py-1.5 text-sm">
          npx create-signet-app my-app
        </code>
      </section>
      <Showcase />
    </main>
  )
}
