/**
 * Real-time channels: presence, live updates and a small shared state per
 * channel, with one hub for every runtime. The hub knows nothing about
 * sockets; `./bun`, `./node` and `./cloudflare` connect real WebSockets to it.
 *
 * ```ts
 * const hub = createRealtime({
 *   authorize: (who, channel) => channel.startsWith("record:"), // deny by default
 * })
 * await hub.publish(orgId, "record:projects:42", "updated", { id: "42" })
 * ```
 *
 * Tenancy is structural: a connection's org comes from `authenticate`, never
 * from the client, and every channel lives under its org. Org A's
 * "record:projects:42" and org B's are different channels; a client cannot
 * name another org's channel at all.
 *
 * Wire protocol (JSON text frames), client to server:
 *   { type: "join", channel, since?: { epoch, seq } }   since resumes after a reconnect
 *   { type: "leave", channel }
 *   { type: "presence", channel, typing?: boolean, editing?: string | null }
 *   { type: "set", channel, key, value, base?: number } last writer wins; base = version you saw
 *   { type: "action", channel, action, ref? }      a channel with a reducer (see `actions`)
 *   { type: "ping" }
 * server to client: welcome, joined, event, presence, state, conflict, pong, error.
 *
 * Server-authoritative channels: `actions` gives a channel (or a prefix,
 * "room:*") a reducer. Clients send intents; the hub runs the reducer and
 * either broadcasts an "action" event `{ action, by, value, ref? }` with the
 * usual seq, or answers only the sender with an error and changes nothing.
 * `set` is refused on such a channel, so its value changes only through the
 * reducer.
 *
 * ```ts
 * const hub = createRealtime({
 *   authorize,
 *   actions: {
 *     "room:*": {
 *       initial: () => ({ high: 0, by: null }),
 *       reduce: (state, action, who, ctx) => {
 *         const a = action as { amount: number }
 *         if (!who || a.amount <= state.high) throw new ActionRejected("Too low.")
 *         ctx.schedule("close", ctx.now + 15_000, { close: true }) // replaces the earlier one
 *         return { high: a.amount, by: who.userId }
 *       },
 *     },
 *   },
 * })
 * ```
 */

export type RealtimeIdentity = {
  userId: string
  /** The tenant. Every channel this connection joins is under this org. */
  orgId: string
  name?: string
  avatar?: string
  /** The member's permissions, for `authorize` (signet-db's membership permissions). */
  permissions?: string[]
  /** Epoch ms after which the connection is closed (the session's expiry). */
  expiresAt?: number
  /**
   * A room key chosen by the server (in `authenticate`), never the client.
   * When set, this connection's channels live under `roomScope(room)` instead
   * of its org, so users of different orgs meet in the same channels.
   */
  room?: string
}

/** The scope to pass where an orgId is expected (publish, act, schedule...) to reach a room's channels. */
export const roomScope = (room: string) => `room\u0000${room}`

/** Throw from a reducer to refuse an action: the sender gets this message, nothing changes. */
export class ActionRejected extends Error {
  constructor(
    message: string,
    readonly code = "REJECTED",
  ) {
    super(message)
  }
}

export type ActionContext = {
  orgId: string
  channel: string
  now: number
  /** Dispatch `action` (with `who` null) at `at`. Same name replaces. Applied only if the action is accepted. */
  schedule(name: string, at: number, action: unknown): void
  unschedule(name: string): void
}

// biome-ignore lint/suspicious/noExplicitAny: the app types its own state
export type RealtimeReducer<S = any> = {
  /** The value of a fresh channel. Default null. */
  initial?: (channel: string) => S
  /**
   * The next value, or throw `ActionRejected`. Synchronous and pure: it gets a
   * copy, so a mutation before a throw changes nothing. `who` is null for
   * server actions (`act`, deadlines).
   */
  reduce: (state: S, action: unknown, who: RealtimeIdentity | null, ctx: ActionContext) => S
}

export type RealtimeDeadline = {
  orgId: string
  channel: string
  name: string
  at: number
  action: unknown
}

/** Where deadlines are kept. Default: in-memory timers. `realtimeRoom` keeps them in Durable Object alarms. */
export type RealtimeTimers = {
  set(deadline: RealtimeDeadline): void | Promise<void>
  clear(orgId: string, channel: string, name: string): void | Promise<void>
}

