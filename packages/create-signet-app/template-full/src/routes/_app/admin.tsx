import { createApiClient } from "@dapplelight/signet-lib/api"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@dapplelight/signet-ui/components/table"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"

export const Route = createFileRoute("/_app/admin")({
  component: Admin,
})

// The admin API (api/app.ts, /api/admin) is signet-db's defineAdmin over the
// whole schema: list, search, filter, edit and delete, audited, by role.
// TODO(admin-screen): replace this page with `AdminScreen` from
// "@dapplelight/signet-ui/screens/admin-screens" once that screen is
// published: <AdminScreen api={createAdminApi({ baseUrl: "/api/admin" })} />.
// Until then this lists each table's first page, read-only.
const http = createApiClient({ baseUrl: "/api/admin" })

type Meta = { tables: { name: string; columns: { key: string; list: boolean }[] }[] }
type Page = { rows: Record<string, unknown>[] }

function Admin() {
  const meta = useQuery({ queryKey: ["admin"], queryFn: () => http.get<Meta>("") }).data
  const [table, setTable] = useState("users")
  const rows = useQuery({
    queryKey: ["admin", table],
    queryFn: () => http.get<Page>(`/${table}?limit=20`),
  }).data?.rows
  const columns = meta?.tables.find((t) => t.name === table)?.columns.filter((c) => c.list) ?? []

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium">Admin</h1>
      <div className="flex flex-wrap gap-1 text-sm">
        {meta?.tables.map((t) => (
          <button
            key={t.name}
            type="button"
            data-active={t.name === table || undefined}
            onClick={() => setTable(t.name)}
            className="rounded-md px-2 py-1 text-muted-foreground data-active:bg-muted data-active:text-foreground"
          >
            {t.name}
          </button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key}>{c.key}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows?.map((row, i) => (
            <TableRow key={String(row.id ?? i)}>
              {columns.map((c) => (
                <TableCell key={c.key}>{format(row[c.key])}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

const format = (v: unknown) =>
  v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)
