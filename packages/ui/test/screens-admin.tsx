/**
 * The admin screen against an in-memory AdminApi: table list, sort, search,
 * filters, paging, selection and bulk delete, the record panel (form, save,
 * history), labels and classNames. Keyboard, focus and ARIA throughout.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { act, cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { AdminScreen, createAdminApi, AdminApiError } = await import(
  "../src/components/screens/admin-screens"
)
type Api = import("../src/components/screens/admin-screens").AdminApi
type Meta = import("../src/components/screens/admin-screens").AdminMeta
type Query = import("../src/components/screens/admin-screens").AdminListQuery

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
/** For waitFor: throws until true, so waitFor retries; counts once it holds. */
const must = (n: string, c: boolean, d: unknown = "") => {
  if (!c) throw new Error(`${n} ${JSON.stringify(d)}`)
  ok(n, c)
}
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (e) {
    ok(`${name} (threw: ${(e as Error).message.split("\n")[0]})`, false)
  } finally {
    cleanup()
  }
}

const col = (key: string, extra: Partial<Meta["tables"][0]["columns"][0]> = {}) => ({
  name: key,
  key,
  type: "text",
  notNull: true,
  primaryKey: false,
  unique: false,
  hasDefault: false,
  readonly: false,
  list: true,
  sortable: true,
  filterable: true,
  searchable: true,
  operators: ["eq", "ne", "in", "isNull", "contains", "startsWith"] as never,
  ...extra,
})

const META: Meta = {
  tables: [
    {
      name: "projects",
      primaryKey: ["id"],
      softDelete: true,
      ops: ["list", "get", "create", "update", "delete", "action"],
      actions: [{ name: "archive", description: "Hide it from lists", destructive: false }],
      columns: [
        col("id", { primaryKey: true, hasDefault: true, readonly: true }),
        col("name"),
        col("status", { enum: ["open", "closed"] }),
        col("budget", { type: "integer", searchable: false, notNull: false }),
        col("deletedAt", { type: "integer", notNull: false, readonly: true, list: false }),
      ],
      relations: [],
      defaultSort: { sort: "id", order: "desc" },
    },
    {
      name: "audit_log",
      primaryKey: ["id"],
      softDelete: false,
      ops: ["list", "get"],
      actions: [],
      columns: ["id", "at", "actorType", "actorId", "action", "tableName", "rowId"].map((k) =>
        col(k, { readonly: true }),
      ),
      relations: [],
      defaultSort: { sort: "id", order: "desc" },
    },
  ],
}

function fakeApi() {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: `p${String(i + 1).padStart(2, "0")}`,
    name: i === 0 ? "Apollo" : `Project ${i + 1}`,
    status: i % 3 ? "open" : "closed",
    budget: i * 100,
    deletedAt: null as number | null,
  }))
  const calls: { op: string; args: unknown[] }[] = []
  const audit = [
    {
      id: "a1",
      at: "2026-11-01T10:00:00.000Z",
      actorType: "user",
      actorId: "u1",
      action: "update",
      tableName: "projects",
      rowId: "p01",
      before: { name: "Apolo" },
      after: { name: "Apollo" },
    },
  ]
  const api: Api = {
    meta: async () => META,
    list: async (table: string, q: Query) => {
      calls.push({ op: "list", args: [table, q] })
      if (table === "audit_log") return { rows: audit, nextCursor: null }
      let r = rows.filter((x) => q.withDeleted || x.deletedAt === null)
      if (q.q) r = r.filter((x) => x.name.toLowerCase().includes((q.q as string).toLowerCase()))
      if (q.filter?.status?.eq) r = r.filter((x) => x.status === q.filter?.status?.eq)
      const key = (q.sort ?? "id") as keyof (typeof rows)[0]
      r = [...r].sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1))
      if (q.order === "desc") r.reverse()
      const start = q.cursor ? Number(q.cursor) : 0
      const limit = q.limit ?? 25
      return {
        rows: r.slice(start, start + limit),
        nextCursor: start + limit < r.length ? String(start + limit) : null,
      }
    },
    get: async (_t, id) => rows.find((r) => r.id === id) as never,
    create: async (_t, v) => {
      calls.push({ op: "create", args: [v] })
      if (!v.name)
        throw new AdminApiError(400, "Validation failed", "VALIDATION_FAILED", {
          name: ["Required"],
        })
      const row = { id: "new", name: "", status: "open", budget: 0, deletedAt: null, ...v } as never
      rows.push(row)
      return row
    },
    update: async (_t, id, v) => {
      calls.push({ op: "update", args: [id, v] })
      const r = rows.find((x) => x.id === id) as (typeof rows)[0]
      Object.assign(r, v)
      return r
    },
    remove: async (_t, id) => {
      calls.push({ op: "remove", args: [id] })
      const r = rows.find((x) => x.id === id) as (typeof rows)[0]
      r.deletedAt = Date.now()
      return { id, soft: true }
    },
    bulkDelete: async (_t, ids) => {
      calls.push({ op: "bulkDelete", args: [ids] })
      for (const r of rows) if (ids.includes(r.id)) r.deletedAt = Date.now()
      return { ids, soft: true }
    },
    action: async (_t, id, name) => {
      calls.push({ op: "action", args: [id, name] })
      return null
    },
  }
  return { api, calls, rows }
}

