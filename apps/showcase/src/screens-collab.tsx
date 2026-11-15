// Demo page for the collab screens (comment threads with mentions, activity
// feed, version history) on fake data. Open screens-collab.html in
// `bun run dev`; ?theme=cinematic, ?dark=1 and ?screen=comments|activity|history
// pick what to show.
import {
  ActivityFeed,
  type CollabPerson,
  type CollabThread,
  type CollabVersion,
  CommentThreads,
  VersionHistory,
} from "@dapplelight/signet-ui/screens/collab-screens"
import { type ReactNode, StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { applyTheme, initialTheme } from "./themes"

const params = new URLSearchParams(location.search)
if (params.has("dark"))
  document.documentElement.classList.toggle("dark", params.get("dark") === "1")
await applyTheme(initialTheme())

const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

const PEOPLE: CollabPerson[] = [
  { id: "u1", name: "Asha Rao", email: "asha@example.com" },
  { id: "u2", name: "Dev Patel", email: "dev@example.com" },
  { id: "u3", name: "Meera Iyer", email: "meera@example.com" },
]
const me = PEOPLE[0] as CollabPerson
const search = async (q: string) =>
  PEOPLE.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))

function Comments() {
  const [threads, setThreads] = useState<CollabThread[]>([
    {
      id: "c1",
      author: PEOPLE[1] as CollabPerson,
      body: "Copy is final. @[Asha Rao](user:u1) can you check the hero image?",
      createdAt: ago(90),
      editedAt: ago(80),
      replies: [{ id: "c2", parentId: "c1", author: me, body: "On it.", createdAt: ago(60) }],
    },
  ])
  return (
    <CommentThreads
      className="w-full max-w-xl"
      threads={threads}
      currentUserId={me.id}
      onSearchPeople={search}
      onAdd={async ({ body, parentId }) => {
        await wait()
        const c = { id: crypto.randomUUID(), author: me, body, createdAt: new Date().toISOString() }
        setThreads((all) =>
          parentId
            ? all.map((t) =>
                t.id === parentId ? { ...t, replies: [...t.replies, { ...c, parentId }] } : t,
              )
            : [...all, { ...c, replies: [] }],
        )
      }}
      onEdit={async (c, body) => {
        await wait()
        const edit = <T extends { id: string }>(x: T) =>
          x.id === c.id ? { ...x, body, editedAt: new Date().toISOString() } : x
        setThreads((all) => all.map((t) => ({ ...edit(t), replies: t.replies.map(edit) })))
      }}
      onDelete={async (c) => {
        await wait()
        setThreads((all) =>
          all
            .map((t) =>
              t.id === c.id
                ? { ...t, deleted: true, body: "" }
                : { ...t, replies: t.replies.filter((r) => r.id !== c.id) },
            )
            .filter((t) => !t.deleted || t.replies.length),
        )
      }}
    />
  )
}

function Activity() {
  const [more, setMore] = useState(true)
  const [items, setItems] = useState([
    {
      kind: "change" as const,
      id: "a3",
      at: ago(5),
      actor: me,
      summary: "Asha Rao changed status to Done",
    },
    {
      kind: "comment" as const,
      id: "c1",
      at: ago(90),
      actor: PEOPLE[1] as CollabPerson,
      summary: "Dev Patel commented",
      comment: {
        id: "c1",
        author: PEOPLE[1] as CollabPerson,
        body: "Copy is final. @[Asha Rao](user:u1)",
        createdAt: ago(90),
      },
    },
    {
      kind: "change" as const,
      id: "a2",
      at: ago(120),
      actor: PEOPLE[2] as CollabPerson,
      summary: "Meera Iyer changed due date to 2026-12-01",
    },
  ])
  return (
    <ActivityFeed
      className="w-full max-w-xl"
      items={items}
      hasMore={more}
      onLoadMore={async () => {
        await wait()
        setItems((all) => [
          ...all,
          {
            kind: "change" as const,
            id: "a1",
            at: ago(300),
            actor: me,
            summary: "Asha Rao created this",
          },
        ])
        setMore(false)
      }}
    />
  )
}

const VERSIONS: CollabVersion[] = [
  {
    version: 3,
    action: "update",
    actor: me,
    at: ago(5),
    changes: [{ field: "status", from: "In review", to: "Done" }],
  },
  {
    version: 2,
    action: "update",
    actor: PEOPLE[2] as CollabPerson,
    at: ago(120),
    changes: [
      { field: "dueDate", from: null, to: "2026-12-01" },
      { field: "title", from: "Launch page", to: "Launch page v2" },
    ],
  },
  {
    version: 1,
    action: "insert",
    actor: me,
    at: ago(300),
    changes: [{ field: "title", from: null, to: "Launch page" }],
  },
]

const SCREENS: Record<string, () => ReactNode> = {
  comments: () => <Comments />,
  activity: () => <Activity />,
  history: () => (
    <VersionHistory
      className="w-full max-w-2xl"
      versions={VERSIONS}
      onRestore={async () => {
        await wait()
        return { version: 4 }
      }}
      onUndo={async () => {
        await wait()
        throw new Error(
          "This record changed since you loaded it (now version 4). Reload and try again.",
        )
      }}
    />
  ),
}

function Page() {
  const only = params.get("screen")
  const names = only && SCREENS[only] ? [only] : Object.keys(SCREENS)
  return (
    <main className="flex min-h-dvh flex-col items-center gap-10 bg-background p-8 text-foreground">
      <h1 className="sr-only">Signet screens: collaboration</h1>
      <a href="./" className="self-start text-sm text-text-secondary underline">
        Showcase
      </a>
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
