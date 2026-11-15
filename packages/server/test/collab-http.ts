/**
 * collabRoutes(): every route acts in the request's tenant, signed-out is
 * 401, a store refusal (signet-db's OrgError, by shape) keeps its status,
 * and org B can never reach org A's record through any route (deny by
 * default). The store is an in-memory stand-in shaped like signet-db's
 * createCollab; the real store is tested on every backend in signet-db.
 * Then the mention template and notifyMentions on the real notifier: inbox
 * plus email, preferences honoured, one notification per key.
 */
import { Hono } from "hono"
import { memoryKv } from "../src/adapters/index"
import {
  type CollabStore,
  collabRoutes,
  mentionTemplates,
  notifyMentions,
} from "../src/http/collab"
import { errorHandler } from "../src/http/errors"
import { type TenantOrg, tenant } from "../src/http/orgs"
import { createNotifier, kvNotifyStore, type Sender } from "../src/notify/notifier"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

class FakeOrgError extends Error {
  readonly name = "SignetDbError"
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

type Who = { orgId: string; userId: string }
const orgs = new Map<string, TenantOrg>([
  ["org_a", { id: "org_a", name: "A", slug: "acme", domain: null, theme: null, brandColor: null }],
  ["org_b", { id: "org_b", name: "B", slug: "bolt", domain: null, theme: null, brandColor: null }],
])
const members: Record<string, string[]> = { org_a: ["alice", "mo"], org_b: ["bob"] }
const records = new Map([["t1", { orgId: "org_a", table: "tasks", version: 2 }]])
const comments = new Map<string, { id: string; who: Who; recordId: string; body: string }>()
const calls: string[] = []

const check = (who: Who, ref: { table: string; id: string }) => {
  const r = records.get(ref.id)
  if (
    !members[who.orgId]?.includes(who.userId) ||
    !r ||
    r.orgId !== who.orgId ||
    r.table !== ref.table
  )
    throw new FakeOrgError(404, "NOT_FOUND", "No such record.")
  return r
}
const store: CollabStore = {
  comments: async (who, ref) => (
    check(who, ref), [...comments.values()].filter((c) => c.recordId === ref.id)
  ),
  addComment: async (who, ref, input) => {
    check(who, ref)
    const c = { id: `c${comments.size + 1}`, who, recordId: ref.id, body: input.body }
    comments.set(c.id, c)
    calls.push(`add:${input.parentId ?? "-"}`)
    return c
  },
  editComment: async (who, id, input) => {
    const c = comments.get(id)
    if (!c || c.who.orgId !== who.orgId || !members[who.orgId]?.includes(who.userId))
      throw new FakeOrgError(404, "NOT_FOUND", "No such comment.")
    if (c.who.userId !== who.userId) throw new FakeOrgError(403, "FORBIDDEN", "Not yours.")
    c.body = input.body
    return c
  },
  deleteComment: async (who, id) => {
    const c = comments.get(id)
    if (!c || c.who.orgId !== who.orgId || !members[who.orgId]?.includes(who.userId))
      throw new FakeOrgError(404, "NOT_FOUND", "No such comment.")
    comments.delete(id)
  },
  mentionable: async (who, q = "") => {
    if (!members[who.orgId]?.includes(who.userId)) throw new FakeOrgError(404, "NOT_FOUND", "No.")
    return (members[who.orgId] ?? []).filter((m) => m.includes(q)).map((id) => ({ id, name: id }))
  },
  timeline: async (who, ref, o) => (
    check(who, ref),
    calls.push(`timeline:${o?.before ?? "-"}:${o?.limit ?? "-"}`),
    { items: [], nextCursor: null }
  ),
  versions: async (who, ref, o) => (
    check(who, ref), calls.push(`versions:${o?.before ?? "-"}`), []
  ),
  diff: async (who, ref, from, to) => (check(who, ref), { from, to, changes: [] }),
  restore: async (who, ref, n) => {
    check(who, ref)
    if (who.userId !== "alice")
      throw new FakeOrgError(403, "FORBIDDEN", "You cannot change this record.")
    return { version: n + 10 }
  },
  undo: async (who, ref, o) => {
    const r = check(who, ref)
    if (o?.expected !== undefined && o.expected !== r.version)
      throw new FakeOrgError(409, "CONFLICT", "This record changed since you loaded it.")
    return { version: r.version + 1 }
  },
}

const app = new Hono()
app.onError(errorHandler({ isProduction: () => false }))
app.use(
  "*",
  tenant({
    orgs: {
      get: async (id) => orgs.get(id) ?? null,
      bySlug: async () => null,
      byDomain: async () => null,
    },
  }),
)
app.route("/collab", collabRoutes({ collab: store, userId: (c) => c.req.header("x-user") }))

const req = async (path: string, user: string | null, org = "org_a", init: RequestInit = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json", "x-org": org }
  if (user) headers["x-user"] = user
  const res = await app.request(`/collab${path}`, { ...init, headers })
  return { status: res.status, json: (await res.json()) as any }
}
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) })

