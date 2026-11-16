// QA fixtures, group B: collab, cost, experiment, funnel, growth and monetisation screens.
// Static data and in-memory stubs only: nothing here touches the network or the clock.
import {
  ActivityFeed,
  type CollabFieldChange,
  type CollabPerson,
  type CollabThread,
  type CollabTimelineItem,
  type CollabVersion,
  CommentBody,
  CommentThreads,
  MentionTextarea,
  VersionDiff,
  VersionHistory,
} from "@dapplelight/signet-ui/screens/collab-screens"
import {
  CostDashboard,
  type CostDashboardData,
} from "@dapplelight/signet-ui/screens/cost-dashboard"
import {
  ExperimentForm,
  ExperimentList,
  ExperimentResults,
  type ExperimentResultsView,
  ExperimentStatusBadge,
  type ExperimentView,
  PricingExperimentResults,
  type PricingReadoutView,
} from "@dapplelight/signet-ui/screens/experiment-screens"
import {
  ExpressCheckout,
  FunnelQuestion,
  FunnelRedemption,
  WebFunnel,
} from "@dapplelight/signet-ui/screens/funnel-screens"
import {
  FeedbackForm,
  FeedbackWidget,
  InviteAccept,
  OnboardingChecklist,
  ReferralCard,
  WaitlistJoin,
  WhatsNew,
} from "@dapplelight/signet-ui/screens/growth-screens"
import {
  CustomerCenter,
  CustomerTimeline,
  PromotionalGrantForm,
  type RemoteOffering,
  RemotePaywall,
} from "@dapplelight/signet-ui/screens/monetisation-screens"
import { type ReactNode, useState } from "react"
import { type Fixtures, minutesAgo, QA_NOW_ISO } from "./shared"

/** Padding and a readable width for the screens that bring neither. */
const Pad = ({ children, wide = false }: { children: ReactNode; wide?: boolean }) => (
  <div className={`mx-auto w-full p-6 ${wide ? "max-w-5xl" : "max-w-2xl"}`}>{children}</div>
)

const done = async () => {}

// ------------------------------------------------------------------- collab

const asha: CollabPerson = { id: "u1", name: "Asha Rao", email: "asha@northwind.example" }
const dev: CollabPerson = { id: "u2", name: "Dev Patel", email: "dev@northwind.example" }
const meera: CollabPerson = { id: "u3", name: "Meera Iyer", email: "meera@northwind.example" }
const longName: CollabPerson = {
  id: "u4",
  name: "Venkataraghavan Subramaniam-Krishnamurthy of Northwind Logistics Ltd.",
}
const PEOPLE = [asha, dev, meera]
const searchPeople = async (q: string) =>
  PEOPLE.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))

const THREADS: CollabThread[] = [
  {
    id: "c1",
    author: dev,
    body: "Copy is final. @[Asha Rao](user:u1) can you check the hero image before Friday?",
    createdAt: minutesAgo(90),
    editedAt: minutesAgo(80),
    replies: [
      {
        id: "c2",
        parentId: "c1",
        author: asha,
        body: "On it. @[Meera Iyer](user:u3) the invoice banner still needs the ₹12,480.00 example.",
        createdAt: minutesAgo(60),
      },
      {
        id: "c3",
        parentId: "c1",
        author: meera,
        body: "Added.",
        createdAt: minutesAgo(30),
      },
    ],
  },
  {
    id: "c4",
    author: longName,
    body: "Procurement signed off the Q1 rollout plan; the supplier checklist and the dispatch calendar are attached to the shared folder, nothing_blocks_us_now_except_the_final_legal_review_of_the_annex.",
    createdAt: minutesAgo(20),
    replies: [],
  },
  { id: "c5", author: dev, body: "", deleted: true, createdAt: minutesAgo(15), replies: [] },
]

const TIMELINE: CollabTimelineItem[] = [
  {
    kind: "change",
    id: "a4",
    at: minutesAgo(5),
    actor: { id: "u1", name: "Asha Rao" },
    summary: "Asha Rao changed status to Done",
    action: "update",
    changes: [{ field: "status", from: "In review", to: "Done" }],
  },
  {
    kind: "comment",
    id: "a3",
    at: minutesAgo(90),
    actor: { id: "u2", name: "Dev Patel" },
    summary: "Dev Patel commented",
    comment: {
      id: "c1",
      author: dev,
      body: "Copy is final. @[Asha Rao](user:u1)",
      createdAt: minutesAgo(90),
    },
  },
  {
    kind: "change",
    id: "a2",
    at: minutesAgo(120),
    actor: { id: "u3", name: "Meera Iyer" },
    summary:
      "Meera Iyer changed the due date and the delivery address for the Northwind Logistics Ltd. warehouse to 2026-12-01",
  },
  {
    kind: "change",
    id: "a1",
    at: minutesAgo(300),
    actor: { id: "u1", name: "Asha Rao" },
    summary: "Asha Rao created this",
  },
]

