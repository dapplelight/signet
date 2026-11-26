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
import {
  AnswerHeadline,
  type AnswerHeadlineData,
} from "@dapplelight/signet-ui/components/answer-headline"
import { Avatar, AvatarFallback, initials } from "@dapplelight/signet-ui/components/avatar"
import { Badge } from "@dapplelight/signet-ui/components/badge"
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@dapplelight/signet-ui/components/breadcrumb"
import { Button } from "@dapplelight/signet-ui/components/button"
import { Calendar } from "@dapplelight/signet-ui/components/calendar"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@dapplelight/signet-ui/components/card"
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@dapplelight/signet-ui/components/chart"
import { Checkbox } from "@dapplelight/signet-ui/components/checkbox"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxValue,
  useComboboxAnchor,
} from "@dapplelight/signet-ui/components/combobox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@dapplelight/signet-ui/components/command"
import { DataGrid, type DataGridColumn } from "@dapplelight/signet-ui/components/data-grid"
import {
  DataTable,
  type DataTableProps,
  TruncatedCell,
} from "@dapplelight/signet-ui/components/data-table"
import {
  ArrowRightIcon,
  CircleAlertIcon,
  CreditCardIcon,
  DownloadIcon,
  FileTextIcon,
  InfoIcon,
  PlusIcon,
  SettingsIcon,
  SlashIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserIcon,
} from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis } from "recharts"
import { type Fixtures, QA_NOW } from "./shared"

const LONG_NAME =
  "Northwind Ltd Pan-Regional Logistics, Warehousing and Fulfilment Services (Asia Pacific) Pvt Ltd"

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
})