console.log("collab routes")
{
  const add = await req(
    "/tasks/t1/comments",
    "alice",
    "org_a",
    post({ body: "Hi", parentId: "c0" }),
  )
  ok("POST comment: 201 with the comment", add.status === 201 && add.json.comment.id === "c1")
  ok("POST comment: parentId passed on", calls.includes("add:c0"))
  const list = await req("/tasks/t1/comments", "mo", "org_a")
  ok("GET comments: threads", list.status === 200 && list.json.threads.length === 1)
  ok(
    "empty body is 400",
    (await req("/tasks/t1/comments", "alice", "org_a", post({ body: " " }))).status === 400,
  )
  ok(
    "bad JSON is 400",
    (await req("/tasks/t1/comments", "alice", "org_a", { method: "POST", body: "{" })).status ===
      400,
  )
  const edit = await req("/comments/c1", "mo", "org_a", {
    method: "PATCH",
    body: JSON.stringify({ body: "x" }),
  })
  ok(
    "PATCH someone else's comment: 403 kept from the store",
    edit.status === 403 && edit.json.code === "FORBIDDEN",
  )
  const mine = await req("/comments/c1", "alice", "org_a", {
    method: "PATCH",
    body: JSON.stringify({ body: "Hey" }),
  })
  ok("PATCH own comment", mine.status === 200 && mine.json.comment.body === "Hey")
  const people = await req("/mentions?q=m", "alice", "org_a")
  ok(
    "GET mentions: org members only",
    people.status === 200 && JSON.stringify(people.json.people) === '[{"id":"mo","name":"mo"}]',
  )
  await req("/tasks/t1/timeline?before=123_x&limit=5", "alice")
  ok("GET timeline passes the cursor and limit", calls.includes("timeline:123_x:5"))
  ok("bad limit is 400", (await req("/tasks/t1/timeline?limit=lots", "alice")).status === 400)
  await req("/tasks/t1/versions?before=3", "alice")
  ok("GET versions passes before", calls.includes("versions:3"))
  const diff = await req("/tasks/t1/versions/diff?from=1&to=2", "alice")
  ok("GET diff", diff.status === 200 && diff.json.from === 1 && diff.json.to === 2)
  ok(
    "diff needs from and to",
    (await req("/tasks/t1/versions/diff?from=1", "alice")).status === 400,
  )
  const restore = await req("/tasks/t1/versions/1/restore", "alice", "org_a", post({}))
  ok("POST restore", restore.status === 200 && restore.json.version === 11)
  ok(
    "restore without write access: 403",
    (await req("/tasks/t1/versions/1/restore", "mo", "org_a", post({}))).status === 403,
  )
  const stale = await req("/tasks/t1/undo", "alice", "org_a", post({ expected: 1 }))
  ok("undo on a stale version: 409", stale.status === 409 && stale.json.code === "CONFLICT")
  ok(
    "undo",
    (await req("/tasks/t1/undo", "alice", "org_a", post({ expected: 2 }))).json.version === 3,
  )
  ok(
    "undo expected must be a number",
    (await req("/tasks/t1/undo", "alice", "org_a", post({ expected: "2" }))).status === 400,
  )
  ok(
    "DELETE comment",
    (await req("/comments/c1", "alice", "org_a", { method: "DELETE" })).json.deleted === 1,
  )
}

