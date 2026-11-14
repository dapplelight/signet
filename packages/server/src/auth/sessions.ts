/**
 * Stored sessions: a "your devices" list, revoke one, sign out everywhere.
 *
 * Opt-in on top of `./session`. The cookie is still an HMAC-signed token, but
 * it carries a session id (`sid`) and is only valid while that id is in a
 * `SessionStore`. Stateless cookies keep working exactly as before.
 *
 *   const sessions = { cookieName: "sid", secret: env.SESSION_SECRET, store: kvSessionStore(kv) }
 *   const { cookie } = await startSession(sessions, { sub: user.id, userAgent, ip, previousToken })
 *   const s = await validateSession(token, sessions)   // null once revoked
 */

import type { KeyValue } from "../adapters/index.js"
import { checkSession, issueSession, type SessionOptions, type SessionPayload } from "./session.js"

export type SessionRecord = {
  id: string
  sub: string
  /** "Chrome on macOS", from the user agent at sign-in. */
  device: string
  /** Client IP at sign-in, then at the last touch; null when the app trusts no proxy. */
  ip: string | null
  /** Epoch ms. */
  createdAt: number
  /** Epoch ms. Updated at most once per `touchEverySeconds`. */
  lastSeenAt: number
  /** Epoch ms. */
  expiresAt: number
}

/** Where stored sessions live. `kvSessionStore` covers memory, Workers KV and Upstash; write your own for SQL. */
export type SessionStore = {
  create(record: SessionRecord): Promise<void>
  /** The record with its latest `lastSeenAt`/`ip`, or null once revoked or expired. */
  get(id: string): Promise<SessionRecord | null>
  /** Record activity. Must never bring back a revoked session. */
  touch(record: SessionRecord, seen: { lastSeenAt: number; ip: string | null }): Promise<void>
  /** Live sessions, newest activity first. */
  listByUser(sub: string): Promise<SessionRecord[]>
  revoke(id: string): Promise<void>
  /** Revoke every session of `sub`, except `except` when given. Returns how many were revoked. */
  revokeAll(sub: string, opts?: { except?: string }): Promise<number>
}

export type StoredSessionOptions = SessionOptions & {
  store: SessionStore
  /** Write `lastSeenAt` at most this often per session. Default 300. 0 writes on every request. */
  touchEverySeconds?: number
}

const DEFAULT_TTL = 60 * 60 * 24 * 14