/** A captioned block, so one item can stack many states. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-xs font-medium text-text-muted">{title}</h2>
      {children}
    </section>
  )
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-6">{children}</div>
}

function Wrap({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

// ---------------------------------------------------------------- alert-dialog

function AlertDialogFixture() {
  return (
    <Stack>
      <Block title="Destructive confirmation (open)">
        <AlertDialog open>
          <AlertDialogTrigger render={<Button variant="destructive" className="w-fit" />}>
            <Trash2Icon data-icon="inline-start" />
            Delete vendor
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete vendor and 14 linked invoices?</AlertDialogTitle>
              <AlertDialogDescription>
                {LONG_NAME} will be removed together with its payment history of ₹12,48,000.00. This
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep vendor</AlertDialogCancel>
              <AlertDialogAction variant="destructive">Delete vendor</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Block>
    </Stack>
  )
}

// ----------------------------------------------------------------------- alert

function AlertFixture() {
  return (
    <Stack>
      <Block title="Default, with icon">
        <Alert>
          <InfoIcon className="size-4" />
          <AlertTitle>Statement ready</AlertTitle>
          <AlertDescription>
            Your January statement for account ending 4821 is ready to download.
          </AlertDescription>
        </Alert>
      </Block>
      <Block title="Destructive">
        <Alert variant="destructive">
          <CircleAlertIcon className="size-4" />
          <AlertTitle>Payment failed</AlertTitle>
          <AlertDescription>
            The card ending 4821 was declined for ₹12,480.00. Update the card to keep the plan.
          </AlertDescription>
        </Alert>
      </Block>
      <Block title="Warning">
        <Alert variant="warning">
          <TriangleAlertIcon className="size-4" />
          <AlertTitle>Invoice due in 3 days</AlertTitle>
          <AlertDescription>INV-2041 from Northwind Ltd is due on 18 Jan 2026.</AlertDescription>
        </Alert>
      </Block>
      <Block title="No icon, title only">
        <Alert>
          <AlertTitle>Changes saved</AlertTitle>
        </Alert>
      </Block>
      <Block title="Long title and description">
        <Alert variant="warning">
          <TriangleAlertIcon className="size-4" />
          <AlertTitle>Reconciliation for {LONG_NAME} has 3 unmatched transactions</AlertTitle>
          <AlertDescription>
            <p>
              Bank feed entries from 02 Jan to 14 Jan 2026 total ₹3,18,250.00 and do not match any
              open invoice. Review them before closing the month, or they will be carried over to
              February and shown again on the next statement.
            </p>
          </AlertDescription>
        </Alert>
      </Block>
    </Stack>
  )
}

// ------------------------------------------------------------- answer-headline

const answerDetail = (
  tone: AnswerHeadlineData["tone"],
  question: string,
  sentence: AnswerHeadlineData["sentence"],
  detail?: AnswerHeadlineData["detail"],
): AnswerHeadlineData => ({ tone, question, sentence, detail })

const renderInr = (n: number) => inr.format(n)

function AnswerHeadlineFixture() {
  return (
    <Stack>
      <Block title="Neutral, with detail">
        <AnswerHeadline
          renderValue={renderInr}
          headline={answerDetail(
            "neutral",
            "How much did I spend this month?",
            ["You spent ", { value: 48250.5 }, " in January, across 41 transactions."],
            ["That is ", { value: 6120 }, " less than December."],
          )}
        />
      </Block>
      <Block title="Good, with controls">
        <AnswerHeadline
          renderValue={renderInr}
          headline={answerDetail("good", "Am I on track for the quarter?", [
            "You are ",
            { value: 18200 },
            " ahead of plan, with 18% of the quarter left.",
          ])}
        >
          <Wrap>
            <Button size="xs" variant="outline">
              This month
            </Button>
            <Button size="xs" variant="ghost">
              Quarter
            </Button>
          </Wrap>
        </AnswerHeadline>
      </Block>
      <Block title="Warn">
        <AnswerHeadline
          renderValue={renderInr}
          headline={answerDetail(
            "warn",
            "Can I cover next week's payments?",
            ["Cash is short by ", { value: 22400 }, " on 22 Jan 2026."],
            ["Three invoices from Northwind Ltd fall due before the next payout."],
          )}
        />
      </Block>
      <Block title="Default value renderer, long question">
        <AnswerHeadline
          headline={answerDetail(
            "neutral",
            `What did ${LONG_NAME} bill us for across the last three financial years?`,
            [
              "Billed ",
              { value: 1284000 },
              " over 3 years, an average of ",
              { value: 428000 },
              ".",
            ],
          )}
        />
      </Block>
    </Stack>
  )
}

// ---------------------------------------------------------------------- avatar

const PEOPLE = ["Asha Verma", "Kabir Nair", "Meera", "Rohan Das Gupta", "Ines Marlowe-Ashworth"]

function AvatarFixture() {
  return (
    <Stack>
      <Block title="Sizes: sm, default, lg">
        <Wrap>
          <Avatar size="sm">
            <AvatarFallback>{initials("Asha Verma")}</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>{initials("Asha Verma")}</AvatarFallback>
          </Avatar>
          <Avatar size="lg">
            <AvatarFallback>{initials("Asha Verma")}</AvatarFallback>
          </Avatar>
        </Wrap>
      </Block>
      <Block title="Initials from names">
        <Wrap>
          {PEOPLE.map((name) => (
            <Avatar key={name} size="lg">
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
          ))}
        </Wrap>
      </Block>
      <Block title="Icon fallback">
        <Wrap>
          <Avatar size="lg">
            <AvatarFallback>
              <UserIcon className="size-4" />
            </AvatarFallback>
          </Avatar>
        </Wrap>
      </Block>
      <Block title="Stack with ring, and a long name beside">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex shrink-0 -space-x-2">
            {PEOPLE.slice(0, 4).map((name) => (
              <Avatar key={name} className="ring-2 ring-bg-base">
                <AvatarFallback>{initials(name)}</AvatarFallback>
              </Avatar>
            ))}
          </div>
          <span className="min-w-0 truncate text-sm text-text-secondary">{LONG_NAME}</span>
        </div>
      </Block>
    </Stack>
  )
}

// ----------------------------------------------------------------------- badge

function BadgeFixture() {
  return (
    <Stack>
      <Block title="Variants">
        <Wrap>
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="ghost">Ghost</Badge>
          <Badge variant="link">Link</Badge>
        </Wrap>
      </Block>
      <Block title="With icon">
        <Wrap>
          <Badge>
            <FileTextIcon data-icon="inline-start" />
            Draft
          </Badge>
          <Badge variant="secondary">
            Paid
            <ArrowRightIcon data-icon="inline-end" />
          </Badge>
          <Badge variant="destructive">
            <CircleAlertIcon data-icon="inline-start" />
            Overdue
          </Badge>
        </Wrap>
      </Block>
      <Block title="Counts and amounts">
        <Wrap>
          <Badge>3</Badge>
          <Badge variant="secondary">12</Badge>
          <Badge variant="outline">₹12,480.00</Badge>
        </Wrap>
      </Block>
      <Block title="As a link">
        <Wrap>
          <Badge render={<a href="#qa-badge" />}>Open invoices</Badge>
          <Badge variant="outline" render={<a href="#qa-badge" />}>
            Northwind Ltd
          </Badge>
        </Wrap>
      </Block>
      <Block title="Long label (single line, clipped by the pill)">
        <div className="max-w-full">
          <Badge variant="secondary" className="max-w-full">
            <span className="truncate">{LONG_NAME}</span>
          </Badge>
        </div>
      </Block>
    </Stack>
  )
}

// ------------------------------------------------------------------ breadcrumb

function BreadcrumbFixture() {
  return (
    <Stack>
      <Block title="Trail">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#qa-home">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#qa-vendors">Vendors</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Northwind Ltd</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Block>
      <Block title="Collapsed with ellipsis and custom separator">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#qa-home">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <SlashIcon />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbEllipsis />
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <SlashIcon />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbLink href="#qa-invoices">Invoices</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <SlashIcon />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage>INV-2041</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Block>
      <Block title="Long names wrap">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#qa-home">Workspace</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#qa-vendors">{LONG_NAME}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                Statement of account for the financial year ending 31 March 2026
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Block>
    </Stack>
  )
}

// ---------------------------------------------------------------------- button

const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const
const SIZES = ["xs", "sm", "default", "lg", "touch"] as const
const ICON_SIZES = ["icon-xs", "icon-sm", "icon", "icon-lg", "icon-touch"] as const

function ButtonFixture() {
  return (
    <Stack>
      {VARIANTS.map((variant) => (
        <Block key={variant} title={`${variant}: sizes`}>
          <Wrap>
            {SIZES.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {size}
              </Button>
            ))}
          </Wrap>
        </Block>
      ))}
      <Block title="Disabled">
        <Wrap>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} disabled>
              {variant}
            </Button>
          ))}
        </Wrap>
      </Block>
      <Block title="With icon">
        <Wrap>
          <Button>
            <PlusIcon data-icon="inline-start" />
            New invoice
          </Button>
          <Button variant="outline">
            Download
            <DownloadIcon data-icon="inline-end" />
          </Button>
          <Button variant="destructive">
            <Trash2Icon data-icon="inline-start" />
            Delete
          </Button>
        </Wrap>
      </Block>
      <Block title="Icon only: icon-xs, icon-sm, icon, icon-lg, icon-touch">
        <Wrap>
          {ICON_SIZES.map((size) => (
            <Button key={size} variant="outline" size={size} aria-label={`Settings (${size})`}>
              <SettingsIcon />
            </Button>
          ))}
        </Wrap>
      </Block>
      <Block title="Invalid">
        <Wrap>
          <Button variant="outline" aria-invalid>
            Pay now
          </Button>
        </Wrap>
      </Block>
      <Block title="Long label">
        <div className="flex">
          <Button variant="outline" className="h-auto min-h-8 max-w-full whitespace-normal py-1">
            <CreditCardIcon data-icon="inline-start" />
            Pay {LONG_NAME} the outstanding balance of ₹12,480.00
          </Button>
        </div>
      </Block>
    </Stack>
  )
}

// -------------------------------------------------------------------- calendar

/** The default cell size is 40px: let it scroll inside its box on a 320px screen, not the page. */
function Scroller({ children }: { children: ReactNode }) {
  return <div className="max-w-full overflow-x-auto">{children}</div>
}

