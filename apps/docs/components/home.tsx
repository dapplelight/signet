"use client"
import { CheckIcon, CopyIcon, XIcon } from "lucide-react"
import { useId, useState } from "react"

const COMMANDS = [
  { label: "New app", command: "npx create-signet-app@latest my-app" },
  { label: "MCP server", command: "claude mcp add signet -- bunx @dapplelight/signet-mcp" },
] as const

/** Copies `text` and shows a check for two seconds. */
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setState("copied")
        } catch {
          setState("failed")
        }
        setTimeout(() => setState("idle"), 2000)
      }}
      aria-label={
        state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy failed, select the command"
            : "Copy command"
      }
      title={state === "failed" ? "Copy failed, select the command" : undefined}
      className="grid size-8 shrink-0 place-items-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
    >
      {state === "copied" ? (
        <CheckIcon className="size-4" />
      ) : state === "failed" ? (
        <XIcon className="size-4" />
      ) : (
        <CopyIcon className="size-4" />
      )}
    </button>
  )
}

/** The two commands a visitor runs first: the scaffolder, then the MCP server. */
export function Commands() {
  const [tab, setTab] = useState(0)
  const id = useId()
  const current = COMMANDS[tab] ?? COMMANDS[0]
  return (
    <div className="w-full max-w-xl overflow-hidden rounded-xl border border-fd-border bg-fd-card">
      <div
        role="tablist"
        aria-label="Get started"
        className="flex gap-1 border-b border-fd-border px-2"
      >
        {COMMANDS.map((c, i) => (
          <button
            key={c.label}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={tab === i}
            aria-controls={`${id}-panel`}
            onClick={() => setTab(i)}
            className="-mb-px border-b-2 border-transparent px-2.5 py-2.5 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground aria-selected:border-fd-foreground aria-selected:text-fd-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fd-ring"
          >
            {c.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${tab}`}
        className="flex items-center gap-3 py-2 pr-2 pl-4"
      >
        <code className="min-w-0 flex-1 py-1.5 text-sm break-all sm:overflow-x-auto sm:break-normal sm:whitespace-nowrap">
          <span className="text-fd-muted-foreground select-none">$ </span>
          {current.command}
        </code>
        <CopyButton text={current.command} />
      </div>
    </div>
  )
}
