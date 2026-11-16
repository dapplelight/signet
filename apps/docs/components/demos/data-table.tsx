"use client"
import { Badge } from "@dapplelight/signet-ui/components/badge"
import { Button } from "@dapplelight/signet-ui/components/button"
import { DataTable, type DataTableProps } from "@dapplelight/signet-ui/components/data-table"
import { useState } from "react"

type Invoice = {
  id: string
  customer: string
  amount: number
  status: "paid" | "open" | "overdue" | "draft"
  due: string
}

const invoices: Invoice[] = [
  {
    id: "INV-1042",
    customer: "Northwind Traders",
    amount: 12400,
    status: "paid",
    due: "2026-10-04",
  },
  {
    id: "INV-1043",
    customer: "Globex Corporation",
    amount: 8250,
    status: "open",
    due: "2026-11-18",
  },
  { id: "INV-1044", customer: "Initech", amount: 3120, status: "overdue", due: "2026-10-29" },
  { id: "INV-1045", customer: "Umbrella Health", amount: 21900, status: "paid", due: "2026-10-12" },
  { id: "INV-1046", customer: "Hooli", amount: 5600, status: "open", due: "2026-11-25" },
  { id: "INV-1047", customer: "Stark Logistics", amount: 18750, status: "paid", due: "2026-10-20" },
  { id: "INV-1048", customer: "Wayne Freight", amount: 940, status: "draft", due: "2026-12-02" },
  { id: "INV-1049", customer: "Acme Supplies", amount: 7300, status: "overdue", due: "2026-10-15" },
  { id: "INV-1050", customer: "Soylent Foods", amount: 15200, status: "open", due: "2026-11-30" },
  {
    id: "INV-1051",
    customer: "Cyberdyne Systems",
    amount: 2680,
    status: "paid",
    due: "2026-10-08",
  },
]

const statusVariant = {
  paid: "default",
  open: "secondary",
  overdue: "destructive",
  draft: "outline",
} as const

const columns: DataTableProps<Invoice>["columns"] = [
  { accessorKey: "id", header: "Invoice" },
  { accessorKey: "customer", header: "Customer" },
  {
    accessorKey: "amount",
    header: "Amount",
    cell: ({ row }) => `$${row.original.amount.toLocaleString()}`,
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { filter: "facet" },
    cell: ({ row }) => (
      <Badge variant={statusVariant[row.original.status]}>{row.original.status}</Badge>
    ),
  },
  { accessorKey: "due", header: "Due" },
]

export function DataTableDemo() {
  return (
    <div className="w-full">
      <DataTable columns={columns} data={invoices} getRowId={(r) => r.id} />
    </div>
  )
}

export function DataTableSortableDemo() {
  return (
    <div className="w-full">
      <DataTable columns={columns} data={invoices} getRowId={(r) => r.id} sortable />
    </div>
  )
}

export function DataTableSelectableDemo() {
  return (
    <div className="w-full">
      <DataTable
        columns={columns}
        data={invoices}
        getRowId={(r) => r.id}
        selectable
        bulkActions={(selected) => (
          <Button size="sm" variant="outline">
            Send reminder to {selected.length}
          </Button>
        )}
      />
    </div>
  )
}

export function DataTableToolbarDemo() {
  return (
    <div className="w-full">
      <DataTable
        columns={columns}
        data={invoices}
        getRowId={(r) => r.id}
        sortable
        searchable={{ placeholder: "Search invoices" }}
        columnsMenu
        exportFilename="invoices"
      />
    </div>
  )
}

export function DataTableClickableDemo() {
  const [open, setOpen] = useState<Invoice | null>(null)
  return (
    <div className="w-full space-y-2">
      <DataTable
        columns={columns}
        data={invoices}
        getRowId={(r) => r.id}
        onRowClick={setOpen}
        getRowLabel={(r) => `Open ${r.id} for ${r.customer}`}
      />
      <p className="text-sm text-muted-foreground">
        {open ? `${open.id}: ${open.customer}` : "Click a row"}
      </p>
    </div>
  )
}

export function DataTableEmptyDemo() {
  return (
    <div className="w-full">
      <DataTable columns={columns} data={[]} emptyMessage="No invoices yet." />
    </div>
  )
}