function CalendarFixture() {
  const month = new Date(QA_NOW)
  return (
    <Stack>
      <Block title="Single date (today is 15 Jan 2026)">
        <Scroller>
          <Calendar
            mode="single"
            defaultMonth={month}
            selected={new Date(2026, 0, 21)}
            className="rounded-lg border border-border"
          />
        </Scroller>
      </Block>
      <Block title="Range, with disabled days">
        <Scroller>
          <Calendar
            mode="range"
            defaultMonth={month}
            selected={{ from: new Date(2026, 0, 8), to: new Date(2026, 0, 13) }}
            disabled={[{ before: new Date(2026, 0, 3) }, new Date(2026, 0, 26)]}
            className="rounded-lg border border-border"
          />
        </Scroller>
      </Block>
      <Block title="Dropdown caption, week numbers, no outside days">
        <Scroller>
          <Calendar
            mode="single"
            defaultMonth={month}
            captionLayout="dropdown"
            startMonth={new Date(2024, 0)}
            endMonth={new Date(2027, 11)}
            showWeekNumber
            showOutsideDays={false}
            className="rounded-lg border border-border"
          />
        </Scroller>
      </Block>
      <Block title="Two months">
        <Scroller>
          <Calendar
            mode="multiple"
            numberOfMonths={2}
            defaultMonth={month}
            selected={[new Date(2026, 0, 5), new Date(2026, 0, 19), new Date(2026, 1, 2)]}
            className="rounded-lg border border-border"
          />
        </Scroller>
      </Block>
    </Stack>
  )
}

