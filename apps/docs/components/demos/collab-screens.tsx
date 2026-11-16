"use client"
import {
  ActivityFeed,
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
import { useState } from "react"

export function CommentThreadsDemo() {
  const people: CollabPerson[] = [
    { id: "u1", name: "Asha Rao" },
    { id: "u2", name: "Marcus Lee" },
    { id: "u3", name: "Priya Nair" },
  ]
  const [threads, setThreads] = useState<CollabThread[]>([
    {
      id: "c1",
      author: people[0],
      body: "Invoice INV-2041 looks right. @[Marcus Lee](user:u2) can you confirm the tax line?",
      createdAt: "2026-11-10T09:30:00Z",
      replies: [
        {
          id: "c2",
          parentId: "c1",
          author: people[1],
          body: "Confirmed, GST is 18%.",
          createdAt: "2026-11-10T10:05:00Z",
        },
      ],
    },
  ])
  return (
    <CommentThreads
      className="w-full max-w-xl"
      threads={threads}
      currentUserId="u1"
      onSearchPeople={(q) => people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))}
      onAdd={({ body, parentId }) => {
        const c = {
          id: `c${Date.now()}`,
          parentId,
          author: people[0],
          body,
          createdAt: new Date().toISOString(),
        }
        setThreads((t) =>
          parentId
            ? t.map((x) => (x.id === parentId ? { ...x, replies: [...x.replies, c] } : x))
            : [...t, { ...c, replies: [] }],
        )
      }}
      onEdit={(comment, body) =>
        setThreads((t) =>
          t.map((x) => ({
            ...x,
            body: x.id === comment.id ? body : x.body,
            replies: x.replies.map((r) => (r.id === comment.id ? { ...r, body } : r)),
          })),
        )
      }
      onDelete={(comment) => setThreads((t) => t.filter((x) => x.id !== comment.id))}
    />
  )
}

export function MentionTextareaDemo() {
  const [value, setValue] = useState("Thanks @[Asha Rao](user:u1), shipping Friday.")
  const people: CollabPerson[] = [
    { id: "u1", name: "Asha Rao" },
    { id: "u2", name: "Marcus Lee" },
    { id: "u3", name: "Priya Nair" },
  ]
  return (
    <div className="w-full max-w-md space-y-3">
      <MentionTextarea
        value={value}
        onValueChange={setValue}
        onSearch={(q) => people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))}
        placeholder="Write a comment. Type @ to mention someone."
      />
      <CommentBody body={value} />
    </div>
  )
}

export function ActivityFeedDemo() {
  const items: CollabTimelineItem[] = [
    {
      kind: "change",
      id: "a1",
      at: "2026-11-12T14:20:00Z",
      actor: { id: "u2", name: "Marcus Lee" },
      summary: "Marcus Lee changed status to Paid",
      action: "update",
      changes: [{ field: "status", from: "sent", to: "paid" }],
    },
    {
      kind: "comment",
      id: "a2",
      at: "2026-11-11T09:00:00Z",
      actor: { id: "u1", name: "Asha Rao" },
      summary: "Asha Rao commented",
      comment: {
        id: "c1",
        author: { id: "u1", name: "Asha Rao" },
        body: "Sent the reminder to the client.",
        createdAt: "2026-11-11T09:00:00Z",
      },
    },
    {
      kind: "change",
      id: "a3",
      at: "2026-11-10T08:00:00Z",
      actor: { id: "u1", name: "Asha Rao" },
      summary: "Asha Rao created the invoice",
      action: "insert",
    },
  ]
  return <ActivityFeed className="w-full max-w-xl" items={items} />
}

const versions: CollabVersion[] = [
  {
    version: 3,
    action: "update",
    actor: { id: "u2", name: "Marcus Lee" },
    at: "2026-11-12T14:20:00Z",
    changes: [
      { field: "status", from: "sent", to: "paid" },
      { field: "paidAt", from: null, to: "2026-11-12" },
    ],
  },
  {
    version: 2,
    action: "update",
    actor: { id: "u1", name: "Asha Rao" },
    at: "2026-11-11T09:00:00Z",
    changes: [{ field: "amount", from: 1180, to: 1250 }],
  },
  {
    version: 1,
    action: "insert",
    actor: { id: "u1", name: "Asha Rao" },
    at: "2026-11-10T08:00:00Z",
    changes: [
      { field: "amount", from: null, to: 1180 },
      { field: "status", from: null, to: "draft" },
    ],
  },
]

export function VersionHistoryDemo() {
  return (
    <VersionHistory
      className="w-full max-w-xl"
      versions={versions}
      onRestore={(v) => ({ version: versions.length + 1 + v.version })}
      onUndo={() => undefined}
    />
  )
}

export function VersionDiffDemo() {
  return <VersionDiff className="w-full max-w-md" changes={versions[0].changes} />
}