const lastList = (calls: { op: string; args: unknown[] }[]) =>
  [...calls].reverse().find((c) => c.op === "list" && c.args[0] === "projects")?.args[1] as Query

await t("Admin: table list and rows", async () => {
  const { api } = fakeApi()
  render(<AdminScreen api={api} pageSize={10} />)
  const nav = await screen.findByRole("navigation", { name: "Tables" })
  const current = await within(nav).findByRole("button", { current: "page" })
  ok("Admin: first listable table opens", current.textContent?.includes("Projects") ?? false)
  await screen.findByText("Project 30")
  ok("Admin: header shows the table", !!screen.getByRole("heading", { name: "Projects" }))
  ok("Admin: list columns become headers", !!screen.getByRole("button", { name: "Sort by Name" }))
  ok(
    "Admin: hidden-from-list column is not a header",
    !screen.queryByRole("button", { name: "Sort by Deleted at" }),
  )
  const idHead = screen.getByRole("button", { name: "Sort by Id" }).closest("th") as HTMLElement
  ok("Admin: default sort is announced", idHead.getAttribute("aria-sort") === "descending")
  await userEvent.click(within(nav).getByRole("button", { name: "Audit log" }))
  ok(
    "Admin: switching tables marks the new one current",
    within(nav).getByRole("button", { name: "Audit log" }).getAttribute("aria-current") === "page",
  )
  ok("Admin: list-only table has no New button", !screen.queryByRole("button", { name: "New" }))
})

await t("Admin: sort, search, filter, paging", async () => {
  const { api, calls } = fakeApi()
  render(<AdminScreen api={api} pageSize={10} />)
  await screen.findByText("Project 30")
  const sortName = screen.getByRole("button", { name: "Sort by Name" })
  sortName.focus()
  await userEvent.keyboard("{Enter}")
  await waitFor(() =>
    must(
      "Admin: Enter on a header sorts desc",
      lastList(calls).sort === "name" && lastList(calls).order === "desc",
    ),
  )
  await userEvent.keyboard("{Enter}")
  await waitFor(() => must("Admin: again sorts asc", lastList(calls).order === "asc"))
  ok("Admin: aria-sort follows", sortName.closest("th")?.getAttribute("aria-sort") === "ascending")

  await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "apol")
  await waitFor(
    () =>
      must(
        "Admin: search reaches the api (debounced)",
        lastList(calls).q === "apol",
        lastList(calls),
      ),
    { timeout: 1000 },
  )
  await screen.findByText("Apollo")
  await userEvent.clear(screen.getByRole("searchbox", { name: "Search" }))

  await userEvent.click(screen.getByRole("button", { name: "Filter" }))
  await userEvent.selectOptions(screen.getByLabelText("Column"), "status")
  await userEvent.selectOptions(screen.getByLabelText("Value"), "closed")
  await userEvent.click(screen.getByRole("button", { name: "Add filter" }))
  await waitFor(() =>
    must(
      "Admin: filter is sent as { status: { eq } }",
      (lastList(calls).filter as Record<string, unknown>)?.status !== undefined,
    ),
  )
  const chip = screen.getByRole("button", { name: "Remove filter Status is closed" })
  ok("Admin: active filter shows as a removable chip", !!chip)
  await userEvent.click(chip)
  await waitFor(() => must("Admin: removing the chip clears it", !lastList(calls).filter))

  const next = screen.getByRole("button", { name: "Next page" })
  ok(
    "Admin: previous is disabled on page 1",
    (screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled,
  )
  await waitFor(() => must("Admin: next is enabled", !(next as HTMLButtonElement).disabled))
  await userEvent.click(next)
  await waitFor(() => must("Admin: next sends the cursor", lastList(calls).cursor === "10"))
  ok("Admin: page number updates", !!screen.getByText("Page 2"))
})

