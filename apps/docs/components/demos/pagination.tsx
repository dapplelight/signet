"use client"
import { Pagination } from "@dapplelight/signet-ui/components/pagination"
import { useState } from "react"

export function PaginationDemo() {
  const [page, setPage] = useState(2)
  return <Pagination page={page} totalPages={8} onPageChange={setPage} />
}

const invoices = Array.from({ length: 12 }, (_, i) => `INV-${1040 + i}`)

export function PaginationListDemo() {
  const [page, setPage] = useState(1)
  const size = 4
  const totalPages = Math.ceil(invoices.length / size)
  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <ul className="divide-y rounded-lg border text-sm">
        {invoices.slice((page - 1) * size, page * size).map((id) => (
          <li key={id} className="px-3 py-2">
            {id}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        Page {page} of {totalPages}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  )
}

export function PaginationSinglePageDemo() {
  return (
    <p className="text-sm text-muted-foreground">
      One page of results renders nothing:
      <Pagination page={1} totalPages={1} onPageChange={() => {}} />
    </p>
  )
}