console.log("deny by default")
{
  await req("/tasks/t1/comments", "alice", "org_a", post({ body: "secret" }))
  const id = [...comments.keys()][0] as string
  const routes: [string, RequestInit][] = [
    ["/tasks/t1/comments", {}],
    ["/tasks/t1/comments", post({ body: "hi" })],
    [`/comments/${id}`, { method: "PATCH", body: JSON.stringify({ body: "x" }) }],
    [`/comments/${id}`, { method: "DELETE" }],
    ["/tasks/t1/timeline", {}],
    ["/tasks/t1/versions", {}],
    ["/tasks/t1/versions/diff?from=1&to=2", {}],
    ["/tasks/t1/versions/1/restore", post({})],
    ["/tasks/t1/undo", post({})],
  ]
  for (const [path, init] of routes) {
    const signedOut = await req(path, null, "org_a", init)
    ok(`signed out ${init.method ?? "GET"} ${path}: 401`, signedOut.status === 401)
    const other = await req(path, "bob", "org_b", init)
    ok(`org B ${init.method ?? "GET"} ${path}: 404`, other.status === 404)
    const spoof = await req(path, "bob", "org_a", init)
    ok(`a header naming org A does not let bob in: 404`, spoof.status === 404)
  }
  ok("no tenant: 404", (await req("/tasks/t1/comments", "alice", "nope")).status === 404)
  ok("an unknown table: 404", (await req("/users/t1/comments", "alice")).status === 404)
  ok(
    "org B's mention picker never lists org A",
    (await req("/mentions", "bob", "org_a")).status === 404,
  )
}

console.log("mention notifications")
{
  const sent: { channel: string; to: string; rendered: any }[] = []
  const email: Sender<"email"> = {
    provider: "test",
    async send(to, rendered) {
      sent.push({ channel: "email", to, rendered })
      return { id: `e${sent.length}`, status: "sent" }
    },
  }
  const notifier = createNotifier({
    channels: { email },
    templates: mentionTemplates({ url: (m) => `https://app.test/${m.table}/${m.rowId}` }),
    store: kvNotifyStore(memoryKv()),
    recipients: async (id) => ({ email: `${id}@example.com` }),
    secret: "s".repeat(32),
    retry: { baseSeconds: 0 },
  })
  const notify = notifyMentions(notifier)
  const m = {
    to: "mo",
    by: "alice",
    byName: "Alice",
    orgId: "org_a",
    table: "tasks",
    rowId: "t1",
    commentId: "c9",
    excerpt: "Can @Mo <look>?",
    key: "mention:c9:mo",
  }
  await notify("mo", m)
  await notify("mo", m) // the same key twice: one notification
  await new Promise((r) => setTimeout(r, 30))
  const inbox = await notifier.inbox.list("mo")
  ok(
    "inbox: one item with the link",
    inbox.items.length === 1 && inbox.items[0]?.link === "https://app.test/tasks/t1",
    inbox.items,
  )
  ok(
    "email: one, escaped, with the link",
    sent.length === 1 &&
      sent[0]?.rendered.subject === "Alice mentioned you" &&
      sent[0]?.rendered.html.includes("&lt;look&gt;") &&
      sent[0]?.rendered.html.includes("https://app.test/tasks/t1"),
  )
  await notifier.updatePrefs("dev", { channels: { mentions: { email: false } } })
  const r = (await notify("dev", { ...m, to: "dev", key: "mention:c9:dev" })) as {
    channel: string
    reason?: string
  }[]
  await new Promise((r) => setTimeout(r, 30))
  ok(
    "prefs: mentions email off is skipped, the inbox still gets it",
    r.find((x) => x.channel === "email")?.reason === "PREFS" &&
      (await notifier.inbox.list("dev")).items.length === 1,
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