const CHANGES: CollabFieldChange[] = [
  { field: "status", from: "In review", to: "Done" },
  { field: "due_date", from: null, to: "2026-12-01" },
  { field: "amountDue", from: 1248000, to: 1310000 },
  { field: "tags", from: ["launch"], to: ["launch", "pricing"] },
  { field: "bankAccount", from: "", to: "", hidden: true },
  {
    field: "title",
    from: "Launch page",
    to: "Launch page for the Northwind Logistics Ltd. annual rollout, revision two",
  },
]

const VERSIONS: CollabVersion[] = [
  {
    version: 3,
    action: "update",
    actor: { id: "u1", name: "Asha Rao" },
    at: minutesAgo(5),
    changes: [{ field: "status", from: "In review", to: "Done" }],
  },
  {
    version: 2,
    action: "update",
    actor: { id: "u3", name: "Meera Iyer" },
    at: minutesAgo(120),
    changes: [
      { field: "dueDate", from: null, to: "2026-12-01" },
      {
        field: "title",
        from: "Launch page",
        to: "Launch page for the Northwind Logistics Ltd. annual rollout, revision two",
      },
    ],
  },
  {
    version: 1,
    action: "insert",
    actor: { id: "u1", name: "Asha Rao" },
    at: minutesAgo(300),
    changes: [{ field: "title", from: null, to: "Launch page" }],
  },
]

function MentionDemo() {
  const [value, setValue] = useState(
    "Thanks @[Asha Rao](user:u1), looping in @[Dev Patel](user:u2) for the sign-off.",
  )
  return (
    <Pad>
      <MentionTextarea value={value} onValueChange={setValue} onSearch={searchPeople} rows={4} />
    </Pad>
  )
}

// ---------------------------------------------------------------------- cost

const costDay = (d: number, units: number, saved: number) => ({
  day: `2026-01-${String(d).padStart(2, "0")}`,
  units,
  calls: Math.round(units / 9_000),
  cacheSavedUnits: saved,
})
const COST: CostDashboardData = {
  series: [
    costDay(9, 1_200_000, 300_000),
    costDay(10, 2_400_000, 500_000),
    costDay(11, 1_900_000, 800_000),
    costDay(12, 3_100_000, 700_000),
    costDay(13, 2_700_000, 1_100_000),
    costDay(14, 800_000, 200_000),
    costDay(15, 3_600_000, 1_400_000),
  ],
  models: [
    { model: "small-model-2", units: 4_100_000, calls: 612, cacheSavedUnits: 900_000 },
    { model: "large-model-1", units: 9_800_000, calls: 340, cacheSavedUnits: 2_100_000 },
    { model: "embed-model-1", units: 7_500, calls: 1_200 },
    {
      model: "fine-tuned-support-reply-model-for-northwind-ltd-2026-01-batch-3",
      units: 1_300_000,
      calls: 88,
    },
  ],
  top: [
    {
      subject: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      units: 5_200_000,
      calls: 211,
    },
    {
      subject: "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
      units: 3_100_000,
      calls: 140,
    },
    {
      subject: "fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9",
      units: 900_000,
      calls: 62,
    },
  ],
  caps: {
    day: { used: 3_600_000, cap: 3_000_000 },
    month: { used: 15_700_000, cap: 50_000_000 },
  },
}

// ---------------------------------------------------------------- experiment

