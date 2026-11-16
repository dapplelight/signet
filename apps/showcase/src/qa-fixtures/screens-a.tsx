// QA fixtures for the abuse, account, admin, api, auth and billing screens: static data and
// in-memory stubs, no network. Shapes follow the showcase pages (screens-user, screens-ops).
import { AiSpendAdmin, CaptchaWidget } from "@dapplelight/signet-ui/screens/abuse-screens"
import {
  AccountSection,
  AccountSectionHeader,
  ApiKeyReveal,
  ApiKeysManager,
  ProfileCard,
  SessionsList,
} from "@dapplelight/signet-ui/screens/account-screens"
import {
  type AdminApi,
  AdminHeader,
  type AdminListQuery,
  AdminMain,
  type AdminMeta,
  AdminNav,
  AdminPager,
  AdminPanel,
  AdminRecordSheet,
  type AdminRow,
  AdminScreen,
  AdminTable,
} from "@dapplelight/signet-ui/screens/admin-screens"
import {
  ApiReference,
  type ApiSpec,
  type WebhookDeliveryEntry,
  WebhookDeliveryLog,
} from "@dapplelight/signet-ui/screens/api-screens"
import {
  AuthScreen,
  CodeRequestForm,
  SessionExpiredScreen,
  VerifyCodeForm,
  VerifyCodeScreen,
} from "@dapplelight/signet-ui/screens/auth-screens"
import {
  type BillingInvoice,
  type BillingPlan,
  BillingScreen,
  CurrentPlanCard,
  InvoiceList,
  Paywall,
  PlanPicker,
  RestorePurchasesButton,
  UsageMeters,
  WalletCard,
} from "@dapplelight/signet-ui/screens/billing-screens"
import type { ReactNode } from "react"
import { type Fixtures, minutesAgo } from "./shared"

const noop = () => {}
const ok = async () => {}

/** Screens that are a bare card or form get page padding and a readable width. */
function Page({ children, width = "max-w-xl" }: { children: ReactNode; width?: string }) {
  return <div className={`mx-auto w-full p-4 sm:p-6 ${width}`}>{children}</div>
}

// ------------------------------------------------------------------ abuse

const SPEND_UNITS = 1_000_000
const usd = (n: number) => Math.round(n * SPEND_UNITS)

function AiSpendFixture() {
  return (
    <Page width="max-w-4xl">
      <AiSpendAdmin
        overview={{
          global: {
            scope: "global",
            subject: "*",
            day: { used: usd(41.2), cap: usd(50), remaining: usd(8.8) },
            month: { used: usd(612.4375), cap: usd(600), remaining: 0 },
          },
          top: {
            users: [
              { subject: "usr_9f2c1d", used: usd(120.5), cap: usd(100) },
              { subject: "usr_41aa7e", used: usd(86.0125), cap: usd(150) },
              { subject: "usr_7be210", used: usd(12.3), cap: null },
            ],
            orgs: [
              {
                subject: "org-northwind-logistics-private-limited-bengaluru-south-division-01",
                used: usd(310.75),
                cap: usd(400),
              },
              { subject: "org_blueharbor", used: usd(95.1), cap: null },
            ],
          },
        }}
        caps={[
          { id: "c1", scope: "global", subject: "*", period: "month", units: usd(600) },
          { id: "c2", scope: "user", subject: "*", period: "day", units: usd(5) },
          { id: "c3", scope: "user", subject: "usr_9f2c1d", period: "month", units: usd(100) },
          { id: "c4", scope: "org", subject: "org_blueharbor", period: "day", units: null },
        ]}
        onSetCap={() => true}
        onRemoveCap={noop}
      />
    </Page>
  )
}

// "test" loads no script and reports CAPTCHA_TEST_PASS at once: the only offline render.
function CaptchaFixture() {
  return (
    <Page width="max-w-sm">
      <CaptchaWidget provider="test" onToken={noop} />
    </Page>
  )
}

// ---------------------------------------------------------------- account

const LONG_NAME = "Alexandrina Montgomery-Featherstonehaugh de la Cruz Villanueva"

function ProfileFixture() {
  return (
    <Page>
      <ProfileCard
        profile={{
          name: LONG_NAME,
          email: "alexandrina.montgomery-featherstonehaugh@northwind.example",
          phone: "+91 98765 43210",
        }}
        onSave={ok}
      />
    </Page>
  )
}

