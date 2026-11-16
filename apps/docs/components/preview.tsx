"use client"
import { Children, type ReactNode, useState } from "react"

/**
 * shadcn-style preview: a big white stage with the live demo, the code
 * peeking underneath, "View code" to open it. Children: the demo, then a
 * fenced code block (the last child).
 */
export function Preview({ children }: { children: ReactNode }) {
  const parts = Children.toArray(children)
  const code = parts.pop()
  const [open, setOpen] = useState(false)
  return (
    <div className="not-prose my-6 overflow-hidden rounded-xl border border-fd-border">
      <div className="flex min-h-[18rem] flex-wrap items-center justify-center gap-3 bg-fd-background p-10 text-foreground">
        {parts}
      </div>
      <div className="relative border-t border-fd-border [&_figure]:my-0 [&_figure]:rounded-none [&_figure]:border-0">
        <div className={open ? "" : "max-h-24 overflow-hidden"}>{code}</div>
        {!open && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-transparent to-fd-background">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-md border border-fd-border bg-fd-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-fd-accent"
            >
              View code
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