/** Where reducer values are kept between restarts (Durable Object storage fits). Default: memory only. */
export type RealtimeStorage = {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown): Promise<void>
}

/** What the hub needs from a socket. Adapters wrap Bun, Node and Cloudflare sockets in this. */
export type RealtimeSocket = {
  send(data: string): void
  close(code?: number, reason?: string): void
  /** Bytes queued but not yet sent, for backpressure. */
  buffered?(): number
}

export type RealtimeLimits = {
  /** Largest inbound message. Default 16 KiB. */
  maxMessageBytes?: number
  /** Channels one connection may join. Default 20. */
  maxChannels?: number
  /** Sustained inbound messages per second per connection (burst is twice this). Default 20. */
  messagesPerSecond?: number
  /** Outbound bytes queued on a socket before it is closed as a slow consumer. Default 1 MiB. */
  maxBufferedBytes?: number
  /** Events kept per channel for resume. Default 100. */
  history?: number
  /** Shared-state keys per channel. Default 100. */
  maxStateKeys?: number
}

export type RealtimeOptions = {
  /** May `who` join `channel`? Default: nobody may (deny by default). */
  authorize?: (who: RealtimeIdentity, channel: string) => boolean | Promise<boolean>
  limits?: RealtimeLimits
  /** How often clients should ping. Default 15 s. */
  heartbeatMs?: number
  /** A connection silent this long is closed and leaves presence. Default 45 s. */
  timeoutMs?: number
  /** A typing flag clears itself after this long. Default 6 s. */
  typingMs?: number
  /** An empty channel (and its history and state) is dropped after this long. Default 5 min. */
  idleMs?: number
  /** Clock, for tests. Default Date.now. */
  now?: () => number
  /** Reducers by channel name, or by prefix ending in "*" ("room:*"). Longest match wins. */
  actions?: Record<string, RealtimeReducer>
  timers?: RealtimeTimers
  storage?: RealtimeStorage
}

export type PresenceMember = {
  userId: string
  name?: string
  avatar?: string
  typing: boolean
  editing: string | null
  /** Open connections (tabs) for this user in the channel. */
  connections: number
}

export type StateEntry = { value: unknown; version: number; by: string }

export type RealtimeEvent = {
  type: "event"
  channel: string
  seq: number
  /** The publisher's id, e.g. the outbox row id; dedupe on it. */
  id?: string
  event: string
  data: unknown
  at: number
}

/** A publish target: a hub, or `roomPublisher` on Cloudflare. */
export type RealtimePublisher = {
  publish(orgId: string, channel: string, event: string, data?: unknown, id?: string): Promise<void>
}

export type RealtimeConnection = {
  readonly id: string
  readonly who: RealtimeIdentity
  /** Hand the hub one inbound text frame. */
  receive(data: string): Promise<void>
  /** The socket closed. */
  closed(): void
}

export type RealtimeHub = RealtimePublisher & {
  connect(socket: RealtimeSocket, who: RealtimeIdentity): RealtimeConnection
  /** Expire silent connections, typing flags, expired sessions and idle channels. Call on a timer. */
  sweep(): void
  /** Close every connection of a user in an org, e.g. after they are removed from it. */
  disconnect(orgId: string, userId?: string): void
  presence(orgId: string, channel: string): PresenceMember[]
  state(orgId: string, channel: string): Record<string, StateEntry>
  /** Run an action as the server (`who` null). Resolves to the new value; rejects with `ActionRejected`. */
  act(orgId: string, channel: string, action: unknown): Promise<unknown>
  /** A reducer channel's current value (undefined if not loaded). */
  value(orgId: string, channel: string): unknown
  /** Dispatch `action` on `channel` at `at` (epoch ms). Same name replaces. */
  schedule(orgId: string, channel: string, name: string, at: number, action: unknown): Promise<void>
  unschedule(orgId: string, channel: string, name: string): Promise<void>
  readonly heartbeatMs: number
  /** Connections open now. */
  readonly size: number
}

/** The outbox topic for change events: `enqueue(db, REALTIME_TOPIC, { orgId, channel, event, data })`. */
export const REALTIME_TOPIC = "realtime"

