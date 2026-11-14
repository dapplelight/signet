"use client"

// An app sidebar. UI SDK ships none, so it is composed here: a collapsible
// panel on desktop (to icons, or fully off-canvas), Signet's Drawer from the
// left on phones, and UI SDK's shortcut behaviour for ⌘B / Ctrl+B.
import { useShortcut } from "@ui-sdk/react/shortcuts"
import { PanelLeftIcon } from "lucide-react"
import * as React from "react"
import { DESKTOP_QUERY, useMediaQuery } from "../../hooks/use-media-query.js"
import { cn } from "../../lib/utils.js"
import { Button } from "./button.js"
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "./drawer.js"

type SidebarContextValue = {
  isMobile: boolean
  /** Desktop: expanded or collapsed. */
  open: boolean
  setOpen: (open: boolean) => void
  /** Phone: the drawer is showing. */
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  toggle: () => void
  panelId: string
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function useSidebar(): SidebarContextValue {
  const ctx = React.useContext(SidebarContext)
  if (!ctx) throw new Error("useSidebar must be used within a SidebarProvider.")
  return ctx
}

interface SidebarProviderProps extends React.ComponentProps<"div"> {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Toggles the sidebar. Default "mod+b"; null turns it off. */
  shortcut?: string | null
  /** Where the panel takes over from the drawer. Default: the `md` breakpoint. */
  desktopQuery?: string
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  shortcut = "mod+b",
  desktopQuery = DESKTOP_QUERY,
  className,
  ...props
}: SidebarProviderProps) {
  const isMobile = !useMediaQuery(desktopQuery)
  const [own, setOwn] = React.useState(defaultOpen)
  const [openMobile, setOpenMobile] = React.useState(false)
  const panelId = React.useId()
  const open = openProp ?? own
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOwn(next)
      onOpenChange?.(next)
    },
    [openProp, onOpenChange],
  )
  const toggle = React.useCallback(
    () => (isMobile ? setOpenMobile((o) => !o) : setOpen(!open)),
    [isMobile, open, setOpen],
  )
  useShortcut(shortcut, (event) => {
    event.preventDefault()
    toggle()
  })
  const value = React.useMemo(
    () => ({ isMobile, open, setOpen, openMobile, setOpenMobile, toggle, panelId }),
    [isMobile, open, setOpen, openMobile, toggle, panelId],
  )
  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        className={cn("flex min-h-dvh w-full bg-background", className)}
        {...props}
      />
    </SidebarContext.Provider>
  )
}

interface SidebarProps extends React.ComponentProps<"aside"> {
  /** Screen-reader description of the phone drawer. Default "Navigation". */
  mobileDescription?: string
  /** Classes for the phone drawer's surface. */
  mobileClassName?: string
  /** "icon" keeps a strip of icons when collapsed; "offcanvas" hides it. Default "icon". */
  collapsible?: "icon" | "offcanvas"
  side?: "left" | "right"
}

function Sidebar({
  collapsible = "icon",
  side = "left",
  className,
  children,
  "aria-label": label = "Sidebar",
  mobileDescription = "Navigation",
  mobileClassName,
  ...props
}: SidebarProps) {
  const { isMobile, open, openMobile, setOpenMobile, panelId } = useSidebar()

  if (isMobile) {
    return (
      <Drawer open={openMobile} onOpenChange={setOpenMobile} swipeDirection={side}>
        <DrawerContent className={cn("w-72 sm:w-72", mobileClassName)}>
          <DrawerTitle className="sr-only">{label}</DrawerTitle>
          <DrawerDescription className="sr-only">{mobileDescription}</DrawerDescription>
          <aside
            data-slot="sidebar"
            data-mobile=""
            aria-label={label}
            className={cn("flex h-full flex-col", className)}
            {...props}
          >
            {children}
          </aside>
        </DrawerContent>
      </Drawer>
    )
  }

  const collapsed = !open
  return (
    <aside
      id={panelId}
      data-slot="sidebar"
      data-state={collapsed ? "collapsed" : "expanded"}
      data-collapsible={collapsed ? collapsible : undefined}
      data-side={side}
      aria-label={label}
      inert={collapsed && collapsible === "offcanvas" ? true : undefined}
      className={cn(
        "group/sidebar sticky top-0 flex h-dvh w-64 shrink-0 flex-col overflow-hidden border-border bg-bg-surface text-text-primary transition-[width] duration-200 ease-linear motion-reduce:transition-none",
        side === "left" ? "order-first border-r" : "order-last border-l",
        "data-[collapsible=icon]:w-12 data-[collapsible=offcanvas]:w-0 data-[collapsible=offcanvas]:border-0",
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  )
}

/** Toggles the sidebar: collapses it on desktop, opens the drawer on phones. */
function SidebarTrigger({
  className,
  onClick,
  label = "Toggle sidebar",
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label?: string }) {
  const { isMobile, open, openMobile, toggle, panelId } = useSidebar()
  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      aria-expanded={isMobile ? openMobile : open}
      data-state={(isMobile ? openMobile : open) ? "open" : "closed"}
      aria-controls={isMobile ? undefined : panelId}
      className={className}
      onClick={(event) => {
        onClick?.(event)
        toggle()
      }}
      {...props}
    >
      {children ?? <PanelLeftIcon />}
      <span className="sr-only">{label}</span>
    </Button>
  )
}

/** The main content beside the sidebar. */
function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("flex min-w-0 flex-1 flex-col", className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]/sidebar:overflow-hidden",
        className,
      )}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn("flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        "flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-text-muted group-data-[collapsible=icon]/sidebar:sr-only",
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("m-0 flex w-full min-w-0 list-none flex-col gap-1 p-0", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" className={cn("relative", className)} {...props} />
}

type SidebarMenuButtonProps = React.ComponentProps<"button"> & {
  /** Marks the current page: aria-current="page" and the active style. */
  isActive?: boolean
  /** Render a link (or a router link) instead of a button. */
  render?: React.ReactElement<Record<string, unknown>>
}

/** An icon and a `<span>` label. Collapsed to icons, the label stays for screen readers. */
function SidebarMenuButton({ isActive, render, className, ...props }: SidebarMenuButtonProps) {
  const merged = {
    "data-slot": "sidebar-menu-button",
    "data-active": isActive ? "" : undefined,
    "aria-current": isActive ? ("page" as const) : undefined,
    className: cn(
      "flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm text-text-secondary outline-none transition-colors hover:bg-bg-elevated hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
      "data-active:bg-bg-elevated data-active:font-medium data-active:text-text-primary",
      "[&>svg]:size-4 [&>svg]:shrink-0 [&>span:last-child]:truncate",
      "group-data-[collapsible=icon]/sidebar:size-8 group-data-[collapsible=icon]/sidebar:p-2 group-data-[collapsible=icon]/sidebar:[&>span]:sr-only",
      className,
      typeof render?.props.className === "string" && render.props.className,
    ),
    ...props,
  }
  if (render) return React.cloneElement(render, merged)
  return <button type="button" {...merged} />
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  type SidebarMenuButtonProps,
  SidebarMenuItem,
  type SidebarProps,
  SidebarProvider,
  type SidebarProviderProps,
  SidebarTrigger,
  useSidebar,
}
