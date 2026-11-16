/**
 * Sign-in against signet-server's `clientLoginRoutes` (mounted at `<API>/auth`):
 * authorization code + PKCE through the system browser, with the code returned
 * to a one-shot loopback listener in Rust (`listen_for_callback`). The server
 * matches a port-less registered `http://127.0.0.1/callback` on any port.
 *
 * Tokens live in the Tauri store (`auth.json`) behind `createSession`.
 */

import { createApiClient } from "@dapplelight/signet-lib/api"
import {
  createSession,
  fromTokenResponse,
  tokenEndpointRefresh,
} from "@dapplelight/signet-lib/session"
import { tauriStorage } from "@dapplelight/signet-lib/storage"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { openUrl } from "@tauri-apps/plugin-opener"
import { LazyStore } from "@tauri-apps/plugin-store"
import { createPkce } from "./pkce"

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://localhost:8787/api"
const AUTH = `${API_BASE}/auth`
/** Register this id on the server with redirectUris ["http://127.0.0.1/callback"]. */
export const CLIENT_ID = "__APP_ID__-desktop"
const TIMEOUT_MS = 5 * 60_000

export const session = createSession({
  storage: tauriStorage(new LazyStore("auth.json")),
  refresh: tokenEndpointRefresh(`${AUTH}/token`, CLIENT_ID),
})

export const api = createApiClient({
  baseUrl: API_BASE,
  token: session.token,
  refresh: session.refresh,
  credentials: "omit",
})

export async function signIn(): Promise<void> {
  const { verifier, challenge, state } = await createPkce()
  let onCallback: (query: string) => void = () => {}
  const callback = new Promise<string>((resolve) => {
    onCallback = resolve
  })
  const unlisten = await listen<string>("oauth-callback", (e) => onCallback(e.payload))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const port = await invoke<number>("listen_for_callback")
    const redirectUri = `http://127.0.0.1:${port}/callback`
    const url = new URL(`${AUTH}/authorize`)
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    }).toString()
    await openUrl(url.toString())

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Sign-in timed out")), TIMEOUT_MS)
    })
    const query = new URLSearchParams(await Promise.race([callback, timeout]))
    if (query.get("state") !== state) throw new Error("Sign-in state mismatch")
    const code = query.get("code")
    if (!code)
      throw new Error(query.get("error_description") ?? query.get("error") ?? "Sign-in failed")

    const res = await fetch(`${AUTH}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: CLIENT_ID,
      }),
    })
    if (!res.ok) throw new Error(`Sign-in failed (HTTP ${res.status})`)
    await session.set(fromTokenResponse(await res.json()))
  } finally {
    clearTimeout(timer)
    unlisten()
  }
}

/** Revokes the session on the server (best effort), then forgets the tokens. */
export async function signOut(): Promise<void> {
  const refreshToken = (await session.get())?.refreshToken
  if (refreshToken) {
    await fetch(`${AUTH}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    }).catch(() => {})
  }
  await session.clear()
}
