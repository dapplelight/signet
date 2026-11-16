"use client"
import { DataGrid, type DataGridColumn } from "@dapplelight/signet-ui/components/data-grid"
import { useState } from "react"

type Invoice = {
  id: string
  customer: string
  amount: number
  status: string
  due: string
  paid: boolean
}

const invoices: Invoice[] = [
  {
    id: "INV-1042",
    customer: "Northwind Traders",
    amount: 12400,
    status: "paid",
    due: "2026-10-04",
    paid: true,
  },
  {
    id: "INV-1043",
    customer: "Globex Corporation",
    amount: 8250,
    status: "open",
    due: "2026-11-18",
    paid: false,
  },
  {
    id: "INV-1044",
    customer: "Initech",
    amount: 3120,
    status: "overdue",
    due: "2026-10-29",
    paid: false,
  },
  {
    id: "INV-1045",
    customer: "Umbrella Health",
    amount: 21900,
    status: "paid",
    due: "2026-10-12",
    paid: true,
  },
  {
    id: "INV-1046",
    customer: "Hooli",
    amount: 5600,
    status: "open",
    due: "2026-11-25",
    paid: false,
  },
  {
    id: "INV-1047",
    customer: "Stark Logistics",
    amount: 18750,
    status: "paid",
    due: "2026-10-20",
    paid: true,
  },
  {
    id: "INV-1048",
    customer: "Wayne Freight",
    amount: 940,
    status: "draft",
    due: "2026-12-02",
    paid: false,
  },
  {
    id: "INV-1049",
    customer: "Acme Supplies",
    amount: 7300,
    status: "overdue",
    due: "2026-10-15",
    paid: false,
  },
  {
    id: "INV-1050",
    customer: "Soylent Foods",
    amount: 15200,
    status: "open",
    due: "2026-11-30",
    paid: false,
  },
  {
    id: "INV-1051",
    customer: "Cyberdyne Systems",
    amount: 2680,
    status: "paid",
    due: "2026-10-08",
    paid: true,
  },
]

const columns: DataGridColumn<Invoice>[] = [
  { id: "id", header: "Invoice", editable: false, width: 110 },
  { id: "customer", header: "Customer", width: 200 },
  {
    id: "amount",
    header: "Amount",
    type: "number",
    width: 120,
    format: (v) => `$${Number(v).toLocaleString()}`,
  },
  {
    id: "status",
    header: "Status",
    type: "select",
    width: 120,
    options: [
      { value: "draft", label: "Draft" },
      { value: "open", label: "Open" },
      { value: "paid", label: "Paid" },
      { value: "overdue", label: "Overdue" },
    ],
  },
  { id: "due", header: "Due", type: "date", width: 130 },
  { id: "paid", header: "Paid", type: "checkbox", width: 80 },
]

export function DataGridDemo() {
  const [rows, setRows] = useState(invoices)
  return (
    <div className="w-full">
      <DataGrid
        aria-label="Invoices"
        columns={columns}
        rows={rows}
        height={340}
        getRowId={(r) => r.id}
        onChange={(changes) => {
          setRows((prev) =>
            prev.map((r) => {
              const mine = changes.filter((c) => c.rowId === r.id)
              return mine.length
                ? { ...r, ...Object.fromEntries(mine.map((c) => [c.columnId, c.value])) }
                : r
            }),
          )
        }}
      />
    </div>
  )
}

export function DataGridSelectableDemo() {
  const [selected, setSelected] = useState<string[]>(["INV-1043"])
  return (
    <div className="w-full space-y-2">
      <DataGrid
        aria-label="Invoices"
        columns={columns.slice(0, 4)}
        rows={invoices}
        height={300}
        selectable
        selectedRowIds={selected}
        onSelectedRowIdsChange={setSelected}
        getRowId={(r) => r.id}
      />
      <p className="text-sm text-muted-foreground">{selected.length} selected</p>
    </div>
  )
}

export function DataGridValidationDemo() {
  const [rows, setRows] = useState(invoices)
  const cols: DataGridColumn<Invoice>[] = [
    { id: "id", header: "Invoice", editable: false, width: 110 },
    { id: "customer", header: "Customer", width: 200 },
    {
      id: "amount",
      header: "Amount",
      type: "number",
      width: 140,
      validate: (v) => (typeof v === "number" && v < 0 ? "Amount can't be negative." : undefined),
    },
  ]
  return (
    <div className="w-full">
      <DataGrid
        aria-label="Invoice amounts"
        columns={cols}
        rows={rows}
        height={260}
        getRowId={(r) => r.id}
        onChange={(changes) => {
          setRows((prev) =>
            prev.map((r) => {
              const mine = changes.filter((c) => c.rowId === r.id)
              return mine.length
                ? { ...r, ...Object.fromEntries(mine.map((c) => [c.columnId, c.value])) }
                : r
            }),
          )
        }}
      />
    </div>
  )
}

export function DataGridReadOnlyDemo() {
  return (
    <div className="w-full">
      <DataGrid
        aria-label="Invoices"
        columns={columns.map((c) => ({ ...c, editable: false }))}
        rows={invoices}
        height={300}
        getRowId={(r) => r.id}
      />
    </div>
  )
}
