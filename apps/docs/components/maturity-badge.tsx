import type { maturityLevels } from "@/lib/source"

const LEVELS: Record<(typeof maturityLevels)[number], { dot: string; hint: string }> = {
  stable: { dot: "bg-emerald-500", hint: "On npm, used in production" },
  beta: { dot: "bg-amber-500", hint: "On npm, API may still change" },
  "source-only": { dot: "bg-fd-muted-foreground", hint: "Not on npm: run from the repo" },
}

/** Where a package stands: stable, beta, or source-only (not published). */
export function MaturityBadge({ level }: { level: keyof typeof LEVELS }) {
  return (
    <p className="not-prose mb-6 -mt-3 inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium">
      <span aria-hidden className={`size-1.5 rounded-full ${LEVELS[level].dot}`} />
      {level}
      <span className="font-normal text-fd-muted-foreground">{LEVELS[level].hint}</span>
    </p>
  )
}
