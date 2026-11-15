/**
 * Realtime client, hooks and components. The client runs against the real
 * signet-server hub over an in-memory socket, so join, presence, shared
 * state, resume and dedupe are tested end to end; reconnect runs on a fake
 * socket factory. Then the hooks and the four components in the DOM.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { createRealtime } from "../../server/src/realtime/index"

GlobalRegistrator.register()

const { act, cleanup, render, screen } = await import("@testing-library/react")
const { createRealtimeClient, useChannel, useRecordChanges } = await import(
  "../src/hooks/use-channel"
)
const { AvatarStack, EditingBadge, RecordChangedBanner, TypingIndicator } = await import(
  "../src/components/screens/realtime-screens"
)

let pass = 0,
  fail = 0
const ok = (n: string, c: unknown, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, JSON.stringify(d)))
}
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))

// An in-memory WebSocket wired to a hub: what the browser socket would do.
type Who = { userId: string; orgId: string; name?: string }
function socketsFor(hub: ReturnType<typeof createRealtime>, who: Who) {
  const opened: FakeWs[] = []
  class FakeWs {
    readyState = 0
    onopen: ((e: unknown) => void) | null = null
    onmessage: ((e: { data: unknown }) => void) | null = null
    onclose: ((e: { code: number }) => void) | null = null
    conn: ReturnType<typeof hub.connect>
    constructor(_url: string) {
      opened.push(this)
      this.conn = hub.connect(
        {
          send: (d) => queueMicrotask(() => this.onmessage?.({ data: d })),
          close: (code = 1000) => this.drop(code),
        },
        who,
      )
      queueMicrotask(() => {
        this.readyState = 1
        this.onopen?.({})
      })
    }
    send(d: string) {
      void this.conn.receive(d)
    }
    close(code = 1000) {
      this.conn.closed()
      this.drop(code)
    }
    drop(code: number) {
      if (this.readyState === 3) return
      this.readyState = 3
      queueMicrotask(() => this.onclose?.({ code }))
    }
  }
  return { FakeWs, opened }
}

const hub = createRealtime({ authorize: (_w, ch) => ch.startsWith("record:") })
const A = socketsFor(hub, { userId: "u1", orgId: "o1", name: "Asha Rao" })
const B = socketsFor(hub, { userId: "u2", orgId: "o1", name: "Dev Patel" })
const fast = () => 5
const a = createRealtimeClient({ url: "ws://x/realtime", WebSocket: A.FakeWs, backoff: fast })
const b = createRealtimeClient({ url: "ws://x/realtime", WebSocket: B.FakeWs, backoff: fast })

const CH = "record:docs:1"
const leaveA = a.join(CH)
const leaveB = b.join(CH)
const aEvents: number[] = []
a.onEvent(CH, (e) => aEvents.push((e.data as { n: number }).n))
await tick()
ok("both clients joined", a.snapshot(CH).joined && b.snapshot(CH).joined && a.status === "open")
ok(
  "presence lists both",
  a
    .snapshot(CH)
    .members.map((m) => m.userId)
    .sort()
    .join() === "u1,u2",
)

b.presence(CH, { typing: true, editing: "title" })
await tick()
const dev = a.snapshot(CH).members.find((m) => m.userId === "u2")
ok("typing and editing reach the other client", dev?.typing === true && dev.editing === "title")

await hub.publish("o1", CH, "updated", { n: 1 }, "row_1")
await hub.publish("o1", CH, "updated", { n: 1 }, "row_1") // outbox redelivery
await tick()
ok("an event is delivered once even when redelivered", aEvents.join() === "1")

a.set(CH, "status", "draft")
await tick()
ok(
  "shared state syncs with a version",
  b.snapshot(CH).state.status?.value === "draft" && b.snapshot(CH).state.status?.version === 1,
)
a.set(CH, "status", "review")
b.set(CH, "status", "published")
await tick()
const sa = a.snapshot(CH).state.status
const sb = b.snapshot(CH).state.status
ok(
  "concurrent writes converge on one winner",
  sa?.value === sb?.value && sa?.version === 3 && sb?.version === 3,
  [sa, sb],
)
ok(
  "the writer that lost a race sees a conflict",
  !!(a.snapshot(CH).conflict || b.snapshot(CH).conflict),
)

// reconnect with resume: the socket drops, events are published meanwhile
A.opened.at(-1)?.close(1006)
await hub.publish("o1", CH, "updated", { n: 2 })
await hub.publish("o1", CH, "updated", { n: 3 })
await tick(40)
ok("the client reconnected on its own", A.opened.length === 2 && a.snapshot(CH).joined)
ok("and replayed exactly what it missed", aEvents.join() === "1,2,3", aEvents)

// a kicked user does not reconnect
hub.disconnect("o1", "u1")
await tick(40)
ok("a removed user is not reconnected", A.opened.length === 2 && a.status === "closed")

leaveB()
await tick()
ok(
  "leaving drops presence for the others",
  hub.presence("o1", CH).every((m) => m.userId !== "u2"),
)
leaveA()
a.close()
b.close()

// --- hooks and components
const C = socketsFor(hub, { userId: "u3", orgId: "o1", name: "Meera Iyer" })
const D = socketsFor(hub, { userId: "u4", orgId: "o1", name: "Zed" })
const c = createRealtimeClient({ url: "ws://x/realtime", WebSocket: C.FakeWs, backoff: fast })
const d = createRealtimeClient({ url: "ws://x/realtime", WebSocket: D.FakeWs, backoff: fast })
const leaveD = d.join(CH)

function Page() {
  const ch = useChannel(c, CH)
  const { changed, change, dismiss } = useRecordChanges(c, CH, { selfId: "u3" })
  return (
    <div>
      <AvatarStack members={ch.members} selfId="u3" />
      <EditingBadge members={ch.members} selfId="u3" field="title" fieldLabel="the title" />
      <TypingIndicator members={ch.members} selfId="u3" />
      <RecordChangedBanner
        changed={changed}
        by={(change?.data as { name?: string } | null)?.name}
        onReload={dismiss}
        onDismiss={dismiss}
      />
    </div>
  )
}
render(<Page />)
await act(() => tick(20))
ok(
  "useChannel joins on mount",
  hub.presence("o1", CH).some((m) => m.userId === "u3"),
)
const stack = document.querySelector("[data-slot=avatar-stack]")
ok(
  "AvatarStack shows others, not you, with an accessible label",
  stack?.getAttribute("aria-label") === "Viewing: Zed" &&
    stack.querySelectorAll("[data-user-id]").length === 1,
)
ok(
  "EditingBadge is absent while nobody edits",
  !document.querySelector("[data-slot=editing-badge]"),
)
await act(async () => {
  d.presence(CH, { typing: true, editing: "title" })
  await tick(20)
})
ok("EditingBadge names the editor and field", screen.getByText("Zed is editing the title"))
ok(
  "TypingIndicator announces in a polite live region",
  document.querySelector("[data-slot=typing-indicator]")?.getAttribute("aria-live") === "polite" &&
    screen.getByText("Zed is typing…"),
)
ok(
  "RecordChangedBanner hidden until a change",
  !document.querySelector("[data-slot=record-changed-banner]"),
)
await act(async () => {
  await hub.publish("o1", CH, "updated", { by: "u3", name: "Meera Iyer" })
  await tick(20)
})
ok(
  "your own change does not raise the banner",
  !document.querySelector("[data-slot=record-changed-banner]"),
)
await act(async () => {
  await hub.publish("o1", CH, "updated", { by: "u4", name: "Zed" })
  await tick(20)
})
ok(
  "someone else's change raises it",
  screen.getByText("Zed updated it. Reload to see the latest version."),
)
await act(async () => {
  screen.getByRole("button", { name: "Reload" }).click()
  await tick()
})
ok("Reload clears the banner", !document.querySelector("[data-slot=record-changed-banner]"))
cleanup()
await tick(20)
ok(
  "unmount leaves the channel",
  hub.presence("o1", CH).every((m) => m.userId !== "u3"),
)
leaveD()
c.close()
d.close()

// AvatarStack overflow, without a hub
render(
  <AvatarStack
    max={2}
    members={["Ada", "Bea", "Cy", "Di"].map((name, i) => ({ userId: `x${i}`, name }))}
  />,
)
ok(
  "AvatarStack folds the rest into +n",
  document.querySelector("[data-slot=avatar-stack-more]")?.textContent === "+2",
)
cleanup()

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
