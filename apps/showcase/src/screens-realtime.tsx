// Demo page for the real-time pieces (avatar stack, editing badge, typing
// indicator, record-changed banner) on fake presence. Open
// screens-realtime.html in `bun run dev`; ?theme=cinematic and ?dark=1 work.
// In an app the members come from useChannel(client, channel).members.
import {
  AvatarStack,
  EditingBadge,
  type PresenceMemberView,
  RecordChangedBanner,
  TypingIndicator,
} from "@dapplelight/signet-ui/screens/realtime-screens"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { applyTheme, initialTheme } from "./themes"

const params = new URLSearchParams(location.search)
if (params.has("dark"))
  document.documentElement.classList.toggle("dark", params.get("dark") === "1")
await applyTheme(initialTheme())

const PEOPLE: PresenceMemberView[] = [
  { userId: "me", name: "You" },
  { userId: "u1", name: "Asha Rao" },
  { userId: "u2", name: "Dev Patel" },
  { userId: "u3", name: "Meera Iyer" },
  { userId: "u4", name: "Zed Khan" },
  { userId: "u5", name: "Lena Ortiz" },
]

function RecordPage() {
  const [members, setMembers] = useState(PEOPLE.slice(0, 3))
  const [changed, setChanged] = useState(false)
  // Fake traffic: Dev types in the title for a few seconds, then saves.
  useEffect(() => {
    const steps = [
      () =>
        setMembers((m) =>
          m.map((x) => (x.userId === "u2" ? { ...x, typing: true, editing: "title" } : x)),
        ),
      () => setMembers((m) => m.map((x) => (x.userId === "u2" ? { ...x, typing: false } : x))),
      () => {
        setMembers((m) => m.map((x) => (x.userId === "u2" ? { ...x, editing: null } : x)))
        setChanged(true)
      },
    ]
    const timers = steps.map((fn, i) => setTimeout(fn, 1500 * (i + 1)))
    return () => timers.forEach(clearTimeout)
  }, [])
  return (
    <div className="flex w-full max-w-xl flex-col gap-4 rounded-xl bg-bg-surface p-6 ring-1 ring-border-default">
      <RecordChangedBanner
        changed={changed}
        by="Dev Patel"
        onReload={() => setChanged(false)}
        onDismiss={() => setChanged(false)}
      />
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold text-lg">Quarterly plan</h2>
        <AvatarStack members={members} selfId="me" />
      </div>
      <EditingBadge members={members} selfId="me" field="title" fieldLabel="the title" />
      <TypingIndicator members={members} selfId="me" />
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          className="underline"
          onClick={() => setMembers(PEOPLE.slice(0, Math.min(PEOPLE.length, members.length + 1)))}
        >
          Someone joins
        </button>
        <button
          type="button"
          className="underline"
          onClick={() => setMembers((m) => m.slice(0, -1))}
        >
          Someone leaves
        </button>
      </div>
    </div>
  )
}

function Page() {
  return (
    <main className="flex min-h-dvh flex-col items-center gap-10 bg-background p-8 text-foreground">
      <h1 className="sr-only">Signet screens: real-time</h1>
      <a href="./" className="self-start text-sm text-text-secondary underline">
        Showcase
      </a>
      <RecordPage />
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
