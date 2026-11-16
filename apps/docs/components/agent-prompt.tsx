"use client"

import { Check, Copy, Sparkles } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"

/** A ready-made prompt for a coding agent: collapsed, copyable, one click into Cursor. */
export function AgentPrompt({ title, children }: { title: string; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null)
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setText(body.current?.innerText.trim() ?? "")
  }, [])

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="not-prose my-6 overflow-hidden rounded-xl border bg-fd-card">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium">
        <Sparkles className="size-4 text-fd-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </div>
      <div className="relative px-4 py-3">
        <div
          ref={body}
          className={`space-y-2 font-mono text-[13px] leading-6 text-fd-muted-foreground [&_p]:m-0 ${
            open ? "" : "max-h-24 overflow-hidden"
          }`}
        >
          {children}
        </div>
        {!open && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 h-10 bg-gradient-to-t from-fd-card to-transparent" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-fd-primary px-3 text-[13px] font-medium text-fd-primary-foreground hover:opacity-90"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy prompt"}
        </button>
        <a
          href={`cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(text)}`}
          className="inline-flex h-8 items-center rounded-md border px-3 text-[13px] font-medium hover:bg-fd-accent"
        >
          Open in Cursor
        </a>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="ms-auto text-[13px] text-fd-muted-foreground hover:text-fd-foreground"
        >
          {open ? "Collapse" : "Expand"}
        </button>
      </div>
    </div>
  )
}