export const CLOSE = {
  unsupported: 1003,
  policy: 1008,
  tooBig: 1009,
  slow: 1013,
  timeout: 4000,
  expired: 4001,
  kicked: 4003,
} as const

const CHANNEL = /^[\w:.\-/]{1,200}$/

type Member = { conn: Conn; typingUntil: number; editing: string | null }
type Channel = {
  name: string
  epoch: string
  seq: number
  history: RealtimeEvent[]
  members: Map<string, Member>
  state: Map<string, StateEntry>
  emptySince: number
  reducer?: RealtimeReducer
  value?: unknown
  loading?: Promise<void>
}
type Conn = {
  id: string
  who: RealtimeIdentity
  socket: RealtimeSocket
  channels: Set<string>
  lastSeen: number
  tokens: number
  refilledAt: number
  open: boolean
  queue: Promise<void>
}

export function createRealtime(options: RealtimeOptions = {}): RealtimeHub {
  const {
    authorize = () => false,
    heartbeatMs = 15_000,
    timeoutMs = 45_000,
    typingMs = 6_000,
    idleMs = 300_000,
    now = Date.now,
  } = options
  const L = {
    maxMessageBytes: 16_384,
    maxChannels: 20,
    messagesPerSecond: 20,
    maxBufferedBytes: 1_048_576,
    history: 100,
    maxStateKeys: 100,
    ...options.limits,
  }
  const orgs = new Map<string, Map<string, Channel>>()
  const conns = new Set<Conn>()
  let nextId = 0
  const { actions = {}, storage } = options
  const reducerFor = (name: string) => {
    let best: string | undefined
    for (const k of Object.keys(actions)) {
      const hit = k.endsWith("*") ? name.startsWith(k.slice(0, -1)) : name === k
      if (hit && (best === undefined || k.length > best.length)) best = k
    }
    return best === undefined ? undefined : actions[best]
  }
  const timeouts = new Map<string, ReturnType<typeof setTimeout>>()
  const timers: RealtimeTimers = options.timers ?? {
    set(d) {
      const key = JSON.stringify([d.orgId, d.channel, d.name])
      const arm = () => {
        clearTimeout(timeouts.get(key))
        const t = setTimeout(
          () => {
            if (d.at > now()) return arm() // a delay past setTimeout's 24.8-day cap
            timeouts.delete(key)
            hub.act(d.orgId, d.channel, d.action).catch(() => {})
          },
          Math.min(Math.max(d.at - now(), 0), 2 ** 31 - 1),
        )
        ;(t as { unref?: () => void }).unref?.()
        timeouts.set(key, t)
      }
      arm()
    },
    clear(orgId, channel, name) {
      const key = JSON.stringify([orgId, channel, name])
      clearTimeout(timeouts.get(key))
      timeouts.delete(key)
    },
  }
  const valueKey = (orgId: string, name: string) => `value\u0000${orgId}\u0000${name}`
  // ponytail: stored values are never deleted; add a cleanup when channel churn makes storage grow.
  const ready = (orgId: string, ch: Channel) => {
    const r = ch.reducer as RealtimeReducer
    ch.loading ??= (async () => {
      const stored = storage ? await storage.get(valueKey(orgId, ch.name)) : undefined
      ch.value = stored !== undefined ? stored : (r.initial?.(ch.name) ?? null)
    })()
    return ch.loading
  }
  const scopeOf = (who: RealtimeIdentity) =>
    who.room !== undefined ? roomScope(who.room) : who.orgId

  const record = (ch: Channel, event: string, data: unknown, id?: string) => {
    const e: RealtimeEvent = {
      type: "event",
      channel: ch.name,
      seq: ++ch.seq,
      ...(id !== undefined && { id }),
      event,
      data,
      at: now(),
    }
    ch.history.push(e)
    if (ch.history.length > L.history) ch.history.shift()
    broadcast(ch, e)
  }

  /** Run a reducer: the new value, or it throws and nothing changes. */
  const apply = async (
    orgId: string,
    ch: Channel,
    action: unknown,
    who: RealtimeIdentity | null,
    ref?: string,
  ) => {
    await ready(orgId, ch)
    const r = ch.reducer as RealtimeReducer
    const later: Array<() => Promise<void>> = []
    // The reducer is synchronous, so nothing interleaves between read and write.
    const next = r.reduce(structuredClone(ch.value), action, who, {
      orgId,
      channel: ch.name,
      now: now(),
      schedule: (name, at, a) => {
        later.push(() => hub.schedule(orgId, ch.name, name, at, a))
      },
      unschedule: (name) => {
        later.push(() => hub.unschedule(orgId, ch.name, name))
      },
    })
    ch.value = next
    record(ch, "action", {
      action,
      by: who?.userId ?? null,
      value: next,
      ...(ref !== undefined && { ref }),
    })
    if (storage) await storage.put(valueKey(orgId, ch.name), next)
    for (const f of later) await f()
    return next
  }

  const channelOf = (orgId: string, name: string, create: boolean) => {
    let org = orgs.get(orgId)
    if (!org) {
      if (!create) return undefined
      org = new Map()
      orgs.set(orgId, org)
    }
    let ch = org.get(name)
    if (!ch && create) {
      ch = {
        name,
        epoch: crypto.randomUUID(),
        seq: 0,
        history: [],
        members: new Map(),
        state: new Map(),
        emptySince: now(),
      }
      const reducer = reducerFor(name)
      if (reducer) ch.reducer = reducer
      org.set(name, ch)
    }
    return ch
  }

  const send = (c: Conn, msg: unknown) => {
    if (!c.open) return
    if ((c.socket.buffered?.() ?? 0) > L.maxBufferedBytes) {
      // The client reconnects and resumes from its last seq, so nothing is lost
      // while the history still covers the gap.
      return kill(c, CLOSE.slow, "slow consumer")
    }
    c.socket.send(JSON.stringify(msg))
  }

  const members = (ch: Channel): PresenceMember[] => {
    const t = now()
    const byUser = new Map<string, PresenceMember>()
    for (const m of ch.members.values()) {
      const { userId, name, avatar } = m.conn.who
      const p = byUser.get(userId) ?? {
        userId,
        ...(name !== undefined && { name }),
        ...(avatar !== undefined && { avatar }),
        typing: false,
        editing: null,
        connections: 0,
      }
      p.connections++
      p.typing ||= m.typingUntil > t
      p.editing ??= m.editing
      byUser.set(userId, p)
    }
    return [...byUser.values()]
  }

  const broadcast = (ch: Channel, msg: unknown) => {
    for (const m of [...ch.members.values()]) send(m.conn, msg)
  }

  const presenceChanged = (ch: Channel, joined?: string, left?: string) =>
    broadcast(ch, {
      type: "presence",
      channel: ch.name,
      members: members(ch),
      ...(joined && { joined: [joined] }),
      ...(left && { left: [left] }),
    })

  const userIn = (ch: Channel, userId: string) =>
    [...ch.members.values()].some((m) => m.conn.who.userId === userId)

  const leave = (c: Conn, name: string) => {
    const ch = channelOf(scopeOf(c.who), name, false)
    c.channels.delete(name)
    if (!ch?.members.delete(c.id)) return
    if (ch.members.size === 0) ch.emptySince = now()
    presenceChanged(ch, undefined, userIn(ch, c.who.userId) ? undefined : c.who.userId)
  }

  const kill = (c: Conn, code: number, reason: string) => {
    if (!c.open) return
    c.open = false
    conns.delete(c)
    for (const name of [...c.channels]) leave(c, name)
    try {
      c.socket.close(code, reason)
    } catch {
      // already closed
    }
  }

  const error = (c: Conn, code: string, message: string, channel?: string) =>
    send(c, { type: "error", code, message, ...(channel && { channel }) })

  const joined = (c: Conn, name: string) =>
    c.channels.has(name) ? channelOf(scopeOf(c.who), name, false) : undefined

  async function handle(c: Conn, msg: Record<string, unknown>) {
    const name = msg.channel
    if (msg.type === "ping") return send(c, { type: "pong" })
    if (typeof name !== "string" || !CHANNEL.test(name))
      return error(c, "BAD_REQUEST", "A message needs a valid channel.")

    if (msg.type === "join") {
      if (c.channels.has(name)) return
      if (c.channels.size >= L.maxChannels)
        return error(c, "TOO_MANY_CHANNELS", `At most ${L.maxChannels} channels.`, name)
      let allowed = false
      try {
        allowed = (await authorize(c.who, name)) === true
      } catch {
        allowed = false
      }
      if (!c.open) return
      if (!allowed) return error(c, "FORBIDDEN", "Not allowed to join this channel.", name)
      const ch = channelOf(scopeOf(c.who), name, true) as Channel
      if (ch.reducer) await ready(scopeOf(c.who), ch)
      if (!c.open) return
      const isNewUser = !userIn(ch, c.who.userId)
      ch.members.set(c.id, { conn: c, typingUntil: 0, editing: null })
      c.channels.add(name)
      const since = msg.since as { epoch?: unknown; seq?: unknown } | undefined
      let replay: RealtimeEvent[] | undefined
      let reset = false
      if (since && typeof since.seq === "number") {
        const oldest = ch.history[0]?.seq ?? ch.seq + 1
        if (since.epoch !== ch.epoch || since.seq < oldest - 1 || since.seq > ch.seq) reset = true
        else replay = ch.history.filter((e) => e.seq > (since.seq as number))
      }
      send(c, {
        type: "joined",
        channel: name,
        epoch: ch.epoch,
        seq: ch.seq,
        members: members(ch),
        state: Object.fromEntries(ch.state),
        ...(ch.reducer && { value: ch.value }),
        ...(replay && { replay }),
        ...(reset && { reset: true }),
      })
      return presenceChanged(ch, isNewUser ? c.who.userId : undefined)
    }

    if (msg.type === "leave") return leave(c, name)

    const ch = joined(c, name)
    if (!ch) return error(c, "NOT_JOINED", "Join the channel first.", name)

    if (msg.type === "presence") {
      const m = ch.members.get(c.id) as Member
      if (typeof msg.typing === "boolean") m.typingUntil = msg.typing ? now() + typingMs : 0
      if (msg.editing === null || typeof msg.editing === "string")
        m.editing = msg.editing === null ? null : msg.editing.slice(0, 200)
      return presenceChanged(ch)
    }

    if (msg.type === "action") {
      if (!ch.reducer) return error(c, "BAD_REQUEST", "This channel takes no actions.", name)
      const ref = typeof msg.ref === "string" ? msg.ref.slice(0, 100) : undefined
      try {
        await apply(scopeOf(c.who), ch, msg.action ?? null, c.who, ref)
      } catch (e) {
        const rejected = e instanceof ActionRejected
        return send(c, {
          type: "error",
          code: rejected ? e.code : "ACTION_FAILED",
          message: rejected ? e.message : "The action failed.",
          channel: name,
          ...(ref !== undefined && { ref }),
        })
      }
      return
    }

    if (msg.type === "set") {
      if (ch.reducer)
        return error(c, "FORBIDDEN", "This channel's state changes only through actions.", name)
      const key = msg.key
      if (typeof key !== "string" || key.length === 0 || key.length > 200)
        return error(c, "BAD_REQUEST", "A set needs a key.", name)
      const prev = ch.state.get(key)
      if (!prev && ch.state.size >= L.maxStateKeys)
        return error(c, "TOO_MANY_KEYS", `At most ${L.maxStateKeys} keys per channel.`, name)
      // Last writer wins: the hub's arrival order decides, and the version
      // says which write a client saw. A writer that based its write on an
      // older version is told whose change it replaced. Not when the replaced
      // write is the writer's own: two quick writes before the first echo both
      // carry the same base, and that is not a conflict.
      const entry: StateEntry = {
        value: msg.value ?? null,
        version: (prev?.version ?? 0) + 1,
        by: c.who.userId,
      }
      ch.state.set(key, entry)
      if (
        typeof msg.base === "number" &&
        prev &&
        msg.base < prev.version &&
        prev.by !== c.who.userId
      )
        send(c, { type: "conflict", channel: name, key, replaced: { key, ...prev } })
      return broadcast(ch, { type: "state", channel: name, key, ...entry })
    }

    return error(c, "BAD_REQUEST", "Unknown message type.", name)
  }

  const hub: RealtimeHub = {
    heartbeatMs,
    get size() {
      return conns.size
    },

    connect(socket, who) {
      const t = now()
      const c: Conn = {
        id: `c${++nextId}`,
        who,
        socket,
        channels: new Set(),
        lastSeen: t,
        tokens: L.messagesPerSecond * 2,
        refilledAt: t,
        open: true,
        queue: Promise.resolve(),
      }
      conns.add(c)
      send(c, { type: "welcome", id: c.id, heartbeatMs })
      return {
        id: c.id,
        who,
        receive(data) {
          if (!c.open) return Promise.resolve()
          const t = now()
          c.lastSeen = t
          c.tokens = Math.min(
            L.messagesPerSecond * 2,
            c.tokens + ((t - c.refilledAt) / 1000) * L.messagesPerSecond,
          )
          c.refilledAt = t
          if (c.tokens < 1) {
            kill(c, CLOSE.policy, "rate limited")
            return Promise.resolve()
          }
          c.tokens--
          if (typeof data !== "string") {
            kill(c, CLOSE.unsupported, "text frames only")
            return Promise.resolve()
          }
          if (data.length > L.maxMessageBytes) {
            kill(c, CLOSE.tooBig, "message too big")
            return Promise.resolve()
          }
          let msg: unknown
          try {
            msg = JSON.parse(data)
          } catch {
            error(c, "BAD_REQUEST", "Messages are JSON.")
            return Promise.resolve()
          }
          if (!msg || typeof msg !== "object") {
            error(c, "BAD_REQUEST", "Messages are JSON objects.")
            return Promise.resolve()
          }
          // One message at a time per connection, so a join awaiting
          // `authorize` cannot be overtaken by a set for the same channel.
          c.queue = c.queue.then(() => handle(c, msg as Record<string, unknown>)).catch(() => {})
          return c.queue
        },
        closed() {
          kill(c, 1000, "closed")
        },
      }
    },

    async publish(orgId, channel, event, data = null, id) {
      const ch = channelOf(orgId, channel, false)
      if (!ch) return // nobody joined, nothing to resume: drop
      record(ch, event, data, id)
    },

    async act(orgId, channel, action) {
      if (!CHANNEL.test(channel) || !reducerFor(channel))
        throw new Error(`No reducer for channel ${channel}.`)
      // Created if nobody is in it, so the value is there for the next join.
      return apply(orgId, channelOf(orgId, channel, true) as Channel, action, null)
    },

    value(orgId, channel) {
      return channelOf(orgId, channel, false)?.value
    },

    async schedule(orgId, channel, name, at, action) {
      await timers.set({ orgId, channel, name, at, action })
    },

    async unschedule(orgId, channel, name) {
      await timers.clear(orgId, channel, name)
    },

    sweep() {
      const t = now()
      for (const c of [...conns]) {
        if (c.who.expiresAt !== undefined && t >= c.who.expiresAt)
          kill(c, CLOSE.expired, "session expired")
        else if (t - c.lastSeen > timeoutMs) kill(c, CLOSE.timeout, "heartbeat timeout")
      }
      for (const [orgId, org] of orgs) {
        for (const [name, ch] of org) {
          if (ch.members.size === 0) {
            if (t - ch.emptySince > idleMs) org.delete(name)
            continue
          }
          let expired = false
          for (const m of ch.members.values()) {
            if (m.typingUntil !== 0 && m.typingUntil <= t) {
              m.typingUntil = 0
              expired = true
            }
          }
          if (expired) presenceChanged(ch)
        }
        if (org.size === 0) orgs.delete(orgId)
      }
    },

    disconnect(orgId, userId) {
      for (const c of [...conns])
        if (c.who.orgId === orgId && (userId === undefined || c.who.userId === userId))
          kill(c, CLOSE.kicked, "removed")
    },

    presence(orgId, channel) {
      const ch = channelOf(orgId, channel, false)
      return ch ? members(ch) : []
    },

    state(orgId, channel) {
      return Object.fromEntries(channelOf(orgId, channel, false)?.state ?? [])
    },
  }
  return hub
}

