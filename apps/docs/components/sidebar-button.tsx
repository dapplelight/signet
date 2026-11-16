"use client"
import { SidebarTrigger } from "fumadocs-ui/layouts/docs/slots/sidebar"
import { Menu } from "lucide-react"

/** Phones: the docs bar is off (one shared header), so this opens the page list. */
export function SidebarButton() {
  return (
    <div className="-mb-2 md:hidden">
      <SidebarTrigger
        aria-label="Open page list"
        className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-fd-muted-foreground hover:text-fd-foreground"
      >
        <Menu className="size-4" />
        Menu
      </SidebarTrigger>
    </div>
  )
}