// ------------------------------------------------------------------------ card

function CardFixture() {
  return (
    <Stack>
      <Block title="Header, action, content, footer">
        <Card>
          <CardHeader>
            <CardTitle>Northwind Ltd</CardTitle>
            <CardDescription>Vendor since March 2023, net 30 terms</CardDescription>
            <CardAction>
              <Badge variant="secondary">Active</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-text-secondary">
              12 open invoices totalling ₹3,18,250.00. Next payment is scheduled for 18 Jan 2026.
            </p>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button variant="outline">View ledger</Button>
            <Button>Pay now</Button>
          </CardFooter>
        </Card>
      </Block>
      <Block title="Small">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Monthly spend</CardTitle>
            <CardDescription>January 2026</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">₹48,250.50</p>
          </CardContent>
        </Card>
      </Block>
      <Block title="Small with footer">
        <Card size="sm">
          <CardContent>
            <p className="text-text-secondary">Content only, followed by a footer.</p>
          </CardContent>
          <CardFooter>
            <span className="text-xs text-text-muted">Updated 15 Jan 2026</span>
          </CardFooter>
        </Card>
      </Block>
      <Block title="Long title and description">
        <Card>
          <CardHeader>
            <CardTitle>{LONG_NAME}</CardTitle>
            <CardDescription>
              Consolidated statement of account covering all warehouses, regional depots and
              last-mile partners, reconciled against the bank feed through 14 Jan 2026.
            </CardDescription>
            <CardAction>
              <Badge variant="destructive">Overdue</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-text-secondary">Outstanding: ₹12,48,000.00</p>
          </CardContent>
        </Card>
      </Block>
      <Block title="No header">
        <Card>
          <CardContent>
            <p className="text-text-secondary">A card with only content.</p>
          </CardContent>
        </Card>
      </Block>
    </Stack>
  )
}

// ----------------------------------------------------------------------- chart

const MONTHLY = [
  { month: "Aug", income: 41200, spend: 28900 },
  { month: "Sep", income: 45800, spend: 31200 },
  { month: "Oct", income: 43100, spend: 36400 },
  { month: "Nov", income: 52600, spend: 33800 },
  { month: "Dec", income: 58900, spend: 44100 },
  { month: "Jan", income: 49700, spend: 30800 },
]

const chartConfig = {
  income: { label: "Income" },
  spend: { label: "Spend" },
} satisfies ChartConfig

function ChartFixture() {
  return (
    <Stack>
      <Block title="Bars with tooltip (dot) and legend">
        <ChartContainer config={chartConfig} className="aspect-[2/1] w-full">
          <BarChart data={MONTHLY}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <ChartTooltip defaultIndex={3} content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="income" fill="var(--color-income)" radius={4} isAnimationActive={false} />
            <Bar dataKey="spend" fill="var(--color-spend)" radius={4} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      </Block>
      <Block title="Lines with tooltip (line indicator)">
        <ChartContainer config={chartConfig} className="aspect-[2/1] w-full">
          <LineChart data={MONTHLY}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <ChartTooltip defaultIndex={4} content={<ChartTooltipContent indicator="line" />} />
            <Line
              dataKey="income"
              type="monotone"
              stroke="var(--color-income)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="spend"
              type="monotone"
              stroke="var(--color-spend)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </Block>
      <Block title="Area, single series, dashed indicator">
        <ChartContainer config={chartConfig} className="aspect-[2/1] w-full">
          <AreaChart data={MONTHLY}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <ChartTooltip
              defaultIndex={2}
              content={<ChartTooltipContent indicator="dashed" hideLabel />}
            />
            <Area
              dataKey="spend"
              type="monotone"
              stroke="var(--color-spend)"
              fill="var(--color-spend)"
              fillOpacity={0.2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </Block>
    </Stack>
  )
}

// -------------------------------------------------------------------- checkbox

function CheckRow({
  id,
  children,
  ...props
}: { id: string; children: ReactNode } & ComponentProps<typeof Checkbox>) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Checkbox id={`qa-check-${id}`} className="mt-[3px]" {...props} />
      <label htmlFor={`qa-check-${id}`} className="min-w-0">
        {children}
      </label>
    </div>
  )
}

