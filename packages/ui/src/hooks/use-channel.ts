"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"

/**
 * A client for signet-server's realtime hub (`@dapplelight/signet-server/realtime`)
 * and the React hooks on it. The client is plain TypeScript: it reconnects
 * with backoff, rejoins every channel resuming from the last event it saw,
 * pings on the hub's heartbeat, drops duplicate events and applies shared
 * state by version, so an out-of-order or replayed message never wins.
 *
 * ```ts
 * const live = createRealtimeClient({ url: "/realtime?org=" + orgId })
 * function Doc({ id }) {
 *   const ch = useChannel(live, `record:docs:${id}`, { onEvent: (e) => e.event === "updated" && refetch() })
 *   return <AvatarStack members={ch.members} />
 * }
 * ```
 */

export type PresenceMember = {
  userId: string
  name?: string
  avatar?: string
  typing: boolean
  editing: string | null
  connections: number
}

export type StateEntry = { value: unknown; version: number; by: string }

export type ChannelEvent = {
  channel: string
  seq: number
  id?: string
  event: string
  data: unknown
  at: number
  /** True when this event came from the resume replay after a reconnect. */
  replayed?: boolean
}

export type ConnectionStatus = "connecting" | "open" | "closed"

export type ChannelSnapshot = {
  status: ConnectionStatus
  joined: boolean
  /** Set when the hub refused the join or a message, e.g. "FORBIDDEN". */
  error: string | null
  members: PresenceMember[]
  state: Record<string, StateEntry>
  /**
   * The hub could not replay what was missed while disconnected (too long
   * away, or the channel was recreated): reload the record.
   */
  stale: boolean
  /** Set after a set of yours replaced someone else's newer write. */
  conflict: { key: string; replaced: StateEntry } | null
}

type SocketLike = {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((e: unknown) => void) | null
  onmessage: ((e: { data: unknown }) => void) | null
  onclose: ((e: { code: number }) => void) | null
}

export type RealtimeClientOptions = {
  /** The hub's WebSocket URL; a path ("/realtime") is resolved against the page. */
  url: string
  /** WebSocket constructor. Default the global one. */
  WebSocket?: new (
    url: string,
  ) => SocketLike
  /** Delay before reconnect attempt `n` (1-based). Default 0.5 s doubling to 30 s, with jitter. */
  backoff?: (attempt: number) => number
}

type Local = {
  refs: number
  snap: ChannelSnapshot
  epoch?: string
  seq?: number
  events: Set<(e: ChannelEvent) => void>
}

const EMPTY: ChannelSnapshot = {
  status: "closed",
  joined: false,
  error: null,
  members: [],
  state: {},
  stale: false,
  conflict: null,
}

/** Codes after which reconnecting cannot help: the session ended or the user was removed. */
const FINAL = new Set([4001, 4003])

