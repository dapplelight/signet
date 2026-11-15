/**
 * Pending approvals: the record behind `requireApproval` when the person is
 * not in the agent's chat to answer it.
 *
 * Without a store, `requireApproval` asks through elicitation or refuses
 * (APPROVAL_REQUIRED). With one (`createMcpServer({ approvals })`), a client
 * that cannot ask gets APPROVAL_PENDING and a record the person approves or
 * denies in the app (`approvalRoutes` from `../http/routes`). The agent then
 * calls the same tool with the same arguments: an approved record for that
 * exact call (tool, principal, argument fingerprint) is used once and the
 * action runs. Records expire; every step is a record and an `onEvent`.
 *
 *   const approvals = kvApprovals(kv, { onEvent: (e) => audit.write(e) })
 *   mountMcp(app, "/mcp", { ..., approvals })
 *   app.route("/api/approvals", approvalRoutes({ approvals, subject }))
 */

import type { KeyValue } from "../adapters/index.js"

/** `expired` is computed on read: a pending or approved record past `expiresAt`. */
export type ApprovalStatus = "pending" | "approved" | "denied" | "used" | "expired"

export type ApprovalRecord = {
  id: string
  /** The tool that asked. */
  tool: string
  /** Who the agent acts for (`createMcpServer`'s `principal`, default the token's `sub`); null when anonymous. */
  principal: string | null
  /** The one line the person approves. */
  summary: string
  details?: string | Record<string, unknown>
  /** SHA-256 of the call's bound arguments: an approval only ever runs that exact call. */
  fp: string
  status: ApprovalStatus
  /** "app": decided on the pending record. "elicitation": answered in the agent's client. */
  via: "app" | "elicitation"
  /** Epoch ms. */
  createdAt: number
  /** Epoch ms. A pending or approved record past this reads as `expired`. */
  expiresAt: number
  decidedAt?: number
  decidedBy?: string
  usedAt?: number
}

export type ApprovalEvent = {
  type: "requested" | "approved" | "denied" | "used"
  record: ApprovalRecord
}

export type ApprovalCall = {
  tool: string
  principal: string | null
  summary: string
  details?: string | Record<string, unknown>
  fp: string
}

export type Approvals = {
  /** The newest record for this exact call that is still live (pending, approved or denied), or null. */
  find(call: Pick<ApprovalCall, "tool" | "principal" | "fp">): Promise<ApprovalRecord | null>
  /** Open a pending record for this call (or return the live one already open). */
  request(call: ApprovalCall): Promise<ApprovalRecord>
  /** Record an answer given through elicitation, for the audit trail. */
  answered(call: ApprovalCall, approved: boolean): Promise<ApprovalRecord>
  get(id: string): Promise<ApprovalRecord | null>
  /** The principal's pending records, newest first. */
  listPending(principal: string | null): Promise<ApprovalRecord[]>
  /** Pending → approved. Null when it is not pending (decided, used, expired, unknown). */
  approve(id: string, by: string): Promise<ApprovalRecord | null>
  /** Pending → denied. Null when it is not pending. */
  deny(id: string, by: string): Promise<ApprovalRecord | null>
  /** Approved → used, once. False when it is not approved (or already used, or expired). */
  use(id: string): Promise<boolean>
}

