/**
 * Realtime hub: several clients per channel, tenant isolation (deny by
 * default, org A never sees org B), presence with joins, leaves, typing and
 * heartbeat timeouts on a fake clock, resume after reconnect, last-writer-wins
 * shared state with a conflict, backpressure and rate limits, the outbox
 * queue, session auth and origin checks, then the same protocol over real
 * sockets on Bun and Node and through the Durable Object class.
 */
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { issueSession, verifySession } from "../src/auth/session"
import { bunRealtime } from "../src/realtime/bun"
import { realtimeRoom, roomPublisher } from "../src/realtime/cloudflare"
import {
  admit,
  CLOSE,
  createRealtime,
  REALTIME_TOPIC,
  type RealtimeIdentity,
  type RealtimeOptions,
  realtimeOutbox,
  sessionAuth,
} from "../src/realtime/index"
import { attachRealtime } from "../src/realtime/node"

let pass = 0,
  fail = 0
const ok = (n: string, c: unknown, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, JSON.stringify(d)))
}

type Msg = Record<string, any>

let clock = 1_000_000
const now = () => clock
const allowRecords: RealtimeOptions["authorize"] = (_who, ch) => ch.startsWith("record:")

function fake(
  hub: ReturnType<typeof createRealtime>,
  who: RealtimeIdentity,
  opts: { buffered?: () => number } = {},
) {
  const inbox: Msg[] = []
  const state = { closed: undefined as number | undefined }
  const conn = hub.connect(
    {
      send: (d) => inbox.push(JSON.parse(d)),
      close: (code) => {
        state.closed = code
      },
      ...(opts.buffered && { buffered: opts.buffered }),
    },
    who,
  )
  return {
    inbox,
    state,
    conn,
    send: (m: Msg) => conn.receive(JSON.stringify(m)),
    last: (type: string) => inbox.filter((m) => m.type === type).at(-1) as Msg,
    all: (type: string) => inbox.filter((m) => m.type === type),
    clear: () => inbox.splice(0),
  }
}

const alice = { userId: "alice", orgId: "org_a", name: "Alice" }
const bob = { userId: "bob", orgId: "org_a", name: "Bob" }
const eve = { userId: "eve", orgId: "org_b", name: "Eve" }

// --- deny by default
{
  const hub = createRealtime({ now })
  const a = fake(hub, alice)
  ok(
    "welcome carries the heartbeat interval",
    a.inbox[0]?.type === "welcome" && a.inbox[0].heartbeatMs === 15_000,
  )
  await a.send({ type: "join", channel: "record:doc:1" })
  ok(
    "no authorize: every join is refused",
    a.last("error")?.code === "FORBIDDEN" && !a.last("joined"),
  )
  const thrower = createRealtime({
    now,
    authorize: () => {
      throw new Error("db down")
    },
  })
  const t = fake(thrower, alice)
  await t.send({ type: "join", channel: "record:doc:1" })
  ok("an authorize that throws denies", t.last("error")?.code === "FORBIDDEN")
}

