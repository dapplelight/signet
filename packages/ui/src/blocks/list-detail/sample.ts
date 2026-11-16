/** One row of the list, and what the detail pane shows for it. */
export type ListDetailItem = {
  id: string
  title: string
  subtitle?: string
  /** Matched against the filter option `value`. */
  status: string
  tone?: "default" | "secondary" | "outline" | "destructive"
  description?: string
  fields?: { label: string; value: string }[]
}

const NAMES = [
  "Acme Studio",
  "Northwind Portal",
  "Globex Mobile App",
  "Initech Billing",
  "Umbrella Docs",
  "Hooli Search",
  "Stark Dashboard",
  "Wayne Onboarding",
  "Soylent Newsletter",
  "Pied Piper Sync",
  "Wonka Storefront",
  "Cyberdyne Reports",
  "Gringotts Ledger",
  "Oscorp Labs",
  "Tyrell Help Centre",
]
const STATUSES = [
  ["Active", "default"],
  ["Active", "default"],
  ["Paused", "secondary"],
  ["Archived", "outline"],
] as const
const OWNERS = ["Alex Morgan", "Sam Rivera", "Jordan Lee", "Taylor Brooks"]

/** 45 generic projects: three pages of 20. Replace with your own data. */
export const SAMPLE_ITEMS: ListDetailItem[] = Array.from({ length: 45 }, (_, i) => {
  const [status, tone] = STATUSES[i % STATUSES.length] as (typeof STATUSES)[number]
  const name = NAMES[i % NAMES.length] as string
  const round = Math.floor(i / NAMES.length)
  return {
    id: `p${i + 1}`,
    title: round ? `${name} ${round + 1}` : name,
    subtitle: `Updated ${i + 1} ${i ? "days" : "day"} ago`,
    status,
    tone,
    description: `${name} keeps its tasks, files and conversations in one place so the whole team works from the same plan.`,
    fields: [
      { label: "Owner", value: OWNERS[i % OWNERS.length] as string },
      { label: "Members", value: String(3 + ((i * 5) % 17)) },
      { label: "Created", value: `Oct ${1 + (i % 28)}, 2026` },
    ],
  }
})
