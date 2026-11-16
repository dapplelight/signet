// QA fixtures: notification, org, privacy, realtime, status, subscription-chart and workflow
// screens. Static data, in-memory stubs for every API prop, nothing fetched or timed.
import {
  type InboxEntry,
  InboxItem,
  NotificationInbox,
  NotificationPreferences,
} from "@dapplelight/signet-ui/screens/notification-screens"
import {
  AcceptInvitePage,
  InviteDialog,
  MembersList,
  type OrgInvitation,
  type OrgMember,
  OrgSettings,
  OrgSwitcher,
} from "@dapplelight/signet-ui/screens/org-screens"
import {
  ConsentList,
  type ConsentPurpose,
  type ConsentRecord,
  type DataRequestRow,
  DataRequests,
  PrivacySection,
} from "@dapplelight/signet-ui/screens/privacy-screens"
import {
  AvatarStack,
  EditingBadge,
  type PresenceMemberView,
  RecordChangedBanner,
  TypingIndicator,
} from "@dapplelight/signet-ui/screens/realtime-screens"
import {
  ComponentStatusList,
  IncidentForm,
  IncidentUpdateForm,
  MaintenanceForm,
  StatusAdmin,
  type StatusIncidentView,
  StatusPage,
  type StatusSummaryView,
} from "@dapplelight/signet-ui/screens/status-screens"
import {
  type ChartAudienceView,
  type ChartDayView,
  type ChartResultView,
  SubscriptionCharts,
} from "@dapplelight/signet-ui/screens/subscription-charts"
import {
  ApprovalInboxCard,
  type WorkflowApprovalView,
  WorkflowRunTimeline,
  type WorkflowStepView,
} from "@dapplelight/signet-ui/screens/workflow-screens"
import { type ReactNode, useEffect, useRef } from "react"
import { type Fixtures, minutesAgo } from "./shared"

const DAY = 24 * 60
const noop = () => {}
const resolved = async () => {}