export function createRealtimeClient(options: RealtimeClientOptions) {
  const Ctor =
    options.WebSocket ??
    (globalThis as unknown as { WebSocket: new (url: string) => SocketLike }).WebSocket
  const backoff =
    options.backoff ??
    ((n: number) => Math.min(30_000, 500 * 2 ** (n - 1)) * (0.5 + Math.random() / 2))
  const channels = new Map<string, Local>()
  const listeners = new Set<() => void>()
  const seenIds: string[] = []
  let ws: SocketLike | null = null
  let status: ConnectionStatus = "closed"
  let attempt = 0
  let stopped = false
  let ping: ReturnType<typeof setInterval> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined

  const emit = () => {
    for (const l of [...listeners]) l()
  }
  const update = (name: string, patch: Partial<ChannelSnapshot>) => {
    const ch = channels.get(name)
    if (!ch) return
    ch.snap = { ...ch.snap, ...patch }
    emit()
  }
  const setStatus = (s: ConnectionStatus) => {
    status = s
    for (const name of channels.keys())
      update(name, { status: s, ...(s !== "open" && { joined: false }) })
    if (channels.size === 0) emit()
  }
  const raw = (m: unknown) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(m))
  }
  const join = (name: string, ch: Local) =>
    raw({
      type: "join",
      channel: name,
      ...(ch.epoch !== undefined &&
        ch.seq !== undefined && { since: { epoch: ch.epoch, seq: ch.seq } }),
    })

  const deliver = (ch: Local, e: ChannelEvent) => {
    if (e.id !== undefined) {
      if (seenIds.includes(e.id)) return
      seenIds.push(e.id)
      if (seenIds.length > 500) seenIds.shift()
    }
    ch.seq = Math.max(ch.seq ?? 0, e.seq)
    for (const fn of [...ch.events]) fn(e)
  }

  // biome-ignore lint/suspicious/noExplicitAny: inbound protocol messages are loose JSON
  const onMessage = (m: any) => {
    if (m.type === "welcome") {
      clearInterval(ping)
      ping = setInterval(() => raw({ type: "ping" }), m.heartbeatMs ?? 15_000)
      return
    }
    const ch = typeof m.channel === "string" ? channels.get(m.channel) : undefined
    if (!ch) return
    switch (m.type) {
      case "joined": {
        const stale = m.reset === true
        ch.epoch = m.epoch
        // After a reset there is nothing to resume from: start at the hub's seq.
        if (stale || ch.seq === undefined) ch.seq = m.seq
        update(m.channel, {
          joined: true,
          error: null,
          members: m.members,
          state: m.state,
          ...(stale && { stale: true }),
        })
        for (const e of m.replay ?? []) deliver(ch, { ...e, replayed: true })
        ch.seq = Math.max(ch.seq ?? 0, m.seq)
        return
      }
      case "event":
        return deliver(ch, m)
      case "presence":
        return update(m.channel, { members: m.members })
      case "state": {
        const cur = ch.snap.state[m.key]
        if (cur && cur.version >= m.version) return
        return update(m.channel, {
          state: { ...ch.snap.state, [m.key]: { value: m.value, version: m.version, by: m.by } },
        })
      }
      case "conflict":
        return update(m.channel, { conflict: { key: m.key, replaced: m.replaced } })
      case "error":
        return update(m.channel, { error: m.code })
    }
  }

  const connect = () => {
    retry = undefined
    if (stopped) return
    setStatus("connecting")
    const url =
      typeof location !== "undefined" && options.url.startsWith("/")
        ? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${options.url}`
        : options.url
    const s = new Ctor(url)
    ws = s
    s.onopen = () => {
      attempt = 0
      setStatus("open")
      for (const [name, ch] of channels) join(name, ch)
    }
    s.onmessage = (e) => {
      try {
        onMessage(JSON.parse(String(e.data)))
      } catch {
        // not ours
      }
    }
    s.onclose = (e) => {
      if (ws !== s) return
      ws = null
      clearInterval(ping)
      setStatus("closed")
      if (stopped || FINAL.has(e.code)) return
      retry = setTimeout(connect, backoff(++attempt))
    }
  }

  const client = {
    get status() {
      return status
    },
    /** Join a channel; the returned function leaves it (joins are counted). */
    join(name: string): () => void {
      let ch = channels.get(name)
      if (!ch) {
        ch = { refs: 0, snap: { ...EMPTY, status }, events: new Set() }
        channels.set(name, ch)
        if (!ws && retry === undefined && !stopped) connect()
        else join(name, ch)
      }
      ch.refs++
      const local = ch
      return () => {
        if (--local.refs > 0) return
        channels.delete(name)
        raw({ type: "leave", channel: name })
        emit()
      }
    },
    snapshot(name: string): ChannelSnapshot {
      return channels.get(name)?.snap ?? EMPTY
    },
    /** Called on every change to any channel (for useSyncExternalStore). */
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    /** Events published on a joined channel, including replayed ones after a reconnect. */
    onEvent(name: string, fn: (e: ChannelEvent) => void): () => void {
      const ch = channels.get(name)
      ch?.events.add(fn)
      return () => ch?.events.delete(fn)
    },
    /** Your presence in a channel: typing (clears itself on the hub) and what you are editing. */
    presence(name: string, p: { typing?: boolean; editing?: string | null }) {
      raw({ type: "presence", channel: name, ...p })
    },
    /** Write a shared-state key. Last writer wins; you are told if you replaced a newer write. */
    set(name: string, key: string, value: unknown) {
      const ch = channels.get(name)
      if (!ch) return
      const base = ch.snap.state[key]?.version ?? 0
      // Optimistic: shown now, replaced by the hub's versioned broadcast.
      update(name, { state: { ...ch.snap.state, [key]: { value, version: base, by: "" } } })
      raw({ type: "set", channel: name, key, value, base })
    },
    /** Clear `stale` (after reloading) or `conflict` (after showing it). */
    acknowledge(name: string, what: "stale" | "conflict") {
      update(name, what === "stale" ? { stale: false } : { conflict: null })
    },
    close() {
      stopped = true
      clearTimeout(retry)
      clearInterval(ping)
      ws?.close(1000)
      ws = null
      setStatus("closed")
    },
  }
  return client
}

export type RealtimeClient = ReturnType<typeof createRealtimeClient>

/**
 * Join a channel while mounted. Returns its snapshot (presence, shared state,
 * connection status, stale and conflict flags) and actions for it.
 */
export function useChannel(
  client: RealtimeClient,
  channel: string,
  options: { onEvent?: (e: ChannelEvent) => void } = {},
) {
  useEffect(() => client.join(channel), [client, channel])
  const { onEvent } = options
  useEffect(
    () => (onEvent ? client.onEvent(channel, onEvent) : undefined),
    [client, channel, onEvent],
  )
  const snap = useSyncExternalStore(
    client.subscribe,
    () => client.snapshot(channel),
    () => EMPTY,
  )
  const setTyping = useCallback(
    (typing: boolean) => client.presence(channel, { typing }),
    [client, channel],
  )
  const setEditing = useCallback(
    (editing: string | null) => client.presence(channel, { editing }),
    [client, channel],
  )
  const set = useCallback(
    (key: string, value: unknown) => client.set(channel, key, value),
    [client, channel],
  )
  const acknowledge = useCallback(
    (what: "stale" | "conflict") => client.acknowledge(channel, what),
    [client, channel],
  )
  return { ...snap, setTyping, setEditing, set, acknowledge }
}

/** Who is in a channel, without the rest of the snapshot. Excludes `selfId` when given. */
export function usePresence(client: RealtimeClient, channel: string, selfId?: string) {
  const { members } = useChannel(client, channel)
  return selfId === undefined ? members : members.filter((m) => m.userId !== selfId)
}

/**
 * The latest change event on a record's channel from someone else, for a
 * "this record changed" banner, or null. `dismiss` clears it; a stale resume
 * also counts as a change.
 */
export function useRecordChanges(
  client: RealtimeClient,
  channel: string,
  options: { selfId?: string; events?: string[] } = {},
) {
  const [change, setChange] = useState<ChannelEvent | null>(null)
  const { selfId, events } = options
  const key = events?.join(",")
  const onEvent = useCallback(
    (e: ChannelEvent) => {
      if (key !== undefined && !key.split(",").includes(e.event)) return
      const by = (e.data as { by?: unknown } | null)?.by
      if (selfId !== undefined && by === selfId) return
      setChange(e)
    },
    [selfId, key],
  )
  const ch = useChannel(client, channel, { onEvent })
  const dismiss = useCallback(() => {
    setChange(null)
    if (ch.stale) ch.acknowledge("stale")
  }, [ch.stale, ch.acknowledge])
  return { change, changed: change !== null || ch.stale, dismiss }
}
