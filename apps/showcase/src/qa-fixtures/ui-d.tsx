import { Badge } from "@dapplelight/signet-ui/components/badge"
import { Button } from "@dapplelight/signet-ui/components/button"
import { Spinner } from "@dapplelight/signet-ui/components/spinner"
import { StatStrip } from "@dapplelight/signet-ui/components/stat-strip"
import { Stepper } from "@dapplelight/signet-ui/components/stepper"
import { Switch } from "@dapplelight/signet-ui/components/switch"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@dapplelight/signet-ui/components/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dapplelight/signet-ui/components/tabs"
import { Textarea } from "@dapplelight/signet-ui/components/textarea"
import { ThemeToggle, ThemeToggleButton } from "@dapplelight/signet-ui/components/theme-toggle"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@dapplelight/signet-ui/components/tooltip"
import { Amount } from "@dapplelight/signet-ui/domain/amount"
import { type CsvField, CsvImport, type CsvSchema } from "@dapplelight/signet-ui/domain/csv-import"
import { type JobRun, JobRuns } from "@dapplelight/signet-ui/domain/job-runs"
import {
  Kanban,
  type KanbanBoard,
  KanbanColumn,
  KanbanColumnHeader,
  KanbanColumnTitle,
  KanbanItem,
  KanbanList,
} from "@dapplelight/signet-ui/domain/kanban"
import { TrendChip } from "@dapplelight/signet-ui/domain/trend-chip"
import { Upload, type UploadTransport } from "@dapplelight/signet-ui/domain/upload"
import { CheckIcon, InfoIcon } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { type Fixtures, minutesAgo } from "./shared"

const LONG_NAME =
  "Tailspin Toys International Holdings (Asia Pacific) Private Limited, Mumbai Branch"

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8 min-w-0 last:mb-0">
      <h2 className="mb-3 text-caption text-text-muted">{title}</h2>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- ui

function SpinnerItem() {
  return (
    <>
      <Block title="Sizes">
        <div className="flex items-center gap-6">
          <Spinner />
          <Spinner className="size-6" />
          <Spinner className="size-8" />
          <Spinner className="size-12" />
        </div>
      </Block>
      <Block title="Tones">
        <div className="flex items-center gap-6">
          <Spinner className="size-6" />
          <Spinner className="size-6 text-primary" />
          <Spinner className="size-6 text-text-primary" />
          <Spinner className="size-6 text-accent-red" />
        </div>
      </Block>
      <Block title="Inline with a label">
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <Spinner aria-label="Syncing" /> Syncing the Northwind Ltd ledger
          </p>
          <Button disabled>
            <Spinner className="text-primary-foreground" aria-label="Saving" /> Saving invoice
          </Button>
        </div>
      </Block>
    </>
  )
}

const STAT_ITEMS = [
  { label: "Revenue", value: "₹12,48,000", meta: "+8.2% vs last month", tone: "good" as const },
  { label: "Outstanding", value: "₹3,20,500", meta: "4 invoices overdue", tone: "warn" as const },
  { label: "Paid invoices", value: "128", meta: "This quarter" },
  { label: "Average days to pay", value: "17", meta: "Target: 15 days" },
]

function StatStripItem() {
  return (
    <>
      <Block title="Grid layout (desktop), four stats">
        <StatStrip isDesktop items={STAT_ITEMS} />
      </Block>
      <Block title="Grid layout, two stats">
        <StatStrip isDesktop items={STAT_ITEMS.slice(0, 2)} />
      </Block>
      <Block title="Row layout (phone)">
        <StatStrip isDesktop={false} items={STAT_ITEMS} />
      </Block>
      <Block title="Long label and value">
        <StatStrip
          isDesktop={false}
          items={[
            {
              label: `Receivable from ${LONG_NAME}`,
              value: "₹1,25,00,000.00",
              meta: "Net 60, due 15 Mar 2026",
              tone: "warn",
            },
            { label: "Collected", value: "₹48,20,000.00", meta: "+12%", tone: "good" },
          ]}
        />
      </Block>
    </>
  )
}

const CHECKOUT_STEPS = [
  { title: "Details", description: "Billing contact" },
  { title: "Payment", description: "Card or UPI" },
  { title: "Confirm", description: "Review order" },
]

