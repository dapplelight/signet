"use client"
import { Markdown, MarkdownToc } from "@dapplelight/signet-ui/components/markdown"

const changelog = `# Release 2.4

Invoices now **export to CSV** and sync with [the billing API](https://example.com/docs).

## Fixes

- [x] Overdue badge shows the right day count
- [ ] Refund emails use the customer locale

| Plan | Seats | Price |
| ---- | ----- | ----- |
| Team | 10    | $49   |
| Scale | 50   | $199  |

<script>alert("dropped")</script>
`

export function MarkdownDemo() {
  return (
    <div className="w-full max-w-md">
      <Markdown>{changelog}</Markdown>
    </div>
  )
}

export function MarkdownTocDemo() {
  return (
    <div className="flex w-full max-w-lg gap-8">
      <MarkdownToc markdown={changelog} idPrefix="user-content-" className="w-40 shrink-0" />
      <Markdown className="min-w-0 flex-1">{changelog}</Markdown>
    </div>
  )
}

export function MarkdownImagesDemo() {
  const source =
    "![Quarterly revenue chart](https://example.com/revenue.png)\n\nSee the chart above."
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <Markdown>{source}</Markdown>
      <Markdown images={(src) => src.startsWith("https://example.com/")}>{source}</Markdown>
    </div>
  )
}

export function MarkdownNoAnchorsDemo() {
  return (
    <div className="w-full max-w-md">
      <Markdown headingAnchors={false}>
        {"## Shipping policy\n\nOrders ship within 2 business days."}
      </Markdown>
    </div>
  )
}
