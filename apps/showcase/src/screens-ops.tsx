// Demo page for the operator and money screens: /screens-ops.html?screen=admin
// (admin, admin-record, billing, paywall, growth, workflows), &theme=<name>, &dark=1.
// Everything runs on in-memory data; nothing calls a server.
import {
  type AdminApi,
  type AdminListQuery,
  type AdminMeta,
  type AdminRow,
  AdminScreen,
} from "@dapplelight/signet-ui/screens/admin-screens"
import {
  BillingScreen,
  Paywall,
  plansFromEntitlements,
} from "@dapplelight/signet-ui/screens/billing-screens"
import {
  FeedbackWidget,
  InviteAccept,
  OnboardingChecklist,
  ReferralCard,
  WaitlistJoin,
  WhatsNew,
} from "@dapplelight/signet-ui/screens/growth-screens"
import {
  ApprovalInboxCard,
  WorkflowRunTimeline,
} from "@dapplelight/signet-ui/screens/workflow-screens"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { applyTheme, initialTheme, THEMES } from "./themes"

const params = new URLSearchParams(location.search)
const which = params.get("screen") ?? "admin"

// ------------------------------------------------------------------- admin

const col = (key: string, extra: Record<string, unknown> = {}) => ({
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
  searchable: false,
  operators: ["eq", "ne", "in", "isNull", "contains", "startsWith"],
  ...extra,
})