function SessionsFixture() {
  return (
    <Page>
      <SessionsList
        sessions={[
          {
            id: "a",
            device: "Chrome on macOS",
            ip: "103.21.4.7",
            lastSeenAt: minutesAgo(0),
            current: true,
          },
          { id: "b", device: "Safari on iOS", ip: "49.36.12.90", lastSeenAt: minutesAgo(300) },
          {
            id: "c",
            device: "Firefox on Windows 11 with a very long device description string 24H2",
            ip: null,
            lastSeenAt: minutesAgo(80 * 60),
          },
        ]}
        onRevoke={ok}
        onRevokeOthers={ok}
      />
    </Page>
  )
}

function ApiKeysFixture() {
  return (
    <Page>
      <ApiKeysManager
        keys={[
          {
            id: "k1",
            name: "CI deploy",
            start: "app_9f2c1d",
            createdAt: minutesAgo(400 * 60),
            lastUsedAt: minutesAgo(120),
          },
          {
            id: "k2",
            name: "Zapier sync for the Northwind Ltd quarterly reconciliation workbook",
            start: "app_41aa7e",
            createdAt: minutesAgo(90 * 60),
            lastUsedAt: null,
          },
        ]}
        onCreate={async () => ({ token: "app_7be210c4e9f14b2a8d3e6f0a1b2c3d4e" })}
        onRevoke={ok}
      />
    </Page>
  )
}

// ApiKeyReveal is an inline row (not a dialog), so show it in the section it appears in.
function ApiKeyRevealFixture() {
  return (
    <Page>
      <AccountSection>
        <AccountSectionHeader title="Copy your key" />
        <p className="text-text-muted">You won't see it again.</p>
        <ApiKeyReveal token="app_7be210c4e9f14b2a8d3e6f0a1b2c3d4e5f60718293a4b5c6d7e8f9" />
      </AccountSection>
    </Page>
  )
}

// ------------------------------------------------------------------ admin

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

