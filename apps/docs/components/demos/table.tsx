"use client"

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@dapplelight/signet-ui/components/table"

const invoices = [
  { id: "INV-1042", status: "Paid", method: "Card", amount: "$250.00" },
  { id: "INV-1043", status: "Pending", method: "Bank transfer", amount: "$1,180.00" },
  { id: "INV-1044", status: "Paid", method: "Card", amount: "$89.50" },
  { id: "INV-1045", status: "Overdue", method: "Bank transfer", amount: "$640.00" },
]

export function TableDemo() {
  return (
    <Table>
      <TableCaption>Recent invoices</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Method</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((inv) => (
          <TableRow key={inv.id}>
            <TableCell className="font-medium">{inv.id}</TableCell>
            <TableCell>{inv.status}</TableCell>
            <TableCell>{inv.method}</TableCell>
            <TableCell className="text-right">{inv.amount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function TableCompactDemo() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Method</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((inv) => (
          <TableRow key={inv.id}>
            <TableCell className="font-medium">{inv.id}</TableCell>
            <TableCell>{inv.status}</TableCell>
            <TableCell>{inv.method}</TableCell>
            <TableCell className="text-right">{inv.amount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function TableMutedDemo() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Priya Shah</TableCell>
          <TableCell className="text-text-muted">Owner</TableCell>
        </TableRow>
        <TableRow className="bg-bg-elevated">
          <TableCell>Marcus Lee</TableCell>
          <TableCell className="text-text-muted">Admin (selected)</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Ana Torres</TableCell>
          <TableCell className="text-text-muted">Viewer</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