function StepperItem() {
  return (
    <>
      <Block title="Horizontal, step 2 of 3 current">
        <Stepper aria-label="Checkout" steps={CHECKOUT_STEPS} current={1} />
      </Block>
      <Block title="Horizontal, first step">
        <Stepper aria-label="Checkout start" steps={CHECKOUT_STEPS} current={0} />
      </Block>
      <Block title="Horizontal, all complete">
        <Stepper aria-label="Checkout done" steps={CHECKOUT_STEPS} current={3} />
      </Block>
      <Block title="Vertical, with a long title">
        <Stepper
          aria-label="Vendor onboarding"
          orientation="vertical"
          current={2}
          steps={[
            { title: "Company profile", description: "Legal name and tax ID" },
            { title: "Bank account", description: "Verified with a Rs 1 deposit" },
            {
              title: `Upload signed master services agreement for ${LONG_NAME}`,
              description: "PDF, up to 10 MB",
            },
            { title: "Approval", description: "Finance team reviews within two days" },
          ]}
        />
      </Block>
      <Block title="Custom indicator">
        <Stepper
          aria-label="Custom indicator"
          steps={CHECKOUT_STEPS}
          current={1}
          renderIndicator={(i, status) => (status === "complete" ? <CheckIcon /> : `${i + 1}.`)}
        />
      </Block>
    </>
  )
}

function SwitchRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the Switch inside is the control
    <label className="flex items-center justify-between gap-4 text-sm text-text-primary">
      <span className="min-w-0">{label}</span>
      {children}
    </label>
  )
}

function SwitchItem() {
  return (
    <>
      <Block title="Default size">
        <div className="flex flex-col gap-3">
          <SwitchRow label="Email receipts (off)">
            <Switch aria-label="Email receipts" />
          </SwitchRow>
          <SwitchRow label="Auto-reminders (on)">
            <Switch aria-label="Auto-reminders" defaultChecked />
          </SwitchRow>
          <SwitchRow label="Disabled, off">
            <Switch aria-label="Disabled off" disabled />
          </SwitchRow>
          <SwitchRow label="Disabled, on">
            <Switch aria-label="Disabled on" disabled defaultChecked />
          </SwitchRow>
          <SwitchRow label="Invalid">
            <Switch aria-label="Invalid" aria-invalid />
          </SwitchRow>
        </div>
      </Block>
      <Block title="Small size">
        <div className="flex flex-col gap-3">
          <SwitchRow label="Compact rows (off)">
            <Switch size="sm" aria-label="Compact rows" />
          </SwitchRow>
          <SwitchRow label="Show cents (on)">
            <Switch size="sm" aria-label="Show cents" defaultChecked />
          </SwitchRow>
          <SwitchRow label="Disabled, on">
            <Switch size="sm" aria-label="Small disabled" disabled defaultChecked />
          </SwitchRow>
        </div>
      </Block>
      <Block title="Long label">
        <SwitchRow
          label={`Email me a weekly digest of every invoice paid by ${LONG_NAME} and its subsidiaries`}
        >
          <Switch aria-label="Weekly digest" defaultChecked />
        </SwitchRow>
      </Block>
    </>
  )
}

const INVOICES = [
  { id: "INV-1042", customer: "Northwind Ltd", status: "Paid", amount: 1248000 },
  { id: "INV-1043", customer: "Contoso Retail", status: "Pending", amount: 820050 },
  { id: "INV-1044", customer: "Fabrikam Studio", status: "Overdue", amount: 315000 },
  { id: "INV-1045", customer: LONG_NAME, status: "Pending", amount: 12500000 },
]

