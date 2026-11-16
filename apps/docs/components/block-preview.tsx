"use client"
import { useState } from "react"

// Where the showcase app is served. Set NEXT_PUBLIC_SHOWCASE_URL at docs build
// time; the default is the showcase dev server (`bun run dev` in apps/showcase).
const SHOWCASE = process.env.NEXT_PUBLIC_SHOWCASE_URL ?? "http://localhost:5173/"
const WIDTHS = [390, 1440] as const

/**
 * Live preview of a block: an iframe of the showcase page for it, with a
 * 390 / 1440 width toggle. The showcase page carries the theme switcher, so the
 * docs do not copy it; `embed=1` hides the showcase's own demo bar.
 */
export function BlockPreview({ block }: { block: string }) {
  const [width, setWidth] = useState<(typeof WIDTHS)[number]>(1440)
  const src = `${SHOWCASE.replace(/\/?$/, "/")}block-${block}.html?embed=1`
  return (
    <div className="not-prose my-6 overflow-hidden rounded-xl border border-fd-border">
      <div className="flex items-center justify-between gap-2 border-b border-fd-border bg-fd-card px-3 py-2 text-sm">
        <fieldset aria-label="Preview width" className="m-0 flex gap-1 border-0 p-0">
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={w === width}
              onClick={() => setWidth(w)}
              className="rounded-md px-2.5 py-1 font-medium aria-pressed:bg-fd-accent aria-pressed:text-fd-accent-foreground"
            >
              {w}px
            </button>
          ))}
        </fieldset>
        <a
          href={src.replace("?embed=1", "")}
          target="_blank"
          rel="noreferrer"
          className="text-fd-muted-foreground underline"
        >
          Open in the showcase
        </a>
      </div>
      <div className="overflow-x-auto bg-fd-background">
        <iframe
          title={`${block} block preview`}
          src={src}
          loading="lazy"
          style={{ width, maxWidth: "none" }}
          className="mx-auto block h-[40rem] border-0"
        />
      </div>
    </div>
  )
}
