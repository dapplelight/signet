"use client"
import { SearchInput } from "@dapplelight/signet-ui/components/search-input"
import { useState } from "react"

export function SearchInputDemo() {
  return (
    <div className="w-full max-w-xs">
      <SearchInput placeholder="Search customers" aria-label="Search customers" />
    </div>
  )
}

const customers = ["Acme Corp", "Globex", "Initech", "Umbrella Labs", "Hooli", "Stark Industries"]

export function SearchInputFilterDemo() {
  const [q, setQ] = useState("")
  const hits = customers.filter((c) => c.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <SearchInput
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter customers"
        aria-label="Filter customers"
      />
      <ul className="text-sm">
        {hits.map((c) => (
          <li key={c} className="py-1">
            {c}
          </li>
        ))}
        {hits.length === 0 && <li className="py-1 text-text-muted">No customers match.</li>}
      </ul>
    </div>
  )
}

export function SearchInputWideDemo() {
  return (
    <SearchInput
      containerClassName="w-full max-w-md"
      placeholder="Search invoices, orders and customers"
      aria-label="Search everything"
    />
  )
}

export function SearchInputDisabledDemo() {
  return (
    <div className="w-full max-w-xs">
      <SearchInput disabled placeholder="Search is unavailable" aria-label="Search" />
    </div>
  )
}