const ADMIN_META = {
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
    ...["orders", "subscriptions"].map((name) => ({
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

const PEOPLE: [string, string, string][] = [
  [
    "Priya Raghunathan-Venkataraman of Northwind Ltd, Procurement and Vendor Onboarding",
    "priya.r@northwind.example",
    "team",
  ],
  ["Aarav Shah", "aarav.shah@example.com", "pro"],
  ["Meera Iyer", "meera.iyer@example.com", "free"],
  ["Kabir Kapoor", "kabir.kapoor@example.com", "pro"],
  ["Zoya Nair", "zoya.nair@example.com", "team"],
  ["Ishaan Mehta", "ishaan.mehta@example.com", "free"],
  ["Anika Rao", "anika.rao@example.com", "pro"],
  ["Vihaan Das", "vihaan.das@example.com", "pro"],
  ["Tara Bose", "tara.bose@example.com", "free"],
  ["Rohan Gill", "rohan.gill@example.com", "team"],
]
const CUSTOMERS: AdminRow[] = PEOPLE.map(([name, email, plan], i) => ({
  id: `cus_${9100 + i}`,
  name,
  email,
  plan,
  verified: i % 4 !== 2,
  balance: 1_248_000 - i * 137_450,
  balanceCurrency: "INR",
  notes: i === 0 ? "Asked about annual billing." : null,
  createdAt: minutesAgo(60 * 19 * (i + 1)),
  deletedAt: null,
}))
const AUDIT: AdminRow[] = [
  {
    id: "a2",
    at: minutesAgo(60 * 30),
    actorType: "user",
    actorId: "admin_1",
    action: "update",
    tableName: "customers",
    rowId: "cus_9100",
    before: { plan: "free" },
    after: { plan: "team" },
  },
  {
    id: "a1",
    at: minutesAgo(60 * 24 * 20),
    actorType: "system",
    actorId: "signup",
    action: "insert",
    tableName: "customers",
    rowId: "cus_9100",
    before: null,
    after: {},
  },
]

const adminApi: AdminApi = {
  meta: async () => ADMIN_META,
  list: async (table: string, q: AdminListQuery) => {
    if (table === "audit_log") return { rows: AUDIT, nextCursor: null }
    if (table !== "customers") return { rows: [], nextCursor: null }
    const start = Number(q.cursor ?? 0)
    const limit = q.limit ?? 25
    return {
      rows: CUSTOMERS.slice(start, start + limit),
      nextCursor: start + limit < CUSTOMERS.length ? String(start + limit) : null,
    }
  },
  get: async (_t, id) => CUSTOMERS.find((r) => r.id === id) ?? {},
  create: async (_t, v) => v,
  update: async (_t, _id, v) => v,
  remove: async (_t, id) => ({ id, soft: true }),
  bulkDelete: async (_t, ids) => ({ ids, soft: true }),
  action: async () => null,
}

function AdminScreenFixture() {
  return (
    <div className="p-4 md:p-8">
      <AdminScreen api={adminApi} meta={ADMIN_META} pageSize={10} className="min-h-[44rem]" />
    </div>
  )
}

// The parts laid out by hand (no toolbar), with a record open in the side sheet.
function AdminPanelFixture() {
  return (
    <div className="p-4 md:p-8">
      <AdminPanel
        api={adminApi}
        meta={ADMIN_META}
        defaultTable="customers"
        defaultRecord={{ id: "cus_9101" }}
        pageSize={5}
      >
        <AdminNav />
        <AdminMain>
          <AdminHeader />
          <AdminTable />
          <AdminPager />
        </AdminMain>
        <AdminRecordSheet />
      </AdminPanel>
    </div>
  )
}

// -------------------------------------------------------------------- api

const SPEC: ApiSpec = {
  info: {
    title: "Northwind Ledger API",
    version: "2026-01-15",
    description: "Invoices, payouts and webhooks for Northwind Ltd. Amounts are in paise.",
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Send an API key as a bearer token.",
      },
      session: { type: "apiKey", in: "cookie", name: "sid" },
    },
  },
  paths: {
    "/v1/invoices": {
      get: {
        operationId: "listInvoices",
        summary: "List invoices, newest first, with optional status and date range filters",
        tags: ["Invoices"],
        parameters: [
          {
            name: "status",
            in: "query",
            description: "paid, due or void",
            schema: { type: "string", enum: ["paid", "due", "void"] },
          },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "A page of invoices",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { type: "object" } },
                    nextCursor: { type: "string" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Error" },
        },
      },
      post: {
        operationId: "createInvoice",
        summary: "Create an invoice",
        tags: ["Invoices"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["customerId", "total"],
                properties: { customerId: { type: "string" }, total: { type: "integer" } },
              },
            },
          },
        },
        responses: {
          "201": { description: "Created" },
          "422": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/v1/invoices/{id}": {
      delete: {
        operationId: "voidInvoice",
        summary: "Void an invoice",
        tags: ["Invoices"],
        deprecated: true,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "Voided" } },
      },
    },
    "/v1/health": {
      get: {
        operationId: "health",
        summary: "Liveness probe",
        tags: ["Status"],
        security: [],
        responses: { "200": { description: "ok" } },
      },
    },
  },
}

function ApiReferenceFixture() {
  return (
    <Page width="max-w-4xl">
      <ApiReference spec={SPEC} defaultOpen={["listInvoices"]} />
    </Page>
  )
}

