import { Badge } from "@dapplelight/signet-ui/components/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@dapplelight/signet-ui/components/card"
import { EmptyState } from "@dapplelight/signet-ui/components/empty-state"
import { ErrorState } from "@dapplelight/signet-ui/components/error-state"
import { Skeleton } from "@dapplelight/signet-ui/components/skeleton"
import { type StatItem, StatStrip } from "@dapplelight/signet-ui/components/stat-strip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@dapplelight/signet-ui/components/table"
import { useQuery } from "@tanstack/react-query"

export type OverviewData = {
  stats: StatItem[]
  series: { label: string; value: number }[]
  rows: {
    id: string
    name: string
    status: string
    tone?: "default" | "secondary" | "outline" | "destructive"
    date: string
  }[]
}

// Sample data for the first run. Replace loadOverview with a call to your API
// (src/lib/api.ts); the page already handles loading, empty and error.
export const SAMPLE_OVERVIEW: OverviewData = {
  stats: [
    { label: "Visitors", value: "12,480", meta: "+8.2% vs last week", tone: "good" },
    { label: "Sign-ups", value: "684", meta: "+3.1% vs last week", tone: "good" },
    { label: "Active users", value: "3,912", meta: "-1.4% vs last week", tone: "warn" },
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
    { id: "1", name: "Acme Studio", status: "Active", date: "Nov 16" },
    { id: "2", name: "Northwind", status: "Trial", tone: "secondary", date: "Nov 15" },
    { id: "3", name: "Globex", status: "Active", date: "Nov 15" },
    { id: "4", name: "Initech", status: "Paused", tone: "outline", date: "Nov 13" },
    { id: "5", name: "Umbrella Labs", status: "Past due", tone: "destructive", date: "Nov 12" },
  ],
}

async function loadOverview(): Promise<OverviewData> {
  return SAMPLE_OVERVIEW
}

export function Overview() {
  const q = useQuery({ queryKey: ["overview"], queryFn: loadOverview })
  return (
    <OverviewView
      state={q.isPending ? "loading" : q.isError ? "error" : "ready"}
      data={q.data}
      onRetry={() => q.refetch()}
    />
  )
}

/** The page itself, by state: what a test or a preview renders without fetching. */
export function OverviewView({
  state,
  data,
  onRetry,
}: {
  state: "loading" | "error" | "ready"
  data?: OverviewData
  onRetry?: () => void
}) {
  const empty = !data || (!data.stats.length && !data.series.length && !data.rows.length)
  return (
    <section className="flex flex-col gap-4 md:gap-6" aria-busy={state === "loading" || undefined}>
      <h1 className="text-title font-semibold">Overview</h1>
      {state === "error" ? (
        <Card>
          <CardContent>
            <ErrorState message="The overview did not load." onRetry={onRetry} />
          </CardContent>
        </Card>
      ) : state === "loading" ? (
        <div role="status" aria-label="Loading overview" className="contents">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64" />
          <Skeleton className="h-56" />
        </div>
      ) : empty ? (
        <Card>
          <CardContent>
            <EmptyState
              title="Nothing here yet"
              description="Numbers show up here once there is activity."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <StatStrip items={data.stats} />
          <Card>
            <CardHeader>
              <CardTitle>This week</CardTitle>
            </CardHeader>
            <CardContent>
              <BarChart points={data.series} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        <Badge variant={r.tone ?? "default"}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-text-muted">{r.date}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  )
}

// ponytail: plain bars, no chart library. For axes, tooltips or many series,
// install recharts (an optional peer of signet-ui) and use its Chart component.
function BarChart({ points }: { points: OverviewData["series"] }) {
  const max = Math.max(1, ...points.map((p) => p.value))
  const summary = points.map((p) => `${p.label} ${p.value.toLocaleString()}`).join(", ")
  return (
    <div role="img" aria-label={`Bar chart: ${summary}`} className="flex h-48 items-end gap-2">
      {points.map((p) => (
        <div key={p.label} className="flex h-full flex-1 flex-col items-center gap-1">
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t-md bg-primary"
              style={{ height: `${(p.value / max) * 100}%` }}
              title={`${p.label}: ${p.value.toLocaleString()}`}
            />
          </div>
          <span className="text-xs text-text-muted">{p.label}</span>
        </div>
      ))}
    </div>
  )
}
