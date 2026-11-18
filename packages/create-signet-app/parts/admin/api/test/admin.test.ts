import { expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { users } from "../api/db/schema.ts"
import { ADMIN, app, db, signIn } from "./helpers.ts"

test("admin is for ADMIN_PHONES (and other staff roles) only", async () => {
  const user = await signIn("+919000000003")
  expect((await app.request("/api/admin", { headers: { cookie: user } })).status).toBe(403)
  const admin = await signIn(ADMIN)
  const res = await app.request("/api/admin/users", { headers: { cookie: admin } })
  expect(res.status).toBe(200)
  expect(((await res.json()) as { rows: unknown[] }).rows.length).toBeGreaterThan(0)
})

test("staff cannot change a role or phone; an admin can", async () => {
  const staff = await signIn("+919000000006")
  const staffRow = db.orm.select().from(users).where(eq(users.phone, "+919000000006")).get()
  db.orm.update(users).set({ role: "staff" }).where(eq(users.phone, "+919000000006")).run()
  const patch = (cookie: string, id: string, body: unknown) =>
    app.request(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    })
  const id = staffRow?.id ?? ""

  expect((await patch(staff, id, { role: "admin" })).status).toBe(403)
  expect((await patch(staff, id, { phone: "+919000000099" })).status).toBe(403)
  expect((await patch(staff, id, { name: "Staff" })).status).toBe(200)
  expect(db.orm.select().from(users).where(eq(users.id, id)).get()?.role).toBe("staff")

  const admin = await signIn(ADMIN)
  expect((await patch(admin, id, { role: "readonly" })).status).toBe(200)
  expect(db.orm.select().from(users).where(eq(users.id, id)).get()?.role).toBe("readonly")
})
