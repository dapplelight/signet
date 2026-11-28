"use client"

// shadcn/ui `chart` (registry: styles/base-nova/chart), on recharts 3 as that
// registry item is: tooltip props typed from recharts' DefaultTooltipContentProps,
// legend props from DefaultLegendContentProps, and a ResponsiveContainer
// `initialDimension` so the first render before measuring has a size. Bars keep
// recharts 2's whole-pixel widths (see `withWholePixelBars`).
//
// Carried over from app-a. recharts is an optional peer (>=3.8 <4), so this
// file is reachable only as `@dapplelight/signet-ui/components/chart`, never from
// the barrel: an app that does not chart should not have to install it.
import * as React from "react"
import * as RechartsPrimitive from "recharts"
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent"
import { DESKTOP_QUERY, useMediaQuery } from "../../hooks/use-media-query.js"
import { cn } from "../../lib/utils.js"
import { Card, CardContent, CardHeader, CardTitle } from "./card.js"
import { EmptyState } from "./empty-state.js"
import { ErrorState } from "./error-state.js"
import { Skeleton } from "./skeleton.js"

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
>

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }

  return context
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"]
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-text-muted [&_.recharts-cartesian-axis-tick-value]:fill-text-muted [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border-subtle [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border-default [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border-default [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border-default [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={{ width: 320, height: 200 }}>
          {withWholePixelBars(children)}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

/** recharts' getPercentValue: "10%" of `total`, or a number of pixels; capped at `total`. */
function percentOf(value: number | string | undefined, total: number): number {
  const n =
    typeof value === "string" && value.endsWith("%")
      ? (Number.parseFloat(value) / 100) * total
      : Number(value)
  return Number.isFinite(n) ? Math.min(n, total) : 0
}

type WholePixelBarProps = RechartsPrimitive.RectangleProps & {
  seriesIndex: number
  seriesCount: number
  barGap: number | string
  barCategoryGap: number | string
  vertical: boolean
  /** The category axis's `dataKey`, to find this bar's band. */
  categoryKey: string
  xAxisId?: string | number
  yAxisId?: string | number
}

/**
 * A bar drawn as recharts 2 drew it. recharts 3 rounds the computed bar width
 * (Math.round) where recharts 2 floored it, so bars came out up to 1px wider
 * and each later series 1px further along. This recomputes the unrounded width
 * from the band and, when rounding went up, floors it and moves the bar back.
 */
function WholePixelBar({
  seriesIndex,
  seriesCount,
  barGap,
  barCategoryGap,
  vertical,
  categoryKey,
  xAxisId,
  yAxisId,
  ...props
}: WholePixelBarProps) {
  const xScale = RechartsPrimitive.useXAxisScale(xAxisId)
  const yScale = RechartsPrimitive.useYAxisScale(yAxisId)
  const scale = vertical ? yScale : xScale
  const category = (props as { payload?: Record<string, unknown> }).payload?.[categoryKey]
  const start = scale?.(category, { position: "start" })
  const end = scale?.(category, { position: "end" })
  let { x = 0, y = 0, width = 0, height = 0 } = props
  if (start != null && end != null) {
    const band = Math.abs(end - start)
    const categoryGap = percentOf(barCategoryGap, band)
    let gap = percentOf(barGap, band)
    if (band - 2 * categoryGap - (seriesCount - 1) * gap <= 0) gap = 0
    const size = (band - 2 * categoryGap - (seriesCount - 1) * gap) / seriesCount
    const extra = size > 1 ? Math.round(size) - Math.floor(size) : 0
    if (extra) {
      if (vertical) {
        y -= extra * seriesIndex
        height = Math.floor(size)
      } else {
        x -= extra * seriesIndex
        width = Math.floor(size)
      }
    }
  }
  // recharts skips empty bars itself unless a shape is given; keep skipping them.
  if (!width || !height) return null
  const {
    radius = 0,
    className,
    fill,
    fillOpacity,
    stroke,
    strokeWidth,
    strokeOpacity,
    opacity,
    style,
  } = props
  return (
    <path
      className={cn("recharts-rectangle", className)}
      d={rectanglePath(x, y, width, height, radius)}
      {...{ fill, fillOpacity, stroke, strokeWidth, strokeOpacity, opacity, style }}
    />
  )
}

/**
 * recharts 2's rectangle outline. recharts 3's Rectangle rounds every
 * coordinate to 4 decimals, which shifts the anti-aliasing of rounded corners
 * by a shade; full precision keeps them as they were.
 */
function rectanglePath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number | [number, number, number, number],
): string {
  const max = Math.min(Math.abs(w) / 2, Math.abs(h) / 2)
  const ys = h >= 0 ? 1 : -1
  const xs = w >= 0 ? 1 : -1
  const cw = (h >= 0 && w >= 0) || (h < 0 && w < 0) ? 1 : 0
  if (max > 0 && Array.isArray(radius)) {
    const r = radius.map((v) => Math.min(v ?? 0, max))
    const [r0 = 0, r1 = 0, r2 = 0, r3 = 0] = r
    let d = `M${x},${y + ys * r0}`
    if (r0 > 0) d += `A ${r0},${r0},0,0,${cw},${x + xs * r0},${y}`
    d += `L ${x + w - xs * r1},${y}`
    if (r1 > 0) d += `A ${r1},${r1},0,0,${cw},\n        ${x + w},${y + ys * r1}`
    d += `L ${x + w},${y + h - ys * r2}`
    if (r2 > 0) d += `A ${r2},${r2},0,0,${cw},\n        ${x + w - xs * r2},${y + h}`
    d += `L ${x + xs * r3},${y + h}`
    if (r3 > 0) d += `A ${r3},${r3},0,0,${cw},\n        ${x},${y + h - ys * r3}`
    return `${d}Z`
  }
  if (max > 0 && typeof radius === "number" && radius > 0) {
    const r = Math.min(max, radius)
    return `M ${x},${y + ys * r} A ${r},${r},0,0,${cw},${x + xs * r},${y} L ${x + w - xs * r},${y} A ${r},${r},0,0,${cw},${x + w},${y + ys * r} L ${x + w},${y + h - ys * r} A ${r},${r},0,0,${cw},${x + w - xs * r},${y + h} L ${x + xs * r},${y + h} A ${r},${r},0,0,${cw},${x},${y + h - ys * r} Z`
  }
  return `M ${x},${y} h ${w} v ${h} h ${-w} Z`
}

type ChartElementProps = {
  children?: React.ReactNode
  barGap?: number | string
  barCategoryGap?: number | string
  barSize?: number | string
  maxBarSize?: number
  layout?: string
}
type AxisElementProps = { dataKey?: unknown; xAxisId?: string | number; yAxisId?: string | number }
type BarElementProps = {
  shape?: unknown
  hide?: boolean
  stackId?: string | number
  barSize?: number | string
  maxBarSize?: number
  xAxisId?: string | number
  yAxisId?: string | number
}

const isBar = (node: React.ReactNode): node is React.ReactElement<BarElementProps> =>
  React.isValidElement(node) && node.type === RechartsPrimitive.Bar

/**
 * Gives each plain `<Bar>` directly inside the chart the WholePixelBar shape,
 * so charts look exactly as they did on recharts 2. Charts with an explicit
 * `barSize` / `maxBarSize`, and bars with their own `shape`, are left alone.
 */
function withWholePixelBars<T extends React.ReactNode>(chart: T): T {
  if (!React.isValidElement<ChartElementProps>(chart)) return chart
  const { children, barGap = 4, barCategoryGap = "10%", layout } = chart.props
  const nodes = React.Children.toArray(children)
  const bars = nodes.filter(isBar)
  const vertical = layout === "vertical"
  const CategoryAxis = vertical ? RechartsPrimitive.YAxis : RechartsPrimitive.XAxis
  const axes = nodes.filter(
    (n): n is React.ReactElement<AxisElementProps> =>
      React.isValidElement(n) && n.type === CategoryAxis,
  )
  // The band is found from the category's value, so the axis needs a string dataKey.
  const categoryKey = (b: React.ReactElement<BarElementProps>) => {
    const id = vertical ? b.props.yAxisId : b.props.xAxisId
    const axis = axes.find((a) => (vertical ? a.props.yAxisId : a.props.xAxisId) === id) ?? axes[0]
    return typeof axis?.props.dataKey === "string" ? axis.props.dataKey : undefined
  }
  const sized = (p: ChartElementProps | BarElementProps) =>
    p.barSize != null || p.maxBarSize != null
  if (!bars.length || sized(chart.props) || bars.some((b) => sized(b.props))) return chart
  // Stacked bars share one slot per stackId, as in recharts' own size list.
  const slot = (b: React.ReactElement<BarElementProps>) =>
    b.props.stackId != null ? `stack:${b.props.stackId}` : `bar:${bars.indexOf(b)}`
  const slots = [...new Set(bars.filter((b) => !b.props.hide).map(slot))]
  return React.cloneElement(
    chart,
    undefined,
    nodes.map((child) => {
      if (!isBar(child) || child.props.shape != null || child.props.hide) return child
      const key = categoryKey(child)
      if (key === undefined) return child
      const seriesIndex = slots.indexOf(slot(child))
      return React.cloneElement(child, {
        shape: (props: RechartsPrimitive.RectangleProps) => (
          <WholePixelBar
            {...props}
            seriesIndex={seriesIndex}
            seriesCount={slots.length}
            barGap={barGap}
            barCategoryGap={barCategoryGap}
            vertical={vertical}
            categoryKey={key}
            xAxisId={child.props.xAxisId}
            yAxisId={child.props.yAxisId}
          />
        ),
      })
    }),
  ) as T
}

/**
 * The default series palette: a theme's optional `--chart-1` … `--chart-6`,
 * each falling back to a CONTRACT token, so a chart is coloured under any theme.
 * A config entry with neither `color` nor `theme` takes the entry at its
 * position, wrapping after six.
 */
const CHART_COLORS = [
  "var(--chart-1, var(--color-primary))",
  "var(--chart-2, var(--color-accent-blue))",
  "var(--chart-3, var(--color-accent-green))",
  "var(--chart-4, var(--color-accent-amber))",
  "var(--chart-5, var(--color-accent-red))",
  "var(--chart-6, var(--color-text-muted))",
] as const

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const entries = Object.entries(config)

  if (!entries.length) {
    return null
  }

  return (
    <style
      // CSS vars built from the static ChartConfig, not from user input.
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${entries
  .map(([key, itemConfig], index) => {
    const color =
      itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ??
      itemConfig.color ??
      CHART_COLORS[index % CHART_COLORS.length]
    return `  --color-${key}: ${color};`
  })
  .join("\n")}
}
`,
          )
          .join("\n"),
      }}
    />
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
  React.ComponentProps<"div"> & {
    hideLabel?: boolean
    hideIndicator?: boolean
    indicator?: "line" | "dot" | "dashed"
    nameKey?: string
    labelKey?: string
  } & Omit<
    RechartsPrimitive.DefaultTooltipContentProps<ValueType, NameType>,
    "accessibilityLayer"
  >) {
  const { config } = useChart()

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) {
      return null
    }

    const [item] = payload
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? "value"}`
    const itemConfig = getPayloadConfigFromPayload(config, item, key)
    const value =
      !labelKey && typeof label === "string" ? (config[label]?.label ?? label) : itemConfig?.label

    if (labelFormatter) {
      return (
        <div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>
      )
    }

    if (!value) {
      return null
    }

    return <div className={cn("font-medium", labelClassName)}>{value}</div>
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey])

  if (!active || !payload?.length) {
    return null
  }

  const nestLabel = payload.length === 1 && indicator !== "dot"

  return (
    <div
      data-slot="chart-tooltip"
      className={cn(
        "grid min-w-32 items-start gap-1.5 rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5 text-xs text-text-primary shadow-xl",
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== "none")
          .map((item, index) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? "value"}`
            const itemConfig = getPayloadConfigFromPayload(config, item, key)
            const indicatorColor = color ?? item.payload?.fill ?? item.color

            return (
              <div
                key={index}
                className={cn(
                  "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-text-muted",
                  indicator === "dot" && "items-center",
                )}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn(
                            "shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
                            {
                              "h-2.5 w-2.5": indicator === "dot",
                              "w-1": indicator === "line",
                              "w-0 border-[1.5px] border-dashed bg-transparent":
                                indicator === "dashed",
                              "my-0.5": nestLabel && indicator === "dashed",
                            },
                          )}
                          style={
                            {
                              "--color-bg": indicatorColor,
                              "--color-border": indicatorColor,
                            } as React.CSSProperties
                          }
                        />
                      )
                    )}
                    <div
                      className={cn(
                        "flex flex-1 justify-between leading-none",
                        nestLabel ? "items-end" : "items-center",
                      )}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-text-muted">{itemConfig?.label ?? item.name}</span>
                      </div>
                      {item.value != null && (
                        <span className="font-mono font-medium text-text-primary tabular-nums">
                          {typeof item.value === "number"
                            ? item.value.toLocaleString()
                            : String(item.value)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

const ChartLegend = RechartsPrimitive.Legend

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
}: React.ComponentProps<"div"> & {
  hideIcon?: boolean
  nameKey?: string
} & Pick<RechartsPrimitive.DefaultLegendContentProps, "payload" | "verticalAlign">) {
  const { config } = useChart()

  if (!payload?.length) {
    return null
  }

  return (
    <div
      data-slot="chart-legend"
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className,
      )}
    >
      {payload
        .filter((item) => item.type !== "none")
        .map((item, index) => {
          const key = `${nameKey ?? item.dataKey ?? "value"}`
          const itemConfig = getPayloadConfigFromPayload(config, item, key)

          return (
            <div
              key={index}
              className={cn(
                "flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-text-muted",
              )}
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: item.color,
                  }}
                />
              )}
              {itemConfig?.label}
            </div>
          )
        })}
    </div>
  )
}

function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== "object" || payload === null) {
    return undefined
  }

  const payloadPayload =
    "payload" in payload && typeof payload.payload === "object" && payload.payload !== null
      ? payload.payload
      : undefined

  let configLabelKey: string = key

  if (key in payload && typeof payload[key as keyof typeof payload] === "string") {
    configLabelKey = payload[key as keyof typeof payload] as string
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string
  }

  return configLabelKey in config ? config[configLabelKey] : config[key]
}

// ---------------------------------------------------------------------------
// PaceChart: usage against an even pace and a limit. Built on ChartContainer.

export type PacePart = "pace" | "used" | "projected" | "now" | "limit"

/** One period (a day, a week). `used` is the running total at it; leave it out after Now. */
export type PacePoint = {
  /** On the axis. Keep it short ("Thu"). */
  label: string
  /** What a screen reader says ("Thursday"). Default: `label`. */
  name?: string
  used?: number | null
}

export type PaceModel = {
  /** Index of Now in the data, or -1 when nothing has been used yet. */
  nowIndex: number
  used: number
  /** x of the limit point: where the projection crosses the limit, else the last period. */
  limitX: number
  /** The projection runs from Now to here, or is null (no limit, over it, or no use yet). */
  projection: { endX: number; endValue: number; reachesLimit: boolean } | null
  /** One row per period, plus one at the projection end when it falls between two periods. */
  rows: { x: number; used: number | null; pace: number | null; projected: number | null }[]
}

/**
 * The numbers behind a PaceChart. Use is assumed to continue at its average
 * rate so far; even pace is `limit / periods` per period.
 */
export function paceModel(data: PacePoint[], limit: number | undefined, now?: string): PaceModel {
  const last = data.length - 1
  let nowIndex = now === undefined ? -1 : data.findIndex((d) => d.label === now)
  if (nowIndex < 0 && now === undefined) {
    nowIndex = data.reduce((at, d, i) => (d.used != null ? i : at), -1)
  }
  const used = data[nowIndex]?.used ?? 0
  const rate = nowIndex >= 0 ? used / (nowIndex + 1) : 0
  let projection: PaceModel["projection"] = null
  let limitX = last
  if (limit !== undefined && nowIndex >= 0 && nowIndex < last && rate > 0 && used < limit) {
    const hit = nowIndex + (limit - used) / rate
    const reachesLimit = hit <= last
    const endX = reachesLimit ? hit : last
    projection = {
      endX,
      endValue: reachesLimit ? limit : used + rate * (last - nowIndex),
      reachesLimit,
    }
    if (reachesLimit) limitX = hit
  }
  const rows: PaceModel["rows"] = data.map((d, x) => ({
    x,
    used: d.used ?? null,
    pace: limit === undefined ? null : (limit * (x + 1)) / data.length,
    projected: projection && x === nowIndex ? used : null,
  }))
  if (projection) {
    const end = rows.find((r) => r.x === projection?.endX)
    if (end) end.projected = projection.endValue
    else rows.push({ x: projection.endX, used: null, pace: null, projected: projection.endValue })
  }
  rows.sort((a, b) => a.x - b.x)
  return { nowIndex, used, limitX, projection, rows }
}

export type PaceLabels = {
  [P in PacePart]: string
} & {
  /** State texts. */
  emptyTitle: string
  emptyDescription: string
  errorMessage: string
  loading: string
}

export const DEFAULT_PACE_LABELS: PaceLabels = {
  pace: "On pace",
  used: "Used",
  projected: "Projected",
  now: "Now",
  limit: "limit",
  emptyTitle: "No usage yet",
  emptyDescription: "Usage appears here once it starts.",
  errorMessage: "Couldn't load usage",
  loading: "Loading usage",
}

const PACE_COLORS: Record<PacePart, string> = {
  pace: "var(--color-text-muted)",
  used: CHART_COLORS[0],
  projected: "var(--color-accent-amber)",
  now: "var(--color-border-strong)",
  limit: "var(--color-accent-amber)",
}

const PACE_PARTS = ["pace", "used", "projected", "now", "limit"] as const

/** SVG text cannot ellipsize, so cut by length; the full text is in the description. */
const clip = (text: string, max = 24) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export type PaceChartProps = {
  /** One point per period, in order: `[{ label: "Mon", used: 90 }, ...]`. */
  data?: PacePoint[]
  /** The cap. Without it there is no pace line, projection or limit point. */
  limit?: number
  /** Label of the period that is Now. Default: the last period with a `used` value. */
  now?: string
  title?: React.ReactNode
  /** Right of the title (below it on phones): a Day / Week / Month selector, say. Any node. */
  slot?: React.ReactNode
  yAxisTitle?: string
  /** Formats numbers on the axis, the limit label and the descriptions. */
  format?: (n: number) => string
  state?: "ready" | "loading" | "error"
  onRetry?: () => void
  /** Label per part, plus the state texts. English defaults. */
  labels?: Partial<PaceLabels>
  /** A CSS colour per part. Defaults are theme tokens. */
  colors?: Partial<Record<PacePart, string>>
  /** Hide a part. The pace line, projection and limit point also hide without a `limit`. */
  hide?: Partial<Record<PacePart, boolean>>
  /** Replace the screen-reader sentence of a part. */
  descriptions?: Partial<Record<PacePart, string>>
  /** className per part (on the line or dot itself), the header and the chart area. */
  classNames?: Partial<Record<PacePart | "header" | "chart", string>>
  className?: string
}

export function PaceChart({
  data = [],
  limit,
  now,
  title,
  slot,
  yAxisTitle,
  format = (n) => n.toLocaleString(),
  state = "ready",
  onRetry,
  labels: labelOverrides,
  colors,
  hide,
  descriptions,
  classNames,
  className,
}: PaceChartProps) {
  const l = { ...DEFAULT_PACE_LABELS, ...labelOverrides }
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const model = React.useMemo(() => paceModel(data, limit, now), [data, limit, now])
  const { nowIndex, projection, limitX, rows } = model
  const last = data.length - 1
  const hasLimit = limit !== undefined
  const shown = {
    pace: hasLimit && !hide?.pace,
    used: nowIndex >= 0 && !hide?.used,
    projected: !!projection && !hide?.projected,
    now: nowIndex >= 0 && !hide?.now,
    limit: hasLimit && !hide?.limit,
  }
  const config: ChartConfig = Object.fromEntries(
    PACE_PARTS.map((p) => [p, { label: l[p], color: colors?.[p] ?? PACE_COLORS[p] }]),
  )
  const chartClass = cn("aspect-auto h-45 w-full md:h-60", classNames?.chart)

  const said = (i: number) => data[i]?.name ?? data[i]?.label
  const nowLabel = said(nowIndex) ?? ""
  const sentences: Record<PacePart, string | null> = {
    pace: shown.pace
      ? `${l.pace}: even use reaches ${format(limit as number)} by ${said(last)}.`
      : null,
    used: shown.used ? `${l.used} so far: ${format(model.used)} by ${nowLabel}.` : null,
    projected:
      shown.projected && projection
        ? projection.reachesLimit
          ? `${l.projected}: reaches ${format(limit as number)} on ${said(Math.floor(projection.endX))}.`
          : `${l.projected}: reaches ${format(Math.round(projection.endValue))} by ${said(last)}, under the limit.`
        : null,
    now: shown.now ? `${l.now}: ${nowLabel}.` : null,
    limit: shown.limit
      ? `${l.limit[0]?.toUpperCase()}${l.limit.slice(1)}: ${format(limit as number)}.`
      : null,
  }
  const summary = PACE_PARTS.map((p) => descriptions?.[p] ?? sentences[p])
    .filter(Boolean)
    .join(" ")

  // Phones show about four ticks; labels sit inside the plot so they never clip.
  const step = desktop ? 1 : Math.max(1, Math.ceil(last / 3))
  const ticks = data.map((_, i) => i).filter((i) => i % step === 0 || i === last)
  const max = Math.max(limit ?? 0, model.used, ...rows.map((r) => r.projected ?? 0))
  const nowSide = last > 0 && nowIndex / last > 0.7 ? "insideTopLeft" : "insideTopRight"
  const limitSide = last > 0 && limitX / last > 0.6 ? "left" : "top"
  const limitText = limit === undefined ? "" : `${format(limit)} ${l.limit}`

  let body: React.ReactNode
  if (state === "error") {
    body = <ErrorState message={l.errorMessage} onRetry={onRetry} />
  } else if (state === "loading") {
    body = <Skeleton className={chartClass} />
  } else if (!data.length) {
    body = (
      <div className="[&>div]:min-h-0 [&>div]:py-16">
        <EmptyState title={l.emptyTitle} description={l.emptyDescription} />
      </div>
    )
  } else {
    body = (
      <>
        <ChartContainer config={config} role="img" aria-label={summary} className={chartClass}>
          <RechartsPrimitive.LineChart data={rows} margin={{ left: 8, right: 8, top: 8 }}>
            <RechartsPrimitive.CartesianGrid vertical={false} />
            <RechartsPrimitive.XAxis
              dataKey="x"
              type="number"
              domain={[0, Math.max(last, 1)]}
              ticks={ticks}
              tickFormatter={(i: number) => clip(data[i]?.label ?? "")}
              padding={{ left: 16, right: 16 }}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <RechartsPrimitive.YAxis
              type="number"
              domain={[0, Math.ceil(max * 1.1) || 1]}
              tickCount={desktop ? 5 : 4}
              tickFormatter={(n: number) => format(n)}
              width={yAxisTitle ? 64 : 48}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              label={
                yAxisTitle
                  ? {
                      value: clip(yAxisTitle),
                      angle: -90,
                      position: "insideLeft",
                      style: { textAnchor: "middle", fill: "var(--color-text-muted)" },
                    }
                  : undefined
              }
            />
            {shown.pace && (
              <RechartsPrimitive.Line
                dataKey="pace"
                type="linear"
                stroke="var(--color-pace)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                connectNulls
                isAnimationActive={false}
                className={classNames?.pace}
              />
            )}
            {shown.used && (
              <RechartsPrimitive.Line
                dataKey="used"
                type="linear"
                stroke="var(--color-used)"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
                className={classNames?.used}
              />
            )}
            {shown.projected && (
              <RechartsPrimitive.Line
                dataKey="projected"
                type="linear"
                stroke="var(--color-projected)"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
                connectNulls
                isAnimationActive={false}
                className={classNames?.projected}
              />
            )}
            {shown.now && (
              <RechartsPrimitive.ReferenceLine
                x={nowIndex}
                stroke="var(--color-now)"
                strokeDasharray="4 4"
                className={classNames?.now}
                label={{
                  value: clip(l.now),
                  position: nowSide,
                  fill: "var(--color-text-muted)",
                  fontSize: 12,
                }}
              />
            )}
            {shown.limit && (
              <RechartsPrimitive.ReferenceDot
                x={limitX}
                y={limit}
                r={4}
                fill="var(--color-limit)"
                stroke="none"
                className={classNames?.limit}
                label={{
                  value: clip(limitText),
                  position: limitSide,
                  offset: 8,
                  fill: "var(--color-text-primary)",
                  fontSize: 12,
                }}
              />
            )}
          </RechartsPrimitive.LineChart>
        </ChartContainer>
        <ul data-slot="pace-descriptions" className="sr-only">
          {PACE_PARTS.map((p) => {
            const text = descriptions?.[p] ?? sentences[p]
            return text ? <li key={p}>{text}</li> : null
          })}
        </ul>
      </>
    )
  }

  return (
    <Card
      data-slot="pace-chart"
      data-state={state}
      aria-busy={state === "loading" || undefined}
      className={className}
    >
      <CardHeader
        data-slot="pace-chart-header"
        className={cn("flex flex-wrap items-center justify-between gap-2", classNames?.header)}
      >
        <CardTitle className="min-w-0 truncate">{title}</CardTitle>
        {slot}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}

export {
  CHART_COLORS,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
}
