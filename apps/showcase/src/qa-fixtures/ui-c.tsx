import { Button } from "@dapplelight/signet-ui/components/button"
import { Input } from "@dapplelight/signet-ui/components/input"
import { Label } from "@dapplelight/signet-ui/components/label"
import { PillGroup } from "@dapplelight/signet-ui/components/pill-group"
import { Popover, PopoverContent, PopoverTrigger } from "@dapplelight/signet-ui/components/popover"
import {
  MASKED_VALUE,
  MaskToggle,
  PrivacyMaskProvider,
  RatioFill,
  RatioProgress,
  RatioText,
  usePrivacyMask,
} from "@dapplelight/signet-ui/components/privacy-mask"
import { Progress, ProgressLabel, ProgressValue } from "@dapplelight/signet-ui/components/progress"
import { RadioGroup, RadioGroupItem } from "@dapplelight/signet-ui/components/radio-group"
import { ResponsiveSheet } from "@dapplelight/signet-ui/components/responsive-sheet"
import { RichTextContent, RichTextEditor } from "@dapplelight/signet-ui/components/rich-text-editor"
import { SchemaForm } from "@dapplelight/signet-ui/components/schema-form"
import { SearchInput } from "@dapplelight/signet-ui/components/search-input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@dapplelight/signet-ui/components/select"
import { ShortcutsHelp, useListNavigation } from "@dapplelight/signet-ui/components/shortcuts"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@dapplelight/signet-ui/components/sidebar"
import { Skeleton } from "@dapplelight/signet-ui/components/skeleton"
import { SkipLink } from "@dapplelight/signet-ui/components/skip-link"
import { Slider } from "@dapplelight/signet-ui/components/slider"
import { TooltipProvider } from "@dapplelight/signet-ui/components/tooltip"
import {
  BuildingIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  ReceiptIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { type Fixtures, QA_NOW } from "./shared"

const LONG_NAME = "Northwind Logistics and Freight Forwarding Private Limited – Western Region"
const noop = () => {}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium tracking-wide text-text-muted uppercase">{title}</h2>
      {children}
    </section>
  )
}

// --- pill-group -------------------------------------------------------------

const statusOptions = [
  { value: "", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "due", label: "Due" },
  { value: "overdue", label: "Overdue" },
  { value: "draft", label: "Draft" },
]

const longOptions = [
  { value: "mine", label: "Assigned to me" },
  {
    value: "regional",
    label: "Awaiting approval from the regional finance controller (Northwind Logistics)",
  },
  { value: "archived", label: "Archived" },
]

function PillGroupFixture() {
  return (
    <div className="space-y-6">
      <Section title="First option active">
        <PillGroup options={statusOptions} value="" onChange={noop} />
      </Section>
      <Section title="Middle option active">
        <PillGroup options={statusOptions} value="due" onChange={noop} />
      </Section>
      <Section title="Custom active class">
        <PillGroup
          options={[
            {
              value: "paid",
              label: "Paid",
              activeClassName: "border-accent-green/40 bg-accent-green-subtle text-text-primary",
            },
            {
              value: "due",
              label: "Due",
              activeClassName: "border-accent-amber/40 bg-accent-amber-subtle text-text-primary",
            },
            {
              value: "overdue",
              label: "Overdue",
              activeClassName: "border-accent-red/40 bg-accent-red-subtle text-text-primary",
            },
          ]}
          value="overdue"
          onChange={noop}
        />
      </Section>
      <Section title="Long label wraps">
        <PillGroup options={longOptions} value="regional" onChange={noop} />
      </Section>
    </div>
  )
}

// --- popover ----------------------------------------------------------------