// --- multiple clients, presence, typing, tenant isolation
{
  const hub = createRealtime({ now, authorize: allowRecords })
  const a = fake(hub, alice)
  const a2 = fake(hub, alice) // second tab
  const b = fake(hub, bob)
  const e = fake(hub, eve)
  await a.send({ type: "join", channel: "record:doc:1" })
  await a2.send({ type: "join", channel: "record:doc:1" })
  await b.send({ type: "join", channel: "record:doc:1" })
  await e.send({ type: "join", channel: "record:doc:1" }) // same name, other org
  await b.send({ type: "join", channel: "admin:secrets" })
  ok("authorize refuses a channel outside its rule", b.last("error")?.code === "FORBIDDEN")

  const p = a.last("presence")
  ok(
    "presence lists each user once, with their tab count",
    p.members.length === 2 &&
      p.members.find((m: Msg) => m.userId === "alice").connections === 2 &&
      p.joined?.[0] === "bob",
    p,
  )
  ok(
    "org B's channel of the same name has only org B",
    e.last("presence").members.length === 1 && e.last("presence").members[0].userId === "eve",
  )
  ok("org A never hears of org B's member", !a.inbox.some((m) => JSON.stringify(m).includes("eve")))

  await hub.publish("org_a", "record:doc:1", "updated", { title: "A" })
  ok(
    "a publish reaches every org A client",
    [a, a2, b].every((c) => c.last("event")?.data.title === "A"),
  )
  ok("a publish never reaches org B", !e.last("event"))
  await hub.publish("org_b", "record:doc:1", "updated", { title: "B" })
  ok(
    "and org B's publish never reaches org A",
    [a, a2, b].every((c) => c.last("event").data.title === "A") &&
      e.last("event").data.title === "B",
  )

  await b.send({ type: "presence", channel: "record:doc:1", typing: true, editing: "title" })
  const typing = a.last("presence").members.find((m: Msg) => m.userId === "bob")
  ok("typing and editing show in presence", typing.typing === true && typing.editing === "title")
  clock += 7_000
  hub.sweep()
  ok(
    "typing clears itself after typingMs",
    a.last("presence").members.find((m: Msg) => m.userId === "bob").typing === false,
  )
  ok(
    "editing stays until cleared",
    a.last("presence").members.find((m: Msg) => m.userId === "bob").editing === "title",
  )

  await a2.send({ type: "leave", channel: "record:doc:1" })
  ok("closing one tab is not a leave", !a.last("presence").left)
  // bob goes silent; everyone else pings
  clock += 30_000
  for (const c of [a, a2, e]) await c.send({ type: "ping" })
  ok("ping answers pong", a.last("pong"))
  clock += 20_000
  hub.sweep()
  ok("a silent connection times out", b.state.closed === CLOSE.timeout)
  ok(
    "and leaves presence",
    a.last("presence").left?.[0] === "bob" && a.last("presence").members.length === 1,
  )
  ok(
    "hub.presence reads the same",
    hub
      .presence("org_a", "record:doc:1")
      .map((m) => m.userId)
      .join() === "alice",
  )
  ok(
    "a message on an unjoined channel is refused",
    (await a2.send({ type: "set", channel: "record:doc:1", key: "k", value: 1 }),
    a2.last("error").code === "NOT_JOINED"),
  )

  hub.disconnect("org_a", "alice")
  ok(
    "disconnect closes a user's sockets",
    a.state.closed === CLOSE.kicked &&
      a2.state.closed === CLOSE.kicked &&
      e.state.closed === undefined,
  )
  ok(
    "an expired session is closed on sweep",
    (() => {
      const x = fake(hub, { ...eve, userId: "x", expiresAt: clock + 10 })
      clock += 11
      hub.sweep()
      return x.state.closed === CLOSE.expired
    })(),
  )
}

// --- resume after reconnect
{
  const hub = createRealtime({ now, authorize: allowRecords, limits: { history: 3 } })
  const a = fake(hub, alice)
  const b = fake(hub, bob)
  await a.send({ type: "join", channel: "record:doc:2" })
  await b.send({ type: "join", channel: "record:doc:2" })
  await hub.publish("org_a", "record:doc:2", "updated", { n: 1 })
  const j = b.last("joined")
  const seen = { epoch: j.epoch, seq: b.last("event").seq }
  b.conn.closed()
  await hub.publish("org_a", "record:doc:2", "updated", { n: 2 })
  await hub.publish("org_a", "record:doc:2", "updated", { n: 3 })
  const b2 = fake(hub, bob)
  await b2.send({ type: "join", channel: "record:doc:2", since: seen })
  const r = b2.last("joined")
  ok(
    "resume replays exactly the missed events",
    r.replay?.map((e: Msg) => e.data.n).join() === "2,3" && !r.reset,
    r,
  )
  for (let n = 4; n <= 8; n++) await hub.publish("org_a", "record:doc:2", "updated", { n })
  const b3 = fake(hub, bob)
  await b3.send({ type: "join", channel: "record:doc:2", since: seen })
  ok(
    "a gap older than the history asks for a reset",
    b3.last("joined").reset === true && !b3.last("joined").replay,
  )
  const b4 = fake(hub, bob)
  await b4.send({ type: "join", channel: "record:doc:2", since: { epoch: "other", seq: 1 } })
  ok("a different epoch (channel recreated) resets", b4.last("joined").reset === true)
  for (const c of [a, b2, b3, b4]) c.conn.closed()
  clock += 301_000
  hub.sweep()
  ok(
    "an idle channel is dropped",
    hub.presence("org_a", "record:doc:2").length === 0 &&
      Object.keys(hub.state("org_a", "record:doc:2")).length === 0,
  )
}