function randomId(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Sessions in any `KeyValue`. Each record expires with its session.
 *
 * The per-user index is read-modify-write: two sign-ins of the same user in the
 * same instant can drop one id from the index (Workers KV is also eventually
 * consistent), and an id missing from the index is not listed or caught by
 * `revokeAll`. Fine for a devices page; for a hard guarantee implement
 * `SessionStore` over SQL. Revoking by id is always exact.
 */
export function kvSessionStore(kv: KeyValue, opts: { prefix?: string } = {}): SessionStore {
  const prefix = opts.prefix ?? "signet-sess"
  const rec = (id: string) => `${prefix}:s:${id}`
  // lastSeen lives in its own key so a touch racing a revoke cannot rewrite the record back.
  const seen = (id: string) => `${prefix}:seen:${id}`
  const idx = (sub: string) => `${prefix}:u:${sub}`
  const ttl = (expiresAt: number) => Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000))

  const readIndex = async (sub: string): Promise<string[]> => {
    try {
      const v = JSON.parse((await kv.get(idx(sub))) ?? "[]")
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []
    } catch {
      return []
    }
  }
  // ponytail: index TTL is the longest session we have written; fine because every write refreshes it.
  const writeIndex = async (sub: string, ids: string[], expiresAt: number) =>
    ids.length
      ? kv.set(idx(sub), JSON.stringify(ids), { ttlSeconds: ttl(expiresAt) })
      : kv.delete(idx(sub))

  // The record plus the latest activity from the seen key, so callers (and the
  // touch throttle in validateSession) see the real lastSeenAt.
  const get = async (id: string): Promise<SessionRecord | null> => {
    const [raw, rawSeen] = await Promise.all([kv.get(rec(id)), kv.get(seen(id))])
    if (!raw) return null
    let r: SessionRecord
    try {
      r = JSON.parse(raw) as SessionRecord
    } catch {
      return null
    }
    if (!(r.expiresAt > Date.now())) return null
    try {
      const s = JSON.parse(rawSeen ?? "null") as { lastSeenAt: number; ip: string | null } | null
      if (s && typeof s.lastSeenAt === "number" && s.lastSeenAt >= r.lastSeenAt)
        return { ...r, lastSeenAt: s.lastSeenAt, ip: s.ip ?? null }
    } catch {
      // a corrupt seen key only loses activity, never the session
    }
    return r
  }

  const live = async (sub: string) => {
    const ids = await readIndex(sub)
    const records = (await Promise.all(ids.map(get))).filter(
      (r): r is SessionRecord => r !== null && r.sub === sub,
    )
    return { ids, records }
  }

  return {
    async create(r) {
      await kv.set(rec(r.id), JSON.stringify(r), { ttlSeconds: ttl(r.expiresAt) })
      const { records } = await live(r.sub)
      const maxExp = Math.max(r.expiresAt, ...records.map((x) => x.expiresAt))
      await writeIndex(r.sub, [...records.map((x) => x.id), r.id], maxExp)
    },
    get,
    async touch(r, s) {
      await kv.set(seen(r.id), JSON.stringify(s), { ttlSeconds: ttl(r.expiresAt) })
    },
    async listByUser(sub) {
      const { ids, records } = await live(sub)
      if (records.length !== ids.length)
        await writeIndex(
          sub,
          records.map((r) => r.id),
          Math.max(0, ...records.map((r) => r.expiresAt)),
        )
      return records.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    },
    async revoke(id) {
      await Promise.all([kv.delete(rec(id)), kv.delete(seen(id))])
    },
    async revokeAll(sub, o = {}) {
      // Delete every indexed id (live or not), count only the live ones.
      const { ids, records } = await live(sub)
      const doomed = ids.filter((id) => id !== o.except)
      await Promise.all(doomed.flatMap((id) => [kv.delete(rec(id)), kv.delete(seen(id))]))
      const kept = records.find((r) => r.id === o.except)
      await writeIndex(sub, kept ? [kept.id] : [], kept?.expiresAt ?? 0)
      return records.filter((r) => r.id !== o.except).length
    },
  }
}

/**
 * Cache `get` in memory for `seconds`, to save a KV read per request.
 *
 * The cost: a session revoked through ANOTHER isolate or process stays valid
 * here for up to `seconds`. Revokes through this wrapper clear its own cache at
 * once. Off unless you wrap the store; keep it short (30–60s).
 */
export function cachedSessionStore(store: SessionStore, opts: { seconds: number }): SessionStore {
  const cache = new Map<string, { record: SessionRecord | null; until: number }>()
  const max = 10_000
  return {
    ...store,
    async get(id) {
      const hit = cache.get(id)
      if (hit && hit.until > Date.now()) return hit.record
      const record = await store.get(id)
      // ponytail: crude bound, clear-all at 10k entries; an LRU if that ever thrashes.
      if (cache.size >= max) cache.clear()
      cache.set(id, { record, until: Date.now() + opts.seconds * 1000 })
      return record
    },
    async touch(record, seen) {
      // Keep the cached copy in step, or the throttle sees a stale lastSeenAt
      // and writes on every request until the entry expires.
      const hit = cache.get(record.id)
      if (hit?.record) cache.set(record.id, { ...hit, record: { ...hit.record, ...seen } })
      await store.touch(record, seen)
    },
    async revoke(id) {
      cache.delete(id)
      await store.revoke(id)
    },
    async revokeAll(sub, o) {
      for (const [id, v] of cache) if (v.record?.sub === sub && id !== o?.except) cache.delete(id)
      return store.revokeAll(sub, o)
    },
  }
}

