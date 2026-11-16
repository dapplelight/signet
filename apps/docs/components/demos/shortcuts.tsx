"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import { ShortcutsHelp, useListNavigation } from "@dapplelight/signet-ui/components/shortcuts"
import { useState } from "react"

const orders = ["ORD-2041", "ORD-2042", "ORD-2043", "ORD-2044"]

export function ShortcutsHelpDemo() {
  const [open, setOpen] = useState(false)
  useListNavigation({ ids: orders, onOpen: () => {} })
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Keyboard shortcuts
      </Button>
      <ShortcutsHelp open={open} onOpenChange={setOpen} />
    </>
  )
}

export function ListNavigationDemo() {
  const [opened, setOpened] = useState<string | null>(null)
  const { activeId } = useListNavigation({ ids: orders, onOpen: setOpened, arrows: true })
  return (
    <div className="flex w-full max-w-xs flex-col gap-2">
      <ul className="divide-y rounded-lg border text-sm">
        {orders.map((id) => (
          <li
            key={id}
            aria-current={id === activeId}
            className="px-3 py-2 aria-current:bg-bg-elevated aria-current:font-medium"
          >
            {id}
          </li>
        ))}
      </ul>
      <p className="text-xs text-text-muted">
        Press j and k to move, Enter to open. {opened ? `Opened ${opened}.` : ""}
      </p>
    </div>
  )
}

export function ShortcutsHelpKeyDemo() {
  return (
    <>
      <p className="text-sm text-text-muted">
        Press <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">/</kbd> to open the
        shortcuts list.
      </p>
      <ShortcutsHelp helpKey="/" title="Shortcuts" />
    </>
  )
}
