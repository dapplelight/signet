"use client"
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  PaceChart,
} from "@dapplelight/signet-ui/components/chart"
import { Tabs, TabsList, TabsTrigger } from "@dapplelight/signet-ui/components/tabs"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis } from "recharts"

// Docs shows `from "recharts"`; this app does not depend on it, so the demo reuses the copy signet-ui resolves (one instance, as chart context needs).

const data = [
  { month: "Jun", revenue: 31200, expenses: 24100 },
  { month: "Jul", revenue: 35800, expenses: 25300 },
  { month: "Aug", revenue: 33900, expenses: 26800 },
  { month: "Sep", revenue: 40100, expenses: 27200 },
  { month: "Oct", revenue: 43000, expenses: 28900 },
  { month: "Nov", revenue: 48200, expenses: 29400 },
]

const config = {
  revenue: { label: "Revenue", color: "var(--chart-1, var(--color-primary))" },
  expenses: { label: "Expenses", color: "var(--chart-2, var(--color-accent-blue))" },
} satisfies ChartConfig

export function ChartDemo() {
  return (
    <ChartContainer config={config} className="aspect-[2/1] w-full max-w-xl">
      <BarChart data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} isAnimationActive={false} />
        <Bar dataKey="expenses" fill="var(--color-expenses)" radius={4} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

export function ChartLineDemo() {
  return (
    <ChartContainer config={config} className="aspect-[2/1] w-full max-w-xl">
      <LineChart data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Line
          dataKey="revenue"
          stroke="var(--color-revenue)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="expenses"
          stroke="var(--color-expenses)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  )
}

export function ChartAreaDemo() {
  return (
    <ChartContainer config={config} className="aspect-[2/1] w-full max-w-xl">
      <AreaChart data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Area
          dataKey="revenue"
          stroke="var(--color-revenue)"
          fill="var(--color-revenue)"
          fillOpacity={0.2}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

export function ChartLegendDemo() {
  return (
    <ChartContainer config={config} className="aspect-[2/1] w-full max-w-xl">
      <BarChart data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} isAnimationActive={false} />
        <Bar dataKey="expenses" fill="var(--color-expenses)" radius={4} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

const week = [
  { label: "Mon", name: "Monday", used: 60 },
  { label: "Tue", name: "Tuesday", used: 130 },
  { label: "Wed", name: "Wednesday", used: 220 },
  { label: "Thu", name: "Thursday", used: 320 },
  { label: "Fri", name: "Friday" },
  { label: "Sat", name: "Saturday" },
  { label: "Sun", name: "Sunday" },
]

export function ChartPaceDemo() {
  return (
    <PaceChart
      className="w-full max-w-xl"
      title="API requests"
      yAxisTitle="Requests"
      data={week}
      limit={500}
      slot={
        <Tabs defaultValue="week">
          <TabsList className="group-data-[orientation=horizontal]/tabs:h-auto md:group-data-[orientation=horizontal]/tabs:h-8">
            <TabsTrigger value="day" className="h-11 md:h-[calc(100%-1px)]">
              Day
            </TabsTrigger>
            <TabsTrigger value="week" className="h-11 md:h-[calc(100%-1px)]">
              Week
            </TabsTrigger>
            <TabsTrigger value="month" className="h-11 md:h-[calc(100%-1px)]">
              Month
            </TabsTrigger>
          </TabsList>
        </Tabs>
      }
    />
  )
}