export type KvApprovalsOptions = {
  /** How long a pending record can be approved, and an approved one used, in seconds. Default 86400 (a day). */
  ttlSeconds?: number
  /** How long a record is kept after it expires, for the person's history. Default 7 days. */
  keepSeconds?: number
  prefix?: string
  /** Every request, decision and use: write it to an audit log. A throw is ignored. */
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` lets a callback that returns nothing type-check
  onEvent?: (event: ApprovalEvent) => void | Promise<unknown>
}

function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Approvals in any `KeyValue` (`memoryKv`, Workers KV, Upstash).
 *
 * ponytail: decisions and `use` are read-modify-write, so two retries racing
 * on one approval could both run on a store without transactions. Fine for a
 * person approving one action; for a hard once-only guarantee implement
 * `Approvals` over SQL with a conditional update.
 */
export function kvApprovals(kv: KeyValue, opts: KvApprovalsOptions = {}): Approvals {
  const prefix = opts.prefix ?? "signet-approval"
  const ttlMs = (opts.ttlSeconds ?? 86_400) * 1000
  const keepSeconds = opts.keepSeconds ?? 7 * 86_400
  const rec = (id: string) => `${prefix}:a:${id}`
  const callKey = (c: Pick<ApprovalCall, "tool" | "principal" | "fp">) =>
    `${prefix}:c:${c.principal ?? ""}:${c.tool}:${c.fp}`
  const idx = (principal: string | null) => `${prefix}:u:${principal ?? ""}`
  const keep = (r: ApprovalRecord) =>
    Math.max(1, Math.ceil((r.expiresAt - Date.now()) / 1000) + keepSeconds)

  const emit = async (type: ApprovalEvent["type"], record: ApprovalRecord) => {
    try {
      await opts.onEvent?.({ type, record })
    } catch {} // an audit sink that throws must not change the outcome
  }
  const read = async (id: string): Promise<ApprovalRecord | null> => {
    const raw = await kv.get(rec(id))
    if (!raw) return null
    const r = JSON.parse(raw) as ApprovalRecord
    const live = r.status === "pending" || r.status === "approved"
    return live && r.expiresAt <= Date.now() ? { ...r, status: "expired" } : r
  }
  const write = (r: ApprovalRecord) => kv.set(rec(r.id), JSON.stringify(r), { ttlSeconds: keep(r) })
  const readIndex = async (principal: string | null): Promise<string[]> => {
    try {
      const v = JSON.parse((await kv.get(idx(principal))) ?? "[]")
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []
    } catch {
      return []
    }
  }
  const create = async (call: ApprovalCall, extra: Partial<ApprovalRecord>) => {
    const now = Date.now()
    const r: ApprovalRecord = {
      id: newId(),
      ...call,
      status: "pending",
      via: "app",
      createdAt: now,
      expiresAt: now + ttlMs,
      ...extra,
    }
    await write(r)
    return r
  }
  const decide = async (id: string, to: "approved" | "denied", by: string) => {
    const r = await read(id)
    if (r?.status !== "pending") return null
    const next: ApprovalRecord = { ...r, status: to, decidedAt: Date.now(), decidedBy: by }
    await write(next)
    await emit(to, next)
    return next
  }

  return {
    async find(call) {
      const id = await kv.get(callKey(call))
      const r = id ? await read(id) : null
      return r && (r.status === "pending" || r.status === "approved" || r.status === "denied")
        ? r
        : null
    },
    async request(call) {
      const live = await this.find(call)
      if (live?.status === "pending") return live
      const r = await create(call, {})
      await kv.set(callKey(call), r.id, { ttlSeconds: Math.ceil(ttlMs / 1000) })
      const ids = await readIndex(call.principal)
      await kv.set(idx(call.principal), JSON.stringify([r.id, ...ids].slice(0, 200)), {
        ttlSeconds: Math.ceil(ttlMs / 1000) + keepSeconds,
      })
      await emit("requested", r)
      return r
    },
    async answered(call, approved) {
      const now = Date.now()
      const by = call.principal ?? "anonymous"
      const r = await create(call, {
        status: approved ? "used" : "denied",
        via: "elicitation",
        decidedAt: now,
        decidedBy: by,
        ...(approved ? { usedAt: now } : {}),
      })
      await emit(approved ? "approved" : "denied", r)
      if (approved) await emit("used", r)
      return r
    },
    get: read,
    async listPending(principal) {
      const records = await Promise.all((await readIndex(principal)).map(read))
      return records.filter((r): r is ApprovalRecord => r?.status === "pending")
    },
    approve: (id, by) => decide(id, "approved", by),
    deny: (id, by) => decide(id, "denied", by),
    async use(id) {
      const r = await read(id)
      if (r?.status !== "approved") return false
      const used: ApprovalRecord = { ...r, status: "used", usedAt: Date.now() }
      await write(used)
      await kv.delete(callKey(r))
      await emit("used", used)
      return true
    },
  }
}