/**
 * An outbox queue for signet-db's `drainOutbox`: delivers `REALTIME_TOPIC`
 * rows (`{ orgId, channel, event, data }`) to a hub or `roomPublisher`. The
 * outbox row id becomes the event id, so a redelivered row is a duplicate the
 * client can drop.
 *
 * ```ts
 * await db.batch([(tx) => tx.update(projects)..., enqueue(db, REALTIME_TOPIC, { orgId, channel, event: "updated", data })])
 * await drainOutbox(db, { send: (m) => (m.topic === REALTIME_TOPIC ? live.send(m) : queue.send(m)) })
 * ```
 */
export function realtimeOutbox(publisher: RealtimePublisher) {
  return {
    async send(message: { id: string; topic: string; payload: unknown }) {
      const p = message.payload as Record<string, unknown> | null
      if (!p || typeof p.orgId !== "string" || typeof p.channel !== "string")
        throw new Error("A realtime outbox payload needs orgId and channel.")
      await publisher.publish(
        p.orgId,
        p.channel,
        typeof p.event === "string" ? p.event : "changed",
        p.data ?? null,
        message.id,
      )
    },
  }
}

export type AdmitOptions = {
  /** Who is connecting, from the request (cookie, query token). Null refuses with 401. */
  authenticate: (request: Request) => RealtimeIdentity | null | Promise<RealtimeIdentity | null>
  /**
   * Origins allowed to open a socket. Browsers send cookies on cross-site
   * WebSocket handshakes, so without this check any site could connect as
   * the user. Default: only the request's own host.
   */
  origins?: string[]
}