const LONG_EXPERIMENT_KEY = "checkout-annual-discount-banner-for-returning-customers-in-india-v2"
const EXPERIMENTS: ExperimentView[] = [
  {
    key: "paywall-annual-default",
    description: "Annual plan preselected on the paywall.",
    status: "running",
    variants: [
      { key: "control", weight: 50 },
      { key: "annual", weight: 50 },
    ],
    goal: "subscription_started",
    audience: null,
    startedAt: minutesAgo(60 * 24 * 9),
  },
  {
    key: LONG_EXPERIMENT_KEY,
    status: "draft",
    variants: [
      { key: "control", weight: 50 },
      { key: "banner", weight: 50 },
    ],
    goal: "checkout_completed",
  },
  {
    key: "onboarding-short-form",
    status: "stopped",
    variants: [
      { key: "control", weight: 50 },
      { key: "short", weight: 50 },
    ],
    goal: "onboarding_completed",
    winner: null,
    startedAt: minutesAgo(60 * 24 * 30),
    stoppedAt: minutesAgo(60 * 24 * 12),
  },
  {
    key: "pricing-page-layout",
    status: "rolled_out",
    variants: [
      { key: "control", weight: 50 },
      { key: "cards", weight: 50 },
    ],
    goal: "plan_selected",
    winner: "cards",
    startedAt: minutesAgo(60 * 24 * 60),
    stoppedAt: minutesAgo(60 * 24 * 40),
  },
]
const RUNNING = EXPERIMENTS[0] as ExperimentView
const DRAFT = EXPERIMENTS[1] as ExperimentView

const RESULTS: ExperimentResultsView = {
  goal: "subscription_started",
  alpha: 0.05,
  control: "control",
  variants: [
    {
      key: "control",
      exposed: 4210,
      converted: 316,
      rate: 0.0751,
      lift: null,
      pValue: null,
      significant: false,
    },
    {
      key: "annual",
      exposed: 4188,
      converted: 402,
      rate: 0.096,
      lift: 0.278,
      pValue: 0.0031,
      significant: true,
    },
    {
      key: "annual-with-the-long-variant-name-that-keeps-going-past-sixty-characters",
      exposed: 410,
      converted: 33,
      rate: 0.0805,
      lift: 0.072,
      pValue: 0.64,
      significant: false,
    },
  ],
}

const PRICING_EXPERIMENT: ExperimentView = {
  key: "pro-price-test-2026",
  description: "₹999 against ₹1,249 per month for Pro.",
  status: "running",
  variants: [
    { key: "control", weight: 50, value: { offering: "pro-monthly", version: 1 } },
    { key: "higher", weight: 50, value: { offering: "pro-monthly-higher", version: 2 } },
  ],
  goal: "subscription_started",
  startedAt: minutesAgo(60 * 24 * 14),
}

const PRICING: PricingReadoutView = {
  placements: ["paywall-main"],
  alpha: 0.05,
  control: "control",
  variants: [
    {
      key: "control",
      offering: { offering: "pro-monthly", version: 1 },
      exposed: 3120,
      converted: 241,
      rate: 0.0772,
      lift: null,
      pValue: null,
      significant: false,
      trials: 410,
      trialConverted: 241,
      trialConversion: 0.588,
      revenue: { INR: 24_071_900 },
      revenuePerExposed: { INR: 7715 },
      ltv: {
        estimate: true,
        perCurrency: { INR: 1_198_800 },
        churn: 0.083,
        expectedPayments: 12,
      },
    },
    {
      key: "higher",
      offering: { offering: "pro-monthly-higher", version: 2 },
      exposed: 3098,
      converted: 205,
      rate: 0.0662,
      lift: -0.143,
      pValue: 0.041,
      significant: true,
      trials: 398,
      trialConverted: 205,
      trialConversion: 0.515,
      revenue: { INR: 25_604_500 },
      revenuePerExposed: { INR: 8265 },
      approximate: true,
      ltv: {
        estimate: true,
        perCurrency: { INR: 1_498_800 },
        churn: 0.097,
        expectedPayments: 10,
      },
    },
  ],
}

// -------------------------------------------------------------------- funnel

const FUNNEL_OFFERING: RemoteOffering = {
  key: "web-main",
  version: 4,
  products: [
    {
      id: "p-starter-month",
      store: "web",
      plan: "starter",
      interval: "month",
      price: { amount: 49900, currency: "INR" },
    },
    {
      id: "p-pro-month",
      store: "web",
      plan: "pro",
      interval: "month",
      price: { amount: 124900, currency: "INR" },
      offers: [{ id: "trial-14", type: "free_trial", days: 14 }],
    },
    {
      id: "p-pro-year",
      store: "web",
      plan: "pro",
      interval: "year",
      price: { amount: 1_249_000, currency: "INR" },
    },
    {
      id: "p-team-month",
      store: "web",
      plan: "team",
      interval: "month",
      price: { amount: 399900, currency: "INR" },
    },
  ],
  paywall: {
    title: "Pick the plan that fits Northwind",
    subtitle: "Switch or cancel any time.",
    plans: ["starter", "pro", "team"],
    highlight: "pro",
    badge: "Most popular",
    trial: "14 days free, then billed monthly",
    cta: "Choose plan",
  },
}