// --- shared state, last writer wins, conflict
{
  const hub = createRealtime({ now, authorize: allowRecords })
  const a = fake(hub, alice)
  const b = fake(hub, bob)
  await a.send({ type: "join", channel: "record:doc:3" })
  await b.send({ type: "join", channel: "record:doc:3" })
  await a.send({ type: "set", channel: "record:doc:3", key: "status", value: "draft" })
  ok(
    "a set broadcasts with version 1",
    b.last("state")?.version === 1 &&
      b.last("state").value === "draft" &&
      b.last("state").by === "alice",
  )
  // both saw version 1 and write at once; bob's arrives last
  await Promise.all([
    a.send({ type: "set", channel: "record:doc:3", key: "status", value: "review", base: 1 }),
    b.send({ type: "set", channel: "record:doc:3", key: "status", value: "published", base: 1 }),
  ])
  const final = hub.state("org_a", "record:doc:3").status
  ok(
    "the last writer wins, version 3",
    final?.value === "published" && final.version === 3 && final.by === "bob",
    final,
  )
  ok(
    "both clients converge on the winner",
    a.last("state").value === "published" && b.last("state").value === "published",
  )
  ok(
    "the late writer is told whose change it replaced",
    b.last("conflict")?.replaced.value === "review" &&
      b.last("conflict").replaced.by === "alice" &&
      !a.last("conflict"),
  )
  const c = fake(hub, { ...alice, userId: "carol" })
  await c.send({ type: "join", channel: "record:doc:3" })
  ok("a late joiner gets the state", c.last("joined").state.status.value === "published")
  const capped = createRealtime({ now, authorize: allowRecords, limits: { maxStateKeys: 1 } })
  const k = fake(capped, alice)
  await k.send({ type: "join", channel: "record:x" })
  await k.send({ type: "set", channel: "record:x", key: "a", value: 1 })
  await k.send({ type: "set", channel: "record:x", key: "b", value: 1 })
  ok("state keys are capped", k.last("error").code === "TOO_MANY_KEYS")
}

// --- limits and backpressure
{
  const hub = createRealtime({
    now,
    authorize: allowRecords,
    limits: { maxChannels: 1, maxMessageBytes: 100, messagesPerSecond: 2 },
  })
  const a = fake(hub, alice)
  await a.send({ type: "join", channel: "record:1" })
  await a.send({ type: "join", channel: "record:2" })
  ok("channels per connection are capped", a.last("error").code === "TOO_MANY_CHANNELS")
  await a.send({ type: "join", channel: "bad channel!" })
  ok("a bad channel name is refused", a.last("error").code === "BAD_REQUEST")
  await a.send({ type: "ping" }) // 4th message inside the same instant, burst is 4
  await a.send({ type: "ping" })
  ok("a flood is closed as a policy violation", a.state.closed === CLOSE.policy)
  const big = fake(hub, alice)
  await big.conn.receive("x".repeat(101))
  ok("an oversized message closes 1009", big.state.closed === CLOSE.tooBig)
  let queued = 0
  const slow = fake(hub, bob, { buffered: () => queued })
  await slow.send({ type: "join", channel: "record:1" })
  queued = 2_000_000
  await hub.publish("org_a", "record:1", "updated", {})
  ok(
    "a slow consumer is closed 1013 instead of buffering forever",
    slow.state.closed === CLOSE.slow,
  )
}

// --- outbox queue
{
  const hub = createRealtime({ now, authorize: allowRecords })
  const a = fake(hub, alice)
  await a.send({ type: "join", channel: "record:projects:42" })
  const q = realtimeOutbox(hub)
  await q.send({
    id: "row_1",
    topic: REALTIME_TOPIC,
    payload: {
      orgId: "org_a",
      channel: "record:projects:42",
      event: "updated",
      data: { id: "42" },
    },
  })
  ok(
    "an outbox row becomes an event carrying the row id",
    a.last("event")?.id === "row_1" && a.last("event").event === "updated",
  )
  let threw = false
  try {
    await q.send({ id: "row_2", topic: REALTIME_TOPIC, payload: { channel: "x" } })
  } catch {
    threw = true
  }
  ok("a payload without orgId throws (drainOutbox retries, then marks dead)", threw)
}