function CheckboxFixture() {
  return (
    <Stack>
      <Block title="States">
        <div className="flex flex-col gap-3">
          <CheckRow id="off">Unchecked</CheckRow>
          <CheckRow id="on" defaultChecked>
            Checked
          </CheckRow>
          <CheckRow id="mixed" checked="indeterminate">
            Indeterminate
          </CheckRow>
          <CheckRow id="disabled" disabled>
            Disabled
          </CheckRow>
          <CheckRow id="disabled-on" disabled defaultChecked>
            Disabled and checked
          </CheckRow>
          <CheckRow id="invalid" aria-invalid>
            Invalid
          </CheckRow>
        </div>
      </Block>
      <Block title="Long label wraps">
        <CheckRow id="long" defaultChecked>
          I authorise {LONG_NAME} to debit ₹12,480.00 from the account ending 4821 on the due date
          of each invoice.
        </CheckRow>
      </Block>
      <Block title="Bare, no label">
        <Wrap>
          <Checkbox aria-label="Unchecked" />
          <Checkbox aria-label="Checked" defaultChecked />
        </Wrap>
      </Block>
    </Stack>
  )
}

// -------------------------------------------------------------------- combobox

const VENDOR_GROUPS = [
  { value: "Recent", items: ["Northwind Ltd", "Contoso Traders", "Fabrikam Supplies"] },
  {
    value: "All vendors",
    items: ["Adventure Works Cycles", "Litware Systems", "Tailspin Toys", LONG_NAME],
  },
]
const VENDORS = VENDOR_GROUPS.flatMap((g) => g.items)

function VendorList() {
  return (
    <ComboboxContent>
      <ComboboxEmpty>No vendors found.</ComboboxEmpty>
      <ComboboxList>
        {(group: (typeof VENDOR_GROUPS)[number]) => (
          <ComboboxGroup key={group.value} items={group.items}>
            <ComboboxLabel>{group.value}</ComboboxLabel>
            <ComboboxCollection>
              {(item: string) => (
                <ComboboxItem key={item} value={item}>
                  <span className="min-w-0 truncate">{item}</span>
                </ComboboxItem>
              )}
            </ComboboxCollection>
            {group.value === "Recent" && <ComboboxSeparator />}
          </ComboboxGroup>
        )}
      </ComboboxList>
    </ComboboxContent>
  )
}

