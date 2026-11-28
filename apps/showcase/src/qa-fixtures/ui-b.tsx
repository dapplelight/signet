import { Button } from "@dapplelight/signet-ui/components/button"
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
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@dapplelight/signet-ui/components/drawer"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@dapplelight/signet-ui/components/dropdown-menu"
import { DEFAULT_EMOJIS, EmojiPicker } from "@dapplelight/signet-ui/components/emoji-picker"
import { EmptyState } from "@dapplelight/signet-ui/components/empty-state"
import { ErrorState } from "@dapplelight/signet-ui/components/error-state"
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@dapplelight/signet-ui/components/field"
import { Input } from "@dapplelight/signet-ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@dapplelight/signet-ui/components/input-group"
import { Fold } from "@dapplelight/signet-ui/components/fold"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@dapplelight/signet-ui/components/input-otp"
import { Kbd, KeySequence } from "@dapplelight/signet-ui/components/kbd"
import { Label } from "@dapplelight/signet-ui/components/label"
import { LogoStack, type LogoStackMarkData } from "@dapplelight/signet-ui/components/logo-stack"
import {
  DEFAULT_ID_PREFIX,
  Markdown,
  MarkdownToc,
} from "@dapplelight/signet-ui/components/markdown"
import {
  MetricHeadline,
  MetricHeadlineRoot,
  MetricHeadlineSentence,
  MetricHeadlineTrend,
  MetricHeadlineValue,
} from "@dapplelight/signet-ui/components/metric-headline"
import { Pagination } from "@dapplelight/signet-ui/components/pagination"
import { Popover, PopoverContent, PopoverTrigger } from "@dapplelight/signet-ui/components/popover"
import {
  CopyIcon,
  FileTextIcon,
  InboxIcon,
  MailIcon,
  MoreHorizontalIcon,
  SearchIcon,
  TrashIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import type { Fixtures } from "./shared"

const noop = () => {}

/** A labelled block, so one item can stack several states. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-2">
      <h2 className="text-xs font-medium tracking-wider text-text-muted uppercase">{title}</h2>
      {children}
    </section>
  )
}

type LogoMark = LogoStackMarkData

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(body)}`
const logo = (letter: string, fill: string): LogoMark => ({
  src: svg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${fill}"/><text x="16" y="22.5" font-family="sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`,
  ),
  alt: `${letter} project`,
})
const darkLogo = (letter: string): LogoMark => ({
  src: svg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text x="16" y="24" font-family="sans-serif" font-size="26" font-weight="800" text-anchor="middle" fill="#111">${letter}</text></svg>`,
  ),
  alt: `${letter} project`,
  lightTile: true,
})
const LOGOS: LogoMark[] = [
  logo("A", "#2563eb"),
  logo("G", "#059669"),
  logo("H", "#d97706"),
  logo("I", "#7c3aed"),
  logo("U", "#dc2626"),
  logo("S", "#0891b2"),
]
const DARK_LOGOS: LogoMark[] = [darkLogo("N"), darkLogo("V")]

const LONG_NAME ="Northwind Ltd Quarterly Settlement Account for Regional Distribution Partners"

const MARKDOWN = [
  "# Settlement report",
  "",
  "Prepared for **Northwind Ltd** on *15 January 2026*. See the [ledger](https://example.com/ledger) or the [overview](/overview).",
  "",
  "## Summary",
  "",
  "Total settled this quarter: ₹12,480.00 across 42 invoices, with ~~3 disputed~~ 1 still open.",
  "",
  "- Domestic transfers cleared",
  "- Cross-border transfers pending review",
  "  - Awaiting bank confirmation",
  "",
  "1. Reconcile the ledger",
  "2. Approve the batch",
  "3. Archive the statements",
  "",
  "### Checklist",
  "",
  "- [x] Invoices matched",
  "- [ ] Disputes closed",
  "",
  "> Settlements below ₹500.00 are rolled into the next cycle.",
  "",
  "## Breakdown by regional distribution partner and the quarter in which it was settled",
  "",
  "| Partner | Invoices | Amount |",
  "| --- | --- | --- |",
  "| Northwind Ltd | 24 | ₹8,120.00 |",
  "| Contoso Traders | 18 | ₹4,360.00 |",
  "",
  "```ts",
  "const total = invoices.reduce((sum, i) => sum + i.amount, 0)",
  "```",
  "",
  "Use `settle()` to close the batch.",
  "",
  "![Settlement chart](https://example.com/chart.png)",
  "",
  '<script>alert("dropped")</script>',
  "",
  "---",
  "",
  "#### Notes",
  "",
  "A [bad link](javascript:alert(1)) keeps its text but loses the link.",
].join("\n")

const FOLD_NOTES = `Changed \`packages/ui\` only.

- Added the **Fold** component and its tests
- Reused \`Markdown\` for the body, so links and lists render safely
- Left every existing component as it was

Run \`bun run test\` in \`packages/ui\` to check it.`

export const uiB = {
  dialog: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm transfer to {LONG_NAME}</DialogTitle>
          <DialogDescription>
            ₹12,480.00 will leave your account today. This cannot be undone once the bank accepts
            it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="qa-dialog-ref">Payment reference</Label>
          <Input id="qa-dialog-ref" defaultValue="INV-2026-0142" />
        </div>
        <DialogFooter showCloseButton>
          <Button>Send ₹12,480.00</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),

  drawer: () => (
    <Drawer defaultOpen showSwipeHandle>
      <DrawerTrigger render={<Button variant="outline" />}>Open drawer</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Invoice INV-2026-0142</DrawerTitle>
          <DrawerDescription>Issued to {LONG_NAME}, due 14 February 2026.</DrawerDescription>
        </DrawerHeader>
        <dl className="grid gap-2 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-text-secondary">Subtotal</dt>
            <dd className="tabular-nums">₹10,576.27</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-secondary">GST (18%)</dt>
            <dd className="tabular-nums">₹1,903.73</dd>
          </div>
          <div className="flex justify-between gap-4 font-medium">
            <dt>Total</dt>
            <dd className="tabular-nums">₹12,480.00</dd>
          </div>
        </dl>
        <DrawerFooter>
          <Button>Mark as paid</Button>
          <Button variant="outline">Download PDF</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),

  "dropdown-menu": () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <MoreHorizontalIcon />
          Actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Invoice INV-2026-0142</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <CopyIcon />
            Duplicate
            <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <MailIcon />
            Send reminder to {LONG_NAME}
          </DropdownMenuItem>
          <DropdownMenuItem inset>Export as CSV</DropdownMenuItem>
          <DropdownMenuItem disabled>
            <FileTextIcon />
            Download PDF
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>View</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked>Show paid invoices</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={false}>Show drafts</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Billing cycle</DropdownMenuLabel>
        <DropdownMenuRadioGroup value="monthly">
          <DropdownMenuRadioItem value="monthly">Monthly</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="quarterly">Quarterly</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub defaultOpen>
          <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Q1 2026</DropdownMenuItem>
            <DropdownMenuItem>Archive</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive">
          <TrashIcon />
          Delete invoice
          <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),

  // EmojiPicker keeps its open state internal (no open/defaultOpen prop), so its popover cannot
  // be forced open. The real component shows closed (empty, selected, custom set); the open
  // grid is a Popover that mirrors its markup around the exported DEFAULT_EMOJIS.
  "emoji-picker": () => (
    <div className="space-y-6">
      <Block title="Closed triggers">
        <div className="flex flex-wrap items-center gap-3">
          <EmojiPicker value={null} onChange={noop} label="Goal icon" />
          <EmojiPicker value="🏖️" onChange={noop} label="Goal icon" />
          <EmojiPicker value="🪔" onChange={noop} emojis={["🪔", "🕌", "⛪", "🛕"]} />
        </div>
      </Block>
      <Block title="Open grid (mirrors the popover content)">
        <Popover open>
          <PopoverTrigger
            aria-label="Goal icon"
            className="flex size-11 items-center justify-center rounded-lg border border-border-default bg-bg-surface text-xl md:size-9"
          >
            🏖️
          </PopoverTrigger>
          <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] p-2" align="start">
            <div role="listbox" aria-label="Goal icon" className="grid grid-cols-6 gap-1">
              {DEFAULT_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="option"
                  aria-selected={e === "🏖️"}
                  className={`flex size-11 items-center justify-center rounded-md text-xl hover:bg-bg-elevated md:size-9 ${e === "🏖️" ? "bg-primary/15" : ""}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                aria-label="Other emoji"
                placeholder="Other…"
                maxLength={8}
                className="h-9 min-w-0 flex-1 rounded-md border border-border-default bg-bg-surface px-2 text-sm text-text-primary"
              />
            </div>
          </PopoverContent>
        </Popover>
        <div className="h-96" />
      </Block>
    </div>
  ),

  "empty-state": () => (
    <div className="space-y-8">
      <Block title="Icon, description and action">
        <EmptyState
          icon={<InboxIcon className="size-10" />}
          title="No invoices yet"
          description="Invoices you send to customers like Northwind Ltd appear here, with their payment status."
          action={<Button>Create invoice</Button>}
        />
      </Block>
      <Block title="Long title and description">
        <EmptyState
          icon={<SearchIcon className="size-10" />}
          title={`No transactions match "${LONG_NAME}" in the selected date range`}
          description="Try widening the range, clearing the amount filter above ₹12,480.00, or searching by reference number instead of the partner name."
          action={<Button variant="outline">Clear filters</Button>}
        />
      </Block>
      <Block title="Title only">
        <EmptyState title="Nothing to show" />
      </Block>
    </div>
  ),

  "error-state": () => (
    <div className="space-y-6">
      <Block title="Message and retry">
        <ErrorState
          message="We could not load your invoices. Check your connection and try again."
          onRetry={noop}
        />
      </Block>
      <Block title="Long message">
        <ErrorState
          message={`The settlement export for ${LONG_NAME} failed after 3 attempts because the bank statement for 15 January 2026 was rejected as malformed.`}
          onRetry={noop}
        />
      </Block>
      <Block title="Default message, no retry">
        <ErrorState />
      </Block>
    </div>
  ),

  field: () => (
    <div className="grid max-w-md gap-6">
      <Block title="Label and description">
        <Field>
          <FieldLabel>Billing email</FieldLabel>
          <FieldControl type="email" defaultValue="accounts@northwind.example" />
          <FieldDescription>Invoices and receipts are sent here.</FieldDescription>
        </Field>
      </Block>
      <Block title="Invalid, with error">
        <Field errors={["Enter an amount of at least ₹500.00"]}>
          <FieldLabel>Payout amount</FieldLabel>
          <FieldControl defaultValue="₹120.00" />
          <FieldDescription>Minimum payout is ₹500.00.</FieldDescription>
          <FieldError />
        </Field>
      </Block>
      <Block title="Error from issue objects">
        <Field errors={[{ message: "Company name is required" }, null, "Company name is required"]}>
          <FieldLabel>Company name</FieldLabel>
          <FieldControl placeholder="Northwind Ltd" />
          <FieldError />
        </Field>
      </Block>
      <Block title="Three errors">
        <Field
          errors={[
            "Use at least 12 characters",
            "Add a number",
            { message: "Add a symbol such as ! or #" },
          ]}
        >
          <FieldLabel>New password</FieldLabel>
          <FieldControl type="password" defaultValue="hunter" />
          <FieldError />
        </Field>
      </Block>
      <Block title="Disabled">
        <Field disabled>
          <FieldLabel>Account number</FieldLabel>
          <FieldControl defaultValue="0044 2218 9034" />
          <FieldDescription>Contact support to change the linked account.</FieldDescription>
        </Field>
      </Block>
      <Block title="Long label and description">
        <Field>
          <FieldLabel>{`Legal name of the registered entity as it appears on ${LONG_NAME}`}</FieldLabel>
          <FieldControl defaultValue={LONG_NAME} />
          <FieldDescription>
            Used on tax invoices and must match the certificate of incorporation filed with the
            registrar of companies.
          </FieldDescription>
        </Field>
      </Block>
    </div>
  ),

  "input-group": () => (
    <div className="grid max-w-md gap-6">
      <Block title="Inline start icon">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search invoices" aria-label="Search invoices" />
        </InputGroup>
      </Block>
      <Block title="Text addons both sides">
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>₹</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput defaultValue="12,480" aria-label="Amount" inputMode="decimal" />
          <InputGroupAddon align="inline-end">
            <InputGroupText>INR</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </Block>
      <Block title="Buttons and key hint">
        <div className="grid gap-3">
          <InputGroup>
            <InputGroupInput
              defaultValue="https://pay.example/northwind"
              aria-label="Payment link"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton>Copy</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <InputGroup>
            <InputGroupInput placeholder="Search" aria-label="Search" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Copy">
                <CopyIcon />
              </InputGroupButton>
              <Kbd>⌘K</Kbd>
            </InputGroupAddon>
          </InputGroup>
          <InputGroup>
            <InputGroupInput placeholder="Email" aria-label="Email" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton variant="default" size="sm">
                Send
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </Block>
      <Block title="Textarea with block addons">
        <InputGroup>
          <InputGroupAddon align="block-start" className="border-b">
            <InputGroupText>Note to {LONG_NAME}</InputGroupText>
          </InputGroupAddon>
          <InputGroupTextarea
            aria-label="Note"
            defaultValue="Payment for Q4 settlement. Please confirm receipt."
            rows={3}
          />
          <InputGroupAddon align="block-end" className="border-t">
            <InputGroupText>49 / 500</InputGroupText>
            <InputGroupButton variant="default" className="ml-auto">
              Post
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Block>
      <Block title="Invalid">
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>₹</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput defaultValue="-120" aria-label="Amount" aria-invalid="true" />
        </InputGroup>
      </Block>
      <Block title="Disabled">
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>₹</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput defaultValue="12,480" aria-label="Amount" disabled />
        </InputGroup>
      </Block>
    </div>
  ),

  "input-otp": () => (
    <div className="grid gap-6">
      <Block title="Six digits, entered">
        <InputOTP maxLength={6} value="482913" onChange={noop} aria-label="Verification code">
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </Block>
      <Block title="Partly entered">
        <InputOTP maxLength={6} value="48" onChange={noop} aria-label="Verification code">
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </Block>
      <Block title="Empty">
        <InputOTP maxLength={4} value="" onChange={noop} aria-label="PIN">
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
          </InputOTPGroup>
        </InputOTP>
      </Block>
      <Block title="Invalid">
        <InputOTP maxLength={6} value="000000" onChange={noop} aria-label="Verification code">
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} aria-invalid="true" />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </Block>
      <Block title="Disabled">
        <InputOTP
          maxLength={6}
          value="482913"
          onChange={noop}
          disabled
          aria-label="Verification code"
        >
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </Block>
    </div>
  ),

  input: () => (
    <div className="grid max-w-md gap-6">
      <Block title="Text with value">
        <Input defaultValue="Northwind Ltd" aria-label="Company" />
      </Block>
      <Block title="Placeholder">
        <Input placeholder="Search invoices" aria-label="Search" />
      </Block>
      <Block title="Email">
        <Input type="email" defaultValue="accounts@northwind.example" aria-label="Email" />
      </Block>
      <Block title="Password">
        <Input type="password" defaultValue="correct horse battery" aria-label="Password" />
      </Block>
      <Block title="Number">
        <Input type="number" defaultValue={12480} aria-label="Amount" />
      </Block>
      <Block title="Date">
        <Input type="date" defaultValue="2026-01-15" aria-label="Due date" />
      </Block>
      <Block title="File">
        <Input type="file" aria-label="Statement" />
      </Block>
      <Block title="Read-only">
        <Input readOnly defaultValue="INV-2026-0142" aria-label="Reference" />
      </Block>
      <Block title="Invalid">
        <Input aria-invalid="true" defaultValue="not-an-email" aria-label="Email" />
      </Block>
      <Block title="Disabled">
        <Input disabled defaultValue="Locked after approval" aria-label="Status" />
      </Block>
      <Block title="Long value">
        <Input defaultValue={LONG_NAME} aria-label="Account name" />
      </Block>
    </div>
  ),

  kbd: () => (
    <div className="grid gap-6">
      <Block title="Single keys">
        <div className="flex flex-wrap items-center gap-2">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
          <Kbd>Esc</Kbd>
          <Kbd>Enter</Kbd>
          <Kbd>Shift</Kbd>
          <Kbd>Ctrl</Kbd>
          <Kbd>Space</Kbd>
        </div>
      </Block>
      <Block title="Key sequences">
        <div className="flex flex-wrap items-center gap-4">
          <KeySequence keys={["⌘", "K"]} />
          <KeySequence keys={["Ctrl", "Shift", "P"]} />
          <KeySequence keys={["G", "I"]} />
          <KeySequence keys="?" />
        </div>
      </Block>
      <Block title="Inline in text">
        <p className="text-sm text-text-secondary">
          Press <KeySequence keys={["⌘", "K"]} /> to search invoices, or <Kbd>Esc</Kbd> to close the
          panel without saving ₹12,480.00 to the batch.
        </p>
      </Block>
      <Block title="Long sequence">
        <KeySequence
          className="flex-wrap"
          keys={["Ctrl", "Alt", "Shift", "Option", "Fn", "Tab", "PageDown", "Backspace"]}
        />
      </Block>
    </div>
  ),

  label: () => (
    <div className="grid max-w-md gap-6">
      <Block title="Label for an input">
        <div className="grid gap-2">
          <Label htmlFor="qa-label-company">Company name</Label>
          <Input id="qa-label-company" defaultValue="Northwind Ltd" />
        </div>
      </Block>
      <Block title="Label for a disabled peer">
        <div className="flex flex-col gap-2">
          <Input
            id="qa-label-locked"
            disabled
            defaultValue="INV-2026-0142"
            className="peer order-last"
          />
          <Label htmlFor="qa-label-locked">Reference (locked)</Label>
        </div>
      </Block>
      <Block title="Label with a checkbox">
        <Label htmlFor="qa-label-terms">
          <input id="qa-label-terms" type="checkbox" defaultChecked className="size-4" />
          Send me a receipt for ₹12,480.00
        </Label>
      </Block>
      <Block title="Long label">
        <div className="grid gap-2">
          <Label htmlFor="qa-label-long">{`Legal name of the registered entity as it appears on ${LONG_NAME}`}</Label>
          <Input id="qa-label-long" defaultValue={LONG_NAME} />
        </div>
      </Block>
    </div>
  ),

  "logo-stack": () => (
    <div className="grid max-w-md gap-6">
      <Block title="Four marks: no +N">
        <LogoStack marks={LOGOS.slice(0, 4)} />
      </Block>
      <Block title="Six marks: four and +2">
        <LogoStack marks={LOGOS} />
      </Block>
      <Block title="Dark marks with lightTile, sizes sm and lg">
        <div className="flex flex-col items-start gap-3">
          <LogoStack size="sm" marks={[LOGOS[0] as LogoMark, ...DARK_LOGOS]} />
          <LogoStack size="lg" marks={[LOGOS[0] as LogoMark, ...DARK_LOGOS]} />
        </div>
      </Block>
      <Block title="Broken image: initials stand in">
        <LogoStack marks={[{ src: "data:,", alt: "Northwind Ltd" }, ...LOGOS.slice(0, 2)]} />
      </Block>
    </div>
  ),

  markdown: () => (
    <div className="flex flex-col gap-8 md:flex-row">
      <MarkdownToc
        markdown={MARKDOWN}
        idPrefix={DEFAULT_ID_PREFIX}
        activeId={`${DEFAULT_ID_PREFIX}summary`}
        className="md:w-56 md:shrink-0"
      />
      <Markdown className="min-w-0 flex-1">{MARKDOWN}</Markdown>
    </div>
  ),

  fold: () => (
    <div className="grid max-w-xl gap-6">
      <Fold title="Builder notes" detail="12 lines, written by the builder">
        {FOLD_NOTES}
      </Fold>
      <Fold title="Builder notes" detail="12 lines, written by the builder" defaultOpen>
        {FOLD_NOTES}
      </Fold>
    </div>
  ),

  "metric-headline": () => (
    <div className="grid gap-4 sm:grid-cols-2">
      <MetricHeadline
        label="Revenue"
        period="this month"
        result={{ current: 1248000, previous: 1058000 }}
        format={(n) => `₹${(n / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
      />
      <MetricHeadline
        label="Signups"
        result={{ current: 412, previous: 503 }}
        format={(n) => n.toLocaleString("en-US")}
      />
      <MetricHeadline
        label="Churned customers"
        result={{ current: 12, previous: 19 }}
        goodWhen="down"
        format={(n) => n.toLocaleString("en-US")}
      />
      <MetricHeadline
        label="Failed payments"
        result={{ current: 31, previous: 22 }}
        goodWhen="down"
        format={(n) => n.toLocaleString("en-US")}
      />
      <MetricHeadline
        label="Active invoices"
        result={{ current: 1204, previous: 1200 }}
        format={(n) => n.toLocaleString("en-US")}
      />
      <MetricHeadline
        label="Refund requests"
        result={{ current: 8, previous: null }}
        period="since launch"
        format={(n) => n.toLocaleString("en-US")}
      />
      <MetricHeadline
        label={`Settled volume for ${LONG_NAME}`}
        period="compared with the same quarter last year"
        result={{ current: 98400000, previous: 61200000 }}
        format={(n) => `₹${(n / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
      />
      <MetricHeadline
        label="Active subscribers"
        result={{ current: 2840, previous: 2410 }}
        format={(n) => n.toLocaleString("en-US")}
        copy={{ up: (c) => `${c.label}: ${c.percent} more than last week` }}
        classNames={{ value: "text-primary", sentence: "text-text-primary" }}
      >
        <a href="#report" className="text-caption text-primary underline underline-offset-2">
          Updated 5 minutes ago, view report
        </a>
      </MetricHeadline>
      <div className="sm:col-span-2">
        <MetricHeadlineRoot>
          <MetricHeadlineValue>₹12,480.00</MetricHeadlineValue>
          <MetricHeadlineSentence>
            Outstanding balance, due in 14 days{" "}
            <MetricHeadlineTrend tone="warn">↑ 6%</MetricHeadlineTrend>
          </MetricHeadlineSentence>
        </MetricHeadlineRoot>
      </div>
    </div>
  ),

  pagination: () => (
    <div className="grid gap-6">
      <Block title="First page of 12">
        <Pagination page={1} totalPages={12} onPageChange={noop} />
      </Block>
      <Block title="Middle page">
        <Pagination page={5} totalPages={12} onPageChange={noop} />
      </Block>
      <Block title="Last page">
        <Pagination page={12} totalPages={12} onPageChange={noop} />
      </Block>
      <Block title="Two pages, three-digit page number">
        <div className="flex flex-wrap items-center gap-6">
          <Pagination page={2} totalPages={2} onPageChange={noop} />
          <Pagination page={118} totalPages={240} onPageChange={noop} />
        </div>
      </Block>
      <Block title="In a table footer">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border-default bg-bg-surface p-3 text-sm text-text-secondary">
          <span className="min-w-0 truncate">Showing 41-50 of 118 invoices for {LONG_NAME}</span>
          <Pagination page={5} totalPages={12} onPageChange={noop} className="shrink-0" />
        </div>
      </Block>
    </div>
  ),
} satisfies Fixtures
