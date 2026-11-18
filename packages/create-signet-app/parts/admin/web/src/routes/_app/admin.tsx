import {
  AdminHeader,
  AdminMain,
  AdminNav,
  AdminPager,
  AdminPanel,
  AdminRecordSheet,
  AdminTable,
  AdminToolbar,
  createAdminApi,
} from "@dapplelight/signet-ui/screens/admin-screens"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/admin")({
  component: Admin,
})

// The admin API (api/app.ts, /api/admin) is signet-db's defineAdmin over the
// whole schema: list, search, filter, edit and delete, audited, by role. The
// panel reads its tables and columns from that API. Drop a part, reorder
// them, or add your own inside <AdminPanel> (useAdmin() reads its state);
// <AdminScreen api={adminApi} /> is the same layout in one line.
const adminApi = createAdminApi({ baseUrl: "/api/admin" }) // @api
const adminApi = createAdminApi({ baseUrl: `${import.meta.env.VITE_API_URL ?? ""}/api/admin` }) // @!api

function Admin() {
  return (
    <AdminPanel api={adminApi} defaultTable="users">
      <AdminNav />
      <AdminMain>
        <AdminHeader />
        <AdminToolbar />
        <AdminTable />
        <AdminPager />
      </AdminMain>
      <AdminRecordSheet />
    </AdminPanel>
  )
}