function TableItem() {
  return (
    <>
      <Block title="Header, rows, caption">
        <Table>
          <TableCaption>Invoices issued in January 2026</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {INVOICES.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium text-text-primary">{r.customer}</TableCell>
                <TableCell>
                  <Badge variant={r.status === "Overdue" ? "destructive" : "secondary"}>
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={r.amount} minorUnits />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Block>
      <Block title="Without caption, one row highlighted by a selected state">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>INV-1042</TableCell>
              <TableCell className="text-right">
                <Amount value={1248000} minorUnits />
              </TableCell>
            </TableRow>
            <TableRow data-state="selected" className="bg-bg-elevated">
              <TableCell>INV-1043</TableCell>
              <TableCell className="text-right">
                <Amount value={820050} minorUnits />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Block>
    </>
  )
}

function TabsItem() {
  return (
    <>
      <Block title="Default variant">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="notes" disabled>
              Notes
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-text-secondary">
            Northwind Ltd has paid 12 of 14 invoices this year.
          </TabsContent>
          <TabsContent value="invoices">Invoices list.</TabsContent>
        </Tabs>
      </Block>
      <Block title="Line variant">
        <Tabs defaultValue="invoices">
          <TabsList variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="invoices" className="text-text-secondary">
            Fourteen invoices, two outstanding.
          </TabsContent>
        </Tabs>
      </Block>
      <Block title="Vertical">
        <Tabs defaultValue="profile" orientation="vertical" className="flex-row">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="text-text-secondary">
            Company profile and tax details.
          </TabsContent>
        </Tabs>
      </Block>
      <Block title="Long labels">
        <Tabs defaultValue="a">
          <div className="max-w-full overflow-x-auto">
            <TabsList>
              <TabsTrigger value="a">{`Invoices for ${LONG_NAME}`}</TabsTrigger>
              <TabsTrigger value="b">Credit notes</TabsTrigger>
            </TabsList>
          </div>
        </Tabs>
      </Block>
    </>
  )
}

function TextareaItem() {
  return (
    <div className="flex flex-col gap-6">
      <Block title="Placeholder">
        <Textarea placeholder="Add a note for Northwind Ltd" aria-label="Note" />
      </Block>
      <Block title="With text">
        <Textarea
          aria-label="Memo"
          defaultValue={
            "Net 30 from the invoice date.\nWire to the account on file; reference INV-1042.\nLate fees apply after 15 Feb 2026."
          }
        />
      </Block>
      <Block title="Monospace, 6 rows">
        <Textarea
          aria-label="CSV"
          rows={6}
          className="font-mono text-xs"
          defaultValue={"name,email\nAsha Rao,asha@example.com\nOmar Sheikh,omar@example.com"}
        />
      </Block>
      <Block title="Invalid">
        <Textarea aria-label="Reason" aria-invalid defaultValue="Too short" />
        <p className="mt-1 text-xs text-accent-red">Write at least 20 characters.</p>
      </Block>
      <Block title="Disabled">
        <Textarea aria-label="Locked" disabled defaultValue="Locked after the invoice was sent." />
      </Block>
      <Block title="Long unbroken text">
        <Textarea aria-label="Long" defaultValue={`${LONG_NAME} ${LONG_NAME} ${"x".repeat(70)}`} />
      </Block>
    </div>
  )
}

function ThemeToggleItem() {
  return (
    <>
      <Block title="Icon only">
        <ThemeToggle />
      </Block>
      <Block title="With labels">
        <ThemeToggle showLabels />
      </Block>
      <Block title="Single button">
        <ThemeToggleButton />
      </Block>
    </>
  )
}

const ACTIVITY: {
  title: string
  at: string
  when: string
  detail: string
  status: "complete" | "current" | "upcoming"
}[] = [
  {
    title: "Invoice INV-1042 sent",
    at: minutesAgo(60 * 48),
    when: "13 Jan, 10:00",
    detail: "Emailed to accounts@northwind.example.",
    status: "complete",
  },
  {
    title: "Payment received",
    at: minutesAgo(60 * 5),
    when: "15 Jan, 05:00",
    detail: "₹12,480.00 by UPI.",
    status: "complete",
  },
  {
    title: "Reconciling with the bank statement",
    at: minutesAgo(5),
    when: "15 Jan, 09:55",
    detail: "Waiting for the nightly import.",
    status: "current",
  },
  {
    title: "Receipt issued",
    at: minutesAgo(-60 * 24),
    when: "16 Jan",
    detail: "Sent once the payment reconciles.",
    status: "upcoming",
  },
]

function TimelineItems({ items }: { items: typeof ACTIVITY }) {
  return (
    <>
      {items.map((e) => (
        <TimelineItem key={e.title} status={e.status}>
          <TimelineMarker />
          <TimelineConnector />
          <TimelineTitle>{e.title}</TimelineTitle>
          <TimelineTime dateTime={e.at}>{e.when}</TimelineTime>
          <TimelineDescription>{e.detail}</TimelineDescription>
        </TimelineItem>
      ))}
    </>
  )
}

function TimelineFixture() {
  return (
    <>
      <Block title="With progress status">
        <Timeline aria-label="Invoice activity">
          <TimelineItems items={ACTIVITY} />
        </Timeline>
      </Block>
      <Block title="Plain events, no status, custom marker, long title">
        <Timeline aria-label="Account history">
          <TimelineItem>
            <TimelineMarker>
              <InfoIcon aria-hidden />
            </TimelineMarker>
            <TimelineConnector />
            <TimelineTitle>{`Contract signed with ${LONG_NAME}`}</TimelineTitle>
            <TimelineTime dateTime="2025-11-03">3 Nov 2025</TimelineTime>
            <TimelineDescription>
              Master services agreement, twelve months, auto-renewing.
            </TimelineDescription>
          </TimelineItem>
          <TimelineItem>
            <TimelineMarker />
            <TimelineConnector />
            <TimelineTitle>Workspace created</TimelineTitle>
            <TimelineTime dateTime="2025-10-28">28 Oct 2025</TimelineTime>
          </TimelineItem>
        </Timeline>
      </Block>
    </>
  )
}

// Toasts need a mounted Toaster before toast() is called, and Infinity keeps them on
// screen with no timer. Explicit ids keep a double effect from stacking duplicates.
function ToastFixture() {
  useEffect(() => {
    toast.success("Invoice INV-1042 sent", {
      id: "qa-success",
      description: "Emailed to accounts@northwind.example.",
      duration: Number.POSITIVE_INFINITY,
      action: { label: "Undo", onClick: () => {} },
    })
    toast.error("Payment failed", {
      id: "qa-error",
      description: `The bank declined the card for ${LONG_NAME}.`,
      duration: Number.POSITIVE_INFINITY,
    })
    toast.info("Reconciliation runs at 02:00", {
      id: "qa-info",
      duration: Number.POSITIVE_INFINITY,
    })
    return () => toast.dismiss()
  }, [])
  return (
    <>
      <p className="text-sm text-text-secondary">
        Three toasts (success with an action, error with a long description, info) show in the
        bottom-right stack.
      </p>
      <Toaster expand closeButton />
    </>
  )
}

function TooltipItem() {
  return (
    <TooltipProvider>
      <div className="flex flex-col gap-20 pt-14 pb-28">
        <Block title="Top, short text">
          <Tooltip open>
            <TooltipTrigger asChild>
              <Button variant="outline">Download</Button>
            </TooltipTrigger>
            <TooltipContent side="top">Download INV-1042 as PDF</TooltipContent>
          </Tooltip>
        </Block>
        <Block title="Bottom, long wrapping text">
          <Tooltip open>
            <TooltipTrigger asChild>
              <Button variant="outline">Settle</Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {`Mark every open invoice for ${LONG_NAME} as settled and send a receipt to the billing contact.`}
            </TooltipContent>
          </Tooltip>
        </Block>
      </div>
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------- domain

function AmountItem() {
  const rows: [string, ReactNode][] = [
    ["Standard, INR", <Amount key="a" value={12480} />],
    ["Lakh grouping", <Amount key="a" value={12500000} />],
    ["Credit", <Amount key="a" value={12480} tone="credit" />],
    ["Debit", <Amount key="a" value={-8200.5} tone="debit" />],
    ["Transfer", <Amount key="a" value={3150} tone="transfer" />],
    ["Auto tone, positive", <Amount key="a" value={12480} tone="auto" />],
    ["Auto tone, negative", <Amount key="a" value={-8200.5} tone="auto" />],
    ["Auto tone, zero", <Amount key="a" value={0} tone="auto" />],
    ["Minor units (paise)", <Amount key="a" value={1248000} minorUnits />],
    ["Bigint minor units", <Amount key="a" value={123456789012345678n} minorUnits />],
    ["String value", <Amount key="a" value="9999.5" />],
    ["Whole", <Amount key="a" value={12480.75} notation="whole" />],
    ["Compact lakh", <Amount key="a" value={1250000} notation="compact" />],
    ["Compact crore", <Amount key="a" value={12000000} notation="compact" />],
    ["USD, en-US", <Amount key="a" value={1234567.891} currency="USD" locale="en-US" />],
    [
      "USD compact",
      <Amount key="a" value={1300000} currency="USD" locale="en-US" notation="compact" />,
    ],
    ["JPY, no decimals", <Amount key="a" value={125000} currency="JPY" locale="ja-JP" />],
    ["KWD, 3 decimals", <Amount key="a" value={42.5} currency="KWD" locale="en-US" />],
    ["EUR, de-DE", <Amount key="a" value={9876.5} currency="EUR" locale="de-DE" />],
    [
      "Part classes",
      <Amount
        key="a"
        value={12480.5}
        classNames={{ currency: "text-text-muted", fraction: "text-text-muted" }}
      />,
    ],
    [
      "Large display",
      <Amount key="a" value={12480} tone="credit" className="text-3xl font-medium" />,
    ],
  ]
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, node]) => (
        <div key={label} className="contents">
          <dt className="min-w-0 text-text-secondary">{label}</dt>
          <dd className="m-0 text-right text-text-primary">{node}</dd>
        </div>
      ))}
      <dt className="col-span-2 mt-2 text-text-secondary">
        Whole amount inside a long sentence about {LONG_NAME}: <Amount value={125000000.5} />
      </dt>
    </dl>
  )
}