await t("Admin: selection and bulk delete", async () => {
  const { api, calls } = fakeApi()
  render(<AdminScreen api={api} pageSize={5} />)
  await screen.findByText("Project 30")
  await userEvent.click(screen.getByRole("checkbox", { name: "Select row p30" }))
  await userEvent.click(screen.getByRole("checkbox", { name: "Select row p29" }))
  ok("Admin: selection count is shown", !!screen.getByText("2 selected"))
  ok(
    "Admin: header checkbox is mixed",
    screen.getByRole("checkbox", { name: "Select all rows" }).getAttribute("aria-checked") ===
      "mixed",
  )
  await userEvent.click(screen.getByRole("button", { name: "Delete" }))
  const dialog = await screen.findByRole("alertdialog", { name: "Delete 2 rows?" })
  ok("Admin: bulk delete asks first", !!dialog)
  ok("Admin: focus starts on Cancel", document.activeElement?.textContent === "Cancel")
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
  await waitFor(() =>
    must(
      "Admin: bulkDelete gets the ids",
      JSON.stringify(calls.find((c) => c.op === "bulkDelete")?.args[0]) === '["p30","p29"]',
    ),
  )
  await waitFor(() => must("Admin: selection clears after", !screen.queryByText("2 selected")))
})

await t("Admin: record panel, form, history", async () => {
  const { api, calls } = fakeApi()
  render(<AdminScreen api={api} pageSize={30} />)
  await screen.findByText("Apollo")
  const opener = screen.getByRole("button", { name: "Open p01" })
  opener.focus()
  await userEvent.keyboard("{Enter}")
  const dialog = await screen.findByRole("dialog")
  ok(
    "Admin: panel is a modal dialog",
    dialog.getAttribute("aria-modal") === "true" || dialog.hasAttribute("data-open"),
  )
  const name = (await within(dialog).findByLabelText(/^Name/)) as HTMLInputElement
  ok("Admin: form field labelled from the column", name.value === "Apollo")
  ok(
    "Admin: managed columns are read-only text, not inputs",
    !within(dialog).queryByLabelText(/^Id/),
  )
  const save = within(dialog).getByRole("button", { name: "Save" }) as HTMLButtonElement
  ok("Admin: Save waits for a change", save.disabled)
  await userEvent.clear(name)
  await userEvent.type(name, "Apollo 2")
  await userEvent.click(save)
  await waitFor(() =>
    must(
      "Admin: update sends only changed columns",
      JSON.stringify(calls.find((c) => c.op === "update")?.args) === '["p01",{"name":"Apollo 2"}]',
    ),
  )
  await userEvent.click(within(dialog).getByRole("tab", { name: "History" }))
  await within(dialog).findByText("Updated")
  ok("Admin: history shows the change", !!within(dialog).getByText("Apolo"))
  await userEvent.keyboard("{Escape}")
  await waitFor(() => must("Admin: Escape closes the panel", !screen.queryByRole("dialog")))
})

