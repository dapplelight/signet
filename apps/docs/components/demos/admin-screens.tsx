"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import {
  type AdminApi,
  AdminAuditTrail,
  AdminFilterButton,
  AdminHeader,
  AdminMain,
  type AdminMeta,
  AdminNav,
  AdminPager,
  AdminPanel,
  AdminRecordForm,
  AdminRecordSheet,
  type AdminRecordTarget,
  type AdminRow,
  AdminRowActions,
  AdminScreen,
  AdminTable,
  AdminToolbar,
  useAdmin,
} from "@dapplelight/signet-ui/screens/admin-screens"
import { useMemo, useState } from "react"

const col = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  key: name,
  type: "text",
  notNull: true,
  primaryKey: false,
  unique: false,
  hasDefault: false,
  readonly: false,
  list: true,
  sortable: true,
  filterable: true,
  searchable: false,
  operators: ["eq", "contains"],
  ...over,
})

const meta = {
  tables: [
    {
      name: "orders",
      primaryKey: ["id"],
      softDelete: false,
      ops: ["list", "get", "create", "update", "delete", "action"],
      actions: [{ name: "refund", description: "Refund this order", destructive: true }],
      columns: [
        col("id", { primaryKey: true, hasDefault: true, readonly: true }),
        col("customer", { searchable: true }),
        col("status", { type: "text", enum: ["open", "paid", "refunded"], operators: ["eq"] }),
        col("total", { type: "integer", moneyCurrency: "INR", operators: ["eq", "gt", "lt"] }),
        col("createdAt", { type: "timestamp", readonly: true, operators: ["gt", "lt"] }),
      ],
      relations: [],
      defaultSort: { sort: "createdAt", order: "desc" },
    },
    {
      name: "audit_log",
      primaryKey: ["id"],
      softDelete: false,
      ops: ["list", "get"],
      actions: [],
      columns: [
        col("id", { primaryKey: true, readonly: true }),
        col("actorType"),
        col("actorId"),
        col("action"),
        col("tableName"),
        col("rowId"),
        col("at", { type: "timestamp" }),
        col("before", { type: "json", notNull: false }),
        col("after", { type: "json", notNull: false }),
      ],
      relations: [],
      defaultSort: { sort: "at", order: "desc" },
    },
  ],
} as unknown as AdminMeta

const day = 86400_000

function seed(): Record<string, AdminRow[]> {
  const names = ["Asha Verma", "Rohan Iyer", "Meera Nair", "Dev Patel", "Zoya Khan", "Kabir Shah"]
  const status = ["paid", "open", "paid", "refunded", "paid", "open"]
  return {
    orders: names.map((customer, i) => ({
      id: `ord_${1001 + i}`,
      customer,
      status: status[i],
      total: (i + 1) * 129900,
      createdAt: Date.now() - i * day,
    })),
    audit_log: [
      {
        id: "a2",
        actorType: "user",
        actorId: "admin_1",
        action: "update",
        tableName: "orders",
        rowId: "ord_1001",
        at: Date.now() - 3600_000,
        before: { status: "open" },
        after: { status: "paid" },
      },
      {
        id: "a1",
        actorType: "user",
        actorId: "admin_1",
        action: "create",
        tableName: "orders",
        rowId: "ord_1001",
        at: Date.now() - day,
      },
    ],
  }
}

/** An in-memory AdminApi, standing in for createAdminApi({ baseUrl: "/admin" }). */
function fakeApi(): AdminApi {
  const db = seed()
  const rows = (t: string) => db[t] ?? []
  return {
    meta: async () => meta,
    list: async (table, q) => {
      let r = [...rows(table)]
      for (const [k, ops] of Object.entries(q.filter ?? {})) {
        const eq = (ops as Record<string, unknown>).eq
        if (eq !== undefined) r = r.filter((x) => x[k] === eq)
      }
      if (q.q)
        r = r.filter((x) =>
          String(x.customer ?? "")
            .toLowerCase()
            .includes(q.q?.toLowerCase() ?? ""),
        )
      if (q.sort) {
        const k = q.sort
        const dir = q.order === "desc" ? -1 : 1
        r.sort((a, b) => (String(a[k]) > String(b[k]) ? dir : -dir))
      }
      return { rows: r, nextCursor: null }
    },
    get: async (table, id) => rows(table).find((x) => x.id === id) as AdminRow,
    create: async (table, values) => {
      const row = { id: `ord_${1000 + rows(table).length + 1}`, createdAt: Date.now(), ...values }
      db[table] = [row, ...rows(table)]
      return row
    },
    update: async (table, id, values) => {
      const i = rows(table).findIndex((x) => x.id === id)
      const next = { ...(rows(table)[i] as AdminRow), ...values }
      rows(table)[i] = next
      return next
    },
    remove: async (table, id) => {
      db[table] = rows(table).filter((x) => x.id !== id)
      return { id, soft: false }
    },
    bulkDelete: async (table, ids) => {
      db[table] = rows(table).filter((x) => !ids.includes(String(x.id)))
      return { ids, soft: false }
    },
    action: async () => ({ ok: true }),
  }
}

export function AdminScreenDemo() {
  const api = useMemo(fakeApi, [])
  return (
    <div className="w-full overflow-hidden rounded-lg border">
      <AdminScreen api={api} defaultTable="orders" />
    </div>
  )
}

export function AdminPanelDemo() {
  const api = useMemo(fakeApi, [])
  return (
    <div className="w-full overflow-hidden rounded-lg border">
      <AdminPanel api={api} defaultTable="orders">
        <AdminNav />
        <AdminMain>
          <AdminHeader />
          <AdminToolbar />
          <AdminTable />
          <AdminPager />
        </AdminMain>
      </AdminPanel>
    </div>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  const api = useMemo(fakeApi, [])
  return (
    <div className="w-full max-w-md rounded-lg border p-4">
      <AdminPanel api={api} defaultTable="orders" meta={meta} className="block">
        {children}
      </AdminPanel>
    </div>
  )
}

export function AdminToolbarDemo() {
  return (
    <Frame>
      <AdminToolbar />
    </Frame>
  )
}

export function AdminFilterButtonDemo() {
  return (
    <Frame>
      <AdminFilterButton />
    </Frame>
  )
}

export function AdminRecordFormDemo() {
  return (
    <Frame>
      <AdminRecordForm />
    </Frame>
  )
}

export function AdminAuditTrailDemo() {
  return (
    <Frame>
      <AdminAuditTrail table="orders" id="ord_1001" />
    </Frame>
  )
}

function FirstRowActions() {
  const { page } = useAdmin()
  const row = page.rows[0]
  return row ? <AdminRowActions row={row} /> : null
}

export function AdminRowActionsDemo() {
  return (
    <Frame>
      <FirstRowActions />
    </Frame>
  )
}

export function AdminRecordSheetDemo() {
  const api = useMemo(fakeApi, [])
  const [record, setRecord] = useState<AdminRecordTarget>(null)
  return (
    <AdminPanel
      api={api}
      defaultTable="orders"
      meta={meta}
      record={record}
      onRecordChange={setRecord}
      className="block"
    >
      <Button onClick={() => setRecord({ id: "ord_1001" })}>Open order ord_1001</Button>
      <AdminRecordSheet />
    </AdminPanel>
  )
}
