/**
 * API-key manager: create (secret shown once), list, revoke, with scopes and
 * optional expiry. Built on `./bearer`: only the SHA-256 hash is stored.
 *
 *   const keys = kvApiKeyStore(kv)
 *   const { token, key } = await createApiKey(keys, { sub, name: "CI", scopes: ["read"], prefix: "app" })
 *   // show `token` once; `key` is safe to list
 */

import type { KeyValue } from "../adapters/index.js"
import { createApiToken, hashIncomingToken } from "./bearer.js"

export type ApiKeyRecord = {
  id: string
  sub: string
  name: string
  /** First characters of the token, for recognising it in a list: `app_1a2b3c`. */
  start: string
  /** SHA-256 hex of the token. Never returned by `listApiKeys`. */
  hash: string
  scopes: string[]
  /** Epoch ms. */
  createdAt: number
  /** Epoch ms, or null for no expiry. */
  expiresAt: number | null
  /** Epoch ms, or null if never used. May lag by up to `touchEverySeconds`. */
  lastUsedAt: number | null
}

/** What is safe to show the owner: the record without its hash. */
export type ApiKeyInfo = Omit<ApiKeyRecord, "hash">

export type ApiKeyStore = {
  put(record: ApiKeyRecord): Promise<void>
  getByHash(hash: string): Promise<ApiKeyRecord | null>
  listByUser(sub: string): Promise<ApiKeyRecord[]>
  /** Delete by id, only if it belongs to `sub`. True when something was deleted. */
  delete(sub: string, id: string): Promise<boolean>
  /** Record use. Must never bring back a deleted key. */
  touch(record: ApiKeyRecord, at: number): Promise<void>
}

/**
 * API keys in any `KeyValue`, looked up by hash. The per-user index is
 * read-modify-write (see `kvSessionStore`): two keys created for one user in
 * the same instant can drop one from the list, though it still authenticates
 * until revoked by an exact store. Use SQL where that matters.
 */
export function kvApiKeyStore(kv: KeyValue, opts: { prefix?: string } = {}): ApiKeyStore {
  const prefix = opts.prefix ?? "signet-key"
  const rec = (hash: string) => `${prefix}:h:${hash}`
  // lastUsedAt in its own key, so a touch racing a revoke cannot rewrite the record back.
  const used = (hash: string) => `${prefix}:used:${hash}`
  const idx = (sub: string) => `${prefix}:u:${sub}`
  const ttlOf = (r: ApiKeyRecord) =>
    r.expiresAt === null
      ? {}
      : { ttlSeconds: Math.max(1, Math.ceil((r.expiresAt - Date.now()) / 1000)) }

  const readIndex = async (sub: string): Promise<string[]> => {
    try {
      const v = JSON.parse((await kv.get(idx(sub))) ?? "[]")
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []
    } catch {
      return []
    }
  }
  const writeIndex = (sub: string, hashes: string[]) =>
    hashes.length ? kv.set(idx(sub), JSON.stringify(hashes)) : kv.delete(idx(sub))

  const getByHash = async (hash: string): Promise<ApiKeyRecord | null> => {
    const raw = await kv.get(rec(hash))
    if (!raw) return null
    try {
      const r = JSON.parse(raw) as ApiKeyRecord
      if (r.expiresAt !== null && r.expiresAt <= Date.now()) return null
      const u = Number((await kv.get(used(hash))) ?? 0)
      return u > (r.lastUsedAt ?? 0) ? { ...r, lastUsedAt: u } : r
    } catch {
      return null
    }
  }

  const list = async (sub: string) => {
    const hashes = await readIndex(sub)
    const records = (await Promise.all(hashes.map(getByHash))).filter(
      (r): r is ApiKeyRecord => r !== null && r.sub === sub,
    )
    if (records.length !== hashes.length)
      await writeIndex(
        sub,
        records.map((r) => r.hash),
      )
    return records
  }

  return {
    async put(r) {
      await kv.set(rec(r.hash), JSON.stringify(r), ttlOf(r))
      const hashes = (await list(r.sub)).map((x) => x.hash)
      await writeIndex(r.sub, [...hashes.filter((h) => h !== r.hash), r.hash])
    },
    getByHash,
    async listByUser(sub) {
      return (await list(sub)).sort((a, b) => b.createdAt - a.createdAt)
    },
    async delete(sub, id) {
      const records = await list(sub)
      const hit = records.find((r) => r.id === id)
      if (!hit) return false
      await Promise.all([kv.delete(rec(hit.hash)), kv.delete(used(hit.hash))])
      await writeIndex(
        sub,
        records.filter((r) => r !== hit).map((r) => r.hash),
      )
      return true
    },
    async touch(r, at) {
      await kv.set(used(r.hash), String(at), ttlOf(r))
    },
  }
}