const PLAN_DISPLAY = {
  starter: { name: "Starter", description: "For one person getting organised." },
  pro: {
    name: "Pro",
    description: "Invoices, reminders and reports for a growing business.",
    features: ["invoices", "reminders", "reports"],
  },
  team: {
    name: "Team",
    description:
      "Unlimited workspaces, priority support, audit exports and single sign-on for every member of the organisation.",
    features: ["invoices", "audit_export", "sso"],
  },
}

type StripeStub = Parameters<NonNullable<Parameters<typeof ExpressCheckout>[0]["loadStripe"]>>
// An offline Stripe: mounting an element paints a labelled placeholder instead of loading Stripe.js.
const stubStripe = async (..._key: StripeStub) => {
  const placeholder = (el: HTMLElement, text: string, height: string) => {
    el.className = `${height} flex items-center justify-center rounded-md bg-bg-muted text-sm text-text-muted ring-1 ring-border-default`
    el.textContent = text
  }
  return {
    elements: () => ({
      create: (kind: string) => ({
        mount: (el: HTMLElement) =>
          kind === "expressCheckout"
            ? placeholder(el, "Apple Pay / Google Pay", "h-11")
            : placeholder(el, "Card number, expiry, CVC", "h-32"),
        on: () => {},
        destroy: () => {},
      }),
      submit: async () => ({}),
    }),
    confirmPayment: async () => ({}),
  }
}

// -------------------------------------------------------------------- growth

const CHANGELOG = [
  {
    id: "3",
    date: "2026-01-12",
    title: "Dark mode everywhere, including the invoice PDF preview and the print layout",
    tag: "New",
    href: "#dark-mode",
  },
  { id: "2", date: "2026-01-03", title: "Export to CSV from any table", tag: "New" },
  {
    id: "1",
    date: "2025-12-20",
    title: "Faster search",
    tag: "Fix",
    body: "Results now appear as you type.",
  },
]

// ---------------------------------------------------------------- monetisation

const CENTER_PLANS = [
  { key: "pro", name: "Pro", prices: { month: { amount: 124900, currency: "INR" } } },
]