// --- admit and session auth
const sessionOpts = { cookieName: "app_session", secret: "s".repeat(32) }
const orgsStore = {
  membership: async (orgId: string, userId: string) =>
    orgId === "org_a" && userId === "alice"
      ? { orgId, userId, role: "member", permissions: ["records:read"] }
      : null,
}
const authenticate = sessionAuth({
  verify: (t) => verifySession(t, sessionOpts),
  cookieName: "app_session",
  orgs: orgsStore,
})
const token = await issueSession(sessionOpts, "alice")
{
  const req = (h: Record<string, string>, url = "http://app.example/realtime?org=org_a") =>
    new Request(url, { headers: { host: "app.example", ...h } })
  const who = await admit(req({ cookie: `app_session=${token}` }), { authenticate })
  ok(
    "a member's session cookie admits, with the org and expiry",
    !(who instanceof Response) &&
      who.orgId === "org_a" &&
      who.userId === "alice" &&
      typeof who.expiresAt === "number",
  )
  const notMember = await admit(
    req({ cookie: `app_session=${token}` }, "http://app.example/realtime?org=org_b"),
    { authenticate },
  )
  ok("another org's id is refused 401", notMember instanceof Response && notMember.status === 401)
  const none = await admit(req({}), { authenticate })
  ok("no session is refused 401", none instanceof Response && none.status === 401)
  const cross = await admit(
    req({ cookie: `app_session=${token}`, origin: "https://evil.example" }),
    { authenticate },
  )
  ok("a cross-site origin is refused 403", cross instanceof Response && cross.status === 403)
  const same = await admit(req({ cookie: `app_session=${token}`, origin: "https://app.example" }), {
    authenticate,
  })
  ok("the same origin is admitted", !(same instanceof Response))
  const listed = await admit(
    req(
      { cookie: `signet_org=org_a; app_session=${token}`, origin: "https://web.example" },
      "http://app.example/realtime",
    ),
    { authenticate, origins: ["https://web.example"] },
  )
  ok("a listed origin and the org cookie are admitted", !(listed instanceof Response))
}

// --- real sockets: a small client over the global WebSocket
function client(url: string, headers: Record<string, string>) {
  // Bun's WebSocket takes headers; Node's does not, so Node tests pass the cookie another way.
  const ws = new (WebSocket as unknown as new (u: string, o: unknown) => WebSocket)(url, {
    headers,
  })
  const inbox: Msg[] = []
  const waiters: [(m: Msg) => boolean, (m: Msg) => void][] = []
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data))
    inbox.push(m)
    for (const w of [...waiters]) if (w[0](m)) waiters.splice(waiters.indexOf(w), 1), w[1](m)
  }
  const until = (pred: (m: Msg) => boolean) =>
    new Promise<Msg>((resolve, reject) => {
      const hit = inbox.find(pred)
      if (hit) return resolve(hit)
      waiters.push([pred, resolve])
      setTimeout(() => reject(new Error("timeout")), 2000)
    })
  const opened = new Promise<void>((r, j) => {
    ws.onopen = () => r()
    ws.onerror = () => j(new Error("socket error"))
  })
  const closed = new Promise<number>((r) => {
    ws.onclose = (e) => r(e.code)
  })
  return { ws, inbox, until, opened, closed, send: (m: Msg) => ws.send(JSON.stringify(m)) }
}

async function liveScenario(name: string, base: string) {
  const cookie = { cookie: `app_session=${token}` }
  const a = client(`${base}?org=org_a`, cookie)
  await a.opened
  await a.until((m) => m.type === "welcome")
  a.send({ type: "join", channel: "record:doc:9" })
  await a.until((m) => m.type === "joined")
  a.send({ type: "set", channel: "record:doc:9", key: "k", value: "v" })
  const st = await a.until((m) => m.type === "state")
  ok(`${name}: join and shared state over a real socket`, st.value === "v" && st.version === 1)
  const big = a.inbox.length
  a.send({ type: "ping", pad: "x".repeat(20_000) })
  ok(
    `${name}: an oversized frame closes the socket`,
    (await a.closed) === 1009 && a.inbox.length === big,
  )
  const refused = client(`${base}?org=org_b`, cookie)
  const code = await Promise.race([
    refused.closed,
    refused.opened.then(
      () => -1,
      () => -2,
    ),
  ])
  ok(`${name}: a non-member's upgrade is refused`, code !== -1, code)
}

const liveHub = () => createRealtime({ authorize: allowRecords })

// Bun
{
  const hub = liveHub()
  const live = bunRealtime(hub, { authenticate })
  // Bun's types are not loaded in this package.
  const B = (globalThis as any).Bun
  const server = B.serve({
    port: 0,
    fetch: (req: Request, srv: never) => live.upgrade(req, srv),
    websocket: live.websocket,
  })
  await liveScenario("bun", `ws://localhost:${server.port}/realtime`)
  live.stop()
  server.stop(true)
}

