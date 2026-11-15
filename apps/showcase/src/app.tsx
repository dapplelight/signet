import { Alert, AlertDescription, AlertTitle } from "@dapplelight/signet-ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@dapplelight/signet-ui/components/alert-dialog"
import { AnswerHeadline } from "@dapplelight/signet-ui/components/answer-headline"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  initials,
} from "@dapplelight/signet-ui/components/avatar"
import { Badge } from "@dapplelight/signet-ui/components/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@dapplelight/signet-ui/components/breadcrumb"
import { Button } from "@dapplelight/signet-ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@dapplelight/signet-ui/components/card"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@dapplelight/signet-ui/components/chart"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@dapplelight/signet-ui/components/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@dapplelight/signet-ui/components/dialog"
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@dapplelight/signet-ui/components/field"
import { Input } from "@dapplelight/signet-ui/components/input"
import { Kbd } from "@dapplelight/signet-ui/components/kbd"
import { Progress } from "@dapplelight/signet-ui/components/progress"
import { RadioGroup, RadioGroupItem } from "@dapplelight/signet-ui/components/radio-group"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@dapplelight/signet-ui/components/sidebar"
import { Spinner } from "@dapplelight/signet-ui/components/spinner"
import { StatStrip } from "@dapplelight/signet-ui/components/stat-strip"
import { Stepper } from "@dapplelight/signet-ui/components/stepper"
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
import {
  Timeline,
  TimelineConnector,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from "@dapplelight/signet-ui/components/timeline"
import { Toaster, toast } from "@dapplelight/signet-ui/components/toast"
import { Amount } from "@dapplelight/signet-ui/domain/amount"
import {
  Kanban,
  KanbanColumn,
  KanbanColumnHeader,
  KanbanColumnTitle,
  KanbanItem,
  KanbanList,
} from "@dapplelight/signet-ui/domain/kanban"
import { HomeIcon, InboxIcon, SettingsIcon, UsersIcon } from "lucide-react"
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

const TASKS: Record<string, string> = {
  t1: "Draft the launch post",
  t2: "Invite beta testers",
  t3: "Fix the sign-in redirect",
  t4: "Price the Team plan",
  t5: "Set up billing alerts",
}
const LANES = [
  ["todo", "To do"],
  ["doing", "In progress"],
  ["done", "Done"],
] as const

const LEDGER = [
  { label: "Salary", value: 185000, tone: "auto" },
  { label: "Rent", value: -42000, tone: "auto" },
  { label: "To savings", value: -25000, tone: "transfer" },
] as const

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
  const [palette, setPalette] = useState(false)
  const [email, setEmail] = useState("ada@")

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
        <nav aria-label="Screens" className="flex items-center gap-3 text-sm">
          {__SCREEN_PAGES__.map((page) => (
            <a key={page} href={`./${page}`} className="text-text-secondary underline">
              {page.replace(/\.html$/, "").replace(/-/g, " ")}
            </a>
          ))}
          <ThemeToggle />
        </nav>
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

        <Section title="Basics">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Workspace</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Projects</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Launch plan</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Stepper
            aria-label="Onboarding"
            current={1}
            steps={[
              { title: "Account", description: "Email and password" },
              { title: "Workspace", description: "Name and members" },
              { title: "Billing", description: "Plan and card" },
            ]}
          />
          <div className="grid gap-6 sm:grid-cols-2">
            <Field errors={email.includes(".") ? [] : [{ message: "Enter a full email address" }]}>
              <FieldLabel>Work email</FieldLabel>
              <FieldControl type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <FieldDescription>We send the invite here.</FieldDescription>
              <FieldError />
            </Field>
            <Field>
              <FieldLabel>Plan</FieldLabel>
              <RadioGroup defaultValue="team">
                {["Free", "Team", "Enterprise"].map((plan) => (
                  // biome-ignore lint/a11y/noLabelWithoutControl: RadioGroupItem is the control
                  <label key={plan} className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value={plan.toLowerCase()} />
                    {plan}
                  </label>
                ))}
              </RadioGroup>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {ROWS.map((r) => (
                <Avatar key={r.name}>
                  <AvatarImage alt={r.name} />
                  <AvatarFallback>{initials(r.name)}</AvatarFallback>
                </Avatar>
              ))}
            </div>
            <Button
              variant="outline"
              onClick={() =>
                toast.success("Invite sent", {
                  description: "Grace can join the workspace now.",
                  action: { label: "Undo", onClick: () => toast("Invite withdrawn") },
                })
              }
            >
              Show a toast
            </Button>
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="destructive" />}>
                Remove member
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove Grace from the workspace?</AlertDialogTitle>
                  <AlertDialogDescription>
                    She loses access to every project at once.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive">Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="outline" onClick={() => setPalette(true)}>
              Search… <Kbd>⌘K</Kbd>
            </Button>
            <Spinner />
          </div>
          <Timeline aria-label="Activity">
            {[
              ["Invite accepted", "2026-11-14T09:12", "Today, 9:12", "Grace joined Launch plan."],
              ["Project created", "2026-11-13T17:40", "Yesterday", "Ada started Launch plan."],
              ["Workspace opened", "2026-11-01T10:00", "1 Nov", "The workspace went live."],
            ].map(([title, at, when, detail]) => (
              <TimelineItem key={title}>
                <TimelineMarker />
                <TimelineConnector />
                <TimelineTitle>{title}</TimelineTitle>
                <TimelineTime dateTime={at}>{when}</TimelineTime>
                <TimelineDescription>{detail}</TimelineDescription>
              </TimelineItem>
            ))}
          </Timeline>
        </Section>

        <Section title="Domain: amount and kanban">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <Amount
              value={12500000}
              className="text-3xl font-medium"
              classNames={{
                currency: "mr-0.5 text-xl text-text-muted",
                fraction: "text-text-muted",
              }}
            />
            <Amount value={1250000} notation="compact" className="text-xl" />
            <Amount value={-1999.5} currency="USD" locale="en-US" className="text-xl" />
          </div>
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0 text-sm">
            {LEDGER.map((r) => (
              <li key={r.label} className="flex justify-between py-2">
                <span>{r.label}</span>
                <Amount value={r.value} tone={r.tone} signDisplay="exceptZero" />
              </li>
            ))}
          </ul>
          <Kanban
            aria-label="Launch tasks"
            defaultValue={{ todo: ["t1", "t2"], doing: ["t3", "t4"], done: ["t5"] }}
          >
            {(board) =>
              LANES.map(([id, title]) => (
                <KanbanColumn key={id} value={id} className="w-auto min-w-44 flex-1">
                  <KanbanColumnHeader>
                    <KanbanColumnTitle>{title}</KanbanColumnTitle>
                    <Badge variant="secondary">{board[id]?.length ?? 0}</Badge>
                  </KanbanColumnHeader>
                  <KanbanList>
                    {(board[id] ?? []).map((task) => (
                      <KanbanItem key={task} value={task}>
                        {TASKS[task]}
                      </KanbanItem>
                    ))}
                  </KanbanList>
                </KanbanColumn>
              ))
            }
          </Kanban>
        </Section>

        <Section title="Sidebar">
          <SidebarProvider shortcut={null} className="min-h-0 overflow-hidden rounded-lg border">
            <Sidebar aria-label="Workspace" className="static h-72">
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupLabel>Workspace</SidebarGroupLabel>
                  <SidebarMenu>
                    {[
                      [HomeIcon, "Home"],
                      [InboxIcon, "Inbox"],
                      [UsersIcon, "Members"],
                      [SettingsIcon, "Settings"],
                    ].map(([Icon, label]) => (
                      <SidebarMenuItem key={label as string}>
                        <SidebarMenuButton isActive={label === "Home"}>
                          <Icon />
                          <span>{label as string}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroup>
              </SidebarContent>
            </Sidebar>
            <SidebarInset className="gap-2 p-4 text-sm text-muted-foreground">
              <SidebarTrigger />
              Collapses to icons on desktop, a drawer on phones.
            </SidebarInset>
          </SidebarProvider>
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

      <CommandDialog open={palette} onOpenChange={setPalette} onAction={(v) => toast(`Ran ${v}`)}>
        <CommandInput aria-label="Search commands" placeholder="Type a command or search…" />
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandList>
          <CommandGroup heading="Go to">
            <CommandItem value="home">Home</CommandItem>
            <CommandItem value="inbox">Inbox</CommandItem>
            <CommandItem value="members" keywords={["people", "team"]}>
              Members
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Actions">
            <CommandItem value="invite">Invite someone</CommandItem>
            <CommandItem value="settings" shortcut="mod+,">
              Settings
              <CommandShortcut />
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <Toaster />
    </div>
  )
}
