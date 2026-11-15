/**
 * Collab screens: comment threads (reply, edit, delete, edited marker), the
 * mention picker storing ids not names, the activity feed with Load more,
 * and version history with its diff, Restore and Undo.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const {
  ActivityFeed,
  CommentThreads,
  MentionTextarea,
  VersionHistory,
  mentionsToText,
  textToMentions,
} = await import("../src/components/screens/collab-screens")
const React = await import("react")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
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

const at = "2026-11-15T10:00:00.000Z"
const asha = { id: "u1", name: "Asha Rao" }
const mo = { id: "u2", name: "Mo" }
const people = [asha, mo, { id: "u3", name: "Meera" }]
const search = async (q: string) =>
  people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))

await t("mention text round trip", () => {
  const body = "Hi @[Asha Rao](user:u1) and @[Asha](user:u9)"
  const { text, picked } = mentionsToText(body)
  ok("tokens read as @Name", text === "Hi @Asha Rao and @Asha", text)
  ok("back to tokens, longest name first", textToMentions(text, picked) === body)
})

await t("MentionTextarea picks a member by id", async () => {
  const user = userEvent.setup()
  let value = ""
  function Harness() {
    const [v, setV] = React.useState("")
    value = v
    return <MentionTextarea value={v} onValueChange={setV} onSearch={search} aria-label="Comment" />
  }
  render(<Harness />)
  const box = screen.getByRole("combobox", { name: "Comment" })
  await user.type(box, "Ping @m")
  const list = await screen.findByRole("listbox", { name: "People to mention" })
  await waitFor(() => {
    if (within(list).getAllByRole("option").length !== 2) throw new Error("not yet")
  })
  ok(
    "filters members",
    within(list)
      .getAllByRole("option")
      .map((o) => o.lastChild?.textContent)
      .join() === "Mo,Meera",
  )
  ok("combobox expanded", box.getAttribute("aria-expanded") === "true")
  await user.keyboard("{ArrowDown}{ArrowUp}{Enter}")
  ok("stores the id", value === "Ping @[Mo](user:u2) ", value)
  ok("shows the name", (box as HTMLTextAreaElement).value === "Ping @Mo ")
  ok("closes after picking", !screen.queryByRole("listbox"))
  await user.type(box, "@zz")
  await screen.findByText("No one matches")
  await user.keyboard("{Escape}")
  ok("Escape closes", !screen.queryByRole("listbox"))
})

await t("CommentThreads", async () => {
  const user = userEvent.setup()
  const added: { body: string; parentId?: string }[] = []
  const edited: string[] = []
  const deleted: string[] = []
  const threads = [
    {
      id: "c1",
      author: asha,
      body: "Ready, @[Mo](user:u2)?",
      createdAt: at,
      editedAt: at,
      replies: [{ id: "c2", parentId: "c1", author: mo, body: "Yes", createdAt: at }],
    },
    {
      id: "c3",
      author: mo,
      body: "",
      createdAt: at,
      deleted: true,
      replies: [{ id: "c4", parentId: "c3", author: asha, body: "ok", createdAt: at }],
    },
  ]
  render(
    <CommentThreads
      threads={threads}
      currentUserId="u1"
      onAdd={(i) => {
        added.push(i)
      }}
      onEdit={(c, body) => {
        edited.push(`${c.id}:${body}`)
      }}
      onDelete={(c) => {
        deleted.push(c.id)
      }}
      onSearchPeople={search}
    />,
  )
  const region = screen.getByRole("region", { name: "Comments" })
  const chip = region.querySelector("[data-slot=mention]")
  ok(
    "mention chip with the id",
    chip?.textContent === "@Mo" && chip.getAttribute("data-user-id") === "u2",
  )
  ok(
    "edited marker",
    region.querySelector("[data-slot=comment-edited]")?.textContent === "(edited)",
  )
  ok("deleted placeholder kept for its replies", screen.getByText("Comment deleted") !== null)
  // Only my comments get Edit; Delete only on mine without moderation.
  ok("edit only on own", screen.getAllByRole("button", { name: "Edit" }).length === 2)
  ok("delete only on own", screen.getAllByRole("button", { name: "Delete" }).length === 2)
  await user.click(screen.getAllByRole("button", { name: "Reply" })[0] as HTMLElement)
  const reply = screen.getByRole("combobox", { name: "Reply…" })
  await user.type(reply, "On it")
  await user.click(screen.getAllByRole("button", { name: "Reply" }).at(-1) as HTMLElement)
  ok("reply goes to the thread", added[0]?.body === "On it" && added[0]?.parentId === "c1", added)
  await user.click(screen.getAllByRole("button", { name: "Edit" })[0] as HTMLElement)
  const editBox = screen
    .getAllByRole("combobox")
    .find((b) => (b as HTMLTextAreaElement).value.startsWith("Ready")) as HTMLTextAreaElement
  ok("edit shows names, not tokens", editBox.value === "Ready, @Mo?")
  await user.clear(editBox)
  await user.type(editBox, "Ready now, @Mo?")
  await user.click(screen.getByRole("button", { name: "Save" }))
  ok("edit keeps the mention id", edited[0] === "c1:Ready now, @[Mo](user:u2)?", edited)
  await user.click(screen.getAllByRole("button", { name: "Delete" })[0] as HTMLElement)
  ok("delete", deleted[0] === "c1")
  const composer = screen.getByRole("combobox", { name: /Write a comment/ })
  await user.type(composer, "New one")
  await user.click(screen.getByRole("button", { name: "Comment" }))
  await waitFor(() => {
    const box = screen.getByRole("combobox", { name: /Write a comment/ }) as HTMLTextAreaElement
    if (box.value !== "") throw new Error("not cleared")
  })
  ok("new comment", added.at(-1)?.body === "New one" && added.at(-1)?.parentId === undefined)
})

await t("CommentThreads keeps the text when sending fails", async () => {
  const user = userEvent.setup()
  render(
    <CommentThreads
      threads={[]}
      onAdd={() => {
        throw new Error("down")
      }}
      onSearchPeople={search}
    />,
  )
  ok("empty state", screen.getByText("No comments yet") !== null)
  const box = screen.getByRole("combobox")
  await user.type(box, "Hello")
  await user.click(screen.getByRole("button", { name: "Comment" }))
  await screen.findByText("Couldn't save. Try again.")
  ok("text kept", (screen.getByRole("combobox") as HTMLTextAreaElement).value === "Hello")
})

await t("ActivityFeed", async () => {
  const user = userEvent.setup()
  let loaded = 0
  render(
    <ActivityFeed
      items={[
        { kind: "change", id: "a1", at, actor: asha, summary: "Asha Rao changed status to Done" },
        {
          kind: "comment",
          id: "c1",
          at,
          actor: mo,
          summary: "Mo commented",
          comment: { id: "c1", author: mo, body: "Nice @[Asha Rao](user:u1)", createdAt: at },
        },
      ]}
      hasMore
      onLoadMore={() => {
        loaded++
      }}
    />,
  )
  const region = screen.getByRole("region", { name: "Activity" })
  ok(
    "summaries in order",
    [...region.querySelectorAll("[data-slot=activity-item] > div > span:first-child")]
      .map((s) => s.textContent)
      .join("|") === "Asha Rao changed status to Done|Mo commented",
  )
  ok(
    "comment excerpt with chip",
    region.querySelector("[data-slot=mention]")?.textContent === "@Asha Rao",
  )
  await user.click(screen.getByRole("button", { name: "Load more" }))
  ok("load more", loaded === 1)
})

await t("VersionHistory", async () => {
  const user = userEvent.setup()
  const restored: number[] = []
  let undone = 0
  const versions = [
    {
      version: 3,
      action: "update",
      actor: asha,
      at,
      changes: [
        { field: "status", from: "Doing", to: "Done" },
        { field: "secret", from: null, to: null, hidden: true },
      ],
    },
    {
      version: 2,
      action: "update",
      actor: mo,
      at,
      changes: [{ field: "dueDate", from: null, to: "2026-12-01" }],
    },
    { version: 1, action: "insert", actor: asha, at, changes: [] },
  ]
  render(
    <VersionHistory
      versions={versions}
      onRestore={async (v) => {
        restored.push(v.version)
        return { version: 4 }
      }}
      onUndo={async () => {
        undone++
        throw new Error(
          "This record changed since you loaded it (now version 4). Reload and try again.",
        )
      }}
    />,
  )
  const region = screen.getByRole("region", { name: "Version history" })
  const options = within(region).getAllByRole("option")
  ok(
    "lists versions newest first",
    options.map((o) => o.textContent?.slice(0, 9)).join() === "Version 3,Version 2,Version 1",
  )
  ok(
    "latest selected, its diff shown",
    options[0]?.getAttribute("aria-selected") === "true" &&
      region.querySelector("del")?.textContent === "Doing" &&
      region.querySelector("ins")?.textContent === "Done",
  )
  ok("encrypted field hidden", screen.getByText("Hidden") !== null)
  ok("no Restore on the latest", !screen.queryByRole("button", { name: "Restore this version" }))
  await user.click(options[1] as HTMLElement)
  ok(
    "diff of the picked version",
    screen.getByText("Due date") !== null && region.querySelector("del")?.textContent === "(empty)",
  )
  await user.click(screen.getByRole("button", { name: "Restore this version" }))
  await screen.findByText("Restored as version 4")
  ok("restore", restored[0] === 2)
  await user.click(screen.getByRole("button", { name: "Undo last change" }))
  await screen.findByText(/changed since you loaded it/)
  ok("undo conflict message shown", undone === 1)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
