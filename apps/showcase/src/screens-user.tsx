// Demo page for the user-facing screens (auth, account, notifications,
// privacy) on fake data. Open screens-user.html in `bun run dev`;
// ?theme=cinematic, ?dark=1 and ?screen=auth|verify|expired|account|notifications|privacy
// pick what to show.
import {
  ApiKeysManager,
  ProfileCard,
  SessionsList,
} from "@dapplelight/signet-ui/screens/account-screens"
import {
  AuthScreen,
  SessionExpiredScreen,
  VerifyCodeScreen,
} from "@dapplelight/signet-ui/screens/auth-screens"
import {
  NotificationInbox,
  NotificationPreferences,
} from "@dapplelight/signet-ui/screens/notification-screens"
import {
  ConsentList,
  type DataRequestRow,
  DataRequests,
} from "@dapplelight/signet-ui/screens/privacy-screens"
import { type ReactNode, StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { applyTheme, initialTheme } from "./themes"

const params = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", params.get("dark") === "1")
await applyTheme(initialTheme())

const wait = (ms = 600) => new Promise((r) => setTimeout(r, ms))
const now = Date.now()
const H = 3600_000

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

function Account() {
  const [sessions, setSessions] = useState([
    { id: "a", device: "Chrome on macOS", ip: "103.21.4.7", lastSeenAt: now, current: true },
    { id: "b", device: "Safari on iOS", ip: "49.36.12.90", lastSeenAt: now - 5 * H },
    { id: "c", device: "Firefox on Windows", ip: null, lastSeenAt: now - 80 * H },
  ])
  const [keys, setKeys] = useState([
    {
      id: "k1",
      name: "CI deploy",
      start: "app_9f2c1d",
      createdAt: now - 400 * H,
      lastUsedAt: now - 2 * H,
    },
    { id: "k2", name: "Zapier", start: "app_41aa7e", createdAt: now - 90 * H, lastUsedAt: null },
  ])
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <ProfileCard
        profile={{ name: "Asha Rao", email: "asha@example.com", phone: "+91 98765 43210" }}
        onSave={() => wait()}
      />
      <SessionsList
        sessions={sessions}
        onRevoke={async (s) => {
          await wait()
          setSessions((all) => all.filter((x) => x.id !== s.id))
        }}
        onRevokeOthers={async () => {
          await wait()
          setSessions((all) => all.filter((x) => x.current))
        }}
      />
      <ApiKeysManager
        keys={keys}
        onCreate={async ({ name }) => {
          await wait()
          setKeys((k) => [
            ...k,
            { id: name, name, start: "app_7be210", createdAt: Date.now(), lastUsedAt: null },
          ])
          return { token: "app_7be210c4e9f14b2a8d3e6f0a1b2c3d4e" }
        }}
        onRevoke={async (k) => {
          await wait()
          setKeys((all) => all.filter((x) => x.id !== k.id))
        }}
      />
    </div>
  )
}

function Notifications() {
  const [items, setItems] = useState([
    {
      id: "1",
      title: "Payment received",
      body: "₹4,999 for the Pro plan. Receipt sent to your email.",
      createdAt: new Date(now - 0.1 * H).toISOString(),
    },
    {
      id: "2",
      title: "New sign-in",
      body: "Safari on iOS, Bengaluru",
      createdAt: new Date(now - 5 * H).toISOString(),
    },
    {
      id: "3",
      title: "Weekly summary",
      body: "12 new orders and 3 reviews this week.",
      createdAt: new Date(now - 30 * H).toISOString(),
      readAt: new Date(now).toISOString(),
    },
    {
      id: "4",
      title: "Export ready",
      body: "Your data export is ready to download.",
      createdAt: new Date(now - 72 * H).toISOString(),
      readAt: new Date(now).toISOString(),
    },
  ])
  const read = (ids: string[]) =>
    setItems((all) =>
      all.map((i) => (ids.includes(i.id) ? { ...i, readAt: new Date().toISOString() } : i)),
    )
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <NotificationInbox
        items={items}
        onMarkRead={read}
        onMarkAllRead={() => read(items.map((i) => i.id))}
        onArchive={(it) => setItems((all) => all.filter((i) => i.id !== it.id))}
        hasMore
        onLoadMore={() => wait()}
      />
      <NotificationPreferences
        categories={[
          {
            id: "security",
            label: "Security",
            description: "Sign-ins, password changes",
            required: true,
          },
          { id: "billing", label: "Billing", description: "Receipts and renewals" },
          { id: "activity", label: "Activity", description: "Orders, reviews, mentions" },
          { id: "offers", label: "Offers" },
        ]}
        channels={["email", "whatsapp", "push", "inApp"]}
        defaultValue={{
          offers: { email: false, whatsapp: false, push: false },
          activity: { whatsapp: false },
        }}
        onToggle={() => wait(300)}
      />
    </div>
  )
}