const fixedTime = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`

const DELIVERIES: WebhookDeliveryEntry[] = [
  {
    id: "d1",
    endpointId: "e1",
    eventId: "evt_1042",
    type: "invoice.paid",
    status: "delivered",
    attempts: 1,
    responseStatus: 200,
    durationMs: 184,
    createdAt: minutesAgo(12),
  },
  {
    id: "d2",
    endpointId: "e2",
    eventId: "evt_1041",
    type: "payout.failed",
    status: "failed",
    attempts: 5,
    error: "connect ETIMEDOUT",
    durationMs: 10_000,
    body: '{"payout":"po_88","amount":4800000}',
    createdAt: minutesAgo(95),
    lastAttemptAt: minutesAgo(40),
  },
  {
    id: "d3",
    endpointId: "e1",
    eventId: "evt_1039",
    type: "customer.subscription.trial_will_end_soon_notification",
    status: "retrying",
    attempts: 2,
    responseStatus: 503,
    responseBody: "Service Unavailable",
    durationMs: 912,
    createdAt: minutesAgo(180),
    lastAttemptAt: minutesAgo(150),
  },
  {
    id: "d4",
    endpointId: "e3",
    eventId: "evt_1038",
    type: "invoice.created",
    status: "skipped",
    attempts: 0,
    createdAt: minutesAgo(26 * 60),
  },
]

function WebhookLogFixture() {
  return (
    <Page width="max-w-5xl">
      <WebhookDeliveryLog
        deliveries={DELIVERIES}
        endpoints={{
          e1: "https://hooks.northwind.example/signet",
          e2: "https://integrations.northwind-logistics.example/webhooks/ledger/payouts/v2/receive",
          e3: "https://hooks.example.org/ledger",
        }}
        formatTime={fixedTime}
        onRedeliver={ok}
        onLoadMore={noop}
        hasMore
      />
    </Page>
  )
}

// ------------------------------------------------------------------- auth

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 6.28 12 6.28c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.72 14.55 2.8 12 2.8 6.92 2.8 2.8 6.92 2.8 12s4.12 9.2 9.2 9.2c5.31 0 8.83-3.73 8.83-8.99 0-.6-.07-1.06-.15-1.51Z"
      />
    </svg>
  )
}

// Resend unlocks at 0 seconds: the countdown would otherwise tick on its own.
const NO_WAIT = 0

function AuthScreenFixture() {
  return (
    <Page width="max-w-md">
      <AuthScreen
        providers={[{ id: "google", label: "Google", icon: <GoogleMark /> }]}
        onOAuth={ok}
        onRequestCode={ok}
        onVerify={ok}
        resendAfterSeconds={NO_WAIT}
        footer="By continuing you agree to the Terms and Privacy Policy."
      />
    </Page>
  )
}

function VerifyScreenFixture() {
  return (
    <Page width="max-w-md">
      <VerifyCodeScreen
        channel="email"
        to="finance-operations.northwind-logistics@mail.northwind.example"
        onVerify={ok}
        onResend={ok}
        onBack={noop}
        resendAfterSeconds={NO_WAIT}
      />
    </Page>
  )
}

function ExpiredFixture() {
  return (
    <Page width="max-w-md">
      <SessionExpiredScreen onSignIn={noop} />
    </Page>
  )
}

function CodeRequestFixture() {
  return (
    <Page width="max-w-sm">
      <CodeRequestForm
        channel="email"
        defaultValue="finance-operations.northwind-logistics-group@mail.northwind.example"
        onSubmit={ok}
      />
    </Page>
  )
}

function VerifyFormFixture() {
  return (
    <Page width="max-w-sm">
      <VerifyCodeForm onVerify={ok} onResend={ok} resendAfterSeconds={NO_WAIT} />
    </Page>
  )
}

// ---------------------------------------------------------------- billing

const PLANS: BillingPlan[] = [
  {
    key: "free",
    name: "Free",
    description: "For trying things out",
    features: ["basicReports"],
    limits: { projects: 3 },
    prices: { month: { amount: 0, currency: "INR" }, year: { amount: 0, currency: "INR" } },
  },
  {
    key: "pro",
    name: "Pro",
    description: "For individuals",
    badge: "Popular",
    features: ["basicReports", "export", "prioritySupport"],
    limits: { projects: 50 },
    prices: {
      month: { amount: 49_900, currency: "INR" },
      year: { amount: 499_000, currency: "INR" },
    },
  },
  {
    key: "team",
    name: "Team",
    description: "For small teams",
    features: ["basicReports", "export", "prioritySupport", "singleSignOn"],
    limits: { projects: null, seats: 25 },
    prices: {
      month: { amount: 149_900, currency: "INR" },
      year: { amount: 1_499_000, currency: "INR" },
    },
  },
  {
    key: "enterprise",
    name: "Enterprise Annual Commitment with Dedicated Success Manager and Custom SLAs",
    description: "Priced per contract, billed yearly",
    features: ["auditLogs", "singleSignOn"],
    prices: {
      month: { amount: 999_900, currency: "INR" },
      year: { amount: 9_999_000, currency: "INR" },
    },
  },
]

const INVOICES: BillingInvoice[] = [
  {
    id: "3",
    number: "INV/26-27/0031",
    date: "2026-01-14T12:00:00.000Z",
    total: 58_882,
    currency: "INR",
    status: "paid",
    href: "#",
  },
  {
    id: "2",
    number: "INV/26-27/0019/NORTHWIND-LTD/QUARTERLY-RECONCILIATION/SUPPLEMENTARY-ADJUSTMENT-2026",
    date: "2025-12-14T12:00:00.000Z",
    total: 1_248_000,
    currency: "INR",
    status: "due",
    href: "#",
  },
  {
    id: "1",
    number: "INV/26-27/0004",
    date: "2025-11-14T12:00:00.000Z",
    total: 58_882,
    currency: "INR",
    status: "refunded",
    href: "#",
  },
]

const USAGE = [
  { key: "projects", period: "total", used: 38, limit: 50, remaining: 12 },
  { key: "credits", period: "2026-01", used: 930, limit: 1000, remaining: 70 },
  { key: "exports", period: "2026-01", used: 12, limit: 100, remaining: 88 },
  {
    key: "seats",
    period: "total",
    used: 3,
    limit: Number.POSITIVE_INFINITY,
    remaining: Number.POSITIVE_INFINITY,
  },
  {
    key: "workspaceCollaboratorsIncludingArchivedAndSharedWithExternalGuests",
    period: "total",
    used: 4,
    limit: 5,
    remaining: 1,
  },
]

const SUBSCRIPTION = {
  plan: "pro",
  status: "active" as const,
  currentPeriodEnd: "2026-02-14T12:00:00.000Z",
  source: { gateway: "googleplay", subscriptionId: "gp_1" },
}

function PlanPickerFixture() {
  return (
    <Page width="max-w-5xl">
      <PlanPicker plans={PLANS} currentPlan="free" onSubscribe={ok} />
    </Page>
  )
}

function RestoreFixture() {
  return (
    <Page>
      <RestorePurchasesButton onRestore={() => true} />
    </Page>
  )
}

function CurrentPlanFixture() {
  return (
    <Page>
      <CurrentPlanCard
        subscription={{ ...SUBSCRIPTION, plan: "enterprise", source: { gateway: "appstore" } }}
        plans={PLANS}
        onManage={noop}
        onRestore={() => true}
      />
    </Page>
  )
}

function UsageFixture() {
  return (
    <Page>
      <UsageMeters usage={USAGE} />
    </Page>
  )
}

function InvoicesFixture() {
  return (
    <Page>
      <InvoiceList invoices={INVOICES} />
    </Page>
  )
}

function WalletFixture() {
  return (
    <Page width="max-w-sm">
      <WalletCard balance={1_248_000} currency="INR" onTopUp={noop} />
    </Page>
  )
}

function PaywallFixture() {
  return (
    <div className="px-4 py-10">
      <Paywall
        plans={PLANS}
        source="appstore"
        currentPlan="free"
        subtitle="Unlock exports, more projects and priority support."
        onSubscribe={ok}
        onRestore={() => true}
      />
    </div>
  )
}

function BillingScreenFixture() {
  return (
    <div className="px-4 py-8">
      <BillingScreen
        plans={PLANS}
        subscription={SUBSCRIPTION}
        source="googleplay"
        usage={USAGE}
        wallet={{ balance: 1_248_000, currency: "INR", onTopUp: noop }}
        invoices={INVOICES}
        onManage={noop}
        onRestore={() => true}
        onSubscribe={ok}
      />
    </div>
  )
}

export const screensA = {
  "abuse-screens/ai-spend-admin": () => <AiSpendFixture />,
  "abuse-screens/captcha-widget": () => <CaptchaFixture />,
  "account-screens/profile-card": () => <ProfileFixture />,
  "account-screens/sessions-list": () => <SessionsFixture />,
  "account-screens/api-keys-manager": () => <ApiKeysFixture />,
  "account-screens/api-key-reveal": () => <ApiKeyRevealFixture />,
  "admin-screens/admin-screen": () => <AdminScreenFixture />,
  "admin-screens/admin-panel": () => <AdminPanelFixture />,
  "api-screens/api-reference": () => <ApiReferenceFixture />,
  "api-screens/webhook-delivery-log": () => <WebhookLogFixture />,
  "auth-screens/auth-screen": () => <AuthScreenFixture />,
  "auth-screens/verify-code-screen": () => <VerifyScreenFixture />,
  "auth-screens/session-expired-screen": () => <ExpiredFixture />,
  "auth-screens/code-request-form": () => <CodeRequestFixture />,
  "auth-screens/verify-code-form": () => <VerifyFormFixture />,
  "billing-screens/plan-picker": () => <PlanPickerFixture />,
  "billing-screens/restore-purchases-button": () => <RestoreFixture />,
  "billing-screens/current-plan-card": () => <CurrentPlanFixture />,
  "billing-screens/usage-meters": () => <UsageFixture />,
  "billing-screens/invoice-list": () => <InvoicesFixture />,
  "billing-screens/wallet-card": () => <WalletFixture />,
  "billing-screens/paywall": () => <PaywallFixture />,
  "billing-screens/billing-screen": () => <BillingScreenFixture />,
} satisfies Fixtures