/** Check origin and identity for an upgrade request: the identity, or the refusal to send. */
export async function admit(
  request: Request,
  { authenticate, origins }: AdmitOptions,
): Promise<RealtimeIdentity | Response> {
  const origin = request.headers.get("origin")
  if (origin !== null) {
    const host = request.headers.get("host") ?? new URL(request.url).host
    let ok = false
    try {
      ok = origins ? origins.includes(origin) : new URL(origin).host === host
    } catch {
      ok = false
    }
    if (!ok) return new Response("Origin not allowed", { status: 403 })
  }
  let who: RealtimeIdentity | null = null
  try {
    who = await authenticate(request)
  } catch {
    who = null
  }
  if (!who || typeof who.orgId !== "string" || typeof who.userId !== "string")
    return new Response("Unauthorized", { status: 401 })
  return who
}

/** The membership lookup `sessionAuth` needs: signet-db's `createOrgs(...)` has it. */
export type RealtimeMembers = {
  membership(
    orgId: string,
    userId: string,
  ): Promise<{ orgId: string; userId: string; role: string; permissions: string[] } | null>
}

/**
 * `authenticate` from a signet-server session cookie plus org membership. The
 * org comes from the `org` query parameter, else the `signet_org` cookie that
 * `orgRoutes`' switch sets; the user must be a member of it, or the socket is
 * refused. Pass `verify` for stored sessions or Better Auth.
 *
 * ```ts
 * authenticate: sessionAuth({ verify: (token) => verifySession(token, sessionOpts), cookieName: "app_session", orgs })
 * ```
 */
