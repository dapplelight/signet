"use client"

// AI cost for the admin: spend over time with what the cache saved, spend by
// model, the top spenders (subject hashes, as the server gives them), and how
// much of the global day and month caps is used. Data is what
// signet-server's `observabilityAdminRoutes` returns (`series`, `models`,
// `top`) plus the global caps from signet-db's `usage("global")`; hand it in as
// `data`, or give a `fetcher(days)` and the screen loads and retries itself.
// Money is millionths of a USD. recharts is an optional peer, so this screen
// has its own export path, `@dapplelight/signet-ui/screens/cost-dashboard`,
// never the barrel.
import * as React from "react"
import * as R from "recharts"
import { cn } from "../../lib/utils.js"
import { Alert } from "../ui/alert.js"
import { Button } from "../ui/button.js"
import {
  CHART_COLORS,
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "../ui/chart.js"
import { Progress, ProgressLabel, ProgressValue } from "../ui/progress.js"
import { Skeleton } from "../ui/skeleton.js"
import { StatStrip } from "../ui/stat-strip.js"

// ---------------------------------------------------------------- data model

/** One UTC day of `GET /cost/series`. */
export type CostSeriesRow = { day: string; units: number; calls: number; cacheSavedUnits: number }
/** One model of `GET /cost/by-model`. */
export type CostModelRow = {
  model: string
  units: number
  calls: number
  cacheSavedUnits?: number
}
/** One spender of `GET /cost/top`; `subject` is the hash the ledger stores. */
export type CostSubjectRow = { subject: string; units: number; calls?: number }
/** One period of signet-db's `usage("global")`: `cap` null is unlimited. */
export type CostCapUsage = { used: number; cap: number | null }

export type CostDashboardData = {
  series: readonly CostSeriesRow[]
  models: readonly CostModelRow[]
  top: readonly CostSubjectRow[]
  /** Without it the caps card is left out. */
  caps?: { day: CostCapUsage; month: CostCapUsage }
}

// -------------------------------------------------------------------- labels

const usd = new Intl.NumberFormat("en", { style: "currency", currency: "USD" })

export const DEFAULT_COST_LABELS = {
  title: "AI cost",
  days: "Range",
  dayOption: (n: number) => `Last ${n} days`,
  spend: "Spend",
  calls: (n: number) => `${n} calls`,
  cacheSaved: "Saved by cache",
  savedShare: (p: number) => `${p}% avoided`,
  topModel: "Top model",
  overTime: "Spend over time",
  byModel: "By model",
  topSubjects: "Top spenders",
  caps: "Caps",
  period: { day: "Today", month: "This month" },
  noCap: "No cap",
  empty: "No spend in this range",
  error: "Couldn't load costs.",
  retry: "Retry",
  loading: "Loading costs",
  none: "–",
  /** Millionths of a USD to text. */
  money: (units: number) => (units > 0 && units < 10_000 ? "<$0.01" : usd.format(units / 1e6)),
}

export type CostLabels = typeof DEFAULT_COST_LABELS

const DAY_OPTIONS = [7, 30, 90] as const

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring dark:bg-input/30"

const sum = <T,>(rows: readonly T[], pick: (r: T) => number) =>
  rows.reduce((t, r) => t + pick(r), 0)

const TONE = {
  ok: "",
  warn: "[&_[data-slot=progress-indicator]]:bg-accent-amber",
  over: "[&_[data-slot=progress-indicator]]:bg-accent-red",
}
/** Under 80% the primary colour, 80 to 99% amber, 100% and over red. */
const toneOf = (pct: number) => (pct >= 100 ? "over" : pct >= 80 ? "warn" : "ok")

// ---------------------------------------------------------------- the screen

export type CostDashboardProps = Omit<React.ComponentProps<"section">, "children"> & {
  /** What the endpoints returned. Ignored when `fetcher` is given. */
  data?: CostDashboardData | null
  /** Load (and reload on a new range or Retry) by calling this; the screen then owns data, loading and error. */
  fetcher?: (days: number) => Promise<CostDashboardData>
  /** Range in days (7, 30 or 90). Default: 30, kept in the screen unless you control it. */
  days?: number
  onDaysChange?: (days: number) => void
  loading?: boolean
  error?: boolean
  /** Retry button without a `fetcher`. */
  onRetry?: () => void
  labels?: Partial<CostLabels>
}

type Loaded = { data: CostDashboardData | null; loading: boolean; error: boolean }

export function CostDashboard({
  data: dataProp = null,
  fetcher,
  days: daysProp,
  onDaysChange,
  loading: loadingProp = false,
  error: errorProp = false,
  onRetry,
  labels: labelsProp,
  className,
  ...props
}: CostDashboardProps) {
  const labels = React.useMemo(() => ({ ...DEFAULT_COST_LABELS, ...labelsProp }), [labelsProp])
  const id = React.useId()
  const [ownDays, setOwnDays] = React.useState(30)
  const days = daysProp ?? ownDays
  const [loaded, setLoaded] = React.useState<Loaded>({ data: null, loading: true, error: false })
  const [attempt, setAttempt] = React.useState(0)
  const fetcherRef = React.useRef(fetcher)
  fetcherRef.current = fetcher
  const fetching = !!fetcher

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load for Retry and `fetching` for a fetcher that appears later; neither is read inside.
  React.useEffect(() => {
    const load = fetcherRef.current
    if (!load) return
    let live = true
    setLoaded((s) => ({ ...s, loading: true, error: false }))
    load(days).then(
      (data) => live && setLoaded({ data, loading: false, error: false }),
      () => live && setLoaded((s) => ({ ...s, loading: false, error: true })),
    )
    return () => {
      live = false
    }
  }, [days, attempt, fetching])

  const { data, loading, error } = fetching
    ? loaded
    : { data: dataProp, loading: loadingProp, error: errorProp }
  const retry = fetching ? () => setAttempt((n) => n + 1) : onRetry

  const money = labels.money
  const color = (i: number) => CHART_COLORS[i % CHART_COLORS.length] as string
  const models = React.useMemo(
    () => [...(data?.models ?? [])].sort((a, b) => b.units - a.units),
    [data],
  )
  const top = React.useMemo(() => [...(data?.top ?? [])].sort((a, b) => b.units - a.units), [data])
  const series = data?.series ?? []
  const spent = sum(series, (r) => r.units)
  const calls = sum(series, (r) => r.calls)
  const saved = sum(series, (r) => r.cacheSavedUnits)
  const avoided = spent + saved > 0 ? Math.round((saved / (spent + saved)) * 100) : 0
  const rows = series.map((r) => ({
    day: r.day.slice(5),
    spent: r.units,
    saved: r.cacheSavedUnits,
  }))
  const config: ChartConfig = {
    spent: { label: labels.spend, color: color(0) },
    saved: { label: labels.cacheSaved, color: color(2) },
  }

  const card = (title: string, slot: string, body: React.ReactNode) => (
    <figure
      data-slot={slot}
      aria-labelledby={`${id}${slot}`}
      className="flex min-w-0 flex-col gap-2 rounded-xl bg-bg-surface p-4 ring-1 ring-border-subtle"
    >
      <figcaption id={`${id}${slot}`} className="text-xs font-medium text-text-muted">
        {title}
      </figcaption>
      {body}
    </figure>
  )
  const empty = <p className="text-sm text-text-muted">{labels.empty}</p>

  /** A bar per row, each as wide as its share of the biggest; the amount is text. */
  const barList = (
    slot: string,
    attr: "data-model" | "data-subject",
    list: ReadonlyArray<{ key: string; units: number }>,
    mono: boolean,
  ) => {
    const max = Math.max(...list.map((r) => r.units), 0)
    return (
      <ul className="flex flex-col gap-2">
        {list.map((r) => (
          <li
            key={r.key}
            data-slot={slot}
            {...{ [attr]: r.key }}
            className="flex min-w-0 flex-col gap-1"
          >
            <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
              <span
                title={r.key}
                className={cn("min-w-0 truncate text-text-primary", mono && "font-mono")}
              >
                {r.key}
              </span>
              <span className="shrink-0 whitespace-nowrap font-mono text-text-secondary tabular-nums">
                {money(r.units)}
              </span>
            </div>
            <div aria-hidden className="h-1.5 w-full rounded-full bg-bg-elevated">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${max > 0 ? (r.units / max) * 100 : 0}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    )
  }

  const capRow = (period: "day" | "month", u: CostCapUsage) => {
    const pct = u.cap ? Math.round((u.used / u.cap) * 100) : 0
    return (
      <li key={period} data-slot="cost-cap" data-period={period}>
        {u.cap === null ? (
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-text-primary">{labels.period[period]}</span>
            <span className="text-text-muted">{labels.noCap}</span>
          </div>
        ) : (
          <Progress
            value={Math.min(100, pct)}
            className={cn(TONE[toneOf(pct)])}
            data-tone={toneOf(pct)}
          >
            <ProgressLabel className="text-text-primary">{labels.period[period]}</ProgressLabel>
            <ProgressValue>
              {() => `${pct}% · ${money(u.used)} / ${money(u.cap as number)}`}
            </ProgressValue>
          </Progress>
        )}
      </li>
    )
  }

  return (
    <section
      data-slot="cost-dashboard"
      aria-labelledby={`${id}t`}
      aria-busy={loading || undefined}
      className={cn("flex flex-col gap-4", className)}
      {...props}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id={`${id}t`} className="text-heading font-semibold text-text-primary">
          {labels.title}
        </h2>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {labels.days}
          <select
            data-filter="days"
            className={selectClass}
            value={days}
            onChange={(e) => {
              const n = Number(e.target.value)
              setOwnDays(n)
              onDaysChange?.(n)
            }}
          >
            {DAY_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {labels.dayOption(n)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div role="status" aria-label={labels.loading} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-64" />
            ))}
          </div>
        </div>
      ) : error ? (
        <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">
          <span>{labels.error}</span>
          {retry && (
            <Button type="button" size="sm" variant="outline" onClick={retry}>
              {labels.retry}
            </Button>
          )}
        </Alert>
      ) : data ? (
        <>
          <StatStrip
            items={[
              { label: labels.spend, value: money(spent), meta: labels.calls(calls) },
              {
                label: labels.cacheSaved,
                value: money(saved),
                meta: labels.savedShare(avoided),
                ...(saved > 0 ? { tone: "good" as const } : {}),
              },
              { label: labels.topModel, value: models[0]?.model ?? labels.none },
            ]}
          />
          <div className="grid gap-3 lg:grid-cols-2">
            {card(
              labels.overTime,
              "chart-spend",
              rows.length ? (
                <ChartContainer config={config} className="aspect-auto h-56 w-full">
                  <R.ComposedChart data={rows} margin={{ left: 4, right: 4 }}>
                    <R.CartesianGrid vertical={false} />
                    <R.XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} />
                    <R.YAxis
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickFormatter={(v: number) => money(v)}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(v, name) => (
                            <span className="flex w-full justify-between gap-3">
                              <span>{config[String(name)]?.label}</span>
                              <span className="font-mono tabular-nums">{money(Number(v))}</span>
                            </span>
                          )}
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <R.Bar dataKey="spent" fill="var(--color-spent)" />
                    <R.Line
                      dataKey="saved"
                      type="monotone"
                      stroke="var(--color-saved)"
                      dot={false}
                    />
                  </R.ComposedChart>
                </ChartContainer>
              ) : (
                empty
              ),
            )}
            {card(
              labels.byModel,
              "cost-models",
              models.length
                ? barList(
                    "cost-model",
                    "data-model",
                    models.map((m) => ({ key: m.model, units: m.units })),
                    false,
                  )
                : empty,
            )}
            {card(
              labels.topSubjects,
              "cost-top",
              top.length
                ? barList(
                    "cost-subject",
                    "data-subject",
                    top.map((s) => ({ key: s.subject, units: s.units })),
                    true,
                  )
                : empty,
            )}
            {data.caps &&
              card(
                labels.caps,
                "cost-caps",
                <ul className="flex flex-col gap-4">
                  {capRow("day", data.caps.day)}
                  {capRow("month", data.caps.month)}
                </ul>,
              )}
          </div>
        </>
      ) : null}
    </section>
  )
}