function Privacy() {
  const [consents, setConsents] = useState([
    {
      purpose: "marketing-email",
      noticeVersion: "2026-11-01",
      givenAt: "2026-11-02T10:00:00Z",
      withdrawnAt: null as string | null,
    },
    {
      purpose: "analytics",
      noticeVersion: "2026-11-01",
      givenAt: "2026-10-01T10:00:00Z",
      withdrawnAt: "2026-10-05T10:00:00Z",
    },
  ])
  const [requests, setRequests] = useState<DataRequestRow[]>([
    { id: "r1", kind: "export", status: "completed", requestedAt: "2026-11-01T10:00:00Z" },
    {
      id: "r2",
      kind: "erasure",
      status: "rejected",
      requestedAt: "2026-09-12T10:00:00Z",
      note: "An invoice is still open",
    },
  ])
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <ConsentList
        purposes={[
          { id: "marketing-email", label: "Offers by email" },
          { id: "analytics", label: "Usage analytics", description: "Helps us fix what's slow" },
          { id: "personalisation", label: "Personalised picks" },
        ]}
        consents={consents}
        onGive={async (p) => {
          await wait()
          setConsents((c) => [
            ...c,
            {
              purpose: p,
              noticeVersion: "2026-11-01",
              givenAt: new Date().toISOString(),
              withdrawnAt: null,
            },
          ])
        }}
        onWithdraw={async (p) => {
          await wait()
          setConsents((c) =>
            c.map((x) => (x.purpose === p ? { ...x, withdrawnAt: new Date().toISOString() } : x)),
          )
        }}
      />
      <DataRequests
        requests={requests}
        onRequestExport={async () => {
          await wait()
          setRequests((r) => [
            ...r,
            {
              id: "r3",
              kind: "export",
              status: "pending",
              requestedAt: new Date().toISOString(),
              dueAt: new Date(now + 720 * H).toISOString(),
            },
          ])
        }}
        onRequestErasure={() => wait()}
        onDownload={() => {}}
      />
    </div>
  )
}

const SCREENS: Record<string, () => ReactNode> = {
  auth: () => (
    <AuthScreen
      providers={[{ id: "google", label: "Google", icon: <GoogleMark /> }]}
      onOAuth={() => wait()}
      onRequestCode={() => wait()}
      onVerify={() => wait()}
      footer="By continuing you agree to the Terms and Privacy Policy."
    />
  ),
  verify: () => (
    <VerifyCodeScreen
      channel="phone"
      to="+91******3210"
      onVerify={() => wait()}
      onResend={() => wait()}
      onBack={() => {}}
    />
  ),
  expired: () => <SessionExpiredScreen onSignIn={() => {}} />,
  account: () => <Account />,
  notifications: () => <Notifications />,
  privacy: () => <Privacy />,
}

function Page() {
  const only = params.get("screen")
  const names = only && SCREENS[only] ? [only] : Object.keys(SCREENS)
  return (
    <main className="flex min-h-dvh flex-col items-center gap-10 bg-background p-8 text-foreground">
      <h1 className="sr-only">Signet screens</h1>
      {names.map((n) => (
        <div key={n} data-screen={n} className="flex w-full justify-center">
          {SCREENS[n]?.()}
        </div>
      ))}
    </main>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element #root not found")
createRoot(root).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