export const screensB = {
  // collab-screens
  "collab-screens/comment-body": () => (
    <Pad>
      <div className="flex flex-col gap-4">
        <CommentBody body="Copy is final. @[Asha Rao](user:u1) can you check the hero image?" />
        <CommentBody body="Plain text with no mentions at all." />
        <CommentBody body="Looping in @[Venkataraghavan Subramaniam-Krishnamurthy of Northwind Logistics Ltd.](user:u4) and @[Dev Patel](user:u2) on the unbroken_token_that_has_no_spaces_to_wrap_at_all_in_this_line." />
      </div>
    </Pad>
  ),
  "collab-screens/mention-textarea": () => <MentionDemo />,
  "collab-screens/comment-threads": () => (
    <Pad>
      <CommentThreads
        threads={THREADS}
        currentUserId="u1"
        onSearchPeople={searchPeople}
        onAdd={done}
        onEdit={done}
        onDelete={done}
      />
    </Pad>
  ),
  "collab-screens/activity-feed": () => (
    <Pad>
      <ActivityFeed items={TIMELINE} hasMore onLoadMore={done} />
    </Pad>
  ),
  "collab-screens/version-diff": () => (
    <Pad>
      <VersionDiff changes={CHANGES} />
    </Pad>
  ),
  "collab-screens/version-history": () => (
    <Pad>
      <VersionHistory versions={VERSIONS} onRestore={async () => ({ version: 4 })} onUndo={done} />
    </Pad>
  ),

  // cost-dashboard
  "cost-dashboard/cost-dashboard": () => (
    <Pad wide>
      <CostDashboard data={COST} days={7} onDaysChange={() => {}} />
    </Pad>
  ),

  // experiment-screens
  "experiment-screens/experiment-status-badge": () => (
    <Pad>
      <div className="flex flex-wrap gap-2">
        <ExperimentStatusBadge status="draft" />
        <ExperimentStatusBadge status="running" />
        <ExperimentStatusBadge status="stopped" />
        <ExperimentStatusBadge status="rolled_out" />
      </div>
    </Pad>
  ),
  "experiment-screens/experiment-list": () => (
    <Pad>
      <ExperimentList experiments={EXPERIMENTS} selected="paywall-annual-default" />
    </Pad>
  ),
  "experiment-screens/experiment-results": () => (
    <Pad wide>
      <ExperimentResults
        experiment={RUNNING}
        results={RESULTS}
        onStart={done}
        onStop={done}
        onRollout={done}
      />
    </Pad>
  ),
  "experiment-screens/experiment-form": () => (
    <Pad>
      <ExperimentForm
        experiment={{
          ...DRAFT,
          description:
            "Show a banner with the annual discount to customers who bought once in the last 90 days.",
          audience: { plan: "free" },
        }}
        offerings={[
          { key: "pro-monthly", version: 1 },
          { key: "pro-monthly-higher", version: 2 },
        ]}
        onSubmit={done}
        onStart={done}
      />
    </Pad>
  ),
  "experiment-screens/pricing-experiment-results": () => (
    <Pad wide>
      <PricingExperimentResults
        experiment={PRICING_EXPERIMENT}
        readout={PRICING}
        onRollout={done}
        onStop={done}
      />
    </Pad>
  ),

  // funnel-screens
  "funnel-screens/funnel-question": () => (
    <Pad>
      <FunnelQuestion
        question={{
          id: "goal",
          title: "What do you want to sort out first, and how soon do you need it done?",
          multiple: true,
          options: [
            { value: "invoices", label: "Send invoices and get paid faster" },
            { value: "budget", label: "Keep a monthly budget" },
            { value: "gst", label: "File GST on time for every one of my Northwind Ltd. branches" },
          ],
        }}
        value={["invoices"]}
        onAnswer={() => {}}
      />
    </Pad>
  ),
  "funnel-screens/web-funnel": () => (
    <Pad>
      <WebFunnel
        page={{
          funnel: {
            key: "launch",
            title: "Run your books in minutes",
            subtitle: "Pick a plan to get started. Your discount is already applied.",
            questions: [],
          },
          offering: FUNNEL_OFFERING,
          discounts: {
            "p-pro-month": {
              valid: true,
              code: "WELCOME20",
              off: 25000,
              amount: 99900,
              currency: "INR",
            },
          },
        }}
        code="WELCOME20"
        display={PLAN_DISPLAY}
        onCheckout={async () => ({ clientSecret: "pi_qa_secret" })}
      />
    </Pad>
  ),
  // Offline stand-in: Stripe.js is never loaded; loadStripe returns a stub that paints placeholders.
  "funnel-screens/express-checkout": () => (
    <Pad>
      <ExpressCheckout
        publishableKey="pk_test_qa"
        clientSecret="pi_qa_secret"
        returnUrl="https://app.example.com/start?session=qa"
        amount={99900}
        currency="INR"
        loadStripe={stubStripe}
      />
    </Pad>
  ),
  "funnel-screens/funnel-redemption": () => (
    <Pad>
      <FunnelRedemption
        data={{
          session: { id: "sess_qa", status: "paid", plan: "pro" },
          redemption: {
            link: "https://app.example.com/redeem#qa",
            token:
              "rdm_7f3a9c1e5b2d48a6b0c9e4d1f8a27356_northwind_ltd_pro_annual_2026-01-15T10-00-00Z",
            expiresAt: QA_NOW_ISO,
          },
        }}
      />
    </Pad>
  ),

  // growth-screens
  "growth-screens/waitlist-join": () => (
    <Pad>
      <div className="flex flex-col gap-6">
        <WaitlistJoin onJoin={async (email) => ({ email, position: 1284, joined: true })} />
        <WaitlistJoin
          defaultResult={{ position: 1284, joined: true }}
          onJoin={() => ({ position: 1284, joined: true })}
        />
      </div>
    </Pad>
  ),
  "growth-screens/invite-accept": () => (
    <Pad>
      <InviteAccept
        invite={{
          inviterName: "Meera Iyer of Northwind Logistics Ltd. Accounts Payable",
          scopeName: "Northwind Studio, Mumbai and Pune combined invoicing workspace",
          role: "editor",
          email: "dev@northwind.example",
          expiresAt: "2026-01-30",
        }}
        onAccept={async () => ({ ok: true })}
        onDecline={() => {}}
      />
    </Pad>
  ),
  "growth-screens/referral-card": () => (
    <Pad>
      <ReferralCard
        code="MEERA42"
        url="https://app.example.com/signup?ref=MEERA42&utm_source=referral&utm_campaign=northwind-annual"
        stats={{ referred: 12, converted: 5, rewarded: 3 }}
        onShare={() => {}}
      />
    </Pad>
  ),
  "growth-screens/onboarding-checklist": () => (
    <Pad>
      <OnboardingChecklist
        steps={[
          { key: "profile", title: "Add your photo" },
          {
            key: "project",
            title: "Create your first project",
            description: "It takes about a minute.",
          },
          {
            key: "invite",
            title: "Invite the whole accounts team at Northwind Logistics Ltd. to your workspace",
            description: "They will get an email with a link to join.",
          },
          { key: "billing", title: "Pick a plan" },
        ]}
        defaultDone={["profile"]}
        onDismiss={() => {}}
      />
    </Pad>
  ),
  "growth-screens/feedback-form": () => (
    <Pad>
      <FeedbackForm rating onSubmit={done} />
    </Pad>
  ),
  "growth-screens/feedback-widget": () => (
    <div className="flex min-h-[32rem] justify-end p-6">
      <FeedbackWidget rating defaultOpen onSubmit={done} />
    </div>
  ),
  "growth-screens/whats-new": () => (
    <div className="flex min-h-[32rem] justify-end p-6">
      <WhatsNew entries={CHANGELOG} unseen={2} defaultOpen />
    </div>
  ),

  // monetisation-screens
  "monetisation-screens/remote-paywall": () => (
    <Pad wide>
      <RemotePaywall offering={FUNNEL_OFFERING} display={PLAN_DISPLAY} onPurchase={() => {}} />
    </Pad>
  ),
  "monetisation-screens/customer-center": () => (
    <Pad>
      <CustomerCenter
        overview={{
          plan: "pro",
          status: "active",
          currentPeriodEnd: "2026-02-14T00:00:00.000Z",
          renews: true,
          source: { gateway: "web", subscriptionId: "sub_qa_1" },
          store: false,
          manageUrl: null,
          canCancel: true,
          retention: { kind: "discount", percent: 30, months: 3 },
        }}
        plans={CENTER_PLANS}
        onCancel={done}
        onAcceptRetention={done}
        onRequestRefund={done}
        onContactSupport={done}
      />
    </Pad>
  ),
  "monetisation-screens/customer-timeline": () => (
    <Pad>
      <CustomerTimeline
        totals={[{ currency: "INR", paid: 3_747_000, refunded: 124_900, approximate: false }]}
        entries={[
          {
            id: "e5",
            kind: "refund",
            gateway: "web",
            eventType: "charge.refunded",
            productId: "p-pro-month",
            paymentId: "pay_qa_0005",
            amount: 124900,
            currency: "INR",
            occurredAt: minutesAgo(60 * 24 * 2),
          },
          {
            id: "e4",
            kind: "renewal",
            gateway: "appstore",
            eventType: "DID_RENEW",
            productId: "com.northwind.app.pro.monthly.with.a.very.long.store.identifier.v2",
            paymentId: "tx_qa_0004",
            amount: 124900,
            currency: "INR",
            approximate: true,
            occurredAt: minutesAgo(60 * 24 * 5),
          },
          {
            id: "e3",
            kind: "billing_issue",
            gateway: "googleplay",
            eventType: "SUBSCRIPTION_ON_HOLD",
            occurredAt: minutesAgo(60 * 24 * 12),
          },
          {
            id: "e2",
            kind: "purchase",
            gateway: "web",
            eventType: "checkout.completed",
            productId: "p-pro-month",
            paymentId: "pay_qa_0002",
            amount: 124900,
            currency: "INR",
            occurredAt: minutesAgo(60 * 24 * 40),
          },
          {
            id: "e1",
            kind: "trial",
            gateway: "web",
            eventType: "trial.started",
            occurredAt: minutesAgo(60 * 24 * 54),
          },
        ]}
      />
    </Pad>
  ),
  "monetisation-screens/promotional-grant-form": () => (
    <Pad>
      <PromotionalGrantForm plans={["pro", "team"]} defaultDays={30} onGrant={done} />
    </Pad>
  ),
} satisfies Fixtures