export function sessionAuth(options: {
  verify: (
    token: string,
  ) => Promise<{ sub?: string; exp?: number } | null> | { sub?: string; exp?: number } | null
  cookieName: string
  orgs: RealtimeMembers
  /** The org id for this request. Default: `?org=` then the `signet_org` cookie. */
  org?: (request: Request) => string | null | undefined
  /** Display name and avatar for presence. */
  profile?: (userId: string) => Promise<{ name?: string; avatar?: string } | null>
}): (request: Request) => Promise<RealtimeIdentity | null> {
  return async (request) => {
    const cookies = request.headers.get("cookie") ?? ""
    const token = cookie(cookies, options.cookieName)
    if (!token) return null
    const payload = await options.verify(token)
    if (!payload?.sub) return null
    const orgId = options.org
      ? options.org(request)
      : (new URL(request.url).searchParams.get("org") ?? cookie(cookies, "signet_org"))
    if (!orgId) return null
    const m = await options.orgs.membership(orgId, payload.sub)
    if (!m) return null
    const profile = (await options.profile?.(payload.sub)) ?? {}
    return {
      userId: payload.sub,
      orgId: m.orgId,
      permissions: m.permissions,
      ...profile,
      ...(typeof payload.exp === "number" && { expiresAt: payload.exp * 1000 }),
    }
  }
}

function cookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const i = part.indexOf("=")
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim())
      } catch {
        return undefined
      }
    }
  }
  return undefined
}