// ---- CsvImport: a deterministic in-memory run through the flow, no file, fetch or clock.

const CSV_FIELDS: CsvField[] = [
  { key: "customer", label: "Customer", aliases: ["Client name"], required: true },
  { key: "email", label: "Email", required: true },
  { key: "amount", label: "Amount" },
  { key: "due", label: "Due date", aliases: ["Due"] },
]

const CSV_TEXT = [
  "Client name,Email,Amount,Due",
  "Northwind Ltd,accounts@northwind.example,12480.00,2026-02-01",
  "Contoso Retail,billing@contoso.example,8200.50,2026-02-05",
  "Fabrikam Studio,fabrikam-studio,3150.00,2026-02-09",
  `${LONG_NAME},ap@tailspin.example,not a number,2026-02-12`,
  "Adventure Works Cycles,ap@adventure-works.example,64000.00,2026-02-15",
].join("\n")

type CsvRow = Record<string, string>

const CSV_SCHEMA: CsvSchema<CsvRow> = {
  safeParse(value) {
    const v = value as CsvRow
    const issues: { path: string[]; message: string }[] = []
    if (!v.customer) issues.push({ path: ["customer"], message: "Required" })
    if (!v.email?.includes("@")) issues.push({ path: ["email"], message: "Not an email address" })
    if (v.amount && !/^\d+(\.\d+)?$/.test(v.amount)) {
      issues.push({ path: ["amount"], message: "Must be a number" })
    }
    return issues.length ? { success: false, error: { issues } } : { success: true, data: v }
  },
}

