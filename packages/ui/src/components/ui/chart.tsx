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
import { cn } from "../../lib/utils.js"

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

export {
  CHART_COLORS,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
}
