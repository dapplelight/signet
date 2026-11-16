"use client"

import { MarkdownCopyButton, ViewOptionsPopover } from "fumadocs-ui/layouts/docs/page"

/** One compact split button: copy the page as Markdown | open it elsewhere. */
export function PageActions({
  markdownUrl,
  githubUrl,
}: {
  markdownUrl: string
  githubUrl: string
}) {
  return (
    <div className="flex shrink-0 items-stretch self-start overflow-hidden rounded-md border bg-fd-secondary">
      <MarkdownCopyButton
        markdownUrl={markdownUrl}
        className="h-8 rounded-none px-3 text-[13px] hover:bg-fd-accent"
      >
        Copy page
      </MarkdownCopyButton>
      <span className="w-px bg-fd-border" />
      <ViewOptionsPopover
        markdownUrl={markdownUrl}
        githubUrl={githubUrl}
        aria-label="Open page in…"
        className={() => "h-8 rounded-none px-2 hover:bg-fd-accent"}
      >
        <span className="sr-only">Open page in…</span>
      </ViewOptionsPopover>
    </div>
  )
}