const info = ({ hash: _hash, ...rest }: ApiKeyRecord): ApiKeyInfo => rest

/**
 * Mint a key. `token` is the only copy of the secret: show it once and drop
 * it. `key` is what to list. `prefix` makes tokens greppable (`app_…`).
 */
export async function createApiKey(
  store: ApiKeyStore,
  input: {
    sub: string
    name: string
    prefix: string
    scopes?: string[]
    /** Omit for a key that never expires. */
    expiresInSeconds?: number
  },
): Promise<{ token: string; key: ApiKeyInfo }> {
  if (!/^[a-z][a-z0-9]{1,15}$/i.test(input.prefix))
    throw new Error("API key prefix must be 2-16 letters or digits, starting with a letter.")
  const { token, hash } = await createApiToken(input.prefix)
  const now = Date.now()
  const record: ApiKeyRecord = {
    id: crypto.randomUUID(),
    sub: input.sub,
    name: input.name.slice(0, 100),
    start: token.slice(0, input.prefix.length + 7),
    hash,
    scopes: [...new Set(input.scopes ?? [])],
    createdAt: now,
    expiresAt: input.expiresInSeconds ? now + input.expiresInSeconds * 1000 : null,
    lastUsedAt: null,
  }
  await store.put(record)
  return { token, key: info(record) }
}

export async function listApiKeys(store: ApiKeyStore, sub: string): Promise<ApiKeyInfo[]> {
  return (await store.listByUser(sub)).map(info)
}

/** Revoke one of `sub`'s keys. False when it does not exist or is someone else's. */
export function revokeApiKey(store: ApiKeyStore, sub: string, id: string): Promise<boolean> {
  return store.delete(sub, id)
}

export type VerifyApiKeyResult =
  | { ok: true; key: ApiKeyInfo }
  | { ok: false; reason: "missing" | "invalid" | "insufficient_scope" }

/**
 * Authenticate `Authorization: Bearer <prefix>_…` against the store. Checks
 * expiry and that the key carries every scope in `scopes`. Records
 * `lastUsedAt` at most once per `touchEverySeconds` (default 60); pass
 * `defer` (e.g. `waitUntilDefer(ctx)`) to keep that write off the response.
 */
export async function verifyApiKey(
  store: ApiKeyStore,
  headers: Headers,
  opts: {
    prefix: string
    scopes?: string[]
    touchEverySeconds?: number
    defer?: (work: Promise<unknown>) => void
  },
): Promise<VerifyApiKeyResult> {
  const hash = await hashIncomingToken(headers, opts.prefix)
  if (!hash) return { ok: false, reason: "missing" }
  // The lookup is by hash of a 256-bit random token, so it is not a timing oracle.
  const record = await store.getByHash(hash)
  if (!record) return { ok: false, reason: "invalid" }
  if (!(opts.scopes ?? []).every((s) => record.scopes.includes(s)))
    return { ok: false, reason: "insufficient_scope" }
  const now = Date.now()
  if ((now - (record.lastUsedAt ?? 0)) / 1000 >= (opts.touchEverySeconds ?? 60)) {
    const work = store.touch(record, now)
    if (opts.defer) opts.defer(work)
    else await work
  }
  return { ok: true, key: info(record) }
}