/** Screens that bring no padding of their own sit in a padded, centred column. */
function Column({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto flex w-full flex-col gap-4 p-4 ${wide ? "max-w-3xl" : "max-w-xl"}`}>
      {children}
    </div>
  )
}

/** A small widget on a record page: a surface card on a padded page. */
function RecordCard({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl p-4">
      <div className="flex flex-col gap-5 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default">
        {children}
      </div>
    </div>
  )
}

/** Opens the popover inside once, after mount, so the surface shows in a screenshot. */
function OpenOnMount({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector("button")?.click()
  }, [])
  return <div ref={ref}>{children}</div>
}

// --- notifications -----------------------------------------------------------

const INBOX: InboxEntry[] = [
  {
    id: "n1",
    category: "billing",
    title: "Payment received from Northwind Ltd",
    body: "₹12,480.00 for invoice INV-2026-0142. A receipt was sent to accounts@northwind.example.",
    createdAt: minutesAgo(4),
  },
  {
    id: "n2",
    category: "security",
    title: "New sign-in from Safari on iPhone, Bengaluru",
    body: "If this was not you, sign out of every device and change your password.",
    createdAt: minutesAgo(95),
  },
  {
    id: "n3",
    category: "activity",
    title:
      "Meera Iyer mentioned you in the Q1 vendor payout reconciliation thread for Southern Region",
    body: "Can you confirm the GST invoice numbers before Friday? The finance team is waiting on the final list from your side, and we still need the three corrected credit notes from the Pune vendors.",
    createdAt: minutesAgo(5 * 60),
    readAt: minutesAgo(4 * 60),
  },
  {
    id: "n4",
    category: "reports",
    title: "Weekly summary",
    body: "12 new orders, 3 reviews and ₹86,200.00 in revenue this week.",
    createdAt: minutesAgo(2 * DAY),
    readAt: minutesAgo(DAY),
  },
  {
    id: "n5",
    category: "account",
    title: "Data export ready",
    body: "Your export is ready to download for the next 7 days.",
    createdAt: minutesAgo(9 * DAY),
    readAt: minutesAgo(8 * DAY),
  },
]

const PREFERENCE_CATEGORIES = [
  {
    id: "security",
    label: "Security",
    description: "Sign-ins and password changes",
    required: true,
  },
  { id: "billing", label: "Billing", description: "Receipts, renewals and failed payments" },
  {
    id: "activity",
    label: "Mentions, replies and comments on records shared with your whole workspace",
    description: "Every comment thread you take part in, including threads you were added to",
  },
  { id: "offers", label: "Offers" },
]

// --- orgs --------------------------------------------------------------------

const ORG_LONG = "Northwind Logistics and Distribution Partners (Southern Region) Private Ltd"

const ORGS = [
  { org: { id: "o1", name: "Northwind Ltd", slug: "northwind" }, role: "owner" },
  { org: { id: "o2", name: ORG_LONG, slug: "northwind-south" }, role: "admin" },
  { org: { id: "o3", name: "Kestrel Studio", slug: "kestrel" }, role: "member" },
  { org: { id: "o4", name: "Personal", slug: "personal" }, role: "owner" },
]

const MEMBERS: OrgMember[] = [
  { userId: "u1", role: "owner", user: { name: "Asha Rao", email: "asha@northwind.example" } },
  { userId: "u2", role: "admin", user: { name: "Dev Patel", email: "dev@northwind.example" } },
  { userId: "u3", role: "member", user: { name: "Meera Iyer", email: "meera@northwind.example" } },
  {
    userId: "u4",
    role: "member",
    user: {
      name: "Venkata Subrahmanyam Raghunathan-Iyer of the Chennai Accounts Office",
      email: "venkata.subrahmanyam.raghunathan-iyer@chennai.northwind.example",
    },
  },
  { userId: "u5", role: "viewer", user: { email: "isha.nair@northwind.example" } },
]

const INVITATIONS: OrgInvitation[] = [
  { id: "i1", email: "kabir@kestrel.example", role: "member", expiresAt: "2026-01-22T10:00:00Z" },
  { id: "i2", email: null, role: "viewer", expiresAt: "2026-01-29T10:00:00Z" },
]

// --- privacy -----------------------------------------------------------------

const PURPOSES: ConsentPurpose[] = [
  { id: "marketing-email", label: "Offers by email" },
  { id: "analytics", label: "Usage analytics", description: "Helps us fix what is slow" },
  {
    id: "personalisation",
    label:
      "Personalised recommendations based on your purchase history across all Northwind stores",
    description: "Shared with partner stores in India only",
  },
  { id: "research", label: "Product research calls" },
]

const CONSENTS: ConsentRecord[] = [
  {
    purpose: "marketing-email",
    noticeVersion: "2025-11-01",
    givenAt: "2025-11-02T10:00:00Z",
    withdrawnAt: null,
  },
  {
    purpose: "analytics",
    noticeVersion: "2025-11-01",
    givenAt: "2025-10-01T10:00:00Z",
    withdrawnAt: "2025-10-05T10:00:00Z",
  },
  {
    purpose: "personalisation",
    noticeVersion: "2025-11-01",
    givenAt: "2025-12-20T10:00:00Z",
    withdrawnAt: null,
  },
]

const DATA_REQUESTS: DataRequestRow[] = [
  {
    id: "r1",
    kind: "export",
    status: "completed",
    requestedAt: "2025-12-01T10:00:00Z",
    closedAt: "2025-12-02T10:00:00Z",
  },
  {
    id: "r2",
    kind: "erasure",
    status: "rejected",
    requestedAt: "2025-10-12T10:00:00Z",
    note: "An invoice for Northwind Ltd is still open and must be kept for tax records until it is settled",
  },
  {
    id: "r3",
    kind: "export",
    status: "pending",
    requestedAt: "2026-01-14T10:00:00Z",
    dueAt: "2026-02-13T10:00:00Z",
  },
]

// --- realtime ----------------------------------------------------------------

const ME: PresenceMemberView = { userId: "me", name: "You" }
const CREW: PresenceMemberView[] = [
  ME,
  { userId: "u1", name: "Asha Rao", editing: "title" },
  { userId: "u2", name: "Dev Patel", typing: true },
  { userId: "u3", name: "Meera Iyer" },
  { userId: "u4", name: "Kabir Rao", typing: true },
  { userId: "u5", name: "Isha Nair" },
  { userId: "u6", name: "Venkata Subrahmanyam Raghunathan-Iyer of the Chennai Accounts Office" },
]

// --- status ------------------------------------------------------------------

const STATUS_COMPONENTS: StatusSummaryView["components"] = [
  { key: "api", name: "API", description: "REST and RPC endpoints", status: "operational" },
  { key: "web", name: "Web app", status: "operational" },
  {
    key: "payments",
    name: "Payments",
    description: "Cards, UPI and net banking",
    status: "degraded",
  },
  {
    key: "webhooks",
    name: "Outbound webhooks and delayed email delivery to partner mailboxes in the Mumbai region",
    status: "partial_outage",
  },
  { key: "reports", name: "Scheduled reports", status: "maintenance" },
]

const STATUS_INCIDENTS: StatusIncidentView[] = [
  {
    id: "inc1",
    title: "Slow UPI confirmations",
    status: "monitoring",
    impact: "major",
    components: ["payments"],
    startedAt: minutesAgo(150),
    resolvedAt: null,
    updates: [
      {
        at: minutesAgo(150),
        status: "investigating",
        message: "Some UPI payments take over a minute to confirm. We are looking into it.",
      },
      {
        at: minutesAgo(95),
        status: "identified",
        message: "A bank gateway is answering slowly. We are routing around it.",
      },
      {
        at: minutesAgo(30),
        status: "monitoring",
        message: "Confirmations are back under five seconds. We are watching for a recurrence.",
      },
    ],
  },
  {
    id: "inc2",
    title: "Delayed email delivery and webhook retries for partner mailboxes in Mumbai",
    status: "resolved",
    impact: "minor",
    components: ["webhooks", "api"],
    startedAt: minutesAgo(2 * DAY),
    resolvedAt: minutesAgo(2 * DAY - 180),
    updates: [
      {
        at: minutesAgo(2 * DAY),
        status: "investigating",
        message: "Webhooks to some partners are timing out.",
      },
      {
        at: minutesAgo(2 * DAY - 180),
        status: "resolved",
        message: "A queue worker was restarted and the backlog has cleared.",
      },
    ],
  },
]

const STATUS_SUMMARY: StatusSummaryView = {
  status: "degraded",
  components: STATUS_COMPONENTS,
  incidents: STATUS_INCIDENTS,
  maintenance: {
    on: true,
    message: "Scheduled reports are paused while we upgrade the reporting database.",
    until: minutesAgo(-180),
  },
}

const OPEN_INCIDENT = STATUS_INCIDENTS[0] as StatusIncidentView

// --- subscription charts -----------------------------------------------------

// 30 days to the fixed clock, amounts in minor units (paise, cents). Plain arithmetic, no random.
const CHART_DAYS: ChartDayView[] = Array.from({ length: 30 }, (_, i) => {
  const subs = 1180 + i * 7 + (i % 4) * 3
  const usdSubs = 140 + i * 2
  const refund = i % 6 === 0
  const mrrInr = subs * 49900
  const mrrUsd = usdSubs * 1900
  return {
    day: new Date(Date.UTC(2025, 11, 17 + i)).toISOString().slice(0, 10),
    activeSubscribers: subs + usdSubs,
    activeTrials: 90 + (i % 7) * 4,
    mrr: { INR: mrrInr, USD: mrrUsd },
    mrrTotal: mrrInr + mrrUsd * 83,
    newRevenue: { INR: (8 + (i % 5)) * 49900, USD: (2 + (i % 3)) * 1900 },
    renewalRevenue: { INR: (20 + (i % 9)) * 49900, USD: (5 + (i % 4)) * 1900 },
    refunds: { INR: refund ? 49900 : 0, USD: 0 },
    refundCount: refund ? 1 : 0,
    newSubscriptions: 8 + (i % 5),
    trialsStarted: 14 + (i % 6),
    trialConversions: 5 + (i % 4),
    churned: 3 + (i % 3),
    impressions: 1200 + i * 10 + (i % 5) * 40,
    conversions: 60 + (i % 8),
  }
})

const sum = (pick: (d: ChartDayView) => number) => CHART_DAYS.reduce((n, d) => n + pick(d), 0)
const LAST_DAY = CHART_DAYS[CHART_DAYS.length - 1] as ChartDayView

const CHART_DATA: ChartResultView = {
  from: "2025-12-17",
  to: "2026-01-15",
  currencies: ["INR", "USD"],
  base: "INR",
  approximate: true,
  days: CHART_DAYS,
  summary: {
    mrr: LAST_DAY.mrr,
    mrrTotal: LAST_DAY.mrrTotal,
    activeSubscribers: LAST_DAY.activeSubscribers,
    activeTrials: LAST_DAY.activeTrials,
    newRevenue: { INR: sum((d) => d.newRevenue.INR ?? 0), USD: sum((d) => d.newRevenue.USD ?? 0) },
    renewalRevenue: {
      INR: sum((d) => d.renewalRevenue.INR ?? 0),
      USD: sum((d) => d.renewalRevenue.USD ?? 0),
    },
    refunds: { INR: sum((d) => d.refunds.INR ?? 0), USD: 0 },
    refundCount: sum((d) => d.refundCount),
    trialConversion: sum((d) => d.trialConversions) / sum((d) => d.trialsStarted),
    churnRate: sum((d) => d.churned) / LAST_DAY.activeSubscribers,
    impressions: sum((d) => d.impressions),
    conversions: sum((d) => d.conversions),
    paywallConversion: sum((d) => d.conversions) / sum((d) => d.impressions),
  },
}

const AUDIENCES: ChartAudienceView[] = [
  { id: "a1", name: "India, annual plans", filter: { country: "IN", plan: "annual" } },
]

// --- workflows ---------------------------------------------------------------

const RUN_STEPS: WorkflowStepView[] = [
  {
    stepId: "load-invoice",
    kind: "run",
    status: "completed",
    attempts: 1,
    startedAt: minutesAgo(260),
    finishedAt: minutesAgo(259),
  },
  {
    stepId: "verify-gstin",
    kind: "run",
    status: "completed",
    attempts: 3,
    startedAt: minutesAgo(258),
    finishedAt: minutesAgo(250),
  },
  {
    stepId: "cool-off",
    kind: "sleep",
    status: "completed",
    startedAt: minutesAgo(249),
    finishedAt: minutesAgo(189),
  },
  {
    stepId: "manager-review",
    kind: "approval",
    status: "completed",
    summary: "Manager review",
    startedAt: minutesAgo(188),
    finishedAt: minutesAgo(120),
    output: { approved: true, by: "Dev Patel" },
  },
  {
    stepId: "finance-approval",
    kind: "approval",
    status: "waiting",
    summary:
      "Pay Northwind Logistics and Distribution Partners invoice INV-2026-0142 for ₹48,000.00",
    approvers: ["Meera Iyer", "Kabir Rao"],
    startedAt: minutesAgo(119),
  },
]

const APPROVALS: WorkflowApprovalView[] = [
  {
    runId: "run_1",
    stepId: "finance-approval",
    workflow: "vendor-payout",
    summary: "Pay Northwind Studio ₹48,000.00",
    approvers: ["Meera Iyer"],
    requestedAt: minutesAgo(119),
    expiresAt: minutesAgo(-1320),
  },
  {
    runId: "run_2",
    stepId: "approval",
    workflow: "refund",
    summary: "Refund order #1042 (₹2,499.00) to the customer's original payment method",
    approvers: ["Meera Iyer"],
    requestedAt: minutesAgo(75),
  },
  {
    runId: "run_3",
    stepId: "approval",
    workflow: "access-request-for-the-regional-finance-reporting-workspace",
    summary:
      "Grant Kabir Rao read access to the regional finance reporting workspace for the Q1 audit and the follow-up reviews",
    approvers: ["Meera Iyer"],
    requestedAt: minutesAgo(DAY),
  },
]

export const screensC = {
  // --- notification-screens
  "notification-screens/notification-inbox": () => (
    <Column>
      <NotificationInbox
        items={INBOX}
        onMarkRead={resolved}
        onMarkAllRead={resolved}
        onArchive={resolved}
        onOpen={noop}
        hasMore
        onLoadMore={resolved}
      />
    </Column>
  ),
  "notification-screens/notification-preferences": () => (
    <Column>
      <NotificationPreferences
        categories={PREFERENCE_CATEGORIES}
        defaultValue={{ offers: { email: false, push: false }, activity: { push: false } }}
        onToggle={resolved}
      />
    </Column>
  ),
  "notification-screens/inbox-item": () => (
    <Column>
      <div className="flex flex-col rounded-xl bg-bg-surface p-2 ring-1 ring-foreground/10">
        {INBOX.slice(0, 3).map((item) => (
          <InboxItem key={item.id} item={item} onOpen={noop} />
        ))}
        <InboxItem item={INBOX[3] as InboxEntry} render={<a href="#reports" />} />
      </div>
    </Column>
  ),

  // --- org-screens
  "org-screens/org-switcher": () => (
    <div className="min-h-96 p-4">
      <div className="w-64 rounded-xl bg-bg-surface p-2 ring-1 ring-border-default">
        <OpenOnMount>
          <OrgSwitcher orgs={ORGS} currentId="o1" onSwitch={resolved} onCreate={noop} />
        </OpenOnMount>
      </div>
    </div>
  ),
  "org-screens/members-list": () => (
    <Column wide>
      <MembersList
        members={MEMBERS}
        roles={["owner", "admin", "member", "viewer"]}
        currentUserId="u1"
        canManage
        onRoleChange={resolved}
        onRemove={resolved}
        invitations={INVITATIONS}
        onRevokeInvite={resolved}
        onInvite={noop}
      />
    </Column>
  ),
  "org-screens/invite-dialog": () => (
    <InviteDialog
      open
      onOpenChange={noop}
      roles={["member", "admin", "viewer"]}
      onInvite={async () => ({ link: "https://app.northwind.example/invite/0f3c9a7e41" })}
    />
  ),
  "org-screens/accept-invite-page": () => (
    <AcceptInvitePage
      org={{ id: "o2", name: ORG_LONG }}
      invite={{
        inviterName: "Asha Rao",
        role: "member",
        expiresAt: "2026-01-22T10:00:00Z",
      }}
      onAccept={async () => ({ ok: true })}
      onDecline={noop}
    />
  ),
  "org-screens/org-settings": () => (
    <Column>
      <OrgSettings
        org={{ name: ORG_LONG, theme: "editorial", brandColor: "#12833c" }}
        onSave={resolved}
      />
    </Column>
  ),

  // --- privacy-screens
  "privacy-screens/consent-list": () => (
    <Column>
      <ConsentList
        purposes={PURPOSES}
        consents={CONSENTS}
        onGive={resolved}
        onWithdraw={resolved}
      />
    </Column>
  ),
  "privacy-screens/data-requests": () => (
    <Column>
      <DataRequests
        requests={DATA_REQUESTS}
        onRequestExport={resolved}
        onRequestErasure={resolved}
        onDownload={noop}
      />
    </Column>
  ),
  "privacy-screens/privacy-section": () => (
    <Column>
      <PrivacySection aria-label="Data retention">
        <h2 className="text-base leading-none font-medium">Data retention</h2>
        <p className="text-text-secondary">
          Invoices and tax records are kept for eight years, as Indian law requires. Everything else
          is deleted within 30 days of closing your account.
        </p>
        <p className="text-xs text-text-muted">
          Questions about how Northwind Ltd handles your data: privacy@northwind.example
        </p>
      </PrivacySection>
      <PrivacySection aria-label="Data processors">
        <h2 className="text-base leading-none font-medium">
          Processors that handle your data on our behalf, with the region each one stores it in
        </h2>
        <p className="text-text-secondary">Payments, email delivery and error reporting.</p>
      </PrivacySection>
    </Column>
  ),

  // --- realtime-screens
  "realtime-screens/avatar-stack": () => (
    <RecordCard>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Quarterly plan</h2>
        <AvatarStack members={CREW} selfId="me" />
      </div>
      <div className="flex items-center justify-between gap-4 text-sm text-text-secondary">
        Two viewers
        <AvatarStack members={CREW.slice(0, 3)} selfId="me" size="sm" />
      </div>
      <div className="flex items-center justify-between gap-4 text-sm text-text-secondary">
        Large, limit 3
        <AvatarStack members={CREW} selfId="me" size="lg" max={3} />
      </div>
      <div className="flex items-center justify-between gap-4 text-sm text-text-secondary">
        Nobody else here
        <AvatarStack members={[ME]} selfId="me" />
      </div>
    </RecordCard>
  ),
  "realtime-screens/editing-badge": () => (
    <RecordCard>
      <div className="flex flex-col items-start gap-3">
        <EditingBadge members={CREW} selfId="me" />
        <EditingBadge members={CREW} selfId="me" field="title" fieldLabel="the title" />
        <EditingBadge
          className="max-w-full"
          members={[
            ME,
            {
              userId: "u6",
              name: "Venkata Subrahmanyam Raghunathan-Iyer",
              editing: "billing-address-2",
            },
          ]}
          selfId="me"
          field="billing-address-2"
          fieldLabel="the secondary billing contact address line 2 of the Chennai office"
        />
      </div>
    </RecordCard>
  ),
  "realtime-screens/record-changed-banner": () => (
    <RecordCard>
      <RecordChangedBanner changed by="Dev Patel" onReload={noop} onDismiss={noop} />
      <RecordChangedBanner changed onReload={noop} />
      <RecordChangedBanner
        changed
        by="Venkata Subrahmanyam Raghunathan-Iyer of the Chennai Accounts Office"
        onReload={noop}
        onDismiss={noop}
      />
    </RecordCard>
  ),
  "realtime-screens/typing-indicator": () => (
    <RecordCard>
      <TypingIndicator members={[ME, CREW[2] as PresenceMemberView]} selfId="me" />
      <TypingIndicator
        members={[ME, CREW[2] as PresenceMemberView, CREW[4] as PresenceMemberView]}
        selfId="me"
      />
      <TypingIndicator
        members={CREW.map((m) => ({ ...m, typing: m.userId !== "me" }))}
        selfId="me"
      />
      <TypingIndicator members={[ME]} selfId="me" />
    </RecordCard>
  ),

  // --- status-screens
  "status-screens/status-page": () => (
    <div className="p-4 sm:p-8">
      <StatusPage summary={STATUS_SUMMARY} />
    </div>
  ),
  "status-screens/status-admin": () => (
    <div className="p-4 sm:p-8">
      <StatusAdmin
        className="mx-auto"
        summary={{
          components: STATUS_COMPONENTS,
          incidents: STATUS_INCIDENTS,
          maintenance: STATUS_SUMMARY.maintenance,
        }}
        onMaintenance={resolved}
        onComponentStatus={resolved}
        onOpenIncident={resolved}
        onUpdateIncident={resolved}
      />
    </div>
  ),
  "status-screens/component-status-list": () => (
    <Column>
      <ComponentStatusList components={STATUS_COMPONENTS} onStatus={resolved} />
    </Column>
  ),
  "status-screens/incident-form": () => (
    <Column>
      <IncidentForm components={STATUS_COMPONENTS} onOpen={resolved} />
    </Column>
  ),
  "status-screens/incident-update-form": () => (
    <Column>
      <IncidentUpdateForm incident={OPEN_INCIDENT} onUpdate={resolved} />
      <IncidentUpdateForm
        incident={STATUS_INCIDENTS[1] as StatusIncidentView}
        onUpdate={resolved}
      />
    </Column>
  ),
  "status-screens/maintenance-form": () => (
    <Column>
      <MaintenanceForm
        maintenance={{
          on: true,
          message: STATUS_SUMMARY.maintenance.message,
          until: STATUS_SUMMARY.maintenance.until,
        }}
        onSave={resolved}
      />
    </Column>
  ),

  // --- subscription-charts
  "subscription-charts/subscription-charts": () => (
    <div className="p-4 sm:p-8">
      <SubscriptionCharts
        data={CHART_DATA}
        filter={{ from: CHART_DATA.from, to: CHART_DATA.to }}
        onFilterChange={noop}
        options={{
          stores: ["web", "appstore", "googleplay"],
          plans: ["monthly", "annual"],
          countries: ["IN", "US", "DE"],
        }}
        audiences={AUDIENCES}
        onSaveAudience={noop}
        csvHref="/api/charts/csv"
        labels={{
          title: "Subscriptions, renewals, refunds and paywall conversion across every store",
        }}
      />
    </div>
  ),

  // --- workflow-screens
  "workflow-screens/workflow-run-timeline": () => (
    <Column wide>
      <WorkflowRunTimeline
        run={{
          id: "run_1",
          workflow: "vendor-payout",
          status: "waiting",
          createdAt: minutesAgo(262),
          waitingOn: {
            step: "finance-approval",
            kind: "approval",
            until: minutesAgo(-1320),
            approvers: ["Meera Iyer", "Kabir Rao"],
          },
        }}
        steps={RUN_STEPS}
        onCancel={resolved}
      />
    </Column>
  ),
  "workflow-screens/approval-inbox-card": () => (
    <Column>
      <ApprovalInboxCard
        approvals={APPROVALS}
        onApprove={resolved}
        onReject={resolved}
        href={(a) => `#${a.runId}`}
      />
    </Column>
  ),
} satisfies Fixtures
