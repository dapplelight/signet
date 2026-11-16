/**
 * Bearer tokens for clients without cookies (an extension, a desktop app, a
 * CLI, React Native), kept in any `StorageAdapter` and handed to the api
 * client as its token provider.
 *
 *   const session = createSession({ storage: chromeStorage(), refresh: tokenEndpointRefresh(`${api}/auth/token`, "my-extension") })
 *   const api = createApiClient({ baseUrl, credentials: "omit", token: session.token, refresh: session.refresh })
 *   await session.set({ accessToken, refreshToken, expiresAt })   // after sign-in
 *
 * `refresh` is the app's call to its token endpoint; signet-server's
 * `./auth/client-login` answers `grant_type=refresh_token`.
 */

import type { StorageAdapter } from "../storage/index.js"

export type SessionTokens = {
  accessToken: string
  refreshToken?: string
  /** Epoch ms when `accessToken` expires. Absent: used until a 401. */
  expiresAt?: number
}

export type CreateSessionOptions = {
  storage: StorageAdapter
  /** Storage key. Default "signet-session". */
  key?: string
  /**
   * Trade the stored tokens for new ones, or null when the server refuses
   * (refresh token expired or revoked), which clears the session.
   */
  refresh?: (tokens: SessionTokens) => Promise<SessionTokens | null>
  /** Refresh this many ms before `expiresAt`. Default 30 000. */
  skewMs?: number
}

export type Session = {
  get(): Promise<SessionTokens | null>
  set(tokens: SessionTokens): Promise<void>
  clear(): Promise<void>
  /** Called with the new tokens (or null) on every set, clear and refresh. Returns unsubscribe. */
  subscribe(listener: (tokens: SessionTokens | null) => void): () => void
  /** Token provider for `createApiClient({ token })`: the access token, refreshed first when it is about to expire. */
  token(): Promise<string | null>
  /** Refresh function for `createApiClient({ refresh })`: one refresh at a time, the new access token or null. */
  refresh(): Promise<string | null>
}

export function createSession(opts: CreateSessionOptions): Session {
  const key = opts.key ?? "signet-session"
  const skew = opts.skewMs ?? 30_000
  const listeners = new Set<(t: SessionTokens | null) => void>()
  let loaded: Promise<SessionTokens | null> | undefined
  let current: SessionTokens | null = null
  let refreshing: Promise<string | null> | undefined
  // Bumped by every write, so a read or refresh that was in flight can tell it is stale.
  let gen = 0

  // Reads storage into `current` unless a write landed meanwhile. A throw (storage failure) propagates.
  const read = async () => {
    const g = gen
    const raw = await opts.storage.get(key)
    if (g !== gen) return current
    try {
      const t = raw ? (JSON.parse(raw) as SessionTokens) : null
      current = t && typeof t.accessToken === "string" ? t : null
    } catch {
      current = null
    }
    return current
  }

  // Cached after the first success; a failed read is not cached, the next call tries again.
  const load = () => {
    if (!loaded) {
      const p = read()
      loaded = p
      p.catch(() => {
        if (loaded === p) loaded = undefined
      })
    }
    return loaded
  }

  const write = async (tokens: SessionTokens | null) => {
    gen++
    current = tokens
    loaded = Promise.resolve(tokens)
    if (tokens) await opts.storage.set(key, JSON.stringify(tokens))
    else await opts.storage.remove(key)
    for (const l of listeners) l(tokens)
  }

  const refresh = (): Promise<string | null> => {
    refreshing ??= (async () => {
      try {
        const before = await load()
        // Another context sharing the storage may have refreshed (and rotated the refresh token) since we cached.
        const t = await read()
        if (t?.accessToken !== before?.accessToken) {
          for (const l of listeners) l(t)
          return t?.accessToken ?? null
        }
        if (!t?.refreshToken || !opts.refresh) return null
        const g = gen
        const next = await opts.refresh(t)
        // A set() or clear() while the request was out wins over this result.
        if (g !== gen) return current?.accessToken ?? null
        await write(next)
        return next?.accessToken ?? null
      } finally {
        refreshing = undefined
      }
    })()
    return refreshing
  }

  return {
    async get() {
      await load()
      return current
    },
    set: (tokens) => write(tokens),
    clear: () => write(null),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async token() {
      await load()
      const t = current
      if (!t) return null
      if (t.expiresAt !== undefined && t.expiresAt - skew <= Date.now() && t.refreshToken)
        return refresh()
      return t.accessToken
    },
    refresh,
  }
}

/** The OAuth token response (`access_token`, `refresh_token`, `expires_in`) as `SessionTokens`. */
export function fromTokenResponse(
  body: { access_token: string; refresh_token?: string; expires_in?: number },
  now = Date.now(),
): SessionTokens {
  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    ...(body.expires_in !== undefined ? { expiresAt: now + body.expires_in * 1000 } : {}),
  }
}

/**
 * A `refresh` for `createSession` that posts `grant_type=refresh_token` to an
 * OAuth token endpoint (signet-server's `clientLoginRoutes` `/token`). A 400 or
 * 401 (refresh token expired, revoked or reused) is null, which signs out; a
 * network error or 5xx throws, which keeps the session for the next try.
 */
export function tokenEndpointRefresh(
  url: string,
  clientId: string,
  fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a),
): (tokens: SessionTokens) => Promise<SessionTokens | null> {
  return async (tokens) => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken ?? "",
        client_id: clientId,
      }),
    })
    if (res.status === 400 || res.status === 401) return null
    if (!res.ok) throw new Error(`Token refresh failed (HTTP ${res.status})`)
    return fromTokenResponse(await res.json())
  }
}