const META = {
  tables: [
    {
      name: "customers",
      primaryKey: ["id"],
      softDelete: true,
      ops: ["list", "get", "create", "update", "delete", "action"],
      actions: [
        { name: "sendReceipt", description: "Email the last receipt again", destructive: false },
      ],
      columns: [
        col("id", { primaryKey: true, hasDefault: true, readonly: true }),
        col("name", { searchable: true }),
        col("email", { searchable: true }),
        col("plan", { enum: ["free", "pro", "team"] }),
        col("verified", { type: "integer" }),
        col("balance", { type: "integer", moneyCurrency: "balanceCurrency" }),
        col("balanceCurrency", { list: false }),
        col("notes", { notNull: false, list: false }),
        col("createdAt", { type: "integer", readonly: true, hasDefault: true }),
        col("deletedAt", { type: "integer", notNull: false, readonly: true, list: false }),
      ],
      relations: [],
      defaultSort: { sort: "createdAt", order: "desc" },
    },
    ...["orders", "subscriptions", "feature_flags"].map((name) => ({
      name,
      primaryKey: ["id"],
      softDelete: false,
      ops: ["list", "get"],
      actions: [],
      columns: [col("id", { primaryKey: true, readonly: true })],
      relations: [],
      defaultSort: { sort: "id", order: "desc" },
    })),
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
} as unknown as AdminMeta

const FIRST = ["Aarav", "Meera", "Kabir", "Zoya", "Ishaan", "Anika", "Vihaan", "Tara", "Rohan"]
const LAST = ["Shah", "Iyer", "Kapoor", "Nair", "Mehta", "Rao", "Das", "Bose", "Gill"]
const customers: AdminRow[] = Array.from({ length: 42 }, (_, i) => {
  const name = `${FIRST[i % 9]} ${LAST[(i * 4) % 9]}`
  return {
    id: `cus_${(9100 + i).toString(36)}`,
    name,
    email: `${name.toLowerCase().replace(" ", ".")}@example.com`,
    plan: ["pro", "free", "team", "pro"][i % 4],
    verified: i % 5 !== 2,
    balance: (i * 73_919) % 2_500_00,
    balanceCurrency: "INR",
    notes: i === 0 ? "Asked about annual billing." : null,
    createdAt: new Date(Date.UTC(2026, 10, 14) - i * 36e5 * 19).toISOString(),
    deletedAt: null,
  }
})
const audit = [
  {
    id: "a2",
    at: "2026-11-14T09:12:00.000Z",
    actorType: "user",
    actorId: "admin_1",
    action: "update",
    tableName: "customers",
    rowId: customers[0]?.id,
    before: { plan: "free" },
    after: { plan: "pro" },
  },
  {
    id: "a1",
    at: "2026-11-02T16:40:00.000Z",
    actorType: "system",
    actorId: "signup",
    action: "insert",
    tableName: "customers",
    rowId: customers[0]?.id,
    before: null,
    after: {},
  },
]

const api: AdminApi = {
  meta: async () => META,
  list: async (table: string, q: AdminListQuery) => {
    if (table === "audit_log") return { rows: audit, nextCursor: null }
    if (table !== "customers") return { rows: [], nextCursor: null }
    let rows = customers.filter((r) => q.withDeleted || !r.deletedAt)
    if (q.q)
      rows = rows.filter((r) =>
        JSON.stringify(r)
          .toLowerCase()
          .includes(q.q?.toLowerCase() ?? ""),
      )
    for (const [k, spec] of Object.entries(q.filter ?? {}))
      if (spec.eq !== undefined) rows = rows.filter((r) => String(r[k]) === String(spec.eq))
    const key = q.sort ?? "createdAt"
    rows = [...rows].sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1))
    if (q.order !== "asc") rows.reverse()
    const start = Number(q.cursor ?? 0)
    const limit = q.limit ?? 25
    return {
      rows: rows.slice(start, start + limit),
      nextCursor: start + limit < rows.length ? String(start + limit) : null,
    }
  },
  get: async (_t, id) => customers.find((r) => r.id === id) ?? {},
  create: async (_t, v) => {
    const row = {
      id: `cus_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      ...v,
    }
    customers.unshift(row)
    return row
  },
  update: async (_t, id, v) => Object.assign(customers.find((r) => r.id === id) ?? {}, v),
  remove: async (_t, id) => {
    const r = customers.find((x) => x.id === id)
    if (r) r.deletedAt = new Date().toISOString()
    return { id, soft: true }
  },
  bulkDelete: async (_t, ids) => {
    for (const r of customers)
      if (ids.includes(String(r.id))) r.deletedAt = new Date().toISOString()
    return { ids, soft: true }
  },
  action: async () => null,
}

// ----------------------------------------------------------------- billing

const PLANS = plansFromEntitlements(
  {
    free: { features: ["basicReports"], limits: { projects: 3 } },
    pro: { features: ["basicReports", "export", "prioritySupport"], limits: { projects: 50 } },
    team: {
      features: ["basicReports", "export", "prioritySupport", "singleSignOn"],
      limits: { projects: Number.POSITIVE_INFINITY },
    },
  },
  {
    free: {
      name: "Free",
      description: "For trying things out",
      prices: { month: { amount: 0, currency: "INR" }, year: { amount: 0, currency: "INR" } },
    },
    pro: {
      name: "Pro",
      description: "For individuals",
      badge: "Popular",
      prices: {
        month: { amount: 49900, currency: "INR" },
        year: { amount: 499000, currency: "INR" },
      },
    },
    team: {
      name: "Team",
      description: "For small teams",
      prices: {
        month: { amount: 149900, currency: "INR" },
        year: { amount: 1499000, currency: "INR" },
      },
    },
  },
)

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const at = (min: number) => new Date(Date.UTC(2026, 10, 14, 9, min)).toISOString()

function WorkflowsDemo() {
  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-4 py-8 md:grid-cols-[3fr_2fr]">
      <WorkflowRunTimeline
        run={{
          id: "run_1",
          workflow: "vendor-payout",
          status: "waiting",
          createdAt: at(0),
          waitingOn: {
            step: "approval",
            kind: "approval",
            until: at(600),
            approvers: ["Meera Iyer", "Kabir Rao"],
          },
        }}
        steps={[
          {
            stepId: "load-invoice",
            kind: "run",
            status: "completed",
            attempts: 1,
            startedAt: at(0),
          },
          {
            stepId: "verify-gstin",
            kind: "run",
            status: "completed",
            attempts: 3,
            startedAt: at(1),
          },
          { stepId: "cool-off", kind: "sleep", status: "completed", startedAt: at(2) },
          {
            stepId: "approval",
            kind: "approval",
            status: "waiting",
            summary: "Pay Northwind Studio ₹48,000",
            approvers: ["Meera Iyer", "Kabir Rao"],
            startedAt: at(62),
          },
        ]}
        onCancel={() => wait(600)}
      />
      <ApprovalInboxCard
        approvals={[
          {
            runId: "run_1",
            stepId: "approval",
            workflow: "vendor-payout",
            summary: "Pay Northwind Studio ₹48,000",
            approvers: ["Meera Iyer"],
            requestedAt: at(62),
            expiresAt: at(600),
          },
          {
            runId: "run_2",
            stepId: "approval",
            workflow: "refund",
            summary: "Refund order #1042",
            approvers: ["Meera Iyer"],
            requestedAt: at(75),
          },
        ]}
        onApprove={() => wait(600)}
        onReject={() => wait(600)}
        href={(a) => `#${a.runId}`}
      />
    </div>
  )
}

