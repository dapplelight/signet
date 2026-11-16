"use client"

// Block: analytics dashboard. A header with a range picker, a row of stats, an
// area chart and a recent-activity table. Copy it in with
// `signet add block analytics-dashboard` and edit it: the data, the labels and
// the range list are props, every part has a data-slot, and the root takes
// className. recharts is an optional peer of signet-ui: install it to use this.
import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { Badge } from "../../components/ui/badge.js"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js"
import {
  CHART_COLORS,
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "../../components/ui/chart.js"
import { EmptyState } from "../../components/ui/empty-state.js"
import { ErrorState } from "../../components/ui/error-state.js"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js"
import { Skeleton } from "../../components/ui/skeleton.js"
import { StatStrip } from "../../components/ui/stat-strip.js"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js"
import { cn } from "../../lib/utils.js"
import type { DashboardData, DashboardPoint } from "./sample.js"

export { SAMPLE_DASHBOARD } from "./sample.js"
export type { DashboardData, DashboardPoint, DashboardRow } from "./sample.js"

export type BlockState = "ready" | "loading" | "error"

/** Every string the block shows. Spread it and override what you need. */
export const DEFAULT_DASHBOARD_LABELS = {
  title: "Overview",
  range: "Date range",
  chartTitle: "Visitors",
  chartSummary: (points: DashboardPoint[]) => {
    const first = points[0]
    const last = points[points.length - 1]
    if (!first || !last) return "Visitors chart, no data"
    const peak = points.reduce((a, b) => (b.value > a.value ? b : a))
    return `Visitors from ${first.label} to ${last.label}: started at ${first.value.toLocaleString()}, ended at ${last.value.toLocaleString()}, peaked at ${peak.value.toLocaleString()} on ${peak.label}.`
  },
  activityTitle: "Recent activity",
  name: "Name",
  status: "Status",
  date: "Date",
  emptyTitle: "No data yet",
  emptyDescription: "Activity will show here once people start using your app.",
  errorMessage: "We could not load your overview.",
  loading: "Loading overview",
}

export type DashboardLabels = typeof DEFAULT_DASHBOARD_LABELS

export const DEFAULT_DASHBOARD_RANGES = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
]

type Part = "header" | "stats" | "chart" | "activity"

export type AnalyticsDashboardProps = {
  data?: DashboardData
  /** "ready" shows `data` (or the empty state without any); "loading" shows skeletons. */
  state?: BlockState
  onRetry?: () => void
  /** Range picker options and the selected value. Uncontrolled when `range` is omitted. */
  ranges?: { value: string; label: string }[]
  range?: string
  onRangeChange?: (range: string) => void
  /** Extra header content, right of the range picker. */
  actions?: React.ReactNode
  labels?: Partial<DashboardLabels>
  /** className per part. */
  classNames?: Partial<Record<Part, string>>
  className?: string
}

const CHART: ChartConfig = { value: { label: "Visitors", color: CHART_COLORS[0] } }

export function AnalyticsDashboard({
  data,
  state = "ready",
  onRetry,
  ranges = DEFAULT_DASHBOARD_RANGES,
  range,
  onRangeChange,
  actions,
  labels: labelOverrides,
  classNames,
  className,
}: AnalyticsDashboardProps) {
  const l = { ...DEFAULT_DASHBOARD_LABELS, ...labelOverrides }
  const [own, setOwn] = React.useState(ranges[0]?.value ?? "")
  const selected = range ?? own
  const empty = !data || (!data.series.length && !data.rows.length && !data.stats.length)
  const loading = state === "loading"

  return (
    <section
      data-block="analytics-dashboard"
      data-state={state}
      aria-busy={loading || undefined}
      className={cn("mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:gap-6 md:p-6", className)}
    >
      <header
        data-slot="dashboard-header"
        className={cn("flex items-center justify-between gap-3", classNames?.header)}
      >
        <h1 className="min-w-0 truncate text-title font-semibold text-text-primary">{l.title}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <Select
            value={selected}
            onValueChange={(v) => {
              setOwn(v as string)
              onRangeChange?.(v as string)
            }}
          >
            <SelectTrigger aria-label={l.range} className="h-11 w-40 md:h-8">
              <SelectValue>
                {(v: string | null) => ranges.find((r) => r.value === v)?.label ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ranges.map((r) => (
                <SelectItem key={r.value} value={r.value} className="min-h-11 md:min-h-0">
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {state === "error" ? (
        <Card data-slot="dashboard-error">
          <CardContent>
            <ErrorState message={l.errorMessage} onRetry={onRetry} />
          </CardContent>
        </Card>
      ) : loading ? (
        <DashboardSkeleton label={l.loading} />
      ) : empty ? (
        <Card data-slot="dashboard-empty">
          <CardContent>
            <div className="[&>div]:min-h-0 [&>div]:py-16">
              <EmptyState title={l.emptyTitle} description={l.emptyDescription} />
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <StatStrip items={data.stats} className={classNames?.stats} />

          <Card data-slot="dashboard-chart" className={classNames?.chart}>
            <CardHeader>
              <CardTitle>{l.chartTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={CHART}
                role="img"
                aria-label={l.chartSummary(data.series)}
                className="aspect-auto h-45 w-full md:h-60"
              >
                <AreaChart data={data.series} margin={{ left: 8, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    dataKey="value"
                    type="monotone"
                    stroke="var(--color-value)"
                    fill="var(--color-value)"
                    fillOpacity={0.15}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card data-slot="dashboard-activity" className={classNames?.activity}>
            <CardHeader>
              <CardTitle>{l.activityTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{l.name}</TableHead>
                    <TableHead>{l.status}</TableHead>
                    <TableHead className="hidden md:table-cell">{l.date}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="w-full max-w-0 truncate font-medium" title={r.name}>
                        {r.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.tone ?? "default"}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-text-muted md:table-cell">
                        {r.date}
                      </TableCell>
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

/** Same shapes as the real content: four stats, the chart, five table rows. */
function DashboardSkeleton({ label }: { label: string }) {
  return (
    <div data-slot="dashboard-skeleton" role="status" aria-label={label} className="contents">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 md:h-24" />
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-45 w-full md:h-60" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