function PopoverFixture() {
  return (
    <div className="min-h-96">
      <Popover open>
        <PopoverTrigger asChild>
          <Button variant="outline">Filters</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Filter invoices</h3>
            <p className="text-xs text-text-secondary">
              Show only invoices that match all of these.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-popover-customer">Customer</Label>
            <Input id="qa-popover-customer" defaultValue="Northwind Ltd" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-popover-min">Minimum amount</Label>
            <Input id="qa-popover-min" defaultValue="₹12,480.00" />
          </div>
          <p className="truncate text-xs text-text-muted" title={LONG_NAME}>
            Last viewed: {LONG_NAME}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm">
              Reset
            </Button>
            <Button size="sm">Apply</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

// --- privacy-mask -----------------------------------------------------------

function Amount({ children }: { children: string }) {
  const { masked } = usePrivacyMask()
  return <span className="tabular-nums">{masked ? MASKED_VALUE : children}</span>
}

function PrivacyPanel({ masked, title }: { masked: boolean; title: string }) {
  return (
    <PrivacyMaskProvider masked={masked} storageKey={false}>
      <div className="space-y-3 rounded-lg border border-border-default bg-bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          <MaskToggle shortcut="Shift+H" />
        </div>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-text-secondary">Balance</dt>
            <dd>
              <Amount>₹12,480.00</Amount>
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="min-w-0 truncate text-text-secondary">{LONG_NAME}</dt>
            <dd className="shrink-0">
              <Amount>₹2,31,950.50</Amount>
            </dd>
          </div>
        </dl>
        <p className="text-xs text-text-secondary">
          <RatioText>73% of the monthly budget used, up +12.5% on December</RatioText>
        </p>
        <RatioProgress value={73}>
          <ProgressLabel>Groceries budget</ProgressLabel>
          <ProgressValue />
        </RatioProgress>
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-elevated">
          <RatioFill pct={73} className="h-full rounded-full bg-primary" />
        </div>
      </div>
    </PrivacyMaskProvider>
  )
}

function PrivacyMaskFixture() {
  return (
    <div className="space-y-4">
      <PrivacyPanel masked={false} title="Values showing" />
      <PrivacyPanel masked title="Values masked" />
    </div>
  )
}

// --- progress ---------------------------------------------------------------

function ProgressFixture() {
  return (
    <div className="space-y-6">
      <Progress value={0}>
        <ProgressLabel>Not started</ProgressLabel>
        <ProgressValue />
      </Progress>
      <Progress value={35}>
        <ProgressLabel>Invoices sent</ProgressLabel>
        <ProgressValue />
      </Progress>
      <Progress value={72}>
        <ProgressLabel>Quarter targets</ProgressLabel>
        <ProgressValue />
      </Progress>
      <Progress value={100}>
        <ProgressLabel>Reconciliation complete</ProgressLabel>
        <ProgressValue />
      </Progress>
      <Progress value={48} className="[&_[data-slot=progress-track]]:h-2">
        <ProgressLabel>Thicker track</ProgressLabel>
        <ProgressValue />
      </Progress>
      <Progress value={64}>
        <ProgressLabel className="min-w-0 flex-1 truncate">
          Importing statements from {LONG_NAME} and 14 other linked accounts
        </ProgressLabel>
        <ProgressValue />
      </Progress>
      <Progress value={55} aria-label="Track only, no label" />
    </div>
  )
}

// --- radio-group ------------------------------------------------------------

function RadioGroupFixture() {
  return (
    <div className="space-y-6">
      <Section title="Selected option">
        <RadioGroup aria-label="Billing cycle" defaultValue="yearly">
          <Label>
            <RadioGroupItem value="monthly" />
            Monthly, ₹1,040.00 per month
          </Label>
          <Label>
            <RadioGroupItem value="yearly" />
            Yearly, ₹12,480.00 per year
          </Label>
          <Label>
            <RadioGroupItem value="lifetime" disabled />
            Lifetime (unavailable)
          </Label>
        </RadioGroup>
      </Section>
      <Section title="Nothing selected">
        <RadioGroup aria-label="Delivery">
          <Label>
            <RadioGroupItem value="email" />
            Email
          </Label>
          <Label>
            <RadioGroupItem value="post" />
            Post
          </Label>
        </RadioGroup>
      </Section>
      <Section title="Long label wraps">
        <RadioGroup aria-label="Payee" defaultValue="long">
          <Label className="items-start leading-snug">
            <RadioGroupItem value="long" className="mt-0.5" />
            {LONG_NAME}, remit to the registered office
          </Label>
          <Label>
            <RadioGroupItem value="short" />
            Northwind Ltd
          </Label>
        </RadioGroup>
      </Section>
    </div>
  )
}

// --- responsive-sheet -------------------------------------------------------

function ResponsiveSheetFixture() {
  return (
    <ResponsiveSheet
      title="Add expense"
      description="Record a spend against a vendor. You can attach the receipt later."
      onClose={noop}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="qa-sheet-vendor">Vendor</Label>
          <Input id="qa-sheet-vendor" defaultValue="Northwind Ltd" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qa-sheet-amount">Amount</Label>
          <Input id="qa-sheet-amount" defaultValue="₹12,480.00" inputMode="decimal" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qa-sheet-note">Note</Label>
          <Input id="qa-sheet-note" defaultValue={`Freight charges, ${LONG_NAME}`} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline">Cancel</Button>
          <Button>Save expense</Button>
        </div>
      </div>
    </ResponsiveSheet>
  )
}

// --- rich-text-editor -------------------------------------------------------

const RICH_MARKDOWN = [
  "## Q1 reconciliation",
  "",
  "Please review the **Northwind Ltd** invoice _INV-2041_ for ₹12,480.00 before Friday. cc @[Priya Raman](user:u_priya)",
  "",
  "### Checklist",
  "",
  "- Match against the bank feed",
  "- Flag anything over `₹5,000.00`",
  "",
  "1. Approve",
  "2. Send the remittance advice",
  "",
  "```",
  "INV-2041  ₹12,480.00  Net 30",
  "```",
  "",
  "Read the [payment policy](https://example.com/policy) first.",
].join("\n")

function RichTextEditorFixture() {
  return (
    <div className="space-y-6">
      <Section title="Full toolbar, with content">
        <RichTextEditor aria-label="Review notes" defaultValue={RICH_MARKDOWN} />
      </Section>
      <Section title="Empty, placeholder, three formats">
        <RichTextEditor
          aria-label="Short comment"
          placeholder="Write a comment..."
          formats={["bold", "italic", "link"]}
        />
      </Section>
      <Section title="Disabled">
        <RichTextEditor
          aria-label="Locked notes"
          disabled
          defaultValue="Locked while the invoice is **being reconciled**."
        />
      </Section>
      <Section title="Long text wraps">
        <RichTextEditor
          aria-label="Vendor note"
          formats={["bold", "italic"]}
          defaultValue={`Remit to ${LONG_NAME} within thirty days of the invoice date, quoting the purchase order number printed on the delivery note.`}
        />
      </Section>
      <Section title="RichTextContent (read-only)">
        <div className="rounded-lg border border-border-default bg-bg-surface p-4">
          <RichTextContent value={RICH_MARKDOWN} />
        </div>
      </Section>
    </div>
  )
}

// --- schema-form ------------------------------------------------------------

type SchemaFormSchema = Parameters<typeof SchemaForm>[0]["schema"]

// A hand-written AutoForm SchemaProvider: the showcase has no zod dependency, and a
// provider is what SchemaForm builds from a zod schema anyway.
const expenseSchema: SchemaFormSchema = {
  parseSchema: () => ({
    fields: [
      { key: "vendor", type: "string", required: true, fieldConfig: { label: "Vendor" } },
      {
        key: "amount",
        type: "number",
        required: true,
        fieldConfig: { label: "Amount (INR)", description: "Including GST" },
      },
      { key: "date", type: "date", required: true, fieldConfig: { label: "Invoice date" } },
      {
        key: "category",
        type: "select",
        required: true,
        options: [
          ["freight", "Freight"],
          ["software", "Software"],
          ["travel", "Travel"],
        ],
        fieldConfig: { label: "Category" },
      },
      {
        key: "note",
        type: "string",
        required: false,
        fieldConfig: {
          fieldType: "textarea",
          label: `Internal note for the finance team about ${LONG_NAME} and its supporting documents`,
          description: "Not shown to the vendor",
        },
      },
      {
        key: "reimbursable",
        type: "boolean",
        required: false,
        fieldConfig: { label: "Reimbursable" },
      },
      {
        key: "billing",
        type: "object",
        required: false,
        fieldConfig: { label: "Billing details" },
        schema: [
          { key: "gstin", type: "string", required: true, fieldConfig: { label: "GSTIN" } },
          { key: "city", type: "string", required: false, fieldConfig: { label: "City" } },
        ],
      },
    ],
  }),
  validateSchema: (values) => ({ success: true, data: values }),
  getDefaultValues: () => ({
    vendor: "Northwind Ltd",
    amount: 12480,
    date: new Date(QA_NOW),
    category: "freight",
    note: "Pallet delivery to the Pune warehouse.",
    reimbursable: true,
    billing: { gstin: "27AAAAA0000A1Z5", city: "Pune" },
  }),
}

function SchemaFormFixture() {
  return <SchemaForm schema={expenseSchema} onSubmit={noop} submit="Save expense" />
}

// --- search-input -----------------------------------------------------------

function SearchInputFixture() {
  return (
    <div className="max-w-sm space-y-6">
      <Section title="Empty with placeholder">
        <SearchInput aria-label="Search invoices" placeholder="Search invoices" />
      </Section>
      <Section title="With a query">
        <SearchInput aria-label="Search customers" defaultValue="Northwind" />
      </Section>
      <Section title="Long query">
        <SearchInput aria-label="Search vendors" defaultValue={LONG_NAME} />
      </Section>
      <Section title="Disabled">
        <SearchInput aria-label="Search archive" placeholder="Search archive" disabled />
      </Section>
    </div>
  )
}

// --- select -----------------------------------------------------------------

const taxItems = [
  { value: "gst-0", label: "GST 0%" },
  { value: "gst-5", label: "GST 5%" },
  { value: "gst-18", label: "GST 18%" },
  { value: "gst-28", label: "GST 28%" },
  { value: "exempt", label: "Exempt supply" },
  { value: "long", label: `${LONG_NAME}, reverse charge applies` },
]

function SelectFixture() {
  return (
    <TooltipProvider>
      <div className="max-w-xs space-y-6">
        <Section title="Default, sm, disabled, invalid, placeholder">
          <div className="space-y-2">
            <Select defaultValue="gst-18" items={taxItems}>
              <SelectTrigger className="w-full" aria-label="Tax rate">
                <SelectValue />
              </SelectTrigger>
            </Select>
            <Select defaultValue="gst-5" items={taxItems}>
              <SelectTrigger size="sm" className="w-full" aria-label="Tax rate, small">
                <SelectValue />
              </SelectTrigger>
            </Select>
            <Select defaultValue="gst-0" items={taxItems} disabled>
              <SelectTrigger className="w-full" aria-label="Tax rate, disabled">
                <SelectValue />
              </SelectTrigger>
            </Select>
            <Select items={taxItems}>
              <SelectTrigger className="w-full" aria-invalid aria-label="Tax rate, invalid">
                <SelectValue placeholder="Choose a tax rate" />
              </SelectTrigger>
            </Select>
            <Select defaultValue="long" items={taxItems}>
              <SelectTrigger className="w-full" aria-label="Tax rate, long value">
                <SelectValue />
              </SelectTrigger>
            </Select>
          </div>
        </Section>
        <Section title="Open list">
          <div className="min-h-96">
            <Select open defaultValue="gst-18" items={taxItems}>
              <SelectTrigger className="w-full" aria-label="Tax rate, open">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectLabel>GST slabs</SelectLabel>
                  <SelectItem value="gst-0">GST 0%</SelectItem>
                  <SelectItem value="gst-5">GST 5%</SelectItem>
                  <SelectItem value="gst-18">GST 18%</SelectItem>
                  <SelectItem value="gst-28" disabled>
                    GST 28% (disabled)
                  </SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Other</SelectLabel>
                  <SelectItem value="exempt">Exempt supply</SelectItem>
                  <SelectItem value="long">{LONG_NAME}, reverse charge applies</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </Section>
      </div>
    </TooltipProvider>
  )
}

// --- shortcuts --------------------------------------------------------------

// Registers j/k/Enter under the "Invoices" group so the overlay has something to list.
function InvoiceHotkeys() {
  useListNavigation({
    ids: ["inv-2041", "inv-2042", "inv-2043"],
    activeId: "inv-2041",
    onOpen: noop,
    arrows: true,
    group: "Invoices",
  })
  return null
}

function ShortcutsFixture() {
  return (
    <>
      <InvoiceHotkeys />
      <p className="text-sm text-text-secondary">
        Invoices: INV-2041, INV-2042 and INV-2043 for Northwind Ltd.
      </p>
      <ShortcutsHelp open onOpenChange={noop} />
    </>
  )
}

// --- sidebar ----------------------------------------------------------------

// A viewport query that always matches, so the panel renders at any width instead of the
// phone drawer.
const ALWAYS_DESKTOP = "(min-width: 0px)"

function NavMenu() {
  return (
    <>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1 text-sm font-medium">
          <BuildingIcon className="size-4 shrink-0" />
          <span className="truncate">Northwind Ltd</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive>
                <LayoutDashboardIcon />
                <span>Overview</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton render={<a href="#invoices" />}>
                <ReceiptIcon />
                <span>Invoices</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <UsersIcon />
                <span>Customers</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <FileTextIcon />
                <span>{LONG_NAME}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <SettingsIcon />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton disabled>
                <ReceiptIcon />
                <span>Billing (disabled)</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="truncate px-2 text-xs text-text-muted">Priya Raman · Finance</p>
      </SidebarFooter>
    </>
  )
}

function SidebarFixture() {
  return (
    <div className="space-y-6">
      <Section title="Expanded">
        <div className="h-[460px] overflow-hidden rounded-lg border border-border-default">
          <SidebarProvider shortcut={null} desktopQuery={ALWAYS_DESKTOP} className="h-full min-h-0">
            <Sidebar className="h-full w-full sm:w-64">
              <NavMenu />
            </Sidebar>
            <SidebarInset>
              <header className="flex items-center gap-2 border-b border-border-default p-2">
                <SidebarTrigger />
                <span className="text-sm font-medium">Overview</span>
              </header>
              <div className="space-y-2 p-4">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-24 w-full" />
              </div>
            </SidebarInset>
          </SidebarProvider>
        </div>
      </Section>
      <Section title="Collapsed to icons">
        <div className="h-[360px] overflow-hidden rounded-lg border border-border-default">
          <SidebarProvider
            shortcut={null}
            defaultOpen={false}
            desktopQuery={ALWAYS_DESKTOP}
            className="h-full min-h-0"
          >
            <Sidebar className="h-full">
              <NavMenu />
            </Sidebar>
            <SidebarInset>
              <header className="flex items-center gap-2 border-b border-border-default p-2">
                <SidebarTrigger />
              </header>
            </SidebarInset>
          </SidebarProvider>
        </div>
      </Section>
    </div>
  )
}

// --- skeleton ---------------------------------------------------------------

function SkeletonFixture() {
  return (
    <div className="space-y-8">
      <Section title="Text lines">
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </Section>
      <Section title="Avatar and name">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-24 max-w-full" />
          </div>
        </div>
      </Section>
      <Section title="Card">
        <div className="space-y-3 rounded-lg border border-border-default bg-bg-base p-4">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-32 w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      </Section>
      <Section title="Table rows">
        <div className="space-y-2">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

// --- skip-link --------------------------------------------------------------

function FocusedSkipLink() {
  // Focus it on mount so the screenshot shows the real focused state.
  return <SkipLink ref={(el) => el?.focus()} />
}

function SkipLinkFixture() {
  return (
    <div className="space-y-6 pt-16">
      <FocusedSkipLink />
      <p className="text-sm text-text-secondary">
        The link above is focused, as after the first Tab press. It is hidden otherwise.
      </p>
      <Section title="Forced visible, custom text and target">
        <SkipLink
          target="invoices"
          className="not-sr-only inline-block rounded-lg bg-bg-elevated px-3 py-2 text-sm font-medium text-text-primary shadow-md"
        >
          Skip to the invoice list
        </SkipLink>
      </Section>
      <main id="main" tabIndex={-1} className="outline-none">
        <p className="text-sm">Invoices for Northwind Ltd</p>
      </main>
    </div>
  )
}

// --- slider -----------------------------------------------------------------

function SliderRow({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children: ReactNode
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="min-w-0 text-text-secondary">{label}</span>
        <span className="shrink-0 tabular-nums">{value}</span>
      </div>
      {children}
    </div>
  )
}

type SliderProps = ComponentProps<typeof Slider>

function SliderFixture() {
  const common: Partial<SliderProps> = { min: 0, max: 100 }
  return (
    <div className="space-y-8 px-2">
      <SliderRow label="Single value" value="40">
        <Slider {...common} defaultValue={[40]} aria-label="Credit limit used" />
      </SliderRow>
      <SliderRow label="Range" value="₹5,000.00 to ₹12,480.00">
        <Slider min={0} max={20000} step={500} defaultValue={[5000, 12480]} />
      </SliderRow>
      <SliderRow label="At the minimum" value="0">
        <Slider {...common} defaultValue={[0]} aria-label="Discount" />
      </SliderRow>
      <SliderRow label="At the maximum" value="100">
        <Slider {...common} defaultValue={[100]} aria-label="Completion" />
      </SliderRow>
      <SliderRow label="Disabled" value="65">
        <Slider {...common} defaultValue={[65]} disabled aria-label="Locked allocation" />
      </SliderRow>
      <SliderRow label={`Reserve allocation for ${LONG_NAME}`} value="25">
        <Slider {...common} defaultValue={[25]} aria-label="Reserve allocation" />
      </SliderRow>
      <div className="h-40">
        <Slider orientation="vertical" defaultValue={[60]} aria-label="Volume" />
      </div>
    </div>
  )
}

export const uiC = {
  "pill-group": () => <PillGroupFixture />,
  popover: () => <PopoverFixture />,
  "privacy-mask": () => <PrivacyMaskFixture />,
  progress: () => <ProgressFixture />,
  "radio-group": () => <RadioGroupFixture />,
  "responsive-sheet": () => <ResponsiveSheetFixture />,
  "rich-text-editor": () => <RichTextEditorFixture />,
  "schema-form": () => <SchemaFormFixture />,
  "search-input": () => <SearchInputFixture />,
  select: () => <SelectFixture />,
  shortcuts: () => <ShortcutsFixture />,
  sidebar: () => <SidebarFixture />,
  skeleton: () => <SkeletonFixture />,
  "skip-link": () => <SkipLinkFixture />,
  slider: () => <SliderFixture />,
} satisfies Fixtures