function Screen() {
  if (which === "workflows") return <WorkflowsDemo />
  if (which === "admin" || which === "admin-record")
    return (
      <div className="p-4 md:p-8">
        <AdminScreen
          api={api}
          pageSize={10}
          {...(which === "admin-record" ? { defaultRecord: { id: String(customers[0]?.id) } } : {})}
          className="min-h-[44rem]"
        />
      </div>
    )
  if (which === "paywall")
    return (
      <div className="px-4 py-10">
        <Paywall
          plans={PLANS}
          source="appstore"
          currentPlan="free"
          subtitle="Unlock exports, more projects and priority support."
          onSubscribe={() => wait(800)}
          onRestore={async () => {
            await wait(600)
            return true
          }}
        />
      </div>
    )
  if (which === "billing")
    return (
      <div className="px-4 py-8">
        <BillingScreen
          plans={PLANS}
          subscription={{
            plan: "pro",
            status: "active",
            currentPeriodEnd: "2026-12-14T00:00:00.000Z",
            source: { gateway: "googleplay", subscriptionId: "gp_1" },
          }}
          source="googleplay"
          usage={[
            { key: "projects", period: "total", used: 38, limit: 50, remaining: 12 },
            { key: "credits", period: "2026-11", used: 930, limit: 1000, remaining: 70 },
            {
              key: "seats",
              period: "total",
              used: 3,
              limit: Number.POSITIVE_INFINITY,
              remaining: Number.POSITIVE_INFINITY,
            },
          ]}
          wallet={{ balance: 125050, currency: "INR", onTopUp: () => {} }}
          invoices={[
            {
              id: "3",
              number: "INV/26-27/0031",
              date: "2026-11-14",
              total: 58882,
              currency: "INR",
              status: "paid",
              href: "#",
            },
            {
              id: "2",
              number: "INV/26-27/0019",
              date: "2026-10-14",
              total: 58882,
              currency: "INR",
              status: "paid",
              href: "#",
            },
            {
              id: "1",
              number: "INV/26-27/0004",
              date: "2026-09-14",
              total: 58882,
              currency: "INR",
              status: "refunded",
              href: "#",
            },
          ]}
          onManage={() => {}}
          onRestore={() => true}
          onSubscribe={() => wait(800)}
        />
      </div>
    )
  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-4 py-8 md:grid-cols-2">
      <div className="flex flex-col gap-5">
        <WaitlistJoin onJoin={async (email) => ({ email, position: 1284, joined: true })} />
        <WaitlistJoin
          defaultResult={{ position: 1284, joined: true }}
          onJoin={() => ({ position: 1, joined: true })}
        />
        <OnboardingChecklist
          steps={[
            { key: "profile", title: "Add your photo" },
            {
              key: "project",
              title: "Create your first project",
              description: "It takes about a minute.",
            },
            { key: "invite", title: "Invite a teammate" },
            { key: "billing", title: "Pick a plan" },
          ]}
          defaultDone={["profile"]}
          onDismiss={() => {}}
        />
      </div>
      <div className="flex flex-col gap-5">
        <InviteAccept
          invite={{
            inviterName: "Meera Iyer",
            scopeName: "Northwind Studio",
            role: "editor",
            expiresAt: "2026-11-30",
          }}
          onAccept={async () => ({ ok: true })}
          onDecline={() => {}}
        />
        <ReferralCard
          code="MEERA42"
          url="https://app.example.com/?ref=MEERA42"
          stats={{ referred: 12, converted: 5, rewarded: 3 }}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <WhatsNew
            unseen={2}
            defaultOpen={params.get("open") === "news"}
            entries={[
              { id: "3", date: "2026-11-12", title: "Dark mode everywhere", tag: "New", href: "#" },
              { id: "2", date: "2026-11-03", title: "Export to CSV from any table", tag: "New" },
              { id: "1", date: "2026-10-20", title: "Faster search", tag: "Fix" },
            ]}
          />
          <FeedbackWidget
            rating
            defaultOpen={params.get("open") === "feedback"}
            onSubmit={() => wait(500)}
          />
        </div>
      </div>
    </div>
  )
}

const SCREENS = ["admin", "admin-record", "billing", "paywall", "growth", "workflows"]

/** Links between the demos, keeping the theme and dark mode in the URL. */
function DemoBar() {
  const theme = initialTheme()
  const dark = document.documentElement.classList.contains("dark")
  const href = (over: Record<string, string>) =>
    `?${new URLSearchParams({ screen: which, theme, dark: dark ? "1" : "0", ...over })}`
  const link =
    "rounded-md px-2 py-1 text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary aria-[current=page]:bg-bg-elevated aria-[current=page]:font-medium aria-[current=page]:text-text-primary"
  return (
    <nav
      aria-label="Demo"
      className="flex flex-wrap items-center gap-1 border-b border-border-default bg-bg-surface px-4 py-2"
    >
      <a href="./" className={link}>
        Showcase
      </a>
      <span aria-hidden className="mx-1 h-4 w-px bg-border-default" />
      {SCREENS.map((s) => (
        <a
          key={s}
          href={href({ screen: s })}
          aria-current={s === which ? "page" : undefined}
          className={link}
        >
          {s}
        </a>
      ))}
      <span aria-hidden className="mx-1 h-4 w-px bg-border-default" />
      {THEMES.map((t) => (
        <a
          key={t}
          href={href({ theme: t })}
          aria-current={t === theme ? "page" : undefined}
          className={link}
        >
          {t}
        </a>
      ))}
      <a href={href({ dark: dark ? "0" : "1" })} className={link}>
        {dark ? "Light" : "Dark"}
      </a>
    </nav>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element #root not found")
await applyTheme(initialTheme())
createRoot(root).render(
  <StrictMode>
    <main className="min-h-dvh bg-bg-base text-text-primary">
      <h1 className="sr-only">Signet screens: {which}</h1>
      <DemoBar />
      <Screen />
    </main>
  </StrictMode>,
)