// Node (the server under test; Bun's WebSocket client drives it)
{
  const hub = liveHub()
  const server = createServer((_req, res) => res.end("ok"))
  const detach = attachRealtime(server, hub, { authenticate })
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as AddressInfo).port
  await liveScenario("node", `ws://localhost:${port}/realtime`)
  // fragmentation: one message in two frames, hand-built and masked
  const { connect } = await import("node:net")
  const sock = connect(port, "localhost")
  await new Promise<void>((r) => sock.once("connect", () => r()))
  sock.write(
    `GET /realtime?org=org_a HTTP/1.1\r\nHost: localhost:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nCookie: app_session=${token}\r\n\r\n`,
  )
  let raw = ""
  sock.on("data", (d) => {
    raw += d.toString("latin1")
  })
  const masked = (opcode: number, fin: boolean, text: string) => {
    const p = Buffer.from(text)
    const mask = Buffer.from([1, 2, 3, 4])
    const out = Buffer.from(p.map((b, i) => b ^ (mask[i & 3] as number)))
    return Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | p.length]), mask, out])
  }
  await new Promise((r) => setTimeout(r, 100))
  ok(
    "node: the handshake answers with the RFC 6455 accept key",
    raw.includes("101 Switching Protocols") && raw.includes("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="),
  )
  sock.write(masked(0x1, false, '{"type":'))
  sock.write(masked(0x0, true, '"ping"}'))
  await new Promise((r) => setTimeout(r, 100))
  ok("node: a fragmented message is reassembled", raw.includes('{"type":"pong"}'))
  sock.destroy()
  detach()
  server.close()
}

// Durable Object
{
  class FakeSocket {
    sent: string[] = []
    closed?: number
    peer?: FakeSocket
    handlers: Record<string, ((e: { data: unknown }) => void)[]> = {}
    accept() {}
    send(d: string) {
      this.sent.push(d)
    }
    close(code?: number) {
      this.closed = code
    }
    addEventListener(t: string, fn: (e: { data: unknown }) => void) {
      this.handlers[t] = [...(this.handlers[t] ?? []), fn]
    }
    emit(t: string, data?: unknown) {
      for (const fn of this.handlers[t] ?? []) fn({ data })
    }
  }
  const servers: FakeSocket[] = []
  const Room = realtimeRoom({
    authorize: allowRecords,
    pair: () => {
      const s = new FakeSocket()
      servers.push(s)
      return [{}, s]
    },
  })
  const rooms = new Map<string, InstanceType<typeof Room>>()
  const ns = {
    idFromName: (n: string) => n,
    get: (id: never) => {
      const key = id as unknown as string
      if (!rooms.has(key)) rooms.set(key, new Room())
      const room = rooms.get(key) as InstanceType<typeof Room>
      return {
        fetch: async (input: string | Request, init?: RequestInit) => {
          const r = typeof input === "string" ? new Request(input, init) : input
          try {
            return await room.fetch(r)
          } catch (e) {
            // workerd answers 101 with a webSocket; Node's Response refuses status 101
            if (String(e).includes("status"))
              return new Response(null, { status: 204, headers: { "x-upgraded": "1" } })
            throw e
          }
        },
      }
    },
  }
  const upgrade = (who: RealtimeIdentity) =>
    ns.get(who.orgId as never).fetch(
      new Request("https://app.example/realtime", {
        headers: { upgrade: "websocket", "x-signet-realtime-identity": JSON.stringify(who) },
      }),
    )
  await upgrade(alice)
  await upgrade(eve)
  const [sa, se] = servers as [FakeSocket, FakeSocket]
  sa.emit("message", JSON.stringify({ type: "join", channel: "record:doc:1" }))
  se.emit("message", JSON.stringify({ type: "join", channel: "record:doc:1" }))
  await new Promise((r) => setTimeout(r, 10))
  await roomPublisher(ns).publish("org_a", "record:doc:1", "updated", { id: 1 })
  ok(
    "durable object: one object per org, publish reaches only that org",
    sa.sent.some((d) => d.includes('"event":"updated"')) &&
      !se.sent.some((d) => d.includes('"event":"updated"')) &&
      rooms.size === 2,
  )
  const noId = await ns
    .get("org_a" as never)
    .fetch(new Request("https://app.example/realtime", { headers: { upgrade: "websocket" } }))
  ok("durable object: an upgrade without the worker's identity is refused", noId.status === 426)
  for (const r of rooms.values()) clearInterval(r.timer)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
