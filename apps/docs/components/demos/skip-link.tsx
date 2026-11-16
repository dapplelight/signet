"use client"

import { Button } from "@dapplelight/signet-ui/components/button"
import { SkipLink } from "@dapplelight/signet-ui/components/skip-link"

export function SkipLinkDemo() {
  return (
    <div className="flex flex-col items-start gap-3">
      <SkipLink id="skip-demo" target="orders-main" />
      <Button variant="outline" onClick={() => document.getElementById("skip-demo")?.focus()}>
        Focus the skip link
      </Button>
      <main id="orders-main" tabIndex={-1} className="text-sm text-text-muted">
        Orders overview (focus lands here)
      </main>
    </div>
  )
}

export function SkipLinkLabelDemo() {
  return (
    <div className="flex flex-col items-start gap-3">
      <SkipLink id="skip-demo-label" target="invoices-main">
        Skip to invoices
      </SkipLink>
      <Button variant="outline" onClick={() => document.getElementById("skip-demo-label")?.focus()}>
        Focus the skip link
      </Button>
      <main id="invoices-main" tabIndex={-1} className="text-sm text-text-muted">
        Invoices (focus lands here)
      </main>
    </div>
  )
}