type CsvStage = "map" | "review" | "done"
const CSV_STAGES: CsvStage[] = ["map", "review", "done"]

/** Fills the paste box and presses Continue / Import in turn, one step per commit. */
function DrivenCsvImport({ to }: { to: CsvStage }) {
  const ref = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState(0)
  const last = CSV_STAGES.indexOf(to) + 1
  // biome-ignore lint/correctness/useExhaustiveDependencies: each phase runs once, after the previous step committed
  useEffect(() => {
    const root = ref.current
    if (!root || phase > last) return
    const press = (name: RegExp) =>
      [...root.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""))?.click()
    if (phase === 0) {
      const box = root.querySelector("textarea")
      if (!box) return
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      set?.call(box, CSV_TEXT)
      box.dispatchEvent(new Event("input", { bubbles: true }))
    } else if (phase === 1 || phase === 2) press(/^Continue$/)
    else if (phase === 3) press(/^Import \d/)
    setPhase((p) => p + 1)
  }, [phase])
  return (
    <div ref={ref}>
      <CsvImport<CsvRow>
        fields={CSV_FIELDS}
        schema={CSV_SCHEMA}
        onImport={(rows) => ({ inserted: rows.length })}
        delimiter=","
      />
    </div>
  )
}

function CsvImportItem() {
  return (
    <>
      <Block title="Step 1: choose a file or paste text">
        <CsvImport
          fields={CSV_FIELDS}
          schema={CSV_SCHEMA}
          onImport={(rows) => ({ inserted: rows.length })}
        />
      </Block>
      <Block title="Step 2: match columns to fields">
        <DrivenCsvImport to="map" />
      </Block>
      <Block title="Step 3: review, rows with errors">
        <DrivenCsvImport to="review" />
      </Block>
      <Block title="Step 4: imported">
        <DrivenCsvImport to="done" />
      </Block>
    </>
  )
}