await t("Admin: create with server field errors", async () => {
  const { api } = fakeApi()
  render(<AdminScreen api={api} />)
  await userEvent.click(await screen.findByRole("button", { name: "New" }))
  const dialog = await screen.findByRole("dialog")
  ok("Admin: create title", !!within(dialog).getByText("New projects"))
  ok("Admin: id with a default is left out", !within(dialog).queryByLabelText(/^Id/))
  await userEvent.click(within(dialog).getByRole("button", { name: "New" }))
  await waitFor(() => {
    const name = within(dialog).getByLabelText(/^Name/)
    must(
      "Admin: server field error marks the field invalid",
      name.getAttribute("aria-invalid") === "true",
    )
  })
  ok("Admin: and shows the message", !!within(dialog).getByText("Required"))
})

await t("Admin: row actions", async () => {
  const { api, calls } = fakeApi()
  render(<AdminScreen api={api} pageSize={30} />)
  await screen.findByText("Apollo")
  const menus = screen.getAllByRole("button", { name: "Row actions" })
  await userEvent.click(menus[menus.length - 1] as HTMLElement)
  await userEvent.click(await screen.findByRole("menuitem", { name: "Archive" }))
  const dialog = await screen.findByRole("alertdialog", { name: "Archive?" })
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }))
  await waitFor(() =>
    must(
      "Admin: action runs on the row",
      calls.some((c) => c.op === "action" && c.args[1] === "archive"),
    ),
  )
})

await t("Admin: labels and classNames", async () => {
  const { api } = fakeApi()
  render(
    <AdminScreen
      api={api}
      labels={{ tables: "Tablas", create: "Nuevo", search: "Buscar" }}
      classNames={{ nav: "custom-nav", table: "custom-table" }}
      className="custom-root"
    />,
  )
  const nav = await screen.findByRole("navigation", { name: "Tablas" })
  ok("Admin: labels override", !!nav && !!(await screen.findByRole("button", { name: "Nuevo" })))
  ok(
    "Admin: className merges on root",
    !!document.querySelector("[data-slot=admin-panel].custom-root"),
  )
  ok(
    "Admin: classNames reach parts",
    nav.classList.contains("custom-nav") &&
      !!document.querySelector("[data-slot=admin-table].custom-table"),
  )
})

await t("createAdminApi: routes and errors", async () => {
  const seen: { url: string; init: RequestInit }[] = []
  const api = createAdminApi({
    baseUrl: "/admin/",
    headers: () => ({ authorization: "Bearer t" }),
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      if (init.method === "POST" && url.endsWith("/projects"))
        return Response.json(
          {
            success: false,
            error: "Validation failed",
            code: "VALIDATION_FAILED",
            details: { formErrors: [], fieldErrors: { name: ["Required"] } },
          },
          { status: 400 },
        )
      return Response.json({ rows: [], nextCursor: null })
    }) as unknown as typeof fetch,
  })
  await api.list("projects", {
    sort: "name",
    order: "asc",
    filter: { status: { eq: "open" } },
    withDeleted: true,
    q: "",
  })
  const u = new URL(seen[0]?.url as string, "http://x")
  ok("createAdminApi: list path", u.pathname === "/admin/projects")
  ok("createAdminApi: filter as JSON", u.searchParams.get("filter") === '{"status":{"eq":"open"}}')
  ok(
    "createAdminApi: empty q dropped",
    !u.searchParams.has("q") && u.searchParams.get("withDeleted") === "true",
  )
  ok(
    "createAdminApi: headers and cookies",
    (seen[0]?.init.headers as Record<string, string> | undefined)?.authorization === "Bearer t" &&
      seen[0]?.init.credentials === "include",
  )
  await api.bulkDelete("projects", ["a"])
  ok(
    "createAdminApi: bulk delete route",
    seen[1]?.url === "/admin/projects/bulk-delete" && seen[1]?.init.body === '{"ids":["a"]}',
  )
  try {
    await api.create("projects", {})
    ok("createAdminApi: error thrown", false)
  } catch (e) {
    ok(
      "createAdminApi: envelope becomes AdminApiError with fieldErrors",
      e instanceof AdminApiError && e.fieldErrors.name?.[0] === "Required",
    )
  }
})

await act(async () => {})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
process.exit(0)
