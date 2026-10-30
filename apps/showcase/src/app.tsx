import { Alert, AlertDescription, AlertTitle } from "@dapplelight/signet-ui/components/alert"
import { AnswerHeadline } from "@dapplelight/signet-ui/components/answer-headline"
import { Badge } from "@dapplelight/signet-ui/components/badge"
import { Button } from "@dapplelight/signet-ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@dapplelight/signet-ui/components/card"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@dapplelight/signet-ui/components/chart"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@dapplelight/signet-ui/components/dialog"
import { Input } from "@dapplelight/signet-ui/components/input"
import { Progress } from "@dapplelight/signet-ui/components/progress"
import { StatStrip } from "@dapplelight/signet-ui/components/stat-strip"
import { Switch } from "@dapplelight/signet-ui/components/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@dapplelight/signet-ui/components/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dapplelight/signet-ui/components/tabs"
import { ThemeToggle } from "@dapplelight/signet-ui/components/theme-toggle"
import { type ReactNode, useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { applyTheme, THEMES } from "./themes"

const MONTHS = [
  { month: "May", visits: 1240, signups: 310 },
  { month: "Jun", visits: 1580, signups: 420 },
  { month: "Jul", visits: 1390, signups: 365 },
  { month: "Aug", visits: 1910, signups: 540 },
  { month: "Sep", visits: 2260, signups: 690 },
  { month: "Oct", visits: 2480, signups: 760 },
]

const chartConfig = {
  visits: { label: "Visits", color: "var(--chart-1, var(--color-primary))" },
  signups: { label: "Signups", color: "var(--chart-2, var(--color-accent-blue))" },
} satisfies ChartConfig

const ROWS = [
  { name: "Ada Lovelace", plan: "Team", status: "Active", seats: 12 },
  { name: "Grace Hopper", plan: "Pro", status: "Trial", seats: 3 },
  { name: "Alan Turing", plan: "Team", status: "Active", seats: 8 },
  { name: "Katherine Johnson", plan: "Free", status: "Paused", seats: 1 },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  )
}

export function App({ initial }: { initial: string }) {
  const [theme, setTheme] = useState(initial)
  const [on, setOn] = useState(true)

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-6 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 font-medium">Signet</span>
          {THEMES.map((t) => (
            <Button
              key={t}
              size="sm"
              variant={t === theme ? "default" : "outline"}
              aria-pressed={t === theme}
              onClick={() => applyTheme(t).then(() => setTheme(t))}
            >
              {t}
            </Button>
          ))}
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <AnswerHeadline
          headline={{
            question: "How is the product doing this month?",
            sentence: ["Signups grew ", { value: 10 }, "% to ", { value: 760 }, " in October."],
            detail: ["Visits are up to ", { value: 2480 }, ", the best month this half-year."],
            tone: "good",
          }}
          renderValue={(n) => n.toLocaleString()}
        />

        <StatStrip
          items={[
            { label: "Visits", value: "2,480", meta: "+9.7% vs Sep", tone: "good" },
            { label: "Signups", value: "760", meta: "+10.1% vs Sep", tone: "good" },
            { label: "Churn", value: "3.2%", meta: "Above 3% target", tone: "warn" },
            { label: "Open tickets", value: "14", meta: "Median 6h" },
          ]}
        />

        <Section title="Buttons and badges">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
        </Section>

        <Section title="Inputs, dialog and feedback">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Email address" type="email" aria-label="Email address" />
            <Input placeholder="Disabled" disabled aria-label="Disabled input" />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Switch id="weekly" checked={on} onCheckedChange={setOn} />
            <label htmlFor="weekly">Email me a weekly summary</label>
          </div>
          <Progress value={64} aria-label="Onboarding progress" />
          <Alert>
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>
              Alerts, badges and buttons all read the same tokens.
            </AlertDescription>
          </Alert>
          <Dialog>
            <DialogTrigger render={<Button variant="outline" className="w-fit" />}>
              Open dialog
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete this project?</DialogTitle>
                <DialogDescription>
                  This cannot be undone. Radius, shadow and motion come from the active theme.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter showCloseButton>
                <Button variant="destructive">Delete</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Section>

        <Section title="Table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Seats</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.plan}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "Active" ? "default" : "secondary"}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.seats}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <Section title="Tabs and chart">
          <Tabs defaultValue="chart">
            <TabsList>
              <TabsTrigger value="chart">Chart</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>
            <TabsContent value="chart">
              <ChartContainer config={chartConfig} className="aspect-[2/1] w-full">
                <BarChart data={MONTHS}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="visits"
                    fill="var(--color-visits)"
                    radius={4}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="signups"
                    fill="var(--color-signups)"
                    radius={4}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            </TabsContent>
            <TabsContent value="notes">
              <p className="text-sm text-muted-foreground">
                The chart series take their colours from the theme's optional --chart-N slots, and
                fall back to the primary and accent colours when a theme omits them.
              </p>
            </TabsContent>
          </Tabs>
        </Section>
      </main>
    </div>
  )
}