const JOB_RUNS: JobRun[] = [
  {
    id: "run_01",
    job: "invoice.reminders",
    state: "done",
    attempt: 1,
    progress: { done: 48, total: 48 },
    updatedAt: minutesAgo(12),
  },
  {
    id: "run_02",
    job: "ledger.reconcile",
    state: "running",
    attempt: 1,
    progress: { done: 312, total: 1200, note: "Northwind Ltd" },
    updatedAt: minutesAgo(1),
  },
  {
    id: "run_03",
    job: "statement.import",
    state: "queued",
    attempt: 0,
    updatedAt: minutesAgo(2),
  },
  {
    id: "run_04",
    job: "receipts.email",
    state: "dead",
    attempt: 5,
    error: {
      code: "SMTP_REJECTED",
      message: `Mailbox unavailable for billing@tailspin.example (${LONG_NAME}); the relay refused the message after five attempts`,
    },
    progress: { done: 3 },
    updatedAt: minutesAgo(45),
  },
  {
    id: "run_05",
    job: "export.csv",
    state: "cancelled",
    attempt: 1,
    updatedAt: minutesAgo(90),
  },
  {
    id: "run_06",
    job: "export.pdf",
    state: "retrying",
    attempt: 2,
    error: { code: "TIMEOUT" },
    updatedAt: minutesAgo(3),
  },
]

function JobRunsItem() {
  return (
    <>
      <Block title="Runs in every state, with retry and cancel">
        <JobRuns runs={JOB_RUNS} onRetry={() => {}} onCancel={() => {}} />
      </Block>
      <Block title="Read-only (no actions)">
        <JobRuns runs={JOB_RUNS.slice(0, 2)} />
      </Block>
      <Block title="Empty">
        <JobRuns runs={[]} emptyMessage="No job runs in the last 24 hours" />
      </Block>
    </>
  )
}

const BOARD: KanbanBoard = {
  todo: ["c1", "c2"],
  doing: ["c3", "c4"],
  done: ["c5"],
}

const CARDS: Record<string, { title: string; meta: string }> = {
  c1: { title: "Send reminder to Northwind Ltd", meta: "INV-1042 · due 1 Feb" },
  c2: { title: "Review credit note", meta: "INV-1038 · ₹4,200.00" },
  c3: { title: `Reconcile ${LONG_NAME} statements for the 2025 financial year`, meta: "INV-1021" },
  c4: { title: "Chase Fabrikam Studio", meta: "INV-1044 · 3 days overdue" },
  c5: { title: "Issue receipt to Contoso Retail", meta: "INV-1043 · ₹8,200.50" },
}

const COLUMNS: { value: string; title: string }[] = [
  { value: "todo", title: "To do" },
  { value: "doing", title: "In progress" },
  { value: "done", title: "Done" },
]