function ComboboxChipsDemo() {
  const anchor = useComboboxAnchor()
  return (
    <Combobox
      multiple
      items={VENDORS}
      defaultValue={["Northwind Ltd", "Contoso Traders", "Tailspin Toys"]}
    >
      <ComboboxChips ref={anchor}>
        <ComboboxValue>
          {(values: string[]) => (
            <>
              {values.map((value) => (
                <ComboboxChip key={value}>{value}</ComboboxChip>
              ))}
              <ComboboxChipsInput placeholder="Add vendor" />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
    </Combobox>
  )
}

function ComboboxFixture() {
  return (
    <div className="flex min-h-[32rem] min-w-0 flex-col gap-6">
      <Block title="Closed, with value and clear">
        <Combobox items={VENDORS} defaultValue="Northwind Ltd">
          <ComboboxInput placeholder="Select a vendor" showClear />
        </Combobox>
      </Block>
      <Block title="Disabled">
        <Combobox items={VENDORS} disabled>
          <ComboboxInput placeholder="Select a vendor" disabled />
        </Combobox>
      </Block>
      <Block title="Multiple, as chips">
        <ComboboxChipsDemo />
      </Block>
      <Block title="Open: groups, separator, selected item, a long name">
        <Combobox items={VENDOR_GROUPS} open defaultValue="Contoso Traders">
          <ComboboxInput placeholder="Select a vendor" />
          <VendorList />
        </Combobox>
      </Block>
    </div>
  )
}

// --------------------------------------------------------------------- command

function CommandFixture() {
  return (
    <Stack>
      <Block title="Palette: groups, icons, shortcuts, disabled, long label">
        <div className="h-[22rem] overflow-hidden rounded-xl border border-border">
          <Command defaultValue="new-invoice">
            <CommandInput aria-label="Search commands" placeholder="Type a command or search…" />
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandList>
              <CommandGroup heading="Suggestions">
                <CommandItem value="new-invoice" shortcut="mod+n">
                  <PlusIcon />
                  New invoice
                  <CommandShortcut />
                </CommandItem>
                <CommandItem value="pay-vendor">
                  <CreditCardIcon />
                  Pay a vendor
                </CommandItem>
                <CommandItem value="export" disabled>
                  <DownloadIcon />
                  Export statement (no data yet)
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Go to">
                <CommandItem value="vendors">
                  <UserIcon />
                  Vendors
                </CommandItem>
                <CommandItem value="settings" shortcut="mod+,">
                  <SettingsIcon />
                  Settings
                  <CommandShortcut />
                </CommandItem>
                <CommandItem value="long">
                  <FileTextIcon />
                  <span className="min-w-0 truncate">{LONG_NAME}: statement of account</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </Block>
      <Block title="Empty result">
        <div className="overflow-hidden rounded-xl border border-border">
          <Command defaultQuery="zzz">
            <CommandInput aria-label="Search commands" placeholder="Type a command or search…" />
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandList>
              <CommandGroup heading="Go to">
                <CommandItem value="vendors">Vendors</CommandItem>
                <CommandItem value="invoices">Invoices</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </Block>
    </Stack>
  )
}

// ------------------------------------------------------------------- data-grid

type LedgerRow = {
  id: string
  vendor: string
  amount: number
  status: string
  due: string
  approved: boolean
  ref: string
}

const LEDGER: LedgerRow[] = [
  {
    id: "r1",
    vendor: "Northwind Ltd",
    amount: 12480,
    status: "paid",
    due: "2026-01-05",
    approved: true,
    ref: "INV-2038",
  },
  {
    id: "r2",
    vendor: "Contoso Traders",
    amount: 86250.5,
    status: "open",
    due: "2026-01-18",
    approved: true,
    ref: "INV-2041",
  },
  {
    id: "r3",
    vendor: "Fabrikam Supplies",
    amount: 4300,
    status: "overdue",
    due: "2025-12-29",
    approved: false,
    ref: "INV-2029",
  },
  {
    id: "r4",
    vendor: LONG_NAME,
    amount: 1248000,
    status: "open",
    due: "2026-02-02",
    approved: false,
    ref: "INV-2044",
  },
  {
    id: "r5",
    vendor: "Adventure Works Cycles",
    amount: 19990,
    status: "paid",
    due: "2025-12-20",
    approved: true,
    ref: "INV-2022",
  },
  {
    id: "r6",
    vendor: "Litware Systems",
    amount: 7525.75,
    status: "open",
    due: "2026-01-25",
    approved: true,
    ref: "INV-2046",
  },
  {
    id: "r7",
    vendor: "Tailspin Toys",
    amount: 310,
    status: "overdue",
    due: "2026-01-02",
    approved: false,
    ref: "INV-2033",
  },
]

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
]

const gridColumns: DataGridColumn<LedgerRow>[] = [
  { id: "ref", header: "Reference", width: 110, editable: false },
  { id: "vendor", header: "Vendor", width: 240 },
  {
    id: "amount",
    header: "Amount",
    type: "number",
    width: 140,
    format: (value) => inr.format(value as number),
  },
  { id: "status", header: "Status", type: "select", options: STATUS_OPTIONS, width: 120 },
  { id: "due", header: "Due", type: "date", width: 130 },
  { id: "approved", header: "Approved", type: "checkbox", width: 100 },
]

function DataGridFixture() {
  return (
    <Stack>
      <Block title="Editable grid: text, number, select, date, checkbox; two rows selected">
        <DataGrid
          aria-label="Vendor ledger"
          columns={gridColumns}
          rows={LEDGER}
          getRowId={(row) => row.id}
          onChange={() => undefined}
          selectable
          selectedRowIds={["r2", "r4"]}
          onSelectedRowIdsChange={() => undefined}
          height={320}
        />
      </Block>
      <Block title="Read-only, no selection">
        <DataGrid
          aria-label="Vendor ledger, read-only"
          columns={gridColumns}
          rows={LEDGER.slice(0, 3)}
          getRowId={(row) => row.id}
          height={170}
        />
      </Block>
      <Block title="Empty">
        <DataGrid
          aria-label="Empty ledger"
          columns={gridColumns}
          rows={[]}
          getRowId={(row) => row.id}
          height={140}
        />
      </Block>
    </Stack>
  )
}

// ------------------------------------------------------------------ data-table

const tableColumns: DataTableProps<LedgerRow>["columns"] = [
  { accessorKey: "ref", header: "Reference", size: 120 },
  {
    accessorKey: "vendor",
    header: "Vendor",
    size: 240,
    meta: { filter: "text", filterLabel: "Vendor" },
    cell: ({ getValue }) => <TruncatedCell>{String(getValue())}</TruncatedCell>,
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 120,
    meta: { filter: "facet", filterLabel: "Status" },
    cell: ({ getValue }) => {
      const status = String(getValue())
      return <Badge variant={status === "overdue" ? "destructive" : "secondary"}>{status}</Badge>
    },
  },
  {
    accessorKey: "amount",
    header: "Amount",
    size: 150,
    cell: ({ getValue }) => <span className="tabular-nums">{inr.format(Number(getValue()))}</span>,
  },
  { accessorKey: "due", header: "Due", size: 120 },
]

function DataTableFixture() {
  return (
    <Stack>
      <Block title="Toolbar (search, filters, columns, export), sorting, two rows selected, bulk bar">
        <DataTable
          columns={tableColumns}
          data={LEDGER}
          getRowId={(row) => row.id}
          sortable
          searchable
          columnsMenu
          exportFilename="vendor-ledger"
          defaultView={{
            filters: [],
            sorting: [{ id: "amount", desc: true }],
            columnVisibility: {},
            search: "",
          }}
          selectable
          selectedRowIds={["r2", "r4"]}
          onSelectedRowIdsChange={() => undefined}
          bulkActions={(rows) => (
            <Button size="xs" variant="outline">
              Pay {rows.length} invoices
            </Button>
          )}
          onRowClick={() => undefined}
          getRowLabel={(row) => `Open ${row.ref} from ${row.vendor}`}
          activeRowId="r3"
        />
      </Block>
      <Block title="Plain">
        <DataTable columns={tableColumns.slice(0, 2)} data={LEDGER.slice(0, 3)} />
      </Block>
      <Block title="Empty">
        <DataTable
          columns={tableColumns}
          data={[]}
          searchable
          emptyMessage="No invoices match this view."
        />
      </Block>
      <Block title="Loading">
        <DataTable columns={tableColumns} data={[]} loading />
      </Block>
      <Block title="Error">
        <DataTable
          columns={tableColumns}
          data={[]}
          error={{ message: "The ledger could not be loaded.", onRetry: () => undefined }}
        />
      </Block>
    </Stack>
  )
}

export const uiA = {
  "alert-dialog": () => <AlertDialogFixture />,
  alert: () => <AlertFixture />,
  "answer-headline": () => <AnswerHeadlineFixture />,
  avatar: () => <AvatarFixture />,
  badge: () => <BadgeFixture />,
  breadcrumb: () => <BreadcrumbFixture />,
  button: () => <ButtonFixture />,
  calendar: () => <CalendarFixture />,
  card: () => <CardFixture />,
  chart: () => <ChartFixture />,
  checkbox: () => <CheckboxFixture />,
  combobox: () => <ComboboxFixture />,
  command: () => <CommandFixture />,
  "data-grid": () => <DataGridFixture />,
  "data-table": () => <DataTableFixture />,
} satisfies Fixtures
