"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@dapplelight/signet-ui/components/command"
import { CreditCardIcon, FileTextIcon, PlusIcon, SettingsIcon, UserIcon } from "lucide-react"
import * as React from "react"

export function CommandDemo() {
  return (
    <Command className="w-full max-w-sm rounded-lg border">
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem value="new-invoice">
            <PlusIcon />
            New invoice
          </CommandItem>
          <CommandItem value="invoices">
            <FileTextIcon />
            View invoices
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem value="profile">
            <UserIcon />
            Profile
          </CommandItem>
          <CommandItem value="billing">
            <CreditCardIcon />
            Billing
          </CommandItem>
          <CommandItem value="settings">
            <SettingsIcon />
            Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

export function CommandShortcutsDemo() {
  return (
    <Command className="w-full max-w-sm rounded-lg border">
      <CommandInput placeholder="Search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Settings">
          <CommandItem value="profile" shortcut="mod+p">
            <UserIcon />
            Profile
            <CommandShortcut />
          </CommandItem>
          <CommandItem value="billing" shortcut="mod+b">
            <CreditCardIcon />
            Billing
            <CommandShortcut />
          </CommandItem>
          <CommandItem value="settings" shortcut="mod+s">
            <SettingsIcon />
            Settings
            <CommandShortcut />
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

export function CommandDialogDemo() {
  const [open, setOpen] = React.useState(false)
  const [last, setLast] = React.useState("Nothing yet")
  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open command palette
      </Button>
      <span className="text-sm text-text-muted">Ran: {last}</span>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        shortcut={null}
        onAction={(value) => setLast(value)}
      >
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem value="new-invoice">
              <PlusIcon />
              New invoice
            </CommandItem>
            <CommandItem value="invoices">
              <FileTextIcon />
              View invoices
            </CommandItem>
            <CommandItem value="billing">
              <CreditCardIcon />
              Billing
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  )
}
