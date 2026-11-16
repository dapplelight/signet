"use client"

// Subscription charts for the admin: MRR per currency (and a converted total
// when the server has rates), active subscribers and trials, new versus renewal
// revenue and refunds, churn and trial conversions, and paywall impressions
// against conversions, with filters by store, plan, country and offering,
// saved audiences and CSV export. Data is signet-db's `charts.metrics(...)`
// result (or the JSON of `GET /charts`); filter changes go out as a callback.
// recharts is an optional peer, so this screen has its own export path,
// `@dapplelight/signet-ui/screens/subscription-charts`, never the barrel.
import { Download } from "lucide-react"
import * as React from "react"
import * as R from "recharts"
import { cn } from "../../lib/utils.js"
import { Button, buttonVariants } from "../ui/button.js"
import {
  CHART_COLORS,
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "../ui/chart.js"
import { StatStrip } from "../ui/stat-strip.js"
import { formatMoney } from "./billing-screens.js"

// ---------------------------------------------------------------- data model

type PerCurrency = Readonly<Record<string, number>>

/** signet-db `ChartDay`. */
export type ChartDayView = {
  day: string
  activeSubscribers: number
  activeTrials: number
  mrr: PerCurrency
  mrrTotal: number | null
  newRevenue: PerCurrency
  renewalRevenue: PerCurrency
  refunds: PerCurrency
  refundCount: number
  newSubscriptions: number
  trialsStarted: number
  trialConversions: number
  churned: number
  impressions: number
  conversions: number
}

/** signet-db `ChartResult`, or its JSON from `GET /charts`. */
export type ChartResultView = {
  from: string
  to: string
  currencies: readonly string[]
  base: string | null
  approximate: boolean
  days: readonly ChartDayView[]
  summary: {
    mrr: PerCurrency
    mrrTotal: number | null
    activeSubscribers: number
    activeTrials: number
    newRevenue: PerCurrency
    renewalRevenue: PerCurrency
    refunds: PerCurrency
    refundCount: number
    trialConversion: number | null
    churnRate: number | null
    impressions: number
    conversions: number
    paywallConversion: number | null
  }
}

/** The query: dates, filters and an optional saved audience. */
export type ChartFilterView = {
  from: string
  to: string
  store?: string
  plan?: string
  country?: string
  offering?: string
  audience?: string
}

export type ChartAudienceView = {
  id: string
  name: string
  filter: Pick<ChartFilterView, "store" | "plan" | "country" | "offering">
}

// -------------------------------------------------------------------- labels

export const DEFAULT_CHART_LABELS = {
  title: "Subscriptions",
  from: "From",
  to: "To",
  all: "All",
  store: "Store",
  plan: "Plan",
  country: "Country",
  offering: "Offering",
  audience: "Audience",
  noAudience: "No audience",
  saveAudience: "Save as audience",
  audienceName: "Audience name",
  save: "Save",
  export: "Export CSV",
  mrr: "MRR",
  mrrTotal: (base: string) => `MRR total (${base})`,
  activeSubscribers: "Active subscribers",
  activeTrials: "Active trials",
  trialConversion: "Trial conversion",
  churnRate: "Churn",
  paywallConversion: "Paywall conversion",
  newRevenue: "New",
  renewalRevenue: "Renewals",
  refunds: "Refunds",
  revenue: (currency: string) => `Revenue (${currency})`,
  subscribers: "Subscribers and trials",
  churned: "Churned",
  trialConversions: "Trial conversions",
  churnAndConversions: "Churn and trial conversions",
  impressions: "Paywall views",
  conversions: "Started from a paywall",
  paywall: "Paywall conversion",
  approximate: "Includes App Store prices, not settled revenue",
  empty: "No data for this range",
  none: "–",
}

export type ChartLabels = typeof DEFAULT_CHART_LABELS

const percent = (v: number | null, none: string) =>
  v === null ? none : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`
const moneyList = (m: PerCurrency, none: string) =>
  Object.keys(m).length
    ? Object.entries(m)
        .map(([c, v]) => formatMoney(v, c))
        .join(" · ")
    : none
const digits = (currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2
const major = (v: number | undefined, currency: string) => (v ?? 0) / 10 ** digits(currency)

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring dark:bg-input/30"

// ---------------------------------------------------------------- the screen

export type SubscriptionChartsProps = Omit<React.ComponentProps<"section">, "children"> & {
  data: ChartResultView | null
  filter: ChartFilterView
  onFilterChange: (filter: ChartFilterView) => void
  /** Values offered in each filter's select. */
  options?: {
    stores?: readonly string[]
    plans?: readonly string[]
    countries?: readonly string[]
    offerings?: readonly string[]
  }
  audiences?: readonly ChartAudienceView[]
  /** POST `/audiences` with the current filters. */
  onSaveAudience?: (name: string, filter: ChartAudienceView["filter"]) => unknown
  /** A link to `GET /charts/csv` with the current query. */
  csvHref?: string
  /** The currency the revenue chart shows. Default: the first one in the data. */
  currency?: string
  labels?: Partial<ChartLabels>
}

const FILTERS = [
  ["store", "stores"],
  ["plan", "plans"],
  ["country", "countries"],
  ["offering", "offerings"],
] as const

export function SubscriptionCharts({
  data,
  filter,
  onFilterChange,
  options = {},
  audiences = [],
  onSaveAudience,
  csvHref,
  currency: currencyProp,
  labels: labelsProp,
  className,
  ...props
}: SubscriptionChartsProps) {
  const labels = React.useMemo(() => ({ ...DEFAULT_CHART_LABELS, ...labelsProp }), [labelsProp])
  const id = React.useId()
  const [naming, setNaming] = React.useState(false)
  const [name, setName] = React.useState("")
  const set = (patch: Partial<ChartFilterView>) => onFilterChange({ ...filter, ...patch })
  const currencies = data?.currencies ?? []
  const currency = currencyProp ?? currencies[0]
  const base = data?.base ?? null

  const rows = React.useMemo(
    () =>
      (data?.days ?? []).map((d) => {
        const row: Record<string, number | string> = {
          day: d.day.slice(5),
          activeSubscribers: d.activeSubscribers,
          activeTrials: d.activeTrials,
          churned: d.churned,
          trialConversions: d.trialConversions,
          impressions: d.impressions,
          conversions: d.conversions,
        }
        for (const c of currencies) row[`mrr_${c}`] = major(d.mrr[c], c)
        if (base && d.mrrTotal !== null) row.mrrTotal = major(d.mrrTotal, base)
        if (currency) {
          row.newRevenue = major(d.newRevenue[currency], currency)
          row.renewalRevenue = major(d.renewalRevenue[currency], currency)
          row.refunds = major(d.refunds[currency], currency)
        }
        return row
      }),
    [data, currencies, currency, base],
  )
  const color = (i: number) => CHART_COLORS[i % CHART_COLORS.length] as string
  const mrrConfig: ChartConfig = Object.fromEntries([
    ...currencies.map((c, i) => [`mrr_${c}`, { label: `${labels.mrr} ${c}`, color: color(i) }]),
    ...(base
      ? [["mrrTotal", { label: labels.mrrTotal(base), color: color(currencies.length) }]]
      : []),
  ])
  const subsConfig: ChartConfig = {
    activeSubscribers: { label: labels.activeSubscribers, color: color(0) },
    activeTrials: { label: labels.activeTrials, color: color(1) },
  }
  const revenueConfig: ChartConfig = {
    newRevenue: { label: labels.newRevenue, color: color(0) },
    renewalRevenue: { label: labels.renewalRevenue, color: color(2) },
    refunds: { label: labels.refunds, color: color(4) },
  }
  const churnConfig: ChartConfig = {
    churned: { label: labels.churned, color: color(4) },
    trialConversions: { label: labels.trialConversions, color: color(2) },
  }
  const paywallConfig: ChartConfig = {
    impressions: { label: labels.impressions, color: color(5) },
    conversions: { label: labels.conversions, color: color(0) },
  }
  const s = data?.summary
  const lineChart = (config: ChartConfig) => (
    <R.LineChart data={rows} margin={{ left: 4, right: 4 }}>
      <R.CartesianGrid vertical={false} />
      <R.XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} />
      <R.YAxis tickLine={false} axisLine={false} width={48} />
      <ChartTooltip content={<ChartTooltipContent />} />
      <ChartLegend content={<ChartLegendContent />} />
      {Object.keys(config).map((k) => (
        <R.Line key={k} dataKey={k} type="monotone" stroke={`var(--color-${k})`} dot={false} />
      ))}
    </R.LineChart>
  )
  const barChart = (config: ChartConfig, stack?: string) => (
    <R.BarChart data={rows} margin={{ left: 4, right: 4 }}>
      <R.CartesianGrid vertical={false} />
      <R.XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} />
      <R.YAxis tickLine={false} axisLine={false} width={48} />
      <ChartTooltip content={<ChartTooltipContent />} />
      <ChartLegend content={<ChartLegendContent />} />
      {Object.keys(config).map((k) => (
        <R.Bar
          key={k}
          dataKey={k}
          fill={`var(--color-${k})`}
          {...(stack && k !== "refunds" ? { stackId: stack } : {})}
        />
      ))}
    </R.BarChart>
  )
  const card = (title: string, slot: string, config: ChartConfig, chart: React.ReactElement) => (
    <figure
      data-slot={slot}
      className="flex min-w-0 flex-col gap-2 rounded-xl bg-bg-surface p-4 ring-1 ring-border-subtle"
    >
      <figcaption className="text-xs font-medium text-text-muted">{title}</figcaption>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        {chart}
      </ChartContainer>
    </figure>
  )

  return (
    <section
      data-slot="subscription-charts"
      aria-labelledby={`${id}t`}
      className={cn("flex flex-col gap-4", className)}
      {...props}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id={`${id}t`} className="text-heading font-semibold text-text-primary">
          {labels.title}
        </h2>
        {csvHref && (
          <a
            data-slot="charts-export"
            href={csvHref}
            download
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Download aria-hidden />
            {labels.export}
          </a>
        )}
      </div>

      <div data-slot="charts-filters" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {labels.from}
          <input
            type="date"
            className={selectClass}
            value={filter.from}
            max={filter.to}
            onChange={(e) => e.target.value && set({ from: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {labels.to}
          <input
            type="date"
            className={selectClass}
            value={filter.to}
            min={filter.from}
            onChange={(e) => e.target.value && set({ to: e.target.value })}
          />
        </label>
        {FILTERS.map(([key, list]) =>
          options[list]?.length ? (
            <label key={key} className="flex flex-col gap-1 text-xs text-text-muted">
              {labels[key]}
              <select
                data-filter={key}
                className={selectClass}
                value={filter[key] ?? ""}
                onChange={(e) => set({ [key]: e.target.value || undefined })}
              >
                <option value="">{labels.all}</option>
                {options[list]?.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          ) : null,
        )}
        {audiences.length > 0 && (
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            {labels.audience}
            <select
              data-filter="audience"
              className={selectClass}
              value={filter.audience ?? ""}
              onChange={(e) => set({ audience: e.target.value || undefined })}
            >
              <option value="">{labels.noAudience}</option>
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {onSaveAudience &&
          (naming ? (
            <form
              data-slot="save-audience"
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!name.trim()) return
                const { from: _f, to: _t, audience: _a, ...rest } = filter
                onSaveAudience(name.trim(), rest)
                setName("")
                setNaming(false)
              }}
            >
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                {labels.audienceName}
                <input
                  className={selectClass}
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <Button type="submit" size="sm">
                {labels.save}
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!FILTERS.some(([k]) => filter[k])}
              onClick={() => setNaming(true)}
            >
              {labels.saveAudience}
            </Button>
          ))}
      </div>

      {!s || !data?.days.length ? (
        <p className="text-sm text-text-muted">{labels.empty}</p>
      ) : (
        <>
          <StatStrip
            items={[
              {
                label: labels.mrr,
                value: moneyList(s.mrr, labels.none),
                ...(base && s.mrrTotal !== null
                  ? { meta: `${labels.mrrTotal(base)}: ${formatMoney(s.mrrTotal, base)}` }
                  : {}),
              },
              {
                label: labels.activeSubscribers,
                value: String(s.activeSubscribers),
                meta: `${labels.activeTrials}: ${s.activeTrials}`,
              },
              {
                label: labels.trialConversion,
                value: percent(s.trialConversion, labels.none),
                meta: `${labels.churnRate}: ${percent(s.churnRate, labels.none)}`,
              },
              {
                label: labels.paywallConversion,
                value: percent(s.paywallConversion, labels.none),
                meta: `${s.conversions} / ${s.impressions}`,
              },
            ]}
          />
          {data.approximate && <p className="text-xs text-text-muted">≈ {labels.approximate}</p>}
          <div className="grid gap-3 lg:grid-cols-2">
            {currencies.length > 0 &&
              card(labels.mrr, "chart-mrr", mrrConfig, lineChart(mrrConfig))}
            {card(labels.subscribers, "chart-subscribers", subsConfig, lineChart(subsConfig))}
            {currency &&
              card(
                labels.revenue(currency),
                "chart-revenue",
                revenueConfig,
                barChart(revenueConfig, "revenue"),
              )}
            {card(labels.churnAndConversions, "chart-churn", churnConfig, barChart(churnConfig))}
            {card(labels.paywall, "chart-paywall", paywallConfig, barChart(paywallConfig))}
          </div>
        </>
      )}
    </section>
  )
}
