// Registry of everything the QA gallery (qa.html?item=<id>) can render. No React here, so the
// bun test can import it. The fixtures live in ./qa-fixtures/*; qa.tsx must have one per id
// (a missing one is a type error). test/qa-items.ts fails when a component file or screen
// export under packages/ui/src/components/{ui,domain,screens} is neither registered nor
// listed in QA_SKIP, so a new component cannot be missed silently.

export type QaKind = "ui" | "domain" | "screen"
export type QaItem = { id: QaId; kind: QaKind; source: string }

const DIR = "packages/ui/src/components"

/** One item per file: the file's primitives rendered together. Id is the file stem. */
const UI = [
  "action-row",
  "alert-dialog",
  "alert",
  "answer-headline",
  "avatar",
  "badge",
  "breadcrumb",
  "button",
  "calendar",
  "card",
  "chart",
  "checkbox",
  "combobox",
  "command",
  "data-grid",
  "data-table",
  "decision-callout",
  "dialog",
  "drawer",
  "dropdown-menu",
  "emoji-picker",
  "empty-state",
  "error-state",
  "field",
  "fold",
  "input-group",
  "input-otp",
  "input",
  "kbd",
  "label",
  "logo-stack",
  "markdown",
  "metric-headline",
  "pagination",
  "pill-group",
  "popover",
  "privacy-mask",
  "progress",
  "radio-group",
  "responsive-sheet",
  "rich-text-editor",
  "schema-form",
  "search-input",
  "select",
  "shortcuts",
  "sidebar",
  "skeleton",
  "skip-link",
  "slider",
  "spinner",
  "stage-rail",
  "stat-strip",
  "stepper",
  "switch",
  "table",
  "tabs",
  "textarea",
  "theme-toggle",
  "timeline",
  "toast",
  "tooltip",
] as const

const DOMAIN = ["amount", "csv-import", "job-runs", "kanban", "trend-chip", "upload"] as const

/** Screens: file stem -> one item per screen, named after the export in kebab-case. */
const SCREENS = {
  "abuse-screens": ["ai-spend-admin", "captcha-widget"],
  "account-screens": ["profile-card", "sessions-list", "api-keys-manager", "api-key-reveal"],
  "admin-screens": ["admin-screen", "admin-panel"],
  "api-screens": ["api-reference", "webhook-delivery-log"],
  "auth-screens": [
    "auth-screen",
    "verify-code-screen",
    "session-expired-screen",
    "code-request-form",
    "verify-code-form",
  ],
  "billing-screens": [
    "plan-picker",
    "restore-purchases-button",
    "current-plan-card",
    "usage-meters",
    "invoice-list",
    "wallet-card",
    "paywall",
    "billing-screen",
  ],
  "collab-screens": [
    "comment-body",
    "mention-textarea",
    "comment-threads",
    "activity-feed",
    "version-diff",
    "version-history",
  ],
  "cost-dashboard": ["cost-dashboard"],
  "experiment-screens": [
    "experiment-status-badge",
    "experiment-list",
    "experiment-results",
    "experiment-form",
    "pricing-experiment-results",
  ],
  "funnel-screens": ["funnel-question", "web-funnel", "express-checkout", "funnel-redemption"],
  "growth-screens": [
    "waitlist-join",
    "invite-accept",
    "referral-card",
    "onboarding-checklist",
    "feedback-form",
    "feedback-widget",
    "whats-new",
  ],
  "monetisation-screens": [
    "remote-paywall",
    "customer-center",
    "customer-timeline",
    "promotional-grant-form",
  ],
  "notification-screens": ["notification-inbox", "notification-preferences", "inbox-item"],
  "org-screens": [
    "org-switcher",
    "members-list",
    "invite-dialog",
    "accept-invite-page",
    "org-settings",
  ],
  "privacy-screens": ["consent-list", "data-requests", "privacy-section"],
  "realtime-screens": [
    "avatar-stack",
    "editing-badge",
    "record-changed-banner",
    "typing-indicator",
  ],
  "status-screens": [
    "status-page",
    "status-admin",
    "component-status-list",
    "incident-form",
    "incident-update-form",
    "maintenance-form",
  ],
  "subscription-charts": ["subscription-charts"],
  "workflow-screens": ["workflow-run-timeline", "approval-inbox-card"],
} as const

type Screens = typeof SCREENS
export type QaId =
  | (typeof UI)[number]
  | (typeof DOMAIN)[number]
  | { [S in keyof Screens]: `${S}/${Screens[S][number]}` }[keyof Screens]

export const QA_ITEMS: readonly QaItem[] = [
  ...UI.map((id) => ({ id, kind: "ui" as const, source: `${DIR}/ui/${id}.tsx` })),
  ...DOMAIN.map((id) => ({ id, kind: "domain" as const, source: `${DIR}/domain/${id}.tsx` })),
  ...(Object.entries(SCREENS) as [keyof Screens, readonly string[]][]).flatMap(([stem, names]) =>
    names.map((name) => ({
      id: `${stem}/${name}` as QaId,
      kind: "screen" as const,
      source: `${DIR}/screens/${stem}.tsx`,
    })),
  ),
]

/**
 * Exports that are deliberately not rendered, with the reason. `export` omitted = the whole
 * file. Anything under the three component folders that is neither here nor in QA_ITEMS
 * fails test/qa-items.ts.
 */
export const QA_SKIP: readonly { source: string; export?: string; reason: string }[] = [
  {
    source: `${DIR}/ui/theme-provider.tsx`,
    reason: "context only: renders its children and no markup of its own",
  },
  ...[
    "AdminNav",
    "AdminMain",
    "AdminHeader",
    "AdminToolbar",
    "AdminFilterButton",
    "AdminTable",
    "AdminRowActions",
    "AdminPager",
    "AdminRecordForm",
    "AdminAuditTrail",
    "AdminRecordSheet",
  ].map((name) => ({
    source: `${DIR}/screens/admin-screens.tsx`,
    export: name,
    reason: "a part of AdminPanel, which the admin-panel item renders",
  })),
  {
    source: `${DIR}/screens/admin-screens.tsx`,
    export: "AdminApiError",
    reason: "an error class, not a component",
  },
  ...["AccountSection", "AccountSectionHeader", "SessionItem"].map((name) => ({
    source: `${DIR}/screens/account-screens.tsx`,
    export: name,
    reason: "a layout part of the account screens, rendered inside them",
  })),
  ...["AuthCard", "AuthDivider", "AuthError", "AuthHeader"].map((name) => ({
    source: `${DIR}/screens/auth-screens.tsx`,
    export: name,
    reason: "a layout part of the auth screens, rendered inside them",
  })),
  {
    source: `${DIR}/screens/notification-screens.tsx`,
    export: "InboxItemBody",
    reason: "the body of an inbox item, rendered inside inbox-item",
  },
]

/** The modes the page accepts. Must equal MODES in packages/test/src/playwright.ts (the bun test checks). */
export const QA_MODES = ["light", "dark"] as const