function KanbanItemFixture() {
  return (
    <>
      <Block title="Board, with one card picked up (lifted) and one column dragged over">
        <Kanban aria-label="Collections board" value={BOARD}>
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.value}
              value={col.value}
              data-over={col.value === "done" ? "" : undefined}
            >
              <KanbanColumnHeader>
                <KanbanColumnTitle>{col.title}</KanbanColumnTitle>
                <span className="text-xs text-text-muted tabular-nums">
                  {BOARD[col.value]?.length}
                </span>
              </KanbanColumnHeader>
              <KanbanList>
                {BOARD[col.value]?.map((id) => (
                  <KanbanItem key={id} value={id} data-lifted={id === "c4" ? "" : undefined}>
                    <p className="m-0 font-medium">{CARDS[id]?.title}</p>
                    <p className="m-0 mt-1 text-xs text-text-muted">{CARDS[id]?.meta}</p>
                  </KanbanItem>
                ))}
              </KanbanList>
            </KanbanColumn>
          ))}
        </Kanban>
      </Block>
      <Block title="Empty columns">
        <Kanban aria-label="Empty board" value={{ todo: [], doing: [] }}>
          {COLUMNS.slice(0, 2).map((col) => (
            <KanbanColumn key={col.value} value={col.value}>
              <KanbanColumnHeader>
                <KanbanColumnTitle>{col.title}</KanbanColumnTitle>
              </KanbanColumnHeader>
              <KanbanList />
            </KanbanColumn>
          ))}
        </Kanban>
      </Block>
    </>
  )
}

function TrendChipItem() {
  const values: (number | string)[] = [12.4, 0, 0.04, 8.5, 1234.56, -3.2, -0.8, -42, "7.25", "n/a"]
  return (
    <div className="flex flex-col gap-3">
      {values.map((v) => (
        <div key={String(v)} className="flex items-center justify-between gap-4 text-sm">
          <span className="font-mono text-text-secondary">{JSON.stringify(v)}</span>
          <TrendChip value={v} />
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="text-text-secondary">Larger, in a heading</span>
        <TrendChip value={8.2} className="text-base font-medium" />
      </div>
    </div>
  )
}

// ---- Upload: an in-memory transport per file name; nothing is sent anywhere.

const UPLOAD_TRANSPORT: UploadTransport = (file, _target, onProgress) => {
  if (file.name.startsWith("scan")) return Promise.reject(new Error("Upload failed (413)"))
  if (file.name.startsWith("q4")) {
    onProgress(0.6)
    return new Promise<void>(() => {}) // stays at 60%
  }
  onProgress(1)
  return Promise.resolve()
}

const upload = {
  getTarget: () => Promise.resolve({ url: "https://uploads.example/presigned" }),
  transport: UPLOAD_TRANSPORT,
  accept: ["application/pdf", "image/*"],
  maxBytes: 10 * 1024 * 1024,
}

/** Picks files through the real input, as a user would, so the list shows each state. */
function DrivenUpload() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const input = ref.current?.querySelector<HTMLInputElement>("input[type=file]")
    if (!input) return
    const dt = new DataTransfer()
    for (const [name, type] of [
      ["q4-statement.pdf", "application/pdf"],
      [`${LONG_NAME} - signed master services agreement 2026.pdf`, "application/pdf"],
      ["scan-0007.png", "image/png"],
      ["notes.exe", "application/x-msdownload"],
    ] as const) {
      dt.items.add(new File(["demo"], name, { type }))
    }
    input.files = dt.files
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }, [])
  return (
    <div ref={ref}>
      <Upload {...upload} multiple />
    </div>
  )
}

function UploadItem() {
  return (
    <>
      <Block title="Empty drop zone, with type and size hint">
        <Upload {...upload} />
      </Block>
      <Block title="Custom label, no hint">
        <Upload
          getTarget={upload.getTarget}
          transport={upload.transport}
          label="Drop the signed contract here"
        />
      </Block>
      <Block title="Uploading, done, failed (with retry) and a rejected file">
        <DrivenUpload />
      </Block>
    </>
  )
}

export const uiD = {
  spinner: () => <SpinnerItem />,
  "stat-strip": () => <StatStripItem />,
  stepper: () => <StepperItem />,
  switch: () => <SwitchItem />,
  table: () => <TableItem />,
  tabs: () => <TabsItem />,
  textarea: () => <TextareaItem />,
  "theme-toggle": () => <ThemeToggleItem />,
  timeline: () => <TimelineFixture />,
  toast: () => <ToastFixture />,
  tooltip: () => <TooltipItem />,
  amount: () => <AmountItem />,
  "csv-import": () => <CsvImportItem />,
  "job-runs": () => <JobRunsItem />,
  kanban: () => <KanbanItemFixture />,
  "trend-chip": () => <TrendChipItem />,
  upload: () => <UploadItem />,
} satisfies Fixtures
