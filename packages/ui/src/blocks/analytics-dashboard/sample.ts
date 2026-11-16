import type { StatItem } from "../../components/ui/stat-strip.js"

/** One chart point. */
export type DashboardPoint = { label: string; value: number }

/** One row of the recent-activity table. `tone` picks the Badge variant. */
export type DashboardRow = {
  id: string
  name: string
  status: string
  tone?: "default" | "secondary" | "outline" | "destructive"
  date: string
}

export type DashboardData = {
  stats: StatItem[]
  series: DashboardPoint[]
  rows: DashboardRow[]
}

/** Generic sample data for previews and first renders. Replace it with your own. */
export const SAMPLE_DASHBOARD: DashboardData = {
  stats: [
    { label: "Visitors", value: "12,480", meta: "+8.2% vs last period", tone: "good" },
    { label: "Signups", value: "684", meta: "+3.1% vs last period", tone: "good" },
    { label: "Active users", value: "3,912", meta: "-1.4% vs last period", tone: "warn" },
    { label: "Projects", value: "1,207", meta: "42 created today" },
  ],
  series: [
    { label: "Mon", value: 1420 },
    { label: "Tue", value: 1760 },
    { label: "Wed", value: 1680 },
    { label: "Thu", value: 2040 },
    { label: "Fri", value: 2310 },
    { label: "Sat", value: 1590 },
    { label: "Sun", value: 1680 },
  ],
  rows: [
    { id: "1", name: "Acme Studio", status: "Active", date: "Nov 16, 2026" },
    {
      id: "2",
      name: "Northwind Analytics",
      status: "Trial",
      tone: "secondary",
      date: "Nov 15, 2026",
    },
    { id: "3", name: "Globex Design Collective", status: "Active", date: "Nov 15, 2026" },
    { id: "4", name: "Initech", status: "Paused", tone: "outline", date: "Nov 13, 2026" },
    {
      id: "5",
      name: "Umbrella Labs",
      status: "Past due",
      tone: "destructive",
      date: "Nov 12, 2026",
    },
  ],
}
