"use client"
import {
  Sidebar,
  SidebarContent,
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
import { BarChart3Icon, HomeIcon, ReceiptIcon, SettingsIcon, UsersIcon } from "lucide-react"
import { useState } from "react"
import { ClientOnly } from "./client-only"

const items = [
  { label: "Overview", icon: HomeIcon },
  { label: "Invoices", icon: ReceiptIcon },
  { label: "Customers", icon: UsersIcon },
  { label: "Reports", icon: BarChart3Icon },
  { label: "Settings", icon: SettingsIcon },
]

function AppSidebar({ collapsible }: { collapsible?: "icon" | "offcanvas" }) {
  const [active, setActive] = useState("Invoices")
  return (
    <Sidebar collapsible={collapsible} className="h-full" aria-label="Main">
      <SidebarHeader>
        <span className="px-2 py-1 text-sm font-semibold group-data-[collapsible=icon]/sidebar:sr-only">
          Acme Billing
        </span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            {items.map(({ label, icon: Icon }) => (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton isActive={active === label} onClick={() => setActive(label)}>
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

function Shell({ collapsible }: { collapsible?: "icon" | "offcanvas" }) {
  return (
    <SidebarProvider
      shortcut={null}
      className="h-80 min-h-0 w-full max-w-2xl overflow-hidden rounded-lg border"
    >
      <AppSidebar collapsible={collapsible} />
      <SidebarInset>
        <header className="flex items-center gap-2 border-b p-2">
          <SidebarTrigger />
          <span className="text-sm font-medium">Invoices</span>
        </header>
        <div className="p-4 text-sm text-text-muted">42 invoices this month.</div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function SidebarDemoInner() {
  return <Shell />
}

function SidebarOffcanvasDemoInner() {
  return <Shell collapsible="offcanvas" />
}

function SidebarRightDemoInner() {
  return (
    <SidebarProvider
      shortcut={null}
      className="h-80 min-h-0 w-full max-w-2xl overflow-hidden rounded-lg border"
    >
      <SidebarInset>
        <header className="flex items-center gap-2 border-b p-2">
          <SidebarTrigger />
          <span className="text-sm font-medium">Order ORD-2041</span>
        </header>
      </SidebarInset>
      <Sidebar side="right" className="h-full" aria-label="Details">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Details</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <UsersIcon />
                  <span>Customer</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  )
}

export const SidebarDemo = () => (
  <ClientOnly>
    <SidebarDemoInner />
  </ClientOnly>
)

export const SidebarOffcanvasDemo = () => (
  <ClientOnly>
    <SidebarOffcanvasDemoInner />
  </ClientOnly>
)

export const SidebarRightDemo = () => (
  <ClientOnly>
    <SidebarRightDemoInner />
  </ClientOnly>
)