/** "Chrome on macOS" from a user agent, without a parser dependency. "Unknown device" when unsure. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").slice(0, 512)
  const browser = [
    [/Edg(e|A|iOS)?\//, "Edge"],
    [/OPR\/|Opera/, "Opera"],
    [/SamsungBrowser\//, "Samsung Internet"],
    [/Firefox\/|FxiOS\//, "Firefox"],
    [/Chrome\/|CriOS\//, "Chrome"],
    [/Version\/[\d.]+.*Safari\//, "Safari"],
  ] as const
  const os = [
    [/iPhone|iPad|iPod/, "iOS"],
    [/Android/, "Android"],
    [/CrOS/, "ChromeOS"],
    [/Windows/, "Windows"],
    [/Mac OS X|Macintosh/, "macOS"],
    [/Linux/, "Linux"],
  ] as const
  const b = browser.find(([re]) => re.test(ua))?.[1]
  const o = os.find(([re]) => re.test(ua))?.[1]
  if (b && o) return `${b} on ${o}`
  return b ?? o ?? (ua ? ua.split(/[\s/]/)[0]?.slice(0, 40) || "Unknown device" : "Unknown device")
}

export type StartSessionInput = {
  sub: string
  userAgent?: string | null
  ip?: string | null
  /**
   * The cookie the request arrived with, if any. Its session is revoked, so an
   * id planted before sign-in (session fixation) never becomes a signed-in one.
   */
  previousToken?: string | null
}

/**
 * Sign in: always a NEW session id, never the incoming one. Returns the token
 * (put it in `sessionCookie`) and the stored record.
 */
export async function startSession(
  opts: StoredSessionOptions,
  input: StartSessionInput,
): Promise<{ token: string; record: SessionRecord }> {
  if (input.previousToken) {
    const prev = await checkSession(input.previousToken, opts)
    if (prev?.payload.sid) await opts.store.revoke(prev.payload.sid)
  }
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL
  const now = Date.now()
  const record: SessionRecord = {
    id: randomId(),
    sub: input.sub,
    device: deviceLabel(input.userAgent),
    ip: input.ip ?? null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + ttlSeconds * 1000,
  }
  await opts.store.create(record)
  const token = await issueSession(opts, input.sub, { sid: record.id, ttlSeconds })
  return { token, record }
}

export type ValidSession = {
  payload: SessionPayload & { sid: string; sub: string }
  record: SessionRecord
  /** Set when the cookie was signed with a previous key: send it back as the cookie. */
  resigned?: string
}

/**
 * Check a stored-session token: signature (current or previous key), expiry,
 * and that the session is still in the store. Records activity at most once
 * per `touchEverySeconds`; pass `defer` (e.g. `waitUntilDefer(ctx)`) to keep
 * that write off the response.
 */
export async function validateSession(
  token: string | null | undefined,
  opts: StoredSessionOptions,
  ctx: { ip?: string | null; defer?: (work: Promise<unknown>) => void } = {},
): Promise<ValidSession | null> {
  const checked = await checkSession(token, opts)
  const sid = checked?.payload.sid
  if (!checked || !sid) return null
  const record = await opts.store.get(sid)
  if (!record || record.sub !== checked.payload.sub) return null
  const now = Date.now()
  if ((now - record.lastSeenAt) / 1000 >= (opts.touchEverySeconds ?? 300)) {
    const work = opts.store.touch(record, { lastSeenAt: now, ip: ctx.ip ?? record.ip })
    if (ctx.defer) ctx.defer(work)
    else await work
  }
  return {
    payload: checked.payload as ValidSession["payload"],
    record,
    ...(checked.resigned ? { resigned: checked.resigned } : {}),
  }
}

/**
 * New session id for the same user, old one revoked. Call on a privilege
 * change — password or passcode change, step-up, role grant — so a token
 * captured before it stops working. Null when `token` is not a live session.
 */
export async function rotateSession(
  token: string | null | undefined,
  opts: StoredSessionOptions,
  input: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; record: SessionRecord } | null> {
  const current = await validateSession(token, { ...opts, touchEverySeconds: Infinity })
  if (!current) return null
  return startSession(opts, {
    sub: current.record.sub,
    userAgent: input.userAgent,
    ip: input.ip ?? current.record.ip,
    previousToken: token,
  })
}
